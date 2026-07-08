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
//   data-i18n="key"           → element.textContent  (HTML-escaped)
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
// * `{Token}`-shaped non-matches in a locale value (case mismatch, typo)
//   → hard-fail at load time (H6). No silent literal `{Token}` in output.
//
// Idempotency
// -----------
// applyLocale is a pure function of (html, locale, dict, ctx). The plugin
// doesn't mutate the source tree. Vite invokes transformIndexHtml once
// per input; the closeBundle hook is where the BG mirror gets emitted.
//
// Trust model
// -----------
// Locale JSONs are edited by translators/marketers who are trusted to
// commit sensible copy but NOT trusted to write raw HTML/JS. All the
// hard-fails above exist to catch translator mistakes at build time so
// a bad string never reaches the browser. The threat is "translator
// accidentally pastes something dangerous," not "translator actively
// tries to exploit the site" — but we still fail-closed on every
// bypass attempt we can think of, because latent hazards become live
// hazards after refactors.

import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { parse as parseHtml } from 'node-html-parser';

// Shared parser options — threaded through EVERY parseHtml call so the
// outer page, the sanitizer wrapper, and the noscript re-parse all
// interpret markup the same way. Diverging options between call sites
// is exactly the class of bug M12 flagged.
const PARSER_OPTIONS = {
  lowerCaseTagName: false,
  comment: true,
};

// Cap on nested-object depth in a locale JSON. 32 is generous — the deepest
// real key in en.json is `common.header._note_DO_NOT_TRANSLATE_lang_aria_keys`
// at 4 segments. This exists to hard-fail on a malformed 10k-deep JSON
// (accidental translation-tool export loop) BEFORE the recursion blows
// Node's stack with an opaque RangeError (L16).
const MAX_FLATTEN_DEPTH = 32;

// ============================================================================
// 0. Safety helpers
// ============================================================================

/**
 * Own-property "has" check that doesn't walk the prototype chain.
 *
 * `key in obj` returns true for `toString`, `hasOwnProperty`, `constructor`,
 * `__proto__`, and every other Object.prototype member — a data-i18n marker
 * like `data-i18n="toString"` would then bypass the "unknown key" hard-fail
 * (C3, dual-flagged by pr-reviewer, Finder A, Finder D). Use this everywhere
 * we're checking membership in an object that might have prototype-inherited
 * properties, which for plain-JSON parsed dicts is ALWAYS.
 */
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

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
 *
 * Security (M11): symlinks under localesDir are rejected. A translator with
 * write access to `locales/` could otherwise commit `locales/pl.json` as a
 * symlink to `../../.git/config` or any JSON-shaped file on the build host;
 * loadDictionaries would then read it, and if it parses as JSON, echo up
 * to 5 of its top-level keys into the asymmetry-error message that CI
 * pipes to build logs. We just refuse to read symlinks.
 */
