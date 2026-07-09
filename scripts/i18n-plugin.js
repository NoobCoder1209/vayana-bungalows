// Build-time i18n plugin (#47) — loader, per-page transform, head injection,
// BG mirror emit, dev middleware.
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
// Head injection (Part 2)
// -----------------------
// After the marker transform, applyHead() rewrites:
//   - `<html lang>`                            → per-locale
//   - `<link rel="canonical">` / og:url / twitter:url  → locale-prefixed URLs
//   - `<link rel="alternate" hreflang="en|bg|x-default">` alternates
//     wrapped in `<!-- i18n:hreflang -->` marker comments so re-transform
//     is idempotent
//   - inline `<head>` boot-redirect script (`<!-- i18n:boot-redirect -->`)
//     that runs BEFORE any stylesheet loads and handles:
//       * ?lang=en|bg override (writes localStorage, redirects if needed)
//       * localStorage return-visit redirect (stored 'bg' + EN page →
//         location.replace(bgUrl))
//     Sets `data-i18n-redirecting="1"` on <html> BEFORE calling
//     location.replace() so click handlers in lang.js can detect a
//     doomed page and skip wiring (protects the stored preference from
//     mid-navigation taps).
//   - `data-lang-pill-expected="1"` on <html> when the source contains a
//     `.site-header__lang` element (signals to lang.js that a missing
//     pill in the rendered DOM is a real regression, not a legit
//     pill-less page).
//
// BG mirror emit
// --------------
// The `closeBundle` hook iterates the emitted asset bundle for every
// input page and writes the BG variant to `dist/bg/<path>/index.html`.
// The BG pass re-transforms the SOURCE HTML (not the EN-transformed
// output) so the two locales are independent and neither can corrupt
// the other.
//
// Dev middleware
// --------------
// `configureServer` installs middleware that serves `/bg/<path>` in
// dev by transforming the source HTML on the fly. An HMR watcher pushes
// a `full-reload` to any BG tabs whenever a locale JSON or source HTML
// file changes.
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
// * Pre-escaped HTML entity (`&amp;`, `&copy;`, `&#39;`, etc.) → hard-fail
//   at load time (RH3). Locale values must be raw Unicode.
// * `../` relative href in emitted HTML → hard-fail at build time (breaks
//   under the /bg/ path prefix).
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

