// Build-time i18n plugin (#47) — Part 1: loader, per-page transform, Vite hook.
//
// Overview
// --------
// Vayana Bungalows is a Vite multi-page (MPA) static build. Each source
// HTML file (index.html, enquiries/index.html, ...) is authored ONCE in
// English with `data-i18n*` markers on translatable elements. This plugin
// runs each page through the transform TWICE at build time:
//
//   - EN pass → dist/<path>/index.html      (root — the default locale)
//   - BG pass → dist/bg/<path>/index.html   (path-prefix mirror)
//
// Locale dictionaries live under `locales/`:
//   - locales/en.json — English content, source of truth for the key set
//   - locales/bg.json — Bulgarian, MUST declare the exact same keys (147×2
//                        as of Task #162; symmetry hard-fails the build if
//                        broken)
//
// Marker vocabulary
// -----------------
//   data-i18n="key"           → element.textContent
//   data-i18n-attr="attr:key" → element.setAttribute(attr, value)
//                               (split on the LAST `:` — attr may contain
//                               `:` (aria-labelledby, xlink:href, etc.),
//                               dict keys never do)
//   data-i18n-html="key"      → element.innerHTML, via sanitizer (only
//                               <a> <strong> <em> <br> allowed; href scheme
//                               allowlist: http, https, mailto, tel, /, #)
//   data-i18n-meta="key"      → <meta content="value">
//
// The head-injection block (hreflang alternates, per-locale canonical/og
// URL rewrite, boot-redirect script, `<html lang>`, `data-lang-pill-
// expected` marker) lands in Part 2 of Task #163 — this file will grow
// to add it.
//
// Interpolation tokens
// --------------------
// Locale values may embed `{name}` tokens; they resolve from the
// `context` map passed at plugin registration (see vite.config.js's
// i18nContext block). Tokens supported today:
//   {phone}          — SITE_CONFIG.phone.display
//   {credit}         — brand credit line
//   {privacy_url}    — locale-aware path to /privacy/
//   {email_href}     — mailto:...
//   {email_display}  — plain email address (for visible text)
//
// Every EN token must appear in the same BG key (and vice-versa) —
// enforced by loadDictionaries() at plugin-init time.
//
// Failure modes
// -------------
// * Dictionary asymmetry → hard-fail build (throws in loadDictionaries).
// * Token asymmetry per key → hard-fail build.
// * Missing key at transform time → hard-fail with the page + key so a
//   dev sees exactly which data-i18n marker points at nothing.
// * data-i18n-html value contains a disallowed tag or scheme → hard-fail
//   with the offending fragment.
//
// Idempotency
// -----------
// applyLocale is a pure function of (html, locale, dict, ctx). The plugin
// doesn't mutate the source tree. Vite invokes transformIndexHtml once
// per input; the closeBundle hook is where the BG mirror gets emitted.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseHtml } from 'node-html-parser';

// ============================================================================
// 1. Dictionary loader
// ============================================================================

/**
 * Read every `*.json` in `localesDir`, flatten each into a dotted-key map,
 * and hard-fail if the two locales don't declare the same keys OR if any
 * shared key's value has different {token} placeholders across locales.
 *
 * Returns:
 *   {
 *     locales: ['en', 'bg'],
 *     dicts: { en: {'home.hero.title': '...', ...}, bg: {...} },
 *     tokensByKey: { 'common.header.call_aria': Set{'{phone}'}, ... },
 *   }
 *
 * The tokensByKey map is a downstream sanity aid — the transform can log
 * a helpful error if a key that USED to have a token in EN loses it in a
 * BG copy edit, without needing to re-scan both dicts each pass.
 */