export function loadDictionaries(localesDir) {
  const entries = readdirSync(localesDir);
  // Case-normalize the filename check (L15): on case-insensitive filesystems
  // (macOS default) a rename to `EN.JSON` still reads as a locale JSON, but
  // we lowercase before extracting the locale name so `EN` doesn't survive
  // to break the `locales.includes('en')` check downstream.
  const files = entries.filter((f) => f.toLowerCase().endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`[i18n] no locale JSONs found under ${localesDir}`);
  }

  const dicts = {};
  for (const file of files) {
    const fullPath = join(localesDir, file);
    // Reject symlinks — see M11 above.
    const st = lstatSync(fullPath);
    if (st.isSymbolicLink()) {
      throw new Error(
        `[i18n] refusing to read symlinked locale file: ${file}. Locale JSONs must be regular files inside ${localesDir}.`,
      );
    }
    if (!st.isFile()) {
      throw new Error(`[i18n] ${file} is not a regular file`);
    }

    // Locale name = filename stem, lowercased for stable comparison.
    const locale = file.replace(/\.json$/i, '').toLowerCase();
    const raw = readFileSync(fullPath, 'utf-8');
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

  // Token symmetry — every {token} present in the reference locale's value
  // must also appear in every other locale's value at the same key. Uses the
  // STRICT token shape [a-z_][a-z0-9_]*; anything that looks token-shaped but
  // doesn't match (e.g. `{Phone}`, `{PRIVACY_URL}`) is caught by
  // rejectMalformedTokens below (H6) so it can't slip past this check as
  // prose.
  const tokensByKey = {};
  for (const key of referenceKeys) {
    // Validate BOTH locales for token-shape issues at load time. Catches
    // uppercase-cased tokens, empty {} placeholders, hyphens-in-names, etc.
    for (const locale of locales) {
      rejectMalformedTokens(dicts[locale][key], key, locale);
    }
    const refTokens = collectTokens(dicts[locales[0]][key] || '');
    tokensByKey[key] = refTokens;
    for (const locale of locales.slice(1)) {
      const val = dicts[locale][key] || '';
      const tokens = collectTokens(val);
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
 * Leaves are strings; anything else (array, null, number, bool) is an
 * error at build time. Depth-capped at MAX_FLATTEN_DEPTH to prevent
 * stack overflow on pathological JSON (L16).
 */
function flatten(obj, prefix = '', out = {}, depth = 0) {
  if (depth > MAX_FLATTEN_DEPTH) {
    throw new Error(
      `[i18n] locale JSON exceeds max nesting depth (${MAX_FLATTEN_DEPTH}) at "${prefix}" — likely malformed`,
    );
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null) {
      throw new Error(
        `[i18n] null value at "${key}" — leaves must be strings`,
      );
    }
    if (Array.isArray(v)) {
      throw new Error(
        `[i18n] array value at "${key}" — leaves must be strings, not arrays`,
      );
    }
    if (typeof v === 'object') {
      flatten(v, key, out, depth + 1);
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
// 2. Token helpers
// ============================================================================

// Token identifier shape — must match interpolate() below AND the strict
// case-sensitive regex in loadDictionaries. Lowercase-only + underscore +
// digits after the first char. Kept as a single source of truth so
// tightening/broadening the shape is a one-line change.
const TOKEN_NAME_RE = /^[a-z_][a-z0-9_]*$/;
const TOKEN_MATCH_RE = /\{([a-z_][a-z0-9_]*)\}/g;
// Broader regex used ONLY to detect malformed `{Something}` — anything that
// LOOKS like a token but doesn't fit TOKEN_NAME_RE gets rejected at load
// time (H6). Without this, `{Phone}` or `{PRIVACY_URL}` would ship literally
// to production because interpolate() silently ignores non-matching braces.
const TOKEN_SUSPECT_RE = /\{([^{}\s]+)\}/g;

function collectTokens(str) {
  // `.match()` with /g returns array-of-matches OR null; we want a Set.
  // Each match is the raw `{name}` (used for symmetry diffing).
  return new Set(str.match(TOKEN_MATCH_RE) || []);
}

/**
 * Reject any {something} sequence in the value that doesn't parse as a
 * strict lowercase-identifier token. Used at load time so a translator
 * who writes `{Phone}` or `{PRIVACY_URL}` gets a build error immediately
 * instead of shipping the literal string (H6). Prose curly-brace usages
 * like `{TODO}` or `{redacted}` in dev-facing values need to be escaped
 * or rephrased — this is deliberate.
 */
function rejectMalformedTokens(value, key, locale) {
  if (typeof value !== 'string') return;
  // Reset lastIndex on the global regex since we reuse it across calls.
  TOKEN_SUSPECT_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_SUSPECT_RE.exec(value)) !== null) {
    const inner = m[1];
    if (!TOKEN_NAME_RE.test(inner)) {
      throw new Error(
        `[i18n] malformed token "{${inner}}" at "${key}" in ${locale} — tokens must match [a-z_][a-z0-9_]*. Rename or escape the braces.`,
      );
    }
  }
}

// ============================================================================
// 3. Interpolation + sanitizer helpers
// ============================================================================

/**
 * Replace {name} tokens in a string with values from ctx. Missing tokens
 * hard-fail — the dictionary declared a token that nobody supplies is
 * almost always a rename bug (renamed `email_href` in vite.config.js's
 * i18nContext but forgot to update the locale JSON, or vice-versa).
 *
 * Uses hasOwn + explicit null check (H5): `'phone' in {phone: undefined}` is
 * true, but returning undefined via String.prototype.replace callback
 * stringifies it as literal "undefined" — a silent failure the design's
 * "hard-fail on missing token" invariant is meant to prevent. We require
 * both presence AND a non-null, string-coercible value.
 */
export function interpolate(str, ctx, keyForError = '<unknown>') {
  return str.replace(TOKEN_MATCH_RE, (_, name) => {
    if (!hasOwn(ctx, name)) {
      throw new Error(
        `[i18n] missing context value {${name}} referenced by key "${keyForError}"`,
      );
    }
    const value = ctx[name];
    if (value == null) {
      throw new Error(
        `[i18n] context value {${name}} for key "${keyForError}" is ${value === null ? 'null' : 'undefined'}`,
      );
    }
    if (typeof value !== 'string') {
      throw new Error(
        `[i18n] context value {${name}} for key "${keyForError}" is a ${typeof value}, expected string`,
      );
    }
    return value;
  });
}

/**
 * Escape a string for use inside an HTML attribute value that WE serialise
 * ourselves via a template literal. Five-char escape covering `&`, `"`,
 * `<`, `>`, `'`.
 *
 * Contract: caller MUST wrap the interpolated result in double or single
 * quotes. Unquoted attributes (e.g. `<tag attr=${escapeHtmlAttr(v)}>`) are
 * NOT safe here — space/tab/backtick/= can still break out. If Part 2's
 * head-injection templates ever emit unquoted attributes, either broaden
 * this escape or introduce a separate helper (L21).
 *
 * NOT used for setAttribute() calls — node-html-parser's setAttribute
 * does its own escaping for the delimiter it happens to pick, but does
 * NOT escape `&` (H8). See applyValueEscapedForAttr below for that path.
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
 * Safely set an attribute on a node-html-parser Element. Pre-escapes
 * ampersands so bare `Bed & Breakfast` doesn't emit invalid HTML5
 * `title="Bed & Breakfast"` (H8). Ampersand is the only character
 * setAttribute forgets — quotes and `<>` are handled by the parser's
 * internal serialiser.
 *
 * Rationale for pre-escape only on `&`: fully calling escapeHtmlAttr would
 * double-escape the characters setAttribute already handles. This is the
 * minimal delta.
 */
function safeSetAttribute(el, name, value) {
  el.setAttribute(name, String(value).replace(/&/g, '&amp;'));
}

/**
 * Set an element's textContent safely — clears every child node and
 * appends a single text node. Replaces the previous set_content() call
 * which parsed the argument as HTML (C1), meaning any locale value
 * containing `<`, `>`, `&` would be interpreted as markup and either
 * corrupt the output or inject markup into the emitted page.
 *
 * node-html-parser's TextNode constructor lives on the parser's exports;
 * we synthesise a text node by parsing a wrapper with an escaped payload
 * and re-attaching. This is verbose but robust across the ^9.x range,
 * where the direct TextNode-constructor path has changed shape between
 * patch releases.
 */
function setTextContent(el, text) {
  // Clear existing children.
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
  // Emit an HTML-escaped payload wrapped in a placeholder we can grab.
  // Using a synthetic <s> element (kept out of the ALLOWED_HTML_TAGS list
  // is fine — we never emit it) purely as a container to extract the
  // parser's normalised text node.
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const holder = parseHtml(`<s>${escaped}</s>`, PARSER_OPTIONS);
  const holderEl = holder.querySelector('s');
  for (const child of [...holderEl.childNodes]) {
    holderEl.removeChild(child);
    el.appendChild(child);
  }
}

/**
 * Sanitize an HTML fragment intended for `data-i18n-html` insertion.
 * Allowlists:
 *   - tags:    <a>, <strong>, <em>, <br>
 *   - attrs:   href (on <a> only), target, rel  (case-INsensitive match)
 *   - schemes: http:, https:, mailto:, tel:, plus internal `/` (NOT `//`
 *              — protocol-relative URLs like //evil.com are rejected — C2)
 *              plus `#` and empty
 *
 * Anything outside the allowlists is a hard-fail. This is DELIBERATELY
 * strict — the data-i18n-html mechanism exists because a handful of
 * locale strings need inline formatting (bold prices, an inline privacy-
 * policy link in a consent line). It is NOT a general "insert arbitrary
 * HTML from a JSON file" escape hatch.
 *
 * target="_blank" is REJECTED (M14). No legitimate use case in Task #47
 * requires it, and allowing it creates a reverse-tabnabbing surface
 * (rel="noopener" enforcement would be more complex + fragile).
 */
const ALLOWED_HTML_TAGS = new Set(['a', 'strong', 'em', 'br']);
const ALLOWED_HTML_ATTRS = {
  a: new Set(['href', 'rel']),
  strong: new Set(),
  em: new Set(),
  br: new Set(),
};
const ALLOWED_HREF_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

export function sanitizeHtmlFragment(html, keyForError = '<unknown>') {
  // Iterate the root's children directly rather than wrapping in a
  // synthetic <div>. If the input contains a stray `</div>` (M13), the
  // wrapper-based approach used to silently drop content instead of
  // hard-failing; iterating the root treats every top-level node
  // uniformly and refuses anything outside the allowlist.
  const root = parseHtml(html, PARSER_OPTIONS);
  walkFragment(root, keyForError);
  return root.toString();
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
      // Attribute allowlist — case-INsensitive (H7). node-html-parser
      // preserves original attribute casing on .attributes; a translator
      // writing `<a HREF="/x">` should not get a confusing error, and
      // more importantly the scheme check below must run regardless of
      // how the attribute was cased in the source.
      const allowedAttrs = ALLOWED_HTML_ATTRS[tag];
      const attrs = child.attributes || {};
      let hrefValue = null;
      for (const rawAttrName of Object.keys(attrs)) {
        const attrName = rawAttrName.toLowerCase();
        if (!allowedAttrs.has(attrName)) {
          throw new Error(
            `[i18n] disallowed attribute [${rawAttrName}] on <${tag}> for key "${keyForError}"`,
          );
        }
        if (tag === 'a' && attrName === 'href') {
          hrefValue = attrs[rawAttrName];
        }
      }
      if (hrefValue != null && !isAllowedHref(hrefValue)) {
        throw new Error(
          `[i18n] disallowed href "${hrefValue}" in data-i18n-html for key "${keyForError}" — allowed: ${ALLOWED_HREF_SCHEMES.join(', ')}, plus internal /path, #anchor, empty`,
        );
      }
      walkFragment(child, keyForError);
    }
    // Text nodes pass through. Comments are dropped by the parser at
    // read time (PARSER_OPTIONS has comment:true which PRESERVES them —
    // and that's fine, translator-authored comments are benign and would
    // hard-fail on the tag check anyway if they contained one).
  }
}

/**
 * href allowlist:
 *   - `//example.com`   → REJECTED (protocol-relative → external, C2)
 *   - `/internal/path`  → allowed (site-internal)
 *   - `#anchor`         → allowed (in-page)
 *   - `http:` / `https:` / `mailto:` / `tel:` → allowed
 *   - anything else (empty is technically legal but rare — treat as safe) → allowed
 *
 * Note: L19 dropped the redundant `href === '' || href === '#'` early
 * return — the general prefix check subsumes both.
 */
function isAllowedHref(href) {
  // Reject protocol-relative URLs FIRST. These match `startsWith('/')`
  // but resolve to https://... at browse time, defeating the scheme
  // allowlist entirely.
  if (href.startsWith('//')) return false;
  if (href === '' || href.startsWith('/') || href.startsWith('#')) return true;
  return ALLOWED_HREF_SCHEMES.some((scheme) => href.toLowerCase().startsWith(scheme));
}

// ============================================================================
// 4. Per-page transform
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
  const root = parseHtml(html, PARSER_OPTIONS);
  // Recurse the whole tree including <noscript> subtrees. node-html-parser
  // parses <noscript> content as ordinary elements (unlike a real browser
  // where it's inert text) — that's what we want at build time so the
  // markers inside work.
  transformSubtree(root, opts);
  return root.toString();
}