import { readFileSync, readdirSync, lstatSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, relative, sep, dirname, isAbsolute } from 'node:path';
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
    // Validate BOTH locales for token-shape issues + pre-escaped entity
    // hazards at load time. Catches uppercase-cased tokens, empty {}
    // placeholders, hyphens-in-names (H6), AND `&copy;`/`&amp;`-style
    // pre-escapes that would double-escape on emit (RH3).
    for (const locale of locales) {
      rejectMalformedTokens(dicts[locale][key], key, locale);
      rejectPreEscapedEntities(dicts[locale][key], key, locale);
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
    // Reject dot-in-key (M3): a locale that has both `{"home.title": "A"}`
    // at top-level AND `{"home": {"title": "B"}}` would flatten both to
    // the same dotted key `home.title`. Whichever iterates last wins
    // silently — invisible to key-symmetry checks (both locales still
    // declare `home.title`) but the value is ambiguously determined.
    // Reject `.` in individual object keys so the flat key set is
    // well-defined.
    if (k.includes('.')) {
      throw new Error(
        `[i18n] locale key "${k}" (at "${prefix || '<root>'}") contains a dot — nested-object dot-flattening would collide. Rename the key or nest it explicitly.`,
      );
    }
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
      // Defensive: if a caller somehow bypassed the dot check above and
      // produced a colliding flat key, hard-fail.
      if (hasOwn(out, key)) {
        throw new Error(
          `[i18n] flat key collision at "${key}" — the dictionary declares this key twice under different nested paths.`,
        );
      }
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

// Match any HTML-entity-shaped sequence a translator might write out of
// habit: `&amp;`, `&lt;`, `&#39;`, `&#x27;`, `&copy;`, `&nbsp;`. Locale
// values are stored raw (Unicode) — the plugin escapes on write. A
// translator who pre-escapes creates double-escapes in the emitted HTML
// (e.g. `&copy;` → literal `&copy;` visible in the browser instead of
// `©`). RH3 fails loudly at load time so the failure is a build error,
// not an unnoticed shipped bug.
// Match any HTML-entity-shaped sequence a translator might write out of
// habit: `&amp;`, `&lt;`, `&#39;`, `&#x27;`, `&copy;`, `&nbsp;`. Locale
// values are stored raw (Unicode) — the plugin escapes on write. A
// translator who pre-escapes creates double-escapes in the emitted HTML
// (e.g. `&copy;` → literal `&copy;` visible in the browser instead of
// `©`). RH3 fails loudly at load time so the failure is a build error,
// not an unnoticed shipped bug.
//
// M7: tightened to an enumerated list of common HTML entity names +
// numeric-decimal + numeric-hex forms. Prior version had an open-ended
// `[a-zA-Z][a-zA-Z0-9]{1,10}` fallback that false-positived on legit
// translator prose like `Baker &Co; est. 1920` or `T&Co;`. The
// enumerated list covers every entity a translator would plausibly
// pre-escape by habit; any exotic named entity can be added as needed.
const HTML_ENTITY_RE = /&(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos|copy|nbsp|reg|trade|hellip|mdash|ndash|laquo|raquo|larr|rarr|uarr|darr|hearts|diams|clubs|spades|deg|plusmn|times|divide|sup2|sup3|frac12|frac14|frac34|iexcl|iquest);/;

/**
 * Reject HTML-entity-shaped substrings in locale values (RH3). Locale
 * values are stored as raw Unicode; the plugin's escape helpers
 * (setTextContent, safeSetAttribute) transform `&` → `&amp;` on WRITE.
 * If a translator pre-escapes (`&amp;copy; 2026`), that becomes
 * `&amp;amp;copy; 2026` in the emitted output — user sees literal
 * `&amp;copy;` in the browser instead of `©`. The failure is silent
 * (build passes) but user-visible.
 *
 * We could instead decode entities at load time (permissive normalise),
 * but the fail-loud approach matches the plugin's design: every hazard
 * is a build error, not a "just works differently" surprise.
 *
 * Legitimate raw `&` (e.g. "Bed & Breakfast") is allowed — this regex
 * only matches `&NAME;` and `&#NNN;` shapes.
 */
function rejectPreEscapedEntities(value, key, locale) {
  if (typeof value !== 'string') return;
  const m = HTML_ENTITY_RE.exec(value);
  if (m) {
    throw new Error(
      `[i18n] pre-escaped HTML entity "${m[0]}" at "${key}" in ${locale} — locale values must be raw Unicode (write "©" not "&copy;", "&" not "&amp;"). The plugin escapes on emit; pre-escaping produces "&amp;copy;" in the browser.`,
    );
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
 * Rationale for pre-escape only on `&`: fully calling escapeHtmlAttr
 * would double-escape the characters setAttribute already handles.
 * This is the minimal delta.
 *
 * L6: use for ALL attribute writes even when the value is provably
 * plugin-generated (e.g. `lang="en"`, `data-lang-pill-expected="1"`,
 * canonical URL). No performance cost, and it prevents a future
 * refactor that swaps a hardcoded value for a locale-supplied one
 * from silently reintroducing the H8 unescaped-`&` hazard.
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
 *   - attrs:   href, rel (on <a> only)  (case-INsensitive match).
 *              target is intentionally EXCLUDED — see M14 below.
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
    } else if (child.nodeType === 3 /* TEXT_NODE */) {
      // RC1 — CDATA sanitizer bypass. HTML5 has no CDATA outside SVG/MathML.
      // node-html-parser treats `<![CDATA[...]]>` as a single text node
      // rather than an element, so the tag-allowlist branch above never
      // sees the payload. When serialized back and re-parsed by a browser,
      // `<![CDATA[` becomes a bogus-comment, and anything inside (like
      // `<script>alert(1)</script>`) is parsed as real markup — LIVE XSS.
      //
      // Similar shape: PI-like `<?xml ...?>`, comment-in-text `<!-- ... -->`
      // that the parser missed, or a raw `<` that slipped past because
      // node-html-parser couldn't find a matching `>`.
      //
      // Fix: any text node containing an unescaped `<` in its raw
      // representation is markup-in-disguise. Reject.
      const raw = child.rawText != null ? child.rawText : (child.text || '');
      if (raw.includes('<')) {
        throw new Error(
          `[i18n] disallowed raw '<' in text/CDATA fragment for key "${keyForError}" (possible CDATA/comment/PI bypass)`,
        );
      }
    } else if (child.nodeType === 8 /* COMMENT_NODE */) {
      // RL7 — HTML comments have no legitimate translator use case and
      // add dead-weight bytes to the emitted HTML. Reject rather than
      // silently pass through. Conditional-comment IE quirks and
      // comment-in-noscript oddities are exactly the class of latent
      // hazard the module docblock warns about.
      throw new Error(
        `[i18n] disallowed HTML comment in data-i18n-html value for key "${keyForError}"`,
      );
    }
    // Any other node type (CDataSection, ProcessingInstruction, etc.)
    // silently ignored — node-html-parser doesn't emit these under
    // PARSER_OPTIONS. If a future parser upgrade starts emitting them,
    // the tag-allowlist check will fail-closed on any element wrapping
    // them, and the text-check above catches raw `<` in text.
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
 *   basePath     — Vite base, e.g. '/vayana-bungalows/'
 *   pagePath     — the source-tree relative path, e.g. 'enquiries/index.html'
 *   allLocales   — array of every locale the plugin knows about (used by
 *                  the head-injection block for hreflang alternates)
 *   defaultLocale — the locale that owns the site root (path-prefix-less)
 *
 * Returns the transformed HTML string. Never mutates opts.
 */
export function applyLocale(html, opts) {
  const root = parseHtml(html, PARSER_OPTIONS);
  // Recurse the whole tree including <noscript> subtrees. node-html-parser
  // parses <noscript> content as ordinary elements (unlike a real browser
  // where it's inert). transformSubtree handles data-i18n* markers.
  transformSubtree(root, opts);
  // Phase 1 of head injection (DOM ops on lang/pill/canonical). Returns
  // false if allLocales/defaultLocale absent (test opt-out).
  const doHead = applyHead(root, opts);
  let out = root.toString();
  if (doHead) {
    // Phase 2: string-splice for hreflang + boot script emit. Idempotency
    // via marker-comment substrings — see applyHead docstring. Uses the
    // precompiled *_STRIP_RE constants (L4) rather than building a fresh
    // regex per call.
    out = out.replace(HREFLANG_STRIP_RE, '').replace(BOOT_STRIP_RE, '');
    out = insertAfterHead(out, buildHeadBlock(opts));
  }
  return out;
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
 * H4 + H4-a (orphan iteration): BOTH the data-i18n-html branch AND the
 * plain-text data-i18n branch destroy the element's children:
 *   - data-i18n-html rewrites innerHTML via set_content()
 *   - data-i18n clears children via setTextContent's removeChild loop
 * Every descendant marker-bearing element in the pre-collected node
 * list becomes detached. We deduplicate by tracking a WeakSet of
 * elements that have been swallowed by an ancestor's rewrite; those
 * are skipped in the remainder of the loop. Both branches must
 * populate the WeakSet — reverting either one reintroduces the
 * misleading "unknown key on markup that never emits" build failure.
 */
// L5: shared helper for both destroy-branches. Adds every descendant
// element of `el` to `orphaned`. querySelectorAll('*') is exhaustively
// recursive so no ancestor-walk fallback is needed at the outer loop.
function markDescendantsOrphaned(el, orphaned) {
  for (const desc of el.querySelectorAll('*')) {
    orphaned.add(desc);
  }
}

function transformSubtree(root, opts) {
  const { pagePath } = opts;

  const nodes = root.querySelectorAll(
    '[data-i18n], [data-i18n-attr], [data-i18n-html], [data-i18n-meta]',
  );
  // Track elements orphaned by an ancestor's innerHTML rewrite.
  const orphaned = new WeakSet();
  for (const el of nodes) {
    if (orphaned.has(el)) continue;
    // Note: no ancestor-walk fallback needed. The two branches below
    // that destroy children both do `for (const desc of
    // el.querySelectorAll('*')) orphaned.add(desc)` — querySelectorAll('*')
    // is exhaustively recursive, so every descendant Element in the
    // pre-collected `nodes` list gets marked orphaned before its own
    // iteration reaches the check above. If you add a new
    // child-destroying branch, follow the same pattern.

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
      markDescendantsOrphaned(el, orphaned);
      el.set_content(sanitizeHtmlFragment(interpolated, key));
      el.removeAttribute('data-i18n-html');
    } else if (hasText) {
      const key = el.getAttribute('data-i18n');
      const value = lookup(opts.dict, key, pagePath);
      // Mark descendants orphaned BEFORE setTextContent clears them —
      // otherwise the outer loop keeps processing markers on detached
      // children and throws "unknown key" for keys that never reach the
      // emitted output. Same reasoning as the data-i18n-html branch
      // above; both branches destroy the element's children.
      markDescendantsOrphaned(el, orphaned);
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
 *
 * Attribute-name allowlist (S1): translators write locale copy but MUST
 * NOT be able to bypass the sanitiser via data-i18n-attr. Without a
 * check, `data-i18n-attr="onclick:evil"` + `evil = "alert(1)"` would
 * ship XSS from a benign-looking locale value. We enforce the same
 * fail-closed posture the data-i18n-html sanitiser does:
 *
 *   1. attr-name allowlist: reject any `on*` event handler, reject
 *      dangerous embedding attrs (srcdoc, style), reject the meta
 *      http-equiv/refresh redirect vector, and reject `content` on
 *      <meta http-equiv> tags for the same reason. Everything else
 *      is allowed — the intent of data-i18n-attr is legitimate label /
 *      aria-* / title / placeholder / alt copy, which is exactly what
 *      real usage looks like.
 *
 *   2. URL-scheme allowlist: for attributes that carry URLs (href,
 *      src, action, formaction, xlink:href, poster, background, cite,
 *      manifest, data, ping, longdesc), the resulting value MUST pass
 *      isAllowedHref (same allowlist the data-i18n-html sanitiser
 *      uses). A translator writing `javascript:alert(1)` or
 *      `//attacker.example` fails the build.
 *
 * The intent-line stays clean: locale JSON gets to author human copy;
 * translator mistakes → build error; XSS via marker attributes →
 * impossible.
 */
// Attribute names that would trivially XSS if a translator string
// landed in them. Reject unconditionally regardless of tag.
const FORBIDDEN_ATTR_NAMES = new Set([
  'srcdoc',       // <iframe srcdoc="<script>…"> runs verbatim
  'style',        // could inject CSS with `expression(…)` or url(javascript:)
  'onload',       // legacy event-handler naming (also caught by on* below)
  // target='_blank' + rel other than 'noopener' is a reverse-tabnabbing
  // sink (M14 rationale). The data-i18n-html sanitiser drops `target`
  // from <a>'s allowlist entirely; mirror that here so
  // `data-i18n-attr="target:…"` can't reintroduce the vector on any tag.
  'target',
]);
// Any attribute name matching /^on/i is a DOM event handler — reject.
const EVENT_HANDLER_RE = /^on/i;
// Attribute names whose value is a URL — must pass the sanitiser's
// href-scheme allowlist so `javascript:`, `data:`, `//evil` all fail.
const URL_BEARING_ATTRS = new Set([
  'href',
  'src',
  // srcset + imagesrcset: comma-separated URL lists. isAllowedHref will
  // only check the whole value against the scheme allowlist. `data:` in
  // <link rel=preload imagesrcset=...> can still fetch and execute in
  // some renderer paths (M1), so reject any value not starting with a
  // safe scheme. A translator writing a legit srcset with multiple
  // /internal urls would need `data-i18n-html` (which sanitises tags)
  // instead — but srcset markers are rare in copy and can be added to
  // the allowlist later with a proper comma-split check.
  'srcset',
  'imagesrcset',
  'action',
  'formaction',
  'xlink:href',
  'poster',
  'background',
  'cite',
  'manifest',
  'data',
  'ping',
  'longdesc',
]);

/**
 * Validate a single (attr, key) pair against the full allowlist + guard
 * chain and RETURN the resolved (attrLower, interpolated) tuple. Does NOT
 * mutate the element — the caller is responsible for atomic write-out
 * after every pair has been validated. This separation is the H1-atomicity
 * fix: multi-pair markers must be all-or-nothing on the DOM.
 *
 * Returns { attrLower, value } on success; throws on any guard failure.
 * The lowercased attribute name is returned so the caller can pass it to
 * safeSetAttribute — writing the raw-case `attr` would let a marker like
 * `data-i18n-attr="HREF:home_url"` bypass a future case-sensitive check
 * and leave the DOM with a mixed-case attribute that some downstream
 * tooling might treat differently from the lowercase form (M2).
 */
function validateAttrPair(el, opts, markerName, rawValue, attr, key, pair) {
  const attrLower = attr.toLowerCase();
  // `pair` is included in error messages when available so a multi-pair
  // marker's diagnostic can point at the offending segment, not the whole
  // rawValue (finding P11). For single-pair callers (data-i18n-meta) it's
  // null and we omit the pair suffix.
  const pairSuffix = pair ? ` pair "${pair}"` : '';
  if (FORBIDDEN_ATTR_NAMES.has(attrLower)) {
    throw new Error(
      `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}"${pairSuffix} — attribute "${attr}" is forbidden (XSS-adjacent sinks: srcdoc, style, onload). Author intent belongs elsewhere in the DOM.`,
    );
  }
  if (EVENT_HANDLER_RE.test(attr)) {
    throw new Error(
      `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}"${pairSuffix} — attribute "${attr}" is a DOM event handler (on*). Translator strings must not land in event handlers.`,
    );
  }
  // <meta http-equiv="refresh" content="0; url=…"> is a redirect vector.
  // Reject data-i18n-attr on any <meta http-equiv> element's `content`
  // (same shape data-i18n-meta writes) OR any attempt to set http-equiv
  // itself. Legitimate <meta name="…" content="…"> keeps working.
  const tag = el.rawTagName?.toLowerCase();
  if (tag === 'meta') {
    if (attrLower === 'http-equiv') {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}"${pairSuffix} — cannot set http-equiv via data-i18n-attr (redirect vector).`,
      );
    }
    if (attrLower === 'content' && el.hasAttribute('http-equiv')) {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}"${pairSuffix} — cannot set content on <meta http-equiv> (redirect vector). Legitimate <meta name="…" content="…"> is fine.`,
      );
    }
  }
  const value = lookup(opts.dict, key, opts.pagePath);
  const interpolated = interpolate(value, opts.ctx, key);
  // URL-scheme allowlist for URL-bearing attrs — see docblock (S1).
  if (URL_BEARING_ATTRS.has(attrLower) && !isAllowedHref(interpolated)) {
    throw new Error(
      `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}"${pairSuffix} — resolved value "${interpolated}" is not an allowed URL for attribute "${attr}". Allowed schemes: ${ALLOWED_HREF_SCHEMES.join(', ')}, plus internal /path, #anchor, empty.`,
    );
  }
  return { attrLower, value: interpolated };
}

function handleAttrMarker(el, opts, markerName, fixedAttr = null) {
  if (!el.hasAttribute(markerName)) return;
  const rawValue = el.getAttribute(markerName);

  if (fixedAttr) {
    // data-i18n-meta shortcut — the whole value is the dict key. Trim
    // before the empty-check so `<meta data-i18n-meta="   ">` produces
    // the actionable "has empty key" error instead of a downstream
    // "unknown key '   '" from lookup() (L1).
    const trimmed = rawValue.trim();
    if (trimmed.length === 0) {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}" has empty key (expected a dictionary key)`,
      );
    }
    const { attrLower, value } = validateAttrPair(
      el,
      opts,
      markerName,
      rawValue,
      fixedAttr,
      trimmed,
      null,
    );
    safeSetAttribute(el, attrLower, value);
    el.removeAttribute(markerName);
    return;
  }

  // Multi-pair `attr:key` syntax — split on `;` so a single marker can
  // key multiple attributes on the same element (e.g.
  // `data-i18n-attr="href:home_url; title:home_title; aria-label:home_aria"`).
  // Semicolons inside dict values are fine — the split is on the RAW
  // marker value only, not on the resolved translation. Whitespace
  // between pairs is trimmed; empty segments (leading/trailing `;` or
  // `;;` in the middle) are rejected so a translator can't leave the
  // marker in a half-authored state.
  //
  // Within a single pair, `attr` / `key` are separated by the LAST
  // colon (permits keys containing `:`, which the dict flattener does
  // NOT produce today but which we don't want to forbid at the marker
  // layer). Both halves are TRIMMED after the split — a marker like
  // `data-i18n-attr=" onclick :key"` therefore correctly hits the
  // forbidden-attr allowlist on the trimmed name `onclick` rather than
  // silently bypassing on the whitespace-padded literal (L2).
  //
  // Atomicity (H1): we validate EVERY pair up-front into a local buffer,
  // then write all setAttribute calls + removeAttribute at the end. If
  // any pair throws, no DOM writes have happened. Marker stays in place
  // for the outer error handler to point at.
  if (rawValue.length === 0) {
    throw new Error(
      `[i18n] ${opts.pagePath}: ${markerName}="" has empty value (expected attr:key pairs)`,
    );
  }
  const pairs = rawValue.split(';');
  const writes = []; // [{attrLower, value}, ...] — buffered until all pairs validate
  for (const rawPair of pairs) {
    const pair = rawPair.trim();
    if (pair.length === 0) {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}" contains an empty pair (leading/trailing/duplicate ";"). Expected "attr:key" pairs separated by ";".`,
      );
    }
    const lastColon = pair.lastIndexOf(':');
    if (lastColon < 0) {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}" pair "${pair}" missing colon separator (expected attr:key)`,
      );
    }
    const attr = pair.slice(0, lastColon).trim();
    const key = pair.slice(lastColon + 1).trim();
    if (attr.length === 0) {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}" pair "${pair}" has empty attr name (expected attr:key)`,
      );
    }
    if (key.length === 0) {
      throw new Error(
        `[i18n] ${opts.pagePath}: ${markerName}="${rawValue}" pair "${pair}" has empty key (expected attr:key)`,
      );
    }
    writes.push(validateAttrPair(el, opts, markerName, rawValue, attr, key, pair));
  }
  // Every pair passed — commit atomically.
  for (const { attrLower, value } of writes) {
    safeSetAttribute(el, attrLower, value);
  }
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
// 5. Head injection (Part 2)
// ============================================================================