export function loadDictionaries(localesDir) {
  const files = readdirSync(localesDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`[i18n] no locale JSONs found under ${localesDir}`);
  }

  const dicts = {};
  for (const file of files) {
    const locale = file.replace(/\.json$/, '');
    const raw = readFileSync(join(localesDir, file), 'utf-8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `[i18n] ${file} is not valid JSON: ${err.message}`,
      );
    }
    dicts[locale] = flatten(parsed);
  }

  const locales = Object.keys(dicts).sort();
  if (locales.length < 2) {
    throw new Error(
      `[i18n] need ≥2 locale dictionaries; found only [${locales.join(', ')}]`,
    );
  }

  // Symmetry: every locale MUST declare the exact same key set. This is
  // strict — a missing key on one side is almost always a translator
  // dropped it accidentally, and letting it fall through to a fallback
  // ("show the key" or "show EN") ships broken UI to the missing-key
  // locale's users.
  const referenceKeys = new Set(Object.keys(dicts[locales[0]]));
  for (const locale of locales.slice(1)) {
    const localeKeys = new Set(Object.keys(dicts[locale]));
    const missing = [...referenceKeys].filter((k) => !localeKeys.has(k));
    const extra = [...localeKeys].filter((k) => !referenceKeys.has(k));
    if (missing.length || extra.length) {
      const parts = [];
      if (missing.length) {
        parts.push(
          `missing in ${locale} (${missing.length}): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`,
        );
      }
      if (extra.length) {
        parts.push(
          `extra in ${locale} (${extra.length}): ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', ...' : ''}`,
        );
      }
      throw new Error(
        `[i18n] locale dictionaries are not symmetric — ${parts.join('; ')}`,
      );
    }
  }

  // Token symmetry — every {token} present in the reference locale's
  // value must also be present in every other locale's value at the same
  // key. Prevents "we lost the {phone} interpolation in the BG rewrite"
  // shipping a literal `{phone}` to Bulgarian users.
  const tokenRe = /\{[a-z_][a-z0-9_]*\}/g;
  const tokensByKey = {};
  for (const key of referenceKeys) {
    const refTokens = new Set((dicts[locales[0]][key] || '').match(tokenRe) || []);
    tokensByKey[key] = refTokens;
    for (const locale of locales.slice(1)) {
      const val = dicts[locale][key] || '';
      const tokens = new Set(val.match(tokenRe) || []);
      const missingTok = [...refTokens].filter((t) => !tokens.has(t));
      const extraTok = [...tokens].filter((t) => !refTokens.has(t));
      if (missingTok.length || extraTok.length) {
        throw new Error(
          `[i18n] token asymmetry at "${key}" — ${locales[0]} has {${[...refTokens].join(',')}} but ${locale} has {${[...tokens].join(',')}}`,
        );
      }
    }
  }

  return { locales, dicts, tokensByKey };
}

/**
 * Recursively flatten a nested-object dictionary into a dotted-key map.
 * Leaves are strings; anything else is an error at build time.
 */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, key, out);
    } else if (typeof v === 'string') {
      out[key] = v;
    } else {
      throw new Error(
        `[i18n] non-string value at "${key}": ${JSON.stringify(v)}`,
      );
    }
  }
  return out;
}

// ============================================================================
// 2. Interpolation + sanitizer helpers
// ============================================================================

/**
 * Replace {name} tokens in a string with values from ctx. Missing tokens
 * hard-fail — the dictionary declared a token that nobody supplies is
 * almost always a rename bug (renamed `email_href` in vite.config.js's
 * i18nContext but forgot to update the locale JSON, or vice-versa).
 *
 * The tokenRe here is intentionally scoped to the same shape
 * loadDictionaries validates against — [a-z_][a-z0-9_]* — so nothing
 * accidentally matches curly-brace patterns in prose (e.g. a `{TODO}`
 * would slip through the strict identifier regex).
 */
export function interpolate(str, ctx, keyForError = '<unknown>') {
  return str.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, name) => {
    if (!(name in ctx)) {
      throw new Error(
        `[i18n] missing context value {${name}} referenced by key "${keyForError}"`,
      );
    }
    return ctx[name];
  });
}

/**
 * Escape a string for use inside an HTML attribute value. Five-char escape
 * covering `&`, `"`, `<`, `>`, `'` — enough for any place we serialise a
 * value into `attr="..."` construction ourselves (as opposed to going
 * through node-html-parser's setAttribute, which does its own escaping).
 *
 * Used by the head-injection block (Part 2) when we build hreflang and
 * boot-script markup via template literals rather than DOM APIs.
 */
