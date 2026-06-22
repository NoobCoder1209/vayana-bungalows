import { SITE_CONFIG } from './site-config.js';

// Hydrate elements that opt in via data-site-config="<dotted.path>" with a
// value from SITE_CONFIG. The HTML must already render canonical text
// inline so the page is readable without JS — this only OVERWRITES the
// inline value if the config has drifted (e.g. someone changed phone in
// site-config.js but forgot to sweep the HTML), keeping a single source
// of truth without breaking the no-JS path.
//
// Supported targets:
//   <span data-site-config="phone.display">…</span>     -> textContent
//   <a data-site-config-href="phone.href">…</a>         -> href attribute (scheme-allowlisted)
//   <a data-site-config-path="policies.terms">…</a>     -> import.meta.env.BASE_URL + value (href attribute)
//
// "<path>" is dot-separated (phone.display, address.line1, social.facebook).

// Defense-in-depth: even though SITE_CONFIG values are dev-controlled, the
// helper is generic and will likely be reused for header / contact sections.
// A future config edit must not be able to slip a javascript: URL into an
// <a href> via setAttribute. Allowlist HTTP(S), tel:, mailto:, and root- /
// site-relative paths (./, single-/ but not //, ?, #).
//
// `\/(?!\/)` allows `/foo` but rejects `//evil.com` (protocol-relative URLs
// resolve to the page's scheme + that host, i.e. an off-site redirect on
// HTTPS pages — same threat class as javascript: but easier to overlook).
const SAFE_HREF = /^(https?:|tel:|mailto:|\/(?!\/)|[.?#])/i;

// Skip prototype-walking keys when traversing dotted paths. Not exploitable
// with today's hardcoded SITE_CONFIG, but if the helper is ever extended to
// read paths from URL params or another user-controlled source, this stays a
// pure-read primitive instead of an Object.prototype reflection.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function readPath(obj, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc == null) return acc;
    if (FORBIDDEN_KEYS.has(key)) return undefined;
    return acc[key];
  }, obj);
}

function warnMissing(kind, path) {
  // Catches typo'd data-site-config="phon.display" attributes early in dev,
  // before they silently rot. Stays harmless in prod (just a console line).
  console.warn(`[site-config-inject] ${kind} "${path}" did not resolve to a string in SITE_CONFIG`);
}

function hydrate(root = document) {
  // Text content
  for (const el of root.querySelectorAll('[data-site-config]')) {
    const path = el.getAttribute('data-site-config');
    const value = readPath(SITE_CONFIG, path);
    if (typeof value !== 'string') {
      warnMissing('data-site-config', path);
      continue;
    }
    if (el.textContent !== value) el.textContent = value;
  }
  // Direct href (already-formed URL: tel:, mailto:, https:)
  for (const el of root.querySelectorAll('[data-site-config-href]')) {
    const path = el.getAttribute('data-site-config-href');
    const value = readPath(SITE_CONFIG, path);
    if (typeof value !== 'string') {
      warnMissing('data-site-config-href', path);
      continue;
    }
    if (!SAFE_HREF.test(value)) {
      console.warn(`[site-config-inject] data-site-config-href "${path}" rejected: unsafe URL scheme`);
      continue;
    }
    if (el.getAttribute('href') !== value) el.setAttribute('href', value);
  }
  // Site-relative path that needs the build-time base prefix
  // (e.g. policies.terms = "terms/" → "/vayana-bungalows/terms/" in prod, "/terms/" in dev)
  for (const el of root.querySelectorAll('[data-site-config-path]')) {
    const path = el.getAttribute('data-site-config-path');
    const value = readPath(SITE_CONFIG, path);
    if (typeof value !== 'string') {
      warnMissing('data-site-config-path', path);
      continue;
    }
    // Symmetric defense with SAFE_HREF on the href branch: a config value
    // shouldn't slip through with a leading scheme or // (which would make
    // the BASE_URL prefix concatenation produce an off-site redirect under
    // some browsers' URL normalization). Path values are expected to be
    // relative ("terms/"), no leading slash, no scheme.
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) {
      console.warn(`[site-config-inject] data-site-config-path "${path}" rejected: must be a relative path, not a URL`);
      continue;
    }
    const href = `${import.meta.env.BASE_URL}${value}`;
    if (el.getAttribute('href') !== href) el.setAttribute('href', href);
  }
}

export function initSiteConfig() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => hydrate());
  } else {
    hydrate();
  }
}