// Marker comments wrapping every plugin-generated head block. Anything
// between an open and close marker is REMOVED on subsequent transform
// passes so re-running the plugin (dev HMR, or a re-render for another
// locale) is idempotent — the block gets stripped and re-emitted rather
// than duplicated.
const HREFLANG_OPEN = 'i18n:hreflang open';
const HREFLANG_CLOSE = 'i18n:hreflang close';
const BOOT_OPEN = 'i18n:boot-redirect open';
const BOOT_CLOSE = 'i18n:boot-redirect close';

// Boot-redirect script body — module-scope constant (L3). The script is
// identical across every page × locale; per-page data (locale + en/bg
// URLs) is threaded through `data-*` attributes on the <script> tag
// and read via s.getAttribute at runtime. Keeping this at module scope
// avoids allocating the ~800-char template literal on every emit.
//
// Responsibilities (matches the runtime lang.js's docstring):
//   1. ?lang=en|bg URL query override
//   2. Return-visit redirect from EN → BG when localStorage says 'bg'
//   3. Sentinel `data-i18n-redirecting="1"` on <html> before location.replace()
//
// Security notes:
//   * document.currentScript || fallback querySelector — resilient when
//     currentScript is null (event handler, extension re-inject).
//   * Whitelist raw ?lang= match — NO decodeURIComponent (malformed URI
//     would throw and swallow the boot logic).
//   * try/catch wraps localStorage (private-browsing throws).
const BOOT_BODY = `(function(){try{var s=document.currentScript||document.querySelector('script[data-locale]');if(!s)return;var here=s.getAttribute('data-locale');var enUrl=s.getAttribute('data-en-url');var bgUrl=s.getAttribute('data-bg-url');function go(u){if(!u)return false;try{document.documentElement.setAttribute('data-i18n-redirecting','1');}catch(e){}location.replace(u);return true;}var q=null;var m=location.search.match(/[?&]lang=([^&]*)/);if(m){var v=m[1];if(v==='en'||v==='bg')q=v;}if(q){try{localStorage.setItem('vb.lang',q);}catch(e){}if(q!==here){if(go(q==='bg'?bgUrl:enUrl))return;}}else{var st=null;try{st=localStorage.getItem('vb.lang');}catch(e){}if(st==='bg'&&here==='en'){if(go(bgUrl))return;}}}catch(e){}})();`;