export function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize an HTML fragment intended for `data-i18n-html` insertion.
 * Allowlists:
 *   - tags:    <a>, <strong>, <em>, <br>
 *   - attrs:   href (on <a> only), target, rel
 *   - schemes: http:, https:, mailto:, tel:, plus `/`, `#`, empty
 *
 * Anything outside the allowlists is a hard-fail. This is DELIBERATELY
 * strict — the data-i18n-html mechanism exists because a handful of
 * locale strings need inline formatting (bold prices, an inline privacy-
 * policy link in a consent line, a <br /> in a title). It is NOT a
 * general "insert arbitrary HTML from a JSON file" escape hatch. A
 * translator who edits a locale string and pastes in a `<script>` or
 * `<iframe>` gets a build-break before any user sees it.
 *
 * The href scheme allowlist prevents `javascript:` and `data:` URLs
 * even if a tag happens to be `<a>`. Empty href (or `#` / `/…` internal
 * path) is legal — the plugin fills real URLs via {token} interpolation
 * in most cases anyway.
 */
const ALLOWED_HTML_TAGS = new Set(['a', 'strong', 'em', 'br']);
const ALLOWED_HTML_ATTRS = {
  a: new Set(['href', 'target', 'rel']),
  strong: new Set(),
  em: new Set(),
  br: new Set(),
};
const ALLOWED_HREF_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

export function sanitizeHtmlFragment(html, keyForError = '<unknown>') {
  // Wrap in a synthetic root so node-html-parser gives us the top-level
  // children as document.childNodes rather than a single-root Element.
  const root = parseHtml(`<div>${html}</div>`);
  const wrapper = root.querySelector('div');
  walkFragment(wrapper, keyForError);
  return wrapper.innerHTML;
}

function walkFragment(node, keyForError) {
  for (const child of node.childNodes) {
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const tag = child.rawTagName?.toLowerCase();
      if (!ALLOWED_HTML_TAGS.has(tag)) {
        throw new Error(
          `[i18n] disallowed tag <${tag}> in data-i18n-html value for key "${keyForError}"`,
        );
      }
      // Attribute allowlist
      const allowedAttrs = ALLOWED_HTML_ATTRS[tag];
      for (const attrName of Object.keys(child.attributes || {})) {
        if (!allowedAttrs.has(attrName)) {
          throw new Error(
            `[i18n] disallowed attribute [${attrName}] on <${tag}> for key "${keyForError}"`,
          );
        }
      }
      // Href scheme allowlist
      if (tag === 'a' && child.getAttribute('href')) {
        const href = child.getAttribute('href');
        if (!isAllowedHref(href)) {
          throw new Error(
            `[i18n] disallowed href "${href}" in data-i18n-html for key "${keyForError}" — allowed schemes: ${ALLOWED_HREF_SCHEMES.join(', ')}, plus /, #, empty`,
          );
        }
      }
      walkFragment(child, keyForError);
    }
    // Text/comment nodes pass through unchanged. node-html-parser text
    // nodes are already HTML-escaped by the parser at read time.
  }
}

function isAllowedHref(href) {
  if (href === '' || href === '#') return true;
  if (href.startsWith('/') || href.startsWith('#')) return true;
  return ALLOWED_HREF_SCHEMES.some((scheme) => href.toLowerCase().startsWith(scheme));
}

// ============================================================================
// 3. Per-page transform
// ============================================================================

/**
 * Apply a locale to an HTML string. Pure function of (html, opts). Called
 * once per (page × locale) pair — Vite's transformIndexHtml runs it for
 * EN inline; closeBundle re-runs it for BG on the emitted assets.
 *
 * opts:
 *   locale       — 'en' | 'bg'
 *   dict         — flat { key: value } for this locale
 *   ctx          — interpolation context (per locale — see vite.config.js)
 *   isDefault    — true for EN (path-prefix-less)
 *   basePath     — Vite base, e.g. '/vayana-bungalows/'
 *   pagePath     — the source-tree relative path, e.g. 'enquiries/index.html'
 *
 * Returns the transformed HTML string. Never mutates opts.
 */
export function applyLocale(html, opts) {
  const { locale, dict, ctx, pagePath } = opts;
  const root = parseHtml(html, {
    // Preserve <script> and <style> content verbatim — the default is
    // fine here but making it explicit protects against future parser
    // upgrades changing defaults.
    lowerCaseTagName: false,
    comment: true,
  });

  // Recurse the whole tree including <noscript> subtrees. node-html-parser
  // parses <noscript> content as ordinary elements (unlike a real browser
  // where it's inert text) — that's what we want at build time so the
  // markers inside work.
  transformSubtree(root, { locale, dict, ctx, pagePath });

  return root.toString();
}