/**
 * Walk a DOM subtree, resolving every data-i18n* marker found on any
 * element (depth-first). Marker attributes are REMOVED after the value
 * is applied so the emitted HTML doesn't leak the dictionary key names.
 *
 * Precedence when a single element carries multiple markers (L20):
 *   1. Decide first: data-i18n-html and data-i18n on the same element is
 *      a build error (they contradict each other).
 *   2. Apply the text/html marker FIRST. If we ran attr markers first, a
 *      pathological data-i18n-attr="data-i18n:some.key" would set a
 *      data-i18n attribute mid-iteration and the text-write step would
 *      then apply on top — attr-marker outputs must not influence the
 *      text/html decision.
 *   3. Apply attr markers AFTER — attributes don't touch children, so
 *      running them post-text is safe. They also read el.hasAttribute
 *      independently of anything set_content/innerHTML did.
 *
 * H4 (orphan iteration): when data-i18n-html replaces innerHTML, every
 * descendant marker-bearing element in the pre-collected node list
 * becomes detached. We deduplicate by tracking a WeakSet of elements
 * that have been swallowed by an ancestor's innerHTML rewrite; those
 * are skipped in the remainder of the loop.
 */
function transformSubtree(root, opts) {
  const { pagePath } = opts;

  const nodes = root.querySelectorAll(
    '[data-i18n], [data-i18n-attr], [data-i18n-html], [data-i18n-meta]',
  );
  // Track elements orphaned by an ancestor's innerHTML rewrite.
  const orphaned = new WeakSet();
  for (const el of nodes) {
    if (orphaned.has(el)) continue;
    // If an ancestor is orphaned, so is this element. querySelectorAll
    // returned parents before children (depth-first), so an ancestor's
    // rewrite has already run by the time we visit its descendants.
    if (hasOrphanedAncestor(el, orphaned)) {
      orphaned.add(el);
      continue;
    }

    const hasText = el.hasAttribute('data-i18n');
    const hasHtml = el.hasAttribute('data-i18n-html');
    if (hasText && hasHtml) {
      throw new Error(
        `[i18n] ${pagePath}: element has both data-i18n and data-i18n-html — pick one`,
      );
    }

    // Text/html marker FIRST (see precedence comment above).
    if (hasHtml) {
      const key = el.getAttribute('data-i18n-html');
      const value = lookup(opts.dict, key, pagePath);
      const interpolated = interpolate(value, opts.ctx, key);
      // Mark every current descendant orphaned BEFORE the innerHTML rewrite
      // so the outer loop's orphan-guard skips them.
      for (const desc of el.querySelectorAll('*')) {
        orphaned.add(desc);
      }
      el.set_content(sanitizeHtmlFragment(interpolated, key));
      el.removeAttribute('data-i18n-html');
    } else if (hasText) {
      const key = el.getAttribute('data-i18n');
      const value = lookup(opts.dict, key, pagePath);
      setTextContent(el, interpolate(value, opts.ctx, key));
      el.removeAttribute('data-i18n');
    }

    // Attribute markers AFTER.
    handleAttrMarker(el, opts, 'data-i18n-attr');
    handleAttrMarker(el, opts, 'data-i18n-meta', /* fixedAttr */ 'content');
  }

  // Recurse into <noscript>. Parse the innerHTML first, then check the
  // parsed DOM for actual marker attributes — a text substring match
  // (M9) had false positives (a translated string containing the literal
  // text "data-i18n=" would re-parse, then throw an "unknown key" on the
  // fake match). Parsing once and querying is both faster and correct.
  const noscripts = root.querySelectorAll('noscript');
  for (const ns of noscripts) {
    const inner = ns.innerHTML;
    if (inner.length === 0) continue;
    const nested = parseHtml(inner, PARSER_OPTIONS);
    // Only recurse if the parsed DOM actually carries at least one marker.
    if (
      nested.querySelectorAll(
        '[data-i18n], [data-i18n-attr], [data-i18n-html], [data-i18n-meta]',
      ).length === 0
    ) {
      continue;
    }
    transformSubtree(nested, opts);
    ns.set_content(nested.toString());
  }
}