// Precompiled strip regexes for the two known marker pairs (L4). Marker
// texts are module-scope constants (HREFLANG_OPEN/CLOSE, BOOT_OPEN/CLOSE),
// so the escape + RegExp compilation only need to happen once per
// process. Prior version rebuilt the regex on every applyLocale call.
//
// Regex-based rather than DOM-based (F2): DOM-based strip removed every
// child element between markers, including Vite-injected modulepreload
// tags that landed in there on re-transform of an already-emitted page.
// The regex here matches ONLY the exact marker-comment boundaries —
// anything Vite inserted OUTSIDE our markers is untouched.
//
// L1: does NOT trim leading/trailing whitespace around the match. Prior
// revisions ate a single leading and trailing newline via `\s*`, which
// on the second re-transform pass would swallow the newline separating
// our previous block from a Vite-injected sibling — producing adjacent-
// without-separator markup. Leaving the newlines intact means multiple
// re-transforms accumulate ~2 blank lines per pass around <head>;
// cosmetic only.
const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
const HREFLANG_STRIP_RE = new RegExp(
  `<!--${HREFLANG_OPEN.replace(REGEX_ESCAPE_RE, '\\$&')}-->[\\s\\S]*?<!--${HREFLANG_CLOSE.replace(REGEX_ESCAPE_RE, '\\$&')}-->`,
  'g',
);
const BOOT_STRIP_RE = new RegExp(
  `<!--${BOOT_OPEN.replace(REGEX_ESCAPE_RE, '\\$&')}-->[\\s\\S]*?<!--${BOOT_CLOSE.replace(REGEX_ESCAPE_RE, '\\$&')}-->`,
  'g',
);