/**
 * Walk a DOM subtree, resolving every data-i18n* marker found on any
 * element (depth-first). Marker attributes are REMOVED after the value
 * is applied so the emitted HTML doesn't leak the dictionary key names.
 *
 * Order matters when a single element carries multiple markers:
 *   1. data-i18n-attr — applied first; attribute values are independent
 *      of the element's textContent.
 *   2. data-i18n-meta — same as data-i18n-attr but always writes to
 *      `content` on a <meta> element; separate marker to keep intent
 *      readable at the HTML level.
 *   3. data-i18n-html — writes innerHTML; wipes any pre-existing text
 *      content, so runs after the attribute passes (attrs don't touch
 *      children) but as an alternative to plain data-i18n.
 *   4. data-i18n — plain textContent write; wipes children.
 *
 * data-i18n and data-i18n-html on the same element is a build error —
 * they contradict each other. Explicitly checked below.
 */
function transformSubtree(root, opts) {
  const { dict, ctx, pagePath } = opts;

  // querySelectorAll gives us a flat depth-first list. We iterate over a
  // materialised copy because setAttribute / innerHTML rewrites can move
  // the live NodeList underneath us.
  const nodes = root.querySelectorAll('[data-i18n], [data-i18n-attr], [data-i18n-html], [data-i18n-meta]');
  for (const el of nodes) {
    handleAttrMarker(el, opts, 'data-i18n-attr');
    handleAttrMarker(el, opts, 'data-i18n-meta', /* fixedAttr */ 'content');

    const hasText = el.hasAttribute('data-i18n');
    const hasHtml = el.hasAttribute('data-i18n-html');
    if (hasText && hasHtml) {
      throw new Error(
        `[i18n] ${pagePath}: element has both data-i18n and data-i18n-html — pick one`,
      );
    }

    if (hasHtml) {
      const key = el.getAttribute('data-i18n-html');
      const value = lookup(dict, key, pagePath);
      const interpolated = interpolate(value, ctx, key);
      el.innerHTML = sanitizeHtmlFragment(interpolated, key);
      el.removeAttribute('data-i18n-html');
    } else if (hasText) {
      const key = el.getAttribute('data-i18n');
      const value = lookup(dict, key, pagePath);
      el.set_content(interpolate(value, ctx, key));
      el.removeAttribute('data-i18n');
    }
  }

  // Recurse into <noscript> — node-html-parser treats its contents as
  // text content by default, so we re-parse-and-transform. The BG
  // <noscript> fallback for the newsletter form's mailto link goes
  // through here.
  const noscripts = root.querySelectorAll('noscript');
  for (const ns of noscripts) {
    // Only re-transform if the noscript actually contains markers —
    // otherwise we round-trip its innerHTML through the parser for
    // nothing.
    const inner = ns.innerHTML;
    if (!/\bdata-i18n(-attr|-html|-meta)?=/.test(inner)) continue;
    const nested = parseHtml(inner, { comment: true });
    transformSubtree(nested, opts);
    ns.set_content(nested.toString());
  }
}

/**
 * data-i18n-attr="attr:key" — split on the LAST colon because attr names
 * can contain `:` (aria-labelledby is fine, but xlink:href, xml:lang do
 * exist in the wild) and dictionary keys never do (loadDictionaries
 * validates the dotted-key shape).
 *
 * data-i18n-meta="key" is a shortcut for data-i18n-attr="content:key" on
 * a <meta> element — the plugin still writes to `content` either way,
 * but the shortcut form documents intent at the HTML level. Pass
 * fixedAttr='content' from the meta call site to skip the split step.
 */
function handleAttrMarker(el, opts, markerName, fixedAttr = null) {
  if (!el.hasAttribute(markerName)) return;
  const rawValue = el.getAttribute(markerName);

  let attr, key;
  if (fixedAttr) {
    attr = fixedAttr;
    key = rawValue;
  } else {
    const lastColon = rawValue.lastIndexOf(':');
    if (lastColon < 0) {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}" missing colon separator (expected attr:key)`,
      );
    }
    attr = rawValue.slice(0, lastColon);
    key = rawValue.slice(lastColon + 1);
  }
  const value = lookup(opts.dict, key, opts.pagePath);
  el.setAttribute(attr, interpolate(value, opts.ctx, key));
  el.removeAttribute(markerName);
}