function hasOrphanedAncestor(el, orphaned) {
  let p = el.parentNode;
  while (p) {
    if (orphaned.has(p)) return true;
    p = p.parentNode;
  }
  return false;
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
 *
 * Empty attr name is rejected (M10) — `:key` or `attr::key` used to
 * silently emit malformed HTML like `<div ="val">`.
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
    if (attr.length === 0) {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}" has empty attr name (expected attr:key)`,
      );
    }
    if (key.length === 0) {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}" has empty key (expected attr:key)`,
      );
    }
  }
  const value = lookup(opts.dict, key, opts.pagePath);
  safeSetAttribute(el, attr, interpolate(value, opts.ctx, key));
  el.removeAttribute(markerName);
}

/**
 * Look up a key in the flat dictionary. Missing keys are a build error
 * with the source path + key name so the dev knows exactly which
 * data-i18n marker points at nothing.
 *
 * Uses hasOwn (C3) — `key in dict` walks the prototype chain and would
 * silently return Object.prototype.toString etc. for keys that happen
 * to name a native method.
 */
function lookup(dict, key, pagePath) {
  if (!hasOwn(dict, key)) {
    throw new Error(
      `[i18n] ${pagePath}: unknown key "${key}"`,
    );
  }
  return dict[key];
}

// ============================================================================
// 5. Vite plugin factory
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
 *   inputs      — Vite's rollup input map (same object passed to build.rollupOptions.input).
 *                 TODO(part2): the plugin uses this to enumerate which
 *                 pages get the BG mirror emit; currently accepted for
 *                 forward-compat only.
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
  const { locales, dicts } = loadDictionaries(localesDir);

  // The DEFAULT locale is the one whose emitted path stays at the site root.
  const DEFAULT_LOCALE = 'en';
  if (!locales.includes(DEFAULT_LOCALE)) {
    throw new Error(
      `[i18n] default locale "${DEFAULT_LOCALE}" not among discovered locales [${locales.join(', ')}]`,
    );
  }

  // Every locale MUST have a context entry, and every value in that entry
  // must be a non-empty string (H5 stringency — an undefined phone value
  // in the context is a silent-failure vector otherwise).
  for (const locale of locales) {
    if (!hasOwn(contextByLocale, locale)) {
      throw new Error(
        `[i18n] contextByLocale missing entry for locale "${locale}"`,
      );
    }
    const ctx = contextByLocale[locale];
    if (!ctx || typeof ctx !== 'object') {
      throw new Error(
        `[i18n] contextByLocale.${locale} must be an object`,
      );
    }
    for (const [name, value] of Object.entries(ctx)) {
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(
          `[i18n] contextByLocale.${locale}.${name} must be a non-empty string`,
        );
      }
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
     * on disk. We derive the page-relative path via path.relative (L17),
     * which correctly handles Windows path separators AND the case where
     * the filename lives outside projectRoot (virtual/generated sources).
     * Falls back to a `<unknown>` marker if there's no filename at all.
     */
    transformIndexHtml: {
      order: 'pre',
      handler(html, viteCtx) {
        const abs = viteCtx?.filename || '';
        let rel;
        if (!abs) {
          rel = '<unknown>';
        } else {
          rel = relative(projectRoot, abs);
          // path.relative returns absolute if not under projectRoot; keep
          // the absolute path in that case so the error anchor is still
          // useful. Normalise separators to `/` so the display is
          // platform-consistent.
          rel = rel.split(sep).join('/');
        }
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