/**
 * Apply the plugin-generated head block. Two-phase:
 *
 *   Phase 1 (DOM, on `root`):
 *     1. <html lang="…">
 *     2. data-lang-pill-expected on <html> (if source has .site-header__lang)
 *     3. Rewrite canonical, og:url, twitter:url per locale
 *
 *   Phase 2 (string-splice on the caller — see applyLocale):
 *     4. Strip any pre-existing i18n-marked hreflang/boot blocks
 *     5. Insert fresh hreflang + boot-redirect block right after the
 *        opening <head> tag
 *
 * Phase 2 uses string operations rather than DOM mutation for two
 * reasons: (a) node-html-parser's `insertAdjacentHTML` internally
 * re-parses the fragment WITHOUT our PARSER_OPTIONS, and that reparse
 * has historically dropped comment nodes on some versions — which
 * would silently break the idempotency contract because the marker
 * comments would vanish; (b) DOM-based `stripMarkedBlock` removed
 * EVERY child between open and close markers, but Vite's html-plugin
 * may insert modulepreload/CSS <link> tags between our previous
 * markers when we re-transform the EN emit for the BG mirror — those
 * Vite-inserted preloads would be silently deleted from the BG page.
 *
 * String-splice sidesteps both hazards: marker-comment text substrings
 * are unambiguous, and we only touch the exact span between markers.
 *
 * opts uses the same fields applyLocale takes plus allLocales +
 * defaultLocale. If either is missing, applyHead is a no-op — this
 * mode is used by the unit tests to exercise the marker transform
 * without the head injection.
 *
 * Returns true if head injection ran, false if opted out (caller
 * uses this to decide whether to skip the Phase 2 string splice).
 */
function applyHead(root, opts) {
  const {
    locale,
    basePath,
    pagePath,
    allLocales,
    defaultLocale,
  } = opts;
  if (!allLocales || !defaultLocale) return false; // test-only opt-out

  const htmlEl = root.querySelector('html');
  const headEl = root.querySelector('head');
  if (!htmlEl || !headEl) return false; // fragment inputs (test opts)

  // <html lang> — safeSetAttribute handles the ampersand edge but the
  // locale is a whitelisted 2-letter code, no escape concerns.
  safeSetAttribute(htmlEl, 'lang', locale);

  // data-lang-pill-expected marker. Set only when the source had a
  // `.site-header__lang` element — lang.js reads this to decide whether
  // "no pill segments in DOM" is a regression to warn about.
  if (root.querySelector('.site-header__lang')) {
    safeSetAttribute(htmlEl, 'data-lang-pill-expected', '1');
  }

  // Rewrite canonical / og:url / twitter:url to point at the current
  // locale's URL. Skips silently if the source doesn't ship them.
  rewriteCanonicalUrls(headEl, {
    locale,
    basePath,
    pagePath,
    defaultLocale,
  });

  return true;
}

/**
 * Build the plugin-generated head block as a string. The block has
 * both marker comments (open + close), the boot-redirect script (must
 * come first — before any stylesheet loads), and the hreflang alternates.
 *
 * Returned string is what gets spliced into the emitted HTML right after
 * `<head>`.
 */
function buildHeadBlock(opts) {
  const { locale, basePath, pagePath, allLocales, defaultLocale } = opts;

  // Hreflang alternates block.
  const hreflangLines = [];
  hreflangLines.push(`<!--${HREFLANG_OPEN}-->`);
  for (const loc of allLocales) {
    const url = pageUrl({ basePath, pagePath, locale: loc, defaultLocale });
    hreflangLines.push(
      `<link rel="alternate" hreflang="${escapeHtmlAttr(loc)}" href="${escapeHtmlAttr(url)}">`,
    );
  }
  const defaultUrl = pageUrl({
    basePath,
    pagePath,
    locale: defaultLocale,
    defaultLocale,
  });
  hreflangLines.push(
    `<link rel="alternate" hreflang="x-default" href="${escapeHtmlAttr(defaultUrl)}">`,
  );
  hreflangLines.push(`<!--${HREFLANG_CLOSE}-->`);

  // Boot script — data attrs carry the per-page URLs; the body is a
  // module-scope BOOT_BODY constant so we don't re-allocate the ~800-
  // char literal on every emit.
  const enUrl = pageUrl({ basePath, pagePath, locale: 'en', defaultLocale });
  const bgUrl = pageUrl({ basePath, pagePath, locale: 'bg', defaultLocale });
  const bootLines = [
    `<!--${BOOT_OPEN}-->`,
    `<script data-locale="${escapeHtmlAttr(locale)}" data-en-url="${escapeHtmlAttr(enUrl)}" data-bg-url="${escapeHtmlAttr(bgUrl)}">${BOOT_BODY}</script>`,
    `<!--${BOOT_CLOSE}-->`,
  ];

  // Boot script FIRST (must run before any stylesheet). Hreflang after.
  return [...bootLines, ...hreflangLines].join('\n');
}

/**
 * Insert `block` into <head> at a position that keeps `<meta charset>`
 * within WHATWG's 1024-byte safety window. Boot-script + hreflang can
 * push a bare-`<head>` insertion past that window (measured ~1170 bytes
 * for our ~1130-byte block on a minimal page), which risks browsers
 * mis-detecting page encoding for the first ~1KB of content.
 *
 * Preference order:
 *   1. If `<meta charset="…">` exists in <head>, insert AFTER it (so
 *      charset stays at its original near-top position).
 *   2. Otherwise, insert right after `<head>` (falls back to L4's
 *      original behaviour; charset detection uses the HTTP header +
 *      default UTF-8 which is fine).
 *
 * Bounded scan (H-L4-1): the charset-match window is HARD-BOUNDED to
 * the `<head>…</head>` span. A `<meta charset>` in `<body>` (or a
 * template comment, or `<noscript>` fallback) is IGNORED — otherwise
 * an unbounded scan would splice our block INTO `<body>`, silently
 * corrupting emitted output.
 *
 * Anchored regex (M-L4-2): the meta-charset regex requires `charset`
 * to appear as an ATTRIBUTE NAME (`\s+charset\s*=`), not as a
 * substring inside another attribute's value like
 * `<meta name="description" content="charset behaviour">`. Also
 * matches the HTML4-style `<meta http-equiv="Content-Type"
 * content="…; charset=utf-8">` because for THAT tag, `charset=`
 * inside `content=` is the actual charset declaration and we want
 * to land after it too — verified by the WHATWG parser using
 * exactly the same "either shape" detection.
 *
 * String-splice rather than DOM insertion (see applyHead's Phase-2
 * rationale): marker comments always survive because they're just text.
 * Uses a comment-masked scan copy so `<head>`/`<meta …>` substrings
 * inside HTML comments don't false-match.
 *
 * M4: caller (applyLocale) has ALREADY run stripMarkedString by the
 * time we get here, so returning `html` unchanged when there's no
 * `<head>` would leave the document in a mid-idempotency state
 * (previous blocks stripped, new block silently dropped). If we can't
 * find `<head>` after strip already ran, that's an invariant break —
 * throw so the dev sees the failure instead of shipping a subtly-
 * broken page.
 *
 * L2: emits a leading + trailing newline around `block` so the block
 * doesn't run directly into the surrounding markup — cosmetic only.
 * Note (L1 reconciliation): stripMarkedString removes markers WITHOUT
 * touching surrounding whitespace, and this function ADDS a `\n` on
 * both sides. Net effect is that each re-transform pass grows the
 * head by ~2 blank lines (one leading + one trailing) — cosmetic
 * only, `<head>` whitespace has no functional effect.
 */