/**
 * Look up a key in the flat dictionary. Missing keys are a build error
 * with the source path + key name so the dev knows exactly which
 * data-i18n marker points at nothing.
 */
function lookup(dict, key, pagePath) {
  if (!(key in dict)) {
    throw new Error(
      `[i18n] ${pagePath}: unknown key "${key}"`,
    );
  }
  return dict[key];
}

// ============================================================================
// 4. Vite plugin factory
// ============================================================================

/**
 * The Vite plugin.
 *
 * options:
 *   localesDir  — absolute path to locales/ directory
 *   contextByLocale — { en: {phone: '...', ...}, bg: {...} }
 *                     Per-locale interpolation context. Values are already
 *                     resolved (SITE_CONFIG.phone.display, etc.) at the
 *                     call site so this file has zero coupling to
 *                     site-config.js.
 *   basePath    — Vite's base config value ('/vayana-bungalows/' in prod, '/' in dev)
 *   projectRoot — absolute path to the repo root
 *   inputs      — Vite's rollup input map (same object passed to build.rollupOptions.input);
 *                 the plugin uses this to enumerate which pages get the BG mirror emit.
 *                 Passed in rather than read from Vite's config so the plugin stays
 *                 testable without a full Vite context.
 *
 * Part 1 (this file) wires up: dictionary load, per-page transform for the
 * DEFAULT locale (EN), and Vite's transformIndexHtml hook so the source HTML
 * is transformed inline during the normal build. Part 2 will add the BG
 * mirror emit (via closeBundle), the head-injection block, and the dev-mode
 * middleware + watcher.
 */
export function i18nPlugin(options) {
  const {
    localesDir,
    contextByLocale,
    basePath,
    projectRoot,
    inputs,
  } = options;

  if (!localesDir || !contextByLocale || !basePath || !projectRoot || !inputs) {
    throw new Error(
      '[i18n] i18nPlugin({ localesDir, contextByLocale, basePath, projectRoot, inputs }) — all fields required',
    );
  }

  // Load + validate dictionaries once at plugin init. Any asymmetry hard-fails
  // right here, before Vite starts its own dep-scan phase.
  const { locales, dicts, tokensByKey } = loadDictionaries(localesDir);

  // The DEFAULT locale is the one whose emitted path stays at the site root
  // (e.g. dist/index.html, dist/enquiries/index.html). The others land under
  // dist/<locale>/. English is the default.
  const DEFAULT_LOCALE = 'en';
  if (!locales.includes(DEFAULT_LOCALE)) {
    throw new Error(
      `[i18n] default locale "${DEFAULT_LOCALE}" not among discovered locales [${locales.join(', ')}]`,
    );
  }

  // Every locale MUST have a context entry — otherwise interpolate() at
  // transform time throws with the token name, not the missing-locale name,
  // which is harder to debug.
  for (const locale of locales) {
    if (!(locale in contextByLocale)) {
      throw new Error(
        `[i18n] contextByLocale missing entry for locale "${locale}"`,
      );
    }
  }

  return {
    name: 'vayana-i18n',
    enforce: 'pre', // run before Vite's built-in HTML processing

    /**
     * transformIndexHtml — Vite calls this once per input HTML page. We
     * transform IN PLACE for the default locale here; the BG mirror emit
     * lands in Part 2 via closeBundle.
     *
     * Vite gives us `ctx.filename` — the absolute path to the source file
     * on disk. We derive the page-relative path (used as the failure-mode
     * anchor in error messages) by stripping the project root.
     */
    transformIndexHtml: {
      order: 'pre',
      handler(html, viteCtx) {
        const abs = viteCtx?.filename || '';
        const rel = abs.startsWith(projectRoot)
          ? abs.slice(projectRoot.length).replace(/^[/\\]/, '')
          : abs;
        return applyLocale(html, {
          locale: DEFAULT_LOCALE,
          dict: dicts[DEFAULT_LOCALE],
          ctx: contextByLocale[DEFAULT_LOCALE],
          isDefault: true,
          basePath,
          pagePath: rel,
        });
      },
    },
  };
}

// Re-exports for tests + the standalone i18n lint script (Task #164).
export { flatten as _flatten };