function insertAfterHead(html, block) {
  // Build a scan copy where every HTML comment span is replaced with
  // spaces of equal length. That way index positions in the scan copy
  // map 1-to-1 to indices in the original, but comment-embedded
  // "<head>" / "<meta …>" text can't match.
  const scan = html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const headMatch = scan.match(/<head[^>]*>/i);
  if (!headMatch) {
    throw new Error(
      '[i18n] insertAfterHead: no <head> element found after strip pass — head-injection idempotency invariant broken. Source HTML may have been mangled between strip and insert.',
    );
  }
  const headOpenEnd = headMatch.index + headMatch[0].length;
  // Bound the charset search to the <head>…</head> span. If </head>
  // isn't found (malformed but tolerated), fall back to the whole
  // remainder — that's still safer than an unbounded scan because the
  // regex is name-anchored.
  const headCloseIdx = scan.indexOf('</head>', headOpenEnd);
  const searchEnd = headCloseIdx >= 0 ? headCloseIdx : scan.length;
  const headBody = scan.slice(headOpenEnd, searchEnd);
  // Two accepted shapes:
  //   HTML5:  <meta charset="utf-8">
  //   HTML4:  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  // The regex requires `charset` as an ATTRIBUTE NAME (preceded by
  // whitespace after the `<meta` tag name, followed by `=`). The
  // `[^>]*` before `\scharset\s*=` matches ANY other attributes that
  // may precede it. Substring `charset` embedded in prose (e.g.
  // content="describes the charset behaviour") won't match because
  // it isn't followed by `=`.
  const html5 = /<meta\b[^>]*\scharset\s*=[^>]*>/i;
  const html4 = /<meta\b[^>]*\shttp-equiv\s*=\s*["']?content-type["']?[^>]*>/i;
  const html5Match = headBody.match(html5);
  const html4Match = headBody.match(html4);
  let charsetIdxWithinBody = -1;
  let charsetMatchLen = 0;
  if (html5Match) {
    charsetIdxWithinBody = html5Match.index;
    charsetMatchLen = html5Match[0].length;
  } else if (html4Match) {
    charsetIdxWithinBody = html4Match.index;
    charsetMatchLen = html4Match[0].length;
  }
  let insertAt;
  if (charsetIdxWithinBody >= 0) {
    insertAt = headOpenEnd + charsetIdxWithinBody + charsetMatchLen;
  } else {
    insertAt = headOpenEnd;
  }
  return `${html.slice(0, insertAt)}\n${block}\n${html.slice(insertAt)}`;
}

/**
 * Compute the per-locale URL for a given source page. `pagePath` is the
 * source-tree-relative path (e.g. 'enquiries/index.html'); the returned
 * URL is a site-absolute path suitable for canonical/og/hreflang:
 *
 *   basePath = '/vayana-bungalows/'
 *   pagePath = 'enquiries/index.html'
 *   locale = 'en' (default) → '/vayana-bungalows/enquiries/'
 *   locale = 'bg'            → '/vayana-bungalows/bg/enquiries/'
 *   pagePath = 'index.html'
 *   locale = 'en'            → '/vayana-bungalows/'
 *   locale = 'bg'            → '/vayana-bungalows/bg/'
 *
 * Requires: pagePath uses forward-slash separators AND ends with
 * `index.html` (directory-form only). Every call site in the plugin
 * normalises via relFromRoot (which converts `sep` → `/`) or reads
 * Vite bundle keys (always forward-slash). A non-conforming pagePath
 * hard-fails at build time rather than silently emitting a URL with
 * backslashes or a filename suffix.
 */
function pageUrl({ basePath, pagePath, locale, defaultLocale }) {
  if (pagePath.includes('\\')) {
    throw new Error(
      `[i18n] pageUrl: pagePath must use forward-slash separators, got "${pagePath}"`,
    );
  }
  if (pagePath !== 'index.html' && !pagePath.endsWith('/index.html')) {
    throw new Error(
      `[i18n] pageUrl: pagePath must name the index file (end with 'index.html') — emitted URL is directory-form, but the source-path anchor needs the filename. Got "${pagePath}"`,
    );
  }
  const prefix = locale === defaultLocale ? '' : `${locale}/`;
  // 'index.html' → '' ; 'enquiries/index.html' → 'enquiries/'
  const cleaned = pagePath === 'index.html'
    ? ''
    : pagePath.slice(0, -'index.html'.length);
  return `${basePath}${prefix}${cleaned}`;
}

/**
 * Rewrite the value of a per-page URL meta tag to its locale-specific
 * form. Uses safeSetAttribute so the ampersand-in-value edge is handled
 * even though the URLs the plugin builds never contain `&` in practice.
 */
function rewriteCanonicalUrls(headEl, opts) {
  const url = pageUrl(opts);
  const canonical = headEl.querySelector('link[rel="canonical"]');
  if (canonical) safeSetAttribute(canonical, 'href', url);

  const og = headEl.querySelector('meta[property="og:url"]');
  if (og) safeSetAttribute(og, 'content', url);

  const tw = headEl.querySelector('meta[name="twitter:url"]');
  if (tw) safeSetAttribute(tw, 'content', url);
}

// ============================================================================
// 6. Relative-href rejection sweep
// ============================================================================

/**
 * Every emitted HTML must not carry any `href="../…"` or `src="../…"`
 * — under the `/bg/` path prefix, a `../` in an emitted BG page resolves
 * ONE directory ABOVE the root, silently breaking. All internal links
 * MUST be root-absolute (`/vayana-bungalows/…`).
 *
 * This is a build-time sweep run on every locale variant AFTER the
 * transform completes. Currently emits a WARNING (not a hard-fail) so
 * pre-existing `../` links in legacy pages don't block the build.
 * Task #165 (key home page) is where the actual link-conversion sweep
 * lands per the Issue #47 plan; when that ships, tighten this to a
 * throw.
 *
 * M4: takes a raw HTML STRING rather than a parsed root — regex-based
 * scan avoids the extra DOM parse we'd otherwise incur (writeBundle
 * already parses inside applyLocale; a second parse just for this
 * WARN-only check was wasted work). The regex is anchored to the
 * three quoted-value shapes (`attr="…"`, `attr='…'`, `attr=…`) so
 * character-reference-encoded `href="./..&#x2f;evil"` still won't
 * decode inside the value — that's a browser-time decode, not a
 * source-form pattern. When Task #165 tightens to a throw, revisit
 * decoding rules.
 */
const RELATIVE_HREF_RE = /\b(href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
function rejectRelativeHrefs(html, pagePath) {
  const bad = [];
  RELATIVE_HREF_RE.lastIndex = 0;
  let m;
  while ((m = RELATIVE_HREF_RE.exec(html)) !== null) {
    const attr = m[1].toLowerCase();
    const v = m[2] ?? m[3] ?? m[4] ?? '';
    if (!v) continue;
    // M2: catch both leading and embedded `../`. A prior version only
    // checked `startsWith('../')`, which missed `./../foo`,
    // `foo/../../evil`, `/base/../../secret` — under the /bg/ prefix
    // these still resolve upward. When Task #165 tightens this to a
    // throw, an embedded `../` in a legacy page silently ships without
    // this broader check.
    if (v === '..' || v.startsWith('../') || v.includes('/../') || v.endsWith('/..')) {
      bad.push(`[${attr}="${v}"]`);
    }
  }
  if (bad.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[i18n] ${pagePath}: ${bad.length} relative "../" href/src/action detected — internal links must be root-absolute (BG /bg/ prefix breaks them). Task #165 will sweep. Offenders: ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? `; and ${bad.length - 3} more` : ''}`,
    );
  }
}

// ============================================================================
// 7. Vite plugin factory
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
 *   inputs      — Vite's rollup input map (same object passed to
 *                 build.rollupOptions.input). The plugin uses this to
 *                 enumerate which pages get the BG mirror emit at
 *                 closeBundle time.
 *
 * Registers three Vite hooks:
 *   - transformIndexHtml: transforms each source HTML with the default
 *     locale (EN); the emitted output lands at dist/<page>/index.html.
 *   - closeBundle: re-reads each EN-emitted HTML and writes the BG
 *     mirror under dist/bg/<page>/index.html.
 *   - configureServer: dev-mode middleware serving /bg/<path> URLs on
 *     the fly, plus an HMR watcher for locale JSON + source HTML edits.
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
     * lands via closeBundle below.
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
        const rel = relFromRoot(abs, projectRoot);
        return applyLocale(html, {
          locale: DEFAULT_LOCALE,
          dict: dicts[DEFAULT_LOCALE],
          ctx: contextByLocale[DEFAULT_LOCALE],
          basePath,
          pagePath: rel,
          allLocales: locales,
          defaultLocale: DEFAULT_LOCALE,
        });
      },
    },

    /**
     * writeBundle — Vite calls this after every bundle asset has been
     * written to disk. We iterate the bundle object, find every HTML
     * asset (they land after JS/CSS via Vite's own html-plugin), read
     * them from disk (where Vite has finalised asset-URL hashes), and
     * emit BG variants.
     *
     * options.dir is honoured (F-writeBundle-2) so `build.outDir`
     * overrides work. bg/-prefixed HTMLs are skipped so a future refactor
     * that emits BG via `generateBundle` won't recursively produce
     * dist/bg/bg/… (F-recursion).
     */
    writeBundle(options, bundle) {
      // options.dir is Rollup's output directory. For Vite that's
      // typically dist/, but users may override via `build.outDir`.
      // Fall back to `dist/` under projectRoot only if Rollup gave us
      // nothing (should never happen in practice).
      const outDir = options?.dir || resolve(projectRoot, 'dist');
      let count = 0;
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (!asset || asset.type !== 'asset') continue;
        if (!fileName.endsWith('.html')) continue;
        // F-recursion: if a future refactor emits BG via generateBundle,
        // bundle would include bg/… paths — skip them to prevent
        // dist/bg/bg/…
        //
        // S2: emit a WARNING when we skip so a maintainer who adds a
        // legitimately-bg-prefixed source page (e.g. a Bulgaria-specific
        // legacy redirect) sees why their BG mirror isn't landing.
        // Without this, the skip is silent and the missing mirror
        // eats debug time.
        if (fileName.startsWith('bg/')) {
          // eslint-disable-next-line no-console
          console.warn(
            `[i18n] skipping BG mirror emit for "${fileName}" — bg/-prefixed sources are treated as already-mirrored to prevent recursion. If this is a legitimate source page, rename to avoid the bg/ prefix or refactor the recursion guard.`,
          );
          continue;
        }

        const emittedPath = resolve(outDir, fileName);
        let enHtml;
        try {
          enHtml = readFileSync(emittedPath, 'utf-8');
        } catch (e) {
          throw new Error(
            `[i18n] writeBundle: cannot read emitted file ${emittedPath}: ${e.message}`,
          );
        }
        // F-BOM: strip a leading UTF-8 BOM if present (Vite doesn't emit
        // one but a source file with a BOM could round-trip through
        // Vite's html-plugin without normalisation).
        if (enHtml.charCodeAt(0) === 0xfeff) enHtml = enHtml.slice(1);

        // Sweep the FINAL EN emit for `../` hrefs (after Vite's
        // asset-URL rewrite). Runs ONLY on the EN pass — the BG mirror
        // inherits the same offenders, warning again is duplicate log
        // spam (F-double-warn). String-based regex scan (M4) — no
        // extra DOM parse.
        rejectRelativeHrefs(enHtml, fileName);

        // Apply BG head injection on top of the EN-rendered HTML. The
        // marker attributes are already gone (transform stripped them
        // in the EN pass), so the transformSubtree call inside
        // applyLocale is a near-no-op — the work is in applyHead
        // rewriting <html lang>, hreflang, canonical, boot script.
        const bg = applyLocale(enHtml, {
          locale: 'bg',
          dict: dicts.bg,
          ctx: contextByLocale.bg,
          basePath,
          pagePath: fileName,
          allLocales: locales,
          defaultLocale: DEFAULT_LOCALE,
        });
        // F-double-warn: do NOT add another `rejectRelativeHrefs(bg, …)`
        // call here. The BG mirror is derived from the EN emit which we
        // already scanned above; the same `../` offenders would produce
        // duplicate warnings.
        const bgPath = resolve(outDir, 'bg', fileName);
        mkdirSync(dirname(bgPath), { recursive: true });
        writeFileSync(bgPath, bg, 'utf-8');
        count++;
      }
      // eslint-disable-next-line no-console
      console.log(`[i18n] emitted BG variants for ${count} page(s) under dist/bg/`);
    },

    /**
     * configureServer — dev-mode middleware serving `/bg/<path>` by
     * transforming source HTML on the fly. Also installs an HMR
     * watcher that reloads locale JSON edits into memory and pushes
     * a full-reload to BG tabs.
     *
     * Returns a function (post-hook style) so the middleware is
     * inserted AFTER Vite's built-in middlewares (F5) — that way
     * Vite's config.base / decodeURI middleware normalises req.url
     * before we see it, and the /bg/ prefix comparison lands on the
     * post-base-strip path.
     */
    configureServer(server) {
      // F5 fix — LOAD-BEARING: returning a function here tells Vite to
      // install our middleware AFTER its own base/decodeURI middlewares.
      // If this `return` is deleted, our middleware runs BEFORE Vite
      // strips the base, and req.url still carries the '/vayana-bungalows/'
      // prefix — the '/bg/' startsWith check misses and BG dev URLs 404.
      // The manual cfgBase strip below is DEFENSIVE only (belt-and-braces
      // for older Vite versions or edge cases where the post-hook order
      // isn't respected). Keep BOTH.
      return () => {
        // Defensive base-strip (see comment above). server.config.base
        // is e.g. '/vayana-bungalows/'; trailing slash normalised to
        // '/vayana-bungalows' so a request to exactly '/vayana-bungalows'
        // (no trailing slash) still matches.
        const cfgBase = (server.config.base || '/').replace(/\/$/, '');

        server.middlewares.use((req, res, next) => {
          const rawUrl = req.url || '';
          // F-query: strip query string + fragment before path
          // resolution so /bg/foo/?x=1 doesn't produce a filename
          // containing '?'.
          const urlNoQuery = rawUrl.split(/[?#]/)[0];
          // Strip the Vite base prefix if any.
          let urlPath = urlNoQuery;
          if (cfgBase && urlPath.startsWith(cfgBase)) {
            urlPath = urlPath.slice(cfgBase.length) || '/';
          }
          if (!urlPath.startsWith('/bg/') && urlPath !== '/bg') return next();

          // Strip the /bg[/] prefix + normalise to a source-tree path.
          let rel = urlPath.replace(/^\/bg\/?/, '');
          if (rel === '' || rel.endsWith('/')) rel += 'index.html';
          // Path-traversal defence (L7): use path.relative to normalise
          // then confirm the relative path doesn't escape upward.
          // Earlier startsWith(projectRoot + sep) approach was fragile
          // on Windows drive roots (C:\) and paths with trailing sep —
          // could spuriously 403 legitimate dev BG pages. relative +
          // startsWith('..') is portable.
          const source = resolve(projectRoot, rel);
          const relFromProj = relative(projectRoot, source);
          if (relFromProj.startsWith('..') || isAbsolute(relFromProj)) {
            res.statusCode = 403;
            res.end('forbidden');
            return;
          }
          if (!source.endsWith('.html')) return next();

          let html;
          try {
            html = readFileSync(source, 'utf-8');
          } catch {
            return next();
          }
          // Strip UTF-8 BOM defensively (F-BOM).
          if (html.charCodeAt(0) === 0xfeff) html = html.slice(1);

          // F-listener-close: bail if the client closed the connection
          // before our transform completes.
          let closed = false;
          req.on('close', () => { closed = true; });

          let out;
          try {
            out = applyLocale(html, {
              locale: 'bg',
              dict: dicts.bg,
              ctx: contextByLocale.bg,
              basePath: '/',
              pagePath: rel,
              allLocales: locales,
              defaultLocale: DEFAULT_LOCALE,
            });
          } catch (err) {
            res.statusCode = 500;
            res.end(`[i18n dev] ${err.message}`);
            return;
          }

          server.transformIndexHtml(rawUrl, out, req.originalUrl).then(
            (transformed) => {
              if (closed) return;
              res.setHeader('content-type', 'text/html; charset=utf-8');
              res.end(transformed);
            },
            (err) => {
              if (closed) return;
              res.statusCode = 500;
              res.end(`[i18n dev] ${err.message}`);
            },
          );
        });

        // HMR watcher — locale JSON edits reload the in-memory dicts
        // AND push a full-reload to open BG tabs. Source HTML edits
        // are handled by Vite's own watcher (dropped from here to
        // avoid double-reload — F4).
        const boundary = localesDir + sep;
        const onLocaleChange = (path) => {
          if (!path.startsWith(boundary) || !path.endsWith('.json')) return;
          // F3: re-load dicts from disk so the next transform sees the
          // updated locale. loadDictionaries hard-fails on asymmetry,
          // so a broken edit surfaces immediately in the dev log rather
          // than shipping stale content.
          //
          // H2 (race): earlier version did `delete dicts[key]` in one
          // loop then repopulated in a second loop, leaving `dicts` in
          // an EMPTY state between the loops. A concurrent middleware
          // request reading `dicts.bg` in that window got `undefined`
          // and applyLocale exploded downstream. Fix: assign fresh
          // whole-locale objects FIRST (readers always see either the
          // old locale map or the new one — never undefined), THEN
          // delete any locale keys that dropped out of the fresh set.
          // The per-locale flat-key object itself is replaced by
          // reference; readers that already dereferenced `dicts.bg`
          // keep their (stable) old snapshot for the duration of the
          // current transform.
          try {
            const fresh = loadDictionaries(localesDir);
            // 1. Overwrite each locale's flat-key object with a fresh one.
            //    Assignment is atomic per key — no in-between empty state.
            for (const [k, v] of Object.entries(fresh.dicts)) {
              dicts[k] = v;
            }
            // 2. Delete any locale keys the fresh set no longer has.
            //    (Only fires if a locale JSON was RENAMED/DELETED — the
            //    add/change case above already produced a valid fresh
            //    state; this cleanup just prunes stale pointers.)
            for (const k of Object.keys(dicts)) {
              if (!hasOwn(fresh.dicts, k)) delete dicts[k];
            }
            // eslint-disable-next-line no-console
            console.log('[i18n] reloaded locales after change:', path);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[i18n] locale reload FAILED — keeping previous dicts. ${err.message}`);
            return; // don't reload the browser on a broken edit
          }
          try {
            server.ws.send({ type: 'full-reload', path: '*' });
          } catch {
            // best-effort
          }
        };
        // F-listener-leak — register + arrange for cleanup on server
        // shutdown so a Vite restart that re-invokes configureServer
        // doesn't accumulate stale onLocaleChange listeners.
        //
        // Caveat: cleanup requires `server.httpServer` to exist. In
        // middleware-mode Vite (where the caller owns the HTTP server
        // and Vite runs as pure middleware), httpServer is null and
        // the optional-chained `once('close', …)` silently no-ops.
        // Emit a warning (once per configureServer invocation — every
        // Vite restart triggers a new call, so the warning fires per
        // restart) so a middleware-mode integrator sees the leak instead
        // of debugging phantom double-reloads after 5 restarts.
        server.watcher.on('change', onLocaleChange);
        server.watcher.on('add', onLocaleChange);
        server.watcher.on('unlink', onLocaleChange);
        if (server.httpServer) {
          server.httpServer.once('close', () => {
            server.watcher.off('change', onLocaleChange);
            server.watcher.off('add', onLocaleChange);
            server.watcher.off('unlink', onLocaleChange);
          });
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            '[i18n] middleware-mode Vite (no httpServer) — watcher-cleanup on restart not wired; expect one extra locale-reload listener per config restart.',
          );
        }
      };
    },
  };
}

/**
 * Derive a source-tree-relative page path from an absolute filename,
 * normalising separators to `/` and falling back to a `<unknown>`
 * marker when the filename is missing or lives outside projectRoot.
 * Shared between transformIndexHtml and closeBundle so error anchors
 * are identical across both.
 */
function relFromRoot(abs, projectRoot) {
  if (!abs) return '<unknown>';
  const rel = relative(projectRoot, abs);
  return rel.split(sep).join('/');
}

// Re-exports for tests + the standalone i18n lint script (Task #164).
export { flatten as _flatten, insertAfterHead as _insertAfterHead };
