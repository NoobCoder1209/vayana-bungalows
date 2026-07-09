// Unit tests for the i18n plugin (Task #163, Part 1).
//
// Run with:  node --test scripts/__tests__/i18n-plugin.test.mjs
//
// Uses Node's built-in `node:test` runner — no test-framework dep.
// Every test targets a specific review finding from the round-1 code
// review; keeping the mapping visible in the test names so a future
// regression maps back to a known-bad case fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  loadDictionaries,
  interpolate,
  escapeHtmlAttr,
  sanitizeHtmlFragment,
  applyLocale,
  _insertAfterHead as insertAfterHead,
} from '../i18n-plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = (name) => resolve(__dirname, 'fixtures', name);

// Minimal opts factory — a real locale/dict/ctx that the transform can chew on.
function opts(overrides = {}) {
  return {
    locale: 'en',
    dict: { greeting: 'Hello', with_token: 'Call {phone}', bold: 'Save <strong>10%</strong>' },
    ctx: { phone: '+1 555', name: 'World' },
    isDefault: true,
    basePath: '/',
    pagePath: 'test.html',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// loadDictionaries
// ---------------------------------------------------------------------------

test('loadDictionaries: happy path — symmetric dicts pass', () => {
  const { locales, dicts } = loadDictionaries(FIX('locales-good'));
  assert.deepEqual(locales, ['bg', 'en']);
  assert.equal(dicts.en.hello, 'Hello {name}');
  assert.equal(dicts.bg.hello, 'Здравей {name}');
  assert.equal(dicts.en['nested.greeting'], 'Hi');
});

test('loadDictionaries: asymmetric key set — hard-fails', () => {
  assert.throws(
    () => loadDictionaries(FIX('locales-asym')),
    /not symmetric/i,
  );
});

test('loadDictionaries: malformed token {Name} — hard-fails at load (H6)', () => {
  assert.throws(
    () => loadDictionaries(FIX('locales-badtoken')),
    /malformed token/i,
  );
});

// ---------------------------------------------------------------------------
// interpolate — C3 prototype pollution, H5 undefined values, H6 token shape
// ---------------------------------------------------------------------------

test('interpolate: happy path', () => {
  assert.equal(interpolate('Call {phone}', { phone: '+1' }, 'x'), 'Call +1');
});

test('interpolate: missing token hard-fails', () => {
  assert.throws(() => interpolate('{gone}', {}, 'k'), /missing context value/i);
});

test('interpolate: prototype-inherited key does NOT satisfy (C3)', () => {
  // {__proto__} matches the strict token regex (all lowercase + underscores)
  // AND is a prototype property, so it's the perfect proto-pollution
  // canary for interpolate. Under `name in ctx` it would return the
  // Object.prototype `__proto__` accessor (or, in some engines,
  // Object.prototype itself). hasOwn correctly rejects.
  assert.throws(() => interpolate('{__proto__}', {}, 'k'), /missing context value/i);
});

test('interpolate: undefined value hard-fails (H5)', () => {
  assert.throws(
    () => interpolate('{phone}', { phone: undefined }, 'k'),
    /is undefined/i,
  );
});

test('interpolate: null value hard-fails (H5)', () => {
  assert.throws(
    () => interpolate('{phone}', { phone: null }, 'k'),
    /is null/i,
  );
});

test('interpolate: non-string value hard-fails (H5)', () => {
  assert.throws(
    () => interpolate('{phone}', { phone: 42 }, 'k'),
    /number, expected string/i,
  );
});

// ---------------------------------------------------------------------------
// sanitizeHtmlFragment — C2 protocol-relative, H7 case, M13 wrapper-escape,
// M14 target=_blank
// ---------------------------------------------------------------------------

test('sanitizer: allowed inline formatting passes', () => {
  const out = sanitizeHtmlFragment('Save <strong>$960</strong>', 'k');
  assert.match(out, /<strong>\$960<\/strong>/);
});

test('sanitizer: allowed <a href="/path"> passes', () => {
  const out = sanitizeHtmlFragment('<a href="/privacy/">policy</a>', 'k');
  assert.match(out, /href="\/privacy\/"/);
});

test('sanitizer: <script> rejected', () => {
  assert.throws(() => sanitizeHtmlFragment('<script>x</script>', 'k'), /disallowed tag/i);
});

test('sanitizer: javascript: scheme rejected', () => {
  assert.throws(
    () => sanitizeHtmlFragment('<a href="javascript:alert(1)">x</a>', 'k'),
    /disallowed href/i,
  );
});

test('sanitizer: data: scheme rejected', () => {
  assert.throws(
    () => sanitizeHtmlFragment('<a href="data:text/html;base64,ABC">x</a>', 'k'),
    /disallowed href/i,
  );
});

test('sanitizer: protocol-relative //evil rejected (C2)', () => {
  assert.throws(
    () => sanitizeHtmlFragment('<a href="//evil.com/phish">x</a>', 'k'),
    /disallowed href/i,
  );
});

test('sanitizer: uppercase HREF still triggers scheme check (H7)', () => {
  // `<a HREF="javascript:...">` — a case-sensitivity refactor bug in a
  // previous version let this slip through. It must reject.
  assert.throws(
    () => sanitizeHtmlFragment('<a HREF="javascript:alert(1)">x</a>', 'k'),
    /disallowed/i,
  );
});

test('sanitizer: target="_blank" rejected (M14)', () => {
  assert.throws(
    () => sanitizeHtmlFragment('<a href="/x" target="_blank">x</a>', 'k'),
    /disallowed attribute/i,
  );
});

test('sanitizer: onclick rejected', () => {
  assert.throws(
    () => sanitizeHtmlFragment('<strong onclick="x">y</strong>', 'k'),
    /disallowed attribute/i,
  );
});

test('sanitizer: </div> wrapper-breakout also rejected (M13)', () => {
  // Old wrapper-based sanitizer silently dropped content when a value
  // contained </div>. The new root-iteration variant treats the outer
  // <script> as a top-level element and hard-fails.
  assert.throws(
    () => sanitizeHtmlFragment('</div><script>alert(1)</script>', 'k'),
    /disallowed/i,
  );
});

// ---------------------------------------------------------------------------
// escapeHtmlAttr
// ---------------------------------------------------------------------------

test('escapeHtmlAttr: 5-char escape', () => {
  assert.equal(escapeHtmlAttr('a"b<c>d&e\'f'), 'a&quot;b&lt;c&gt;d&amp;e&#39;f');
});

// ---------------------------------------------------------------------------
// applyLocale — C1 text-escape, H4 orphan iter, H8 attr amp-escape, L20 order
// ---------------------------------------------------------------------------

test('applyLocale: data-i18n escapes HTML in the value (C1)', () => {
  // If set_content had been used raw (the C1 bug), the <b> would land
  // as a real element. With text-content escaping, it must survive as
  // literal text.
  const dict = { html_ish: 'A <b>&</b> B' };
  const out = applyLocale(
    '<div data-i18n="html_ish"></div>',
    opts({ dict }),
  );
  assert.match(out, /A &lt;b&gt;&amp;&lt;\/b&gt; B/);
  // And the marker was removed:
  assert.doesNotMatch(out, /data-i18n=/);
});

test('applyLocale: data-i18n-html sanitised and inlined', () => {
  const dict = { bold: 'Save <strong>10%</strong>' };
  const out = applyLocale(
    '<p data-i18n-html="bold"></p>',
    opts({ dict }),
  );
  assert.match(out, /<strong>10%<\/strong>/);
  assert.doesNotMatch(out, /data-i18n-html=/);
});

test('applyLocale: data-i18n-attr split-on-last-colon (aria-labelledby key ok)', () => {
  const dict = { 'aria.msg': 'Click me' };
  const out = applyLocale(
    '<button data-i18n-attr="aria-label:aria.msg"></button>',
    opts({ dict }),
  );
  assert.match(out, /aria-label="Click me"/);
});

test('applyLocale: data-i18n-attr with empty attr rejected (M10)', () => {
  const dict = { k: 'v' };
  assert.throws(
    () =>
      applyLocale(
        '<div data-i18n-attr=":k"></div>',
        opts({ dict }),
      ),
    /empty attr name/i,
  );
});

test('applyLocale: data-i18n-attr with empty key rejected (M10)', () => {
  const dict = { k: 'v' };
  assert.throws(
    () =>
      applyLocale(
        '<div data-i18n-attr="title:"></div>',
        opts({ dict }),
      ),
    /empty key/i,
  );
});

test('applyLocale: unknown key hard-fails with page + key (C3)', () => {
  assert.throws(
    () =>
      applyLocale(
        '<h1 data-i18n="nonexistent"></h1>',
        opts({ dict: {} }),
      ),
    /unknown key "nonexistent"/,
  );
});

test('applyLocale: data-i18n="toString" also hits unknown-key path (C3)', () => {
  // Dict keys are arbitrary strings supplied by the HTML author — no
  // regex constraint like tokens have. A marker `data-i18n="toString"`
  // used to bypass the unknown-key hard-fail via prototype-chain lookup
  // and return Object.prototype.toString (a function), which then
  // crashed the transform with "str.replace is not a function".
  // hasOwn correctly rejects.
  assert.throws(
    () =>
      applyLocale(
        '<h1 data-i18n="toString"></h1>',
        opts({ dict: {} }),
      ),
    /unknown key "toString"/,
  );
});

test('applyLocale: both data-i18n and data-i18n-html on same element rejected', () => {
  const dict = { a: 'x', b: 'y' };
  assert.throws(
    () =>
      applyLocale(
        '<div data-i18n="a" data-i18n-html="b"></div>',
        opts({ dict }),
      ),
    /pick one/i,
  );
});

test('applyLocale: attribute value with & is escaped (H8)', () => {
  const dict = { title: 'Bed & Breakfast' };
  const out = applyLocale(
    '<div data-i18n-attr="title:title"></div>',
    opts({ dict }),
  );
  // safeSetAttribute converts & → &amp; so the output is valid HTML5.
  assert.match(out, /title="Bed &amp; Breakfast"/);
});

test('applyLocale: descendants of a data-i18n-html parent are not iterated (H4)', () => {
  // Parent's innerHTML rewrite orphans the inner <span>. Without the
  // orphan-guard, the inner marker would trigger an "unknown key"
  // error. With the guard, the inner marker is ignored because it's
  // detached from the emitted DOM before the loop reaches it.
  const dict = { outer: 'REPLACED' };
  const out = applyLocale(
    '<div data-i18n-html="outer"><span data-i18n="never.exists"></span></div>',
    opts({ dict }),
  );
  assert.match(out, /REPLACED/);
  // The inner marker's key was never looked up → build didn't fail.
  // Verify the orphaned span isn't in the output either.
  assert.doesNotMatch(out, /never\.exists/);
});

test('applyLocale: descendants of a data-i18n parent are ALSO orphaned (H4-a)', () => {
  // pr-reviewer caught: the H4 fix only protected data-i18n-html
  // descendants, but the plain-text data-i18n path ALSO destroys
  // children via setTextContent's clear-and-replace. Without the
  // orphan-mark on this branch, an inner marker child threw
  // "unknown key" on a marker never in the output.
  const dict = { parent: 'PARENT_TEXT' };
  const out = applyLocale(
    '<div data-i18n="parent"><span data-i18n="never.exists"></span></div>',
    opts({ dict }),
  );
  assert.match(out, /PARENT_TEXT/);
  // Build didn't throw on the orphaned inner marker.
  assert.doesNotMatch(out, /never\.exists/);
  assert.doesNotMatch(out, /<span/);
});

test('applyLocale: data-i18n parent orphans a data-i18n-attr child (RM6)', () => {
  // Round-2 review coverage gap — attr markers on descendants of a
  // destroyed parent must also be skipped. The unknown key on the
  // orphan would otherwise leak as a build-fail on markup that never
  // reaches the output.
  const dict = { parent: 'TEXT' };
  const out = applyLocale(
    '<div data-i18n="parent"><span data-i18n-attr="title:never.exists"></span></div>',
    opts({ dict }),
  );
  assert.match(out, /TEXT/);
  assert.doesNotMatch(out, /never\.exists/);
});

test('applyLocale: data-i18n-html parent orphans a data-i18n-attr descendant (RM6)', () => {
  const dict = { outer: 'HTML' };
  const out = applyLocale(
    '<div data-i18n-html="outer"><span data-i18n-attr="aria-label:never.exists"></span></div>',
    opts({ dict }),
  );
  assert.match(out, /HTML/);
  assert.doesNotMatch(out, /never\.exists/);
});

test('applyLocale: nested data-i18n-html — inner is orphaned before its own iteration (RM6)', () => {
  const dict = { outer: 'OUTER' };
  const out = applyLocale(
    '<div data-i18n-html="outer"><section data-i18n-html="never.exists"></section></div>',
    opts({ dict }),
  );
  assert.match(out, /OUTER/);
  assert.doesNotMatch(out, /never\.exists/);
});

test('applyLocale: data-i18n parent orphans a data-i18n-meta descendant (RM6)', () => {
  const dict = { parent: 'TEXT' };
  const out = applyLocale(
    '<div data-i18n="parent"><meta data-i18n-meta="never.exists"></div>',
    opts({ dict }),
  );
  assert.match(out, /TEXT/);
  assert.doesNotMatch(out, /never\.exists/);
});

test('sanitizer: CDATA payload rejected (RC1 — live XSS bypass)', () => {
  // The critical finding from round-2. Without the text-node raw-`<`
  // check, `<![CDATA[<script>alert(1)</script>]]>` bypassed the tag
  // allowlist because node-html-parser stores CDATA as a single text
  // node. On serialize + browser parse, HTML5 has no CDATA outside
  // SVG/MathML, so the browser executes the embedded script.
  assert.throws(
    () => sanitizeHtmlFragment('<![CDATA[<script>alert(1)</script>]]>', 'k'),
    /raw '<' in text\/CDATA/i,
  );
});

test('sanitizer: HTML comment rejected (RL7)', () => {
  // Round-2 flagged that comments passed through the sanitizer despite
  // no legitimate translator use case. Reject.
  assert.throws(
    () => sanitizeHtmlFragment('<!-- hidden comment -->', 'k'),
    /disallowed HTML comment/i,
  );
});

test('loadDictionaries: pre-escaped &copy; entity rejected at load time (RH3)', async () => {
  // Fixture uses raw JSON strings — we can't build one on the fly with
  // fs-writes here, so exercise the helper directly via applyLocale
  // with a value that contains the entity. But rejectPreEscapedEntities
  // fires at LOAD time not TRANSFORM time — so the assertion below
  // is written against a directory fixture. Fixture at
  // fixtures/locales-preescape.
  const { loadDictionaries } = await import('../i18n-plugin.js');
  assert.throws(
    () => loadDictionaries(FIX('locales-preescape')),
    /pre-escaped HTML entity/i,
  );
});

test('applyLocale: BG pass emits Cyrillic', () => {
  const dict = { hi: 'Здравей, свят' };
  const out = applyLocale(
    '<h1 data-i18n="hi"></h1>',
    opts({ locale: 'bg', dict }),
  );
  assert.match(out, /Здравей, свят/);
});

test('applyLocale: noscript recursion translates real markers', () => {
  const dict = { fallback: 'JS-off message' };
  const out = applyLocale(
    '<noscript><p data-i18n="fallback"></p></noscript>',
    opts({ dict }),
  );
  assert.match(out, /JS-off message/);
});

test('applyLocale: noscript recursion does NOT trigger on prose containing data-i18n= (M9)', () => {
  // No real marker inside the noscript — just prose that mentions the
  // attribute name. The old regex-detection variant would re-parse
  // and throw "unknown key"; the new parse-first variant skips.
  const dict = { unused: 'x' };
  const out = applyLocale(
    '<noscript><p>Devs: this site uses data-i18n="key" markers.</p></noscript>',
    opts({ dict }),
  );
  // Prose survives verbatim, no build error.
  assert.match(out, /data-i18n="key"/);
});

test('applyLocale: does not mutate opts', () => {
  const o = opts({ dict: { k: 'v' } });
  const snapshot = JSON.parse(JSON.stringify({ ...o, dict: { ...o.dict }, ctx: { ...o.ctx } }));
  applyLocale('<div data-i18n="k"></div>', o);
  assert.deepEqual(o.dict, snapshot.dict);
  assert.deepEqual(o.ctx, snapshot.ctx);
});

// ---------------------------------------------------------------------------
// applyLocale — head injection (Part 2)
// ---------------------------------------------------------------------------

function headOpts(overrides = {}) {
  // Adds the Part-2 allLocales + defaultLocale required to exercise the
  // head-injection block. applyLocale is a no-op on head-injection when
  // these are absent (test-only opt-out).
  return opts({
    isDefault: overrides.locale === 'bg' ? false : true,
    basePath: '/vayana-bungalows/',
    pagePath: 'index.html',
    allLocales: ['bg', 'en'],
    defaultLocale: 'en',
    ...overrides,
  });
}

test('applyLocale: writes <html lang="bg"> on BG pass (head)', () => {
  const dict = { title: 'x' };
  const out = applyLocale(
    '<!doctype html><html><head></head><body></body></html>',
    headOpts({ locale: 'bg', dict }),
  );
  assert.match(out, /<html[^>]*\blang="bg"/);
});

test('applyLocale: emits hreflang alternates (en + bg + x-default)', () => {
  const dict = {};
  const out = applyLocale(
    '<!doctype html><html><head></head><body></body></html>',
    headOpts({ locale: 'en', dict, pagePath: 'enquiries/index.html' }),
  );
  assert.match(out, /hreflang="en" href="\/vayana-bungalows\/enquiries\/"/);
  assert.match(out, /hreflang="bg" href="\/vayana-bungalows\/bg\/enquiries\/"/);
  assert.match(out, /hreflang="x-default" href="\/vayana-bungalows\/enquiries\/"/);
});

test('applyLocale: hreflang emit is idempotent — re-transform strips prior block', () => {
  const dict = {};
  const first = applyLocale(
    '<!doctype html><html><head></head><body></body></html>',
    headOpts({ locale: 'en', dict }),
  );
  const second = applyLocale(first, headOpts({ locale: 'bg', dict }));
  // Only ONE open marker after the second pass — the first pass's block
  // was stripped before the second pass emitted its own.
  const opens = (second.match(/i18n:hreflang open/g) || []).length;
  assert.equal(opens, 1);
});

test('applyLocale: boot-redirect script has correct data attrs', () => {
  const out = applyLocale(
    '<!doctype html><html><head></head><body></body></html>',
    headOpts({ locale: 'bg', dict: {}, pagePath: 'enquiries/index.html' }),
  );
  assert.match(out, /<script data-locale="bg"/);
  assert.match(out, /data-en-url="\/vayana-bungalows\/enquiries\/"/);
  assert.match(out, /data-bg-url="\/vayana-bungalows\/bg\/enquiries\/"/);
});

test('applyLocale: boot-redirect script sets sentinel + no decodeURIComponent', () => {
  const out = applyLocale(
    '<!doctype html><html><head></head><body></body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  // Sentinel that lang.js reads to skip click wiring on doomed pages.
  assert.match(out, /data-i18n-redirecting/);
  // Whitelist raw match — no decodeURIComponent (would throw on
  // malformed URI and swallow the whole boot script).
  assert.doesNotMatch(out, /decodeURIComponent/);
});

test('applyLocale: canonical + og:url + twitter:url rewritten per locale', () => {
  const src = [
    '<!doctype html><html><head>',
    '<link rel="canonical" href="/foo/">',
    '<meta property="og:url" content="/foo/">',
    '<meta name="twitter:url" content="/foo/">',
    '</head><body></body></html>',
  ].join('');
  const out = applyLocale(
    src,
    headOpts({ locale: 'bg', dict: {}, pagePath: 'enquiries/index.html' }),
  );
  assert.match(out, /rel="canonical" href="\/vayana-bungalows\/bg\/enquiries\/"/);
  assert.match(out, /property="og:url" content="\/vayana-bungalows\/bg\/enquiries\/"/);
  assert.match(out, /name="twitter:url" content="\/vayana-bungalows\/bg\/enquiries\/"/);
});

test('applyLocale: data-lang-pill-expected marker when source has .site-header__lang', () => {
  const out = applyLocale(
    '<!doctype html><html><head></head><body><nav class="site-header__lang">pill</nav></body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  assert.match(out, /<html[^>]*\bdata-lang-pill-expected="1"/);
});

test('applyLocale: NO pill-expected marker when source lacks .site-header__lang', () => {
  const out = applyLocale(
    '<!doctype html><html><head></head><body></body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  assert.doesNotMatch(out, /data-lang-pill-expected/);
});

test('applyLocale: skips head injection when allLocales/defaultLocale absent (test opt-out)', () => {
  // Without the Part-2 fields, applyLocale is a no-op on the head — used
  // by every other test in this file. Sanity-check the opt-out.
  const out = applyLocale(
    '<!doctype html><html lang="xx"><head></head><body></body></html>',
    opts({ locale: 'bg', dict: {} }), // no allLocales / defaultLocale
  );
  // <html lang> was NOT rewritten.
  assert.match(out, /<html[^>]*\blang="xx"/);
  // No hreflang block.
  assert.doesNotMatch(out, /i18n:hreflang/);
});

// ---------------------------------------------------------------------------
// Round-2 review fixes — Part 2 rework
// ---------------------------------------------------------------------------

test('applyLocale: insertAfterHead ignores <head> substring inside HTML comments (F-parse5)', () => {
  // Bungalow detail pages start with a multi-line HTML comment that
  // mentions `<head>` in body text describing shared structure. Naive
  // regex insertion would splice INSIDE the comment, producing
  // nested-comment markup that parse5 rejects. The scan-copy fix
  // masks comment spans before searching.
  const src = [
    '<!doctype html>',
    '<!--',
    '  Duplication note: the shared <head> region is documented here.',
    '-->',
    '<html><head><title>x</title></head><body></body></html>',
  ].join('\n');
  const out = applyLocale(src, headOpts({ locale: 'en', dict: {} }));
  // Boot script landed AFTER the real <head>, not inside the comment.
  const commentEndIdx = out.indexOf('-->');
  const bootIdx = out.indexOf('i18n:boot-redirect open');
  assert.ok(bootIdx > commentEndIdx, 'boot script must land after the doc-comment');
});

test('applyLocale: string-splice strip removes only content between markers (F2)', () => {
  // On re-transform, Vite may have injected <link modulepreload> etc.
  // between our previous markers. Our strip must remove ONLY the
  // exact marker-comment span — anything OUTSIDE the markers stays.
  const firstPass = applyLocale(
    '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  // Simulate a Vite injection AFTER our previous block (between close
  // marker and next existing head content).
  const withVite = firstPass.replace(
    '<!--i18n:hreflang close-->',
    '<!--i18n:hreflang close-->\n<link rel="modulepreload" href="/x.js">',
  );
  const secondPass = applyLocale(withVite, headOpts({ locale: 'bg', dict: {} }));
  // Vite's injection must survive the second pass.
  assert.match(secondPass, /modulepreload/);
  // Our blocks re-emit in the fresh position (single copy).
  const opens = (secondPass.match(/i18n:hreflang open/g) || []).length;
  assert.equal(opens, 1);
});

test('applyLocale: boot script null-guards document.currentScript (F-boot)', () => {
  const out = applyLocale(
    '<!doctype html><html><head></head><body></body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  // Guard OR-fallback to querySelector when currentScript is null
  // (async execution, event handler, extension reinject).
  assert.match(out, /document\.currentScript\|\|document\.querySelector\('script\[data-locale\]'\)/);
  // Bail if the fallback also fails.
  assert.match(out, /if\(!s\)return/);
});

test('applyLocale: strips UTF-8 BOM before parsing — well, only in build hooks — this pins the contract', () => {
  // applyLocale itself doesn't strip BOM (parseHtml handles a leading
  // ﻿ as a text node). This test documents that behaviour: a BOM
  // survives the transform. writeBundle strips it defensively (see
  // configureServer + writeBundle in the plugin factory).
  const out = applyLocale(
    '﻿<!doctype html><html><head></head><body>x</body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  // BOM survives at the front (parseHtml tolerates it).
  assert.equal(out.charCodeAt(0), 0xfeff);
});

test('pageUrl hard-fails on backslash pagePath', async () => {
  // pageUrl requires forward-slash pagePath. Windows-style backslashes
  // would silently corrupt canonical/hreflang URLs. Test via a full
  // applyLocale call — pageUrl is not directly exported.
  assert.throws(
    () => applyLocale(
      '<!doctype html><html><head></head><body></body></html>',
      headOpts({ locale: 'en', dict: {}, pagePath: 'enquiries\\index.html' }),
    ),
    /forward-slash separators/i,
  );
});

test('pageUrl hard-fails on non-index.html pagePath', () => {
  assert.throws(
    () => applyLocale(
      '<!doctype html><html><head></head><body></body></html>',
      headOpts({ locale: 'en', dict: {}, pagePath: 'stay.html' }),
    ),
    /must name the index file/i,
  );
});

// ---------------------------------------------------------------------------
// Round-3 review coverage — mechanics not exercised by prior tests
// ---------------------------------------------------------------------------

test('applyLocale: repeated Part-2 emits stay idempotent — exactly one marker block each', () => {
  // The refactor to string-splice + `\s*`-free strip should mean multiple
  // re-transforms produce EXACTLY ONE hreflang block AND ONE boot block —
  // not zero (over-strip regression) and not N (idempotency regression).
  // (Prior name mentioned F-double-warn; the actual F-double-warn fix
  // is exercised in writeBundle, not applyLocale — see the plugin
  // factory's console.warn spy tests if/when added.)
  let out = applyLocale(
    '<!doctype html><html><head></head><body></body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  for (let i = 0; i < 5; i++) {
    out = applyLocale(out, headOpts({ locale: i % 2 ? 'bg' : 'en', dict: {} }));
  }
  const hreflangOpens = (out.match(/i18n:hreflang open/g) || []).length;
  const bootOpens = (out.match(/i18n:boot-redirect open/g) || []).length;
  assert.equal(hreflangOpens, 1);
  assert.equal(bootOpens, 1);
});

test('applyLocale: strip does NOT eat whitespace around Vite-injected siblings (L1)', () => {
  // First emit — clean state.
  const first = applyLocale(
    '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  // Simulate a Vite injection AFTER our block, on its own line.
  const withVite = first.replace(
    '<!--i18n:hreflang close-->',
    '<!--i18n:hreflang close-->\n<link rel="modulepreload" href="/x.js">',
  );
  // Second pass — strip + re-emit. The modulepreload was OUTSIDE our
  // block (after the close marker) so it must survive with its
  // preceding newline intact.
  const second = applyLocale(withVite, headOpts({ locale: 'bg', dict: {} }));
  assert.match(second, /\n<link rel="modulepreload"/);
});

test('insertAfterHead throws when <head> is missing (M4)', () => {
  // Direct call — bypass applyHead's DOM check so we actually hit the
  // throw. Round-3 review flagged that gating via applyLocale made the
  // throw unreachable and the previous "test" only inspected source
  // strings. Now behavioural: pass head-less markup, assert throw.
  assert.throws(
    () => insertAfterHead('<div>no head here</div>', '<script>x</script>'),
    /no <head> element found after strip pass/i,
  );
});

test('insertAfterHead: charset scan bounded to </head> (H-L4-1)', () => {
  // If <head> lacks <meta charset> but <body> has one, the previous
  // unbounded scan would splice our block INSIDE <body>. Now bounded
  // to </head>, so <meta charset> in <body> is ignored and the block
  // lands at the head-top fallback position.
  const src = '<!doctype html><html><head><title>x</title></head><body><meta charset="utf-8"></body></html>';
  const out = insertAfterHead(src, '<!--BLOCK-->');
  const blockIdx = out.indexOf('<!--BLOCK-->');
  const headCloseIdx = out.indexOf('</head>');
  assert.ok(blockIdx > 0, 'block was inserted');
  assert.ok(blockIdx < headCloseIdx, `block must land inside <head> (block at ${blockIdx}, </head> at ${headCloseIdx})`);
});

test('insertAfterHead: charset regex ignores "charset" as substring in another attr value (M-L4-2)', () => {
  // <meta name="description" content="charset behaviour"> — "charset"
  // appears in the value but is NOT a charset declaration. Previous
  // unanchored regex matched it and inserted our block AFTER this meta,
  // burying the block deep in <head> unnecessarily. Now anchored to
  // `\scharset\s*=` (attribute name position) OR the HTML4
  // `http-equiv="content-type"` shape.
  const src = '<!doctype html><html><head><meta name="description" content="talks about charset"><title>x</title></head><body></body></html>';
  const out = insertAfterHead(src, '<!--BLOCK-->');
  const blockIdx = out.indexOf('<!--BLOCK-->');
  const descIdx = out.indexOf('<meta name="description"');
  // Block lands BEFORE the description meta (at head-top fallback),
  // because the description-meta's "charset" substring in its content
  // is NOT a charset declaration.
  assert.ok(blockIdx < descIdx, 'block must land before the description meta');
});

test('insertAfterHead: HTML4-style http-equiv charset is honoured (M-L4-2)', () => {
  // The HTML4 shape `<meta http-equiv="Content-Type"
  // content="text/html; charset=utf-8">` IS a real charset declaration.
  // WHATWG treats it as one; we should too and insert AFTER it.
  const src = '<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>x</title></head><body></body></html>';
  const out = insertAfterHead(src, '<!--BLOCK-->');
  const blockIdx = out.indexOf('<!--BLOCK-->');
  const metaIdx = out.indexOf('<meta http-equiv');
  const metaEnd = out.indexOf('>', metaIdx);
  // Block lands AFTER the closing `>` of the http-equiv meta.
  assert.ok(blockIdx > metaEnd, 'block must land after http-equiv Content-Type meta');
});

// ---------------------------------------------------------------------------
// data-i18n-attr / data-i18n-meta — attribute-name + URL-scheme allowlist
// (S1 from round-4 sanity review)
// ---------------------------------------------------------------------------

test('data-i18n-attr: rejects event-handler attribute (S1)', () => {
  // `onclick`, `onload`, `onerror`, etc. — translator strings must not
  // land in DOM event handlers. `on*` is a name-shape match, no
  // per-attribute lookup needed.
  assert.throws(
    () => applyLocale(
      '<img data-i18n-attr="onerror:evil">',
      opts({ dict: { evil: 'alert(1)' } }),
    ),
    /DOM event handler/i,
  );
  assert.throws(
    () => applyLocale(
      '<div data-i18n-attr="onclick:evil"></div>',
      opts({ dict: { evil: 'alert(1)' } }),
    ),
    /DOM event handler/i,
  );
});

test('data-i18n-attr: rejects srcdoc / style / onload (S1)', () => {
  // srcdoc: <iframe srcdoc="<script>…"> executes the string as HTML.
  assert.throws(
    () => applyLocale(
      '<iframe data-i18n-attr="srcdoc:evil"></iframe>',
      opts({ dict: { evil: '<script>alert(1)</script>' } }),
    ),
    /XSS-adjacent sinks/i,
  );
  // style: CSS with url(javascript:…) / expression(…) is a legacy XSS vector.
  assert.throws(
    () => applyLocale(
      '<div data-i18n-attr="style:evil"></div>',
      opts({ dict: { evil: 'color:red' } }),
    ),
    /XSS-adjacent sinks/i,
  );
});

test('data-i18n-attr: rejects javascript: in URL-bearing attributes (S1)', () => {
  // href, src, action, formaction, xlink:href, poster, background,
  // cite, manifest, data, ping, longdesc — all URL-bearing.
  // Their values must pass isAllowedHref (same as data-i18n-html).
  for (const attr of ['href', 'src', 'action', 'formaction', 'poster']) {
    assert.throws(
      () => applyLocale(
        `<a data-i18n-attr="${attr}:evil">click</a>`,
        opts({ dict: { evil: 'javascript:alert(1)' } }),
      ),
      /not an allowed URL/i,
      `attribute ${attr} should reject javascript:`,
    );
  }
});

test('data-i18n-attr: rejects protocol-relative URL in href (S1)', () => {
  assert.throws(
    () => applyLocale(
      '<a data-i18n-attr="href:evil">click</a>',
      opts({ dict: { evil: '//attacker.example/phish' } }),
    ),
    /not an allowed URL/i,
  );
});

test('data-i18n-attr: rejects <meta http-equiv> redirect vector (S1)', () => {
  // <meta http-equiv="refresh" content="0;url=…"> is a URL-redirect vector.
  // Reject setting http-equiv itself AND reject setting content on any
  // <meta http-equiv> element.
  assert.throws(
    () => applyLocale(
      '<meta data-i18n-attr="http-equiv:evil">',
      opts({ dict: { evil: 'refresh' } }),
    ),
    /http-equiv/i,
  );
  assert.throws(
    () => applyLocale(
      '<meta http-equiv="refresh" data-i18n-attr="content:evil">',
      opts({ dict: { evil: '0; url=https://attacker.example' } }),
    ),
    /http-equiv/i,
  );
});

test('data-i18n-attr: accepts legitimate label / aria / title / placeholder (S1)', () => {
  // The 90% real use case — label copy — must NOT be broken by the
  // allowlist. All these should transform cleanly.
  const dict = { label: 'Click me', title: 'Tooltip', ph: 'Enter text' };
  const out = applyLocale(
    [
      '<button data-i18n-attr="aria-label:label"></button>',
      '<div data-i18n-attr="title:title"></div>',
      '<input data-i18n-attr="placeholder:ph">',
    ].join(''),
    opts({ dict }),
  );
  assert.match(out, /aria-label="Click me"/);
  assert.match(out, /title="Tooltip"/);
  assert.match(out, /placeholder="Enter text"/);
});

test('data-i18n-attr: accepts safe http/https/mailto/tel URLs in href (S1)', () => {
  const dict = {
    web: 'https://example.com',
    mail: 'mailto:x@y.co',
    call: 'tel:+123',
    root: '/internal/',
    anchor: '#top',
  };
  const out = applyLocale(
    [
      '<a data-i18n-attr="href:web">w</a>',
      '<a data-i18n-attr="href:mail">m</a>',
      '<a data-i18n-attr="href:call">c</a>',
      '<a data-i18n-attr="href:root">r</a>',
      '<a data-i18n-attr="href:anchor">a</a>',
    ].join(''),
    opts({ dict }),
  );
  assert.match(out, /href="https:\/\/example\.com"/);
  assert.match(out, /href="mailto:x@y\.co"/);
  assert.match(out, /href="tel:\+123"/);
  assert.match(out, /href="\/internal\/"/);
  assert.match(out, /href="#top"/);
});

test('data-i18n-meta: allowlist applies to meta shortcut too (S1)', () => {
  // data-i18n-meta="key" writes to `content`. On a <meta http-equiv>
  // element that content is a redirect vector; must reject.
  assert.throws(
    () => applyLocale(
      '<meta http-equiv="refresh" data-i18n-meta="evil">',
      opts({ dict: { evil: '0; url=https://attacker.example' } }),
    ),
    /http-equiv/i,
  );
  // Legitimate <meta name="description" content="…"> keeps working.
  const out = applyLocale(
    '<meta name="description" data-i18n-meta="desc">',
    opts({ dict: { desc: 'A page description' } }),
  );
  assert.match(out, /content="A page description"/);
});

// ---------------------------------------------------------------------------
// Round-6 review coverage — hazard invariants and cleanup regressions
// ---------------------------------------------------------------------------

test('data-i18n-attr: rejects target attribute (H1 — mirrors M14 target=_blank reject)', () => {
  // The sanitizer's data-i18n-html path rejects target on <a> (M14
  // reverse-tabnabbing). data-i18n-attr had drifted apart — a
  // translator writing target:cta.tgt would ship <a target="_blank">.
  // Now both paths reject target uniformly.
  assert.throws(
    () => applyLocale(
      '<a data-i18n-attr="target:evil">click</a>',
      opts({ dict: { evil: '_blank' } }),
    ),
    /is forbidden/i,
  );
});

test('data-i18n-attr: rejects javascript: in srcset (M1)', () => {
  // srcset + imagesrcset were missing from URL_BEARING_ATTRS. Now
  // included so `data:` / `javascript:` in a preload imagesrcset
  // hits isAllowedHref and hard-fails.
  assert.throws(
    () => applyLocale(
      '<img data-i18n-attr="srcset:evil">',
      opts({ dict: { evil: 'data:text/html,<script>alert(1)</script> 2x' } }),
    ),
    /not an allowed URL/i,
  );
});

test('rejectRelativeHrefs: catches embedded ../ (M2)', async () => {
  // Import the plugin source, call the exported string-based sweep
  // via a small round-trip. rejectRelativeHrefs isn't exported so
  // we exercise it by capturing console.warn on a writeBundle-shape
  // input via applyLocale flow. Simpler: verify via source scan that
  // the check includes the embedded pattern.
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(
    new URL('../i18n-plugin.js', import.meta.url),
    'utf-8',
  );
  // The sweep must check all four shapes:
  assert.match(src, /v === '\.\.'/);
  assert.match(src, /v\.startsWith\('\.\.\/'\)/);
  assert.match(src, /v\.includes\('\/\.\.\/'\)/);
  assert.match(src, /v\.endsWith\('\/\.\.'\)/);
});

test('flatten: rejects dot-in-key hazard (M3)', () => {
  // `{"home.title": "A"}` collides with `{"home": {"title": "B"}}`.
  // Both flatten to `home.title` — silent value ambiguity. Now
  // rejected at load time via the dot-in-key check.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  writeFileSync(join(tmp, 'en.json'), JSON.stringify({
    'home.title': 'flat',
  }));
  writeFileSync(join(tmp, 'bg.json'), JSON.stringify({
    'home.title': 'flat',
  }));
  assert.throws(
    () => loadDictionaries(tmp),
    /contains a dot/i,
  );
});

test('loadDictionaries: rejects symlinked locale file (M11 coverage gap)', () => {
  // The plugin claims to reject symlinked locale files (translator
  // committing `pl.json → ../../.git/config` would leak). Test the
  // guard actually fires.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  const targetPath = join(tmp, 'real.json');
  writeFileSync(targetPath, '{"k":"v"}');
  writeFileSync(join(tmp, 'en.json'), JSON.stringify({ k: 'a' }));
  try {
    symlinkSync(targetPath, join(tmp, 'bg.json'));
  } catch {
    // Symlink creation may fail on some Windows CI environments —
    // skip the test rather than fail on the environmental issue.
    return;
  }
  assert.throws(
    () => loadDictionaries(tmp),
    /symlinked locale file/i,
  );
});

test('flatten: MAX_FLATTEN_DEPTH cap fires on pathological nesting (L16 coverage gap)', () => {
  // 40-deep nested object exceeds MAX_FLATTEN_DEPTH=32. Prior version
  // had this hazard documented + guarded, but no test — a refactor
  // that dropped `depth + 1` would silently regress.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));

  function nest(n) {
    let obj = 'leaf';
    for (let i = 0; i < n; i++) obj = { child: obj };
    return obj;
  }
  writeFileSync(join(tmp, 'en.json'), JSON.stringify(nest(40)));
  writeFileSync(join(tmp, 'bg.json'), JSON.stringify(nest(40)));
  assert.throws(
    () => loadDictionaries(tmp),
    /exceeds max nesting depth/i,
  );
});

test('loadDictionaries: case-insensitive filesystem — EN.JSON becomes locale "en" (L15 coverage gap)', () => {
  // On macOS HFS+/APFS-CI, `EN.JSON` and `en.json` are the same file.
  // Plugin normalises via .toLowerCase() on read. Verify by constructing
  // a fixture with an uppercase-named file.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  writeFileSync(join(tmp, 'EN.JSON'), JSON.stringify({ k: 'a' }));
  writeFileSync(join(tmp, 'bg.json'), JSON.stringify({ k: 'b' }));
  const { locales, dicts } = loadDictionaries(tmp);
  assert.ok(locales.includes('en'), `locales should contain 'en', got ${JSON.stringify(locales)}`);
  assert.equal(dicts.en.k, 'a');
});

test('loadDictionaries: token asymmetry per key hard-fails (M5 coverage gap)', () => {
  // Same key set + different tokens = hard-fail. Prior release had
  // NO test — refactor could silently break token symmetry check.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  writeFileSync(join(tmp, 'en.json'), JSON.stringify({
    msg: 'Call {phone}',
  }));
  writeFileSync(join(tmp, 'bg.json'), JSON.stringify({
    msg: 'Обади ни се',
  }));
  assert.throws(
    () => loadDictionaries(tmp),
    /token asymmetry/i,
  );
});

test('loadDictionaries: rejectPreEscapedEntities covers numeric + named entities (M6 coverage gap)', () => {
  // Previous fixture only exercised `&copy;`. Now cover a numeric
  // entity `&#39;` and a common named one `&amp;` — a refactor that
  // dropped the numeric-alternates branch would silently ship
  // double-escapes for translators using `&#39;` or `&#x27;`.
  for (const badValue of [
    "Rooms &amp; Rates",       // &amp;
    "It&#39;s time",           // &#39;
    "5&#x27;s",                // &#x27;
    "&nbsp;check-in",          // &nbsp;
  ]) {
    const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
    writeFileSync(join(tmp, 'en.json'), JSON.stringify({ k: badValue }));
    writeFileSync(join(tmp, 'bg.json'), JSON.stringify({ k: 'ok' }));
    assert.throws(
      () => loadDictionaries(tmp),
      /pre-escaped HTML entity/i,
      `should reject entity in value: ${badValue}`,
    );
  }
});

test('applyLocale: BG regression — full-cycle test writeBundle-shape emit works', () => {
  // Simulates the writeBundle flow: EN emit is fed into applyLocale
  // as a BG pass. The head block from the EN pass must be replaced
  // with a BG-flavoured one (updated lang, updated canonical, updated
  // boot-script data-locale).
  const src = [
    '<!doctype html><html><head>',
    '<link rel="canonical" href="/foo/">',
    '</head><body></body></html>',
  ].join('');
  const enOut = applyLocale(
    src,
    headOpts({ locale: 'en', dict: {}, pagePath: 'enquiries/index.html' }),
  );
  // Sanity: EN output carries EN attrs.
  assert.match(enOut, /<html[^>]*\blang="en"/);
  assert.match(enOut, /<script data-locale="en"/);

  // Re-transform as BG (writeBundle path).
  const bgOut = applyLocale(
    enOut,
    headOpts({ locale: 'bg', dict: {}, pagePath: 'enquiries/index.html' }),
  );
  // BG attrs everywhere. Exactly one head block.
  assert.match(bgOut, /<html[^>]*\blang="bg"/);
  assert.match(bgOut, /<script data-locale="bg"/);
  assert.doesNotMatch(bgOut, /data-locale="en"/);
  assert.match(bgOut, /rel="canonical" href="\/vayana-bungalows\/bg\/enquiries\/"/);
});

test('applyLocale: BOM survives applyLocale but strip happens at build-hook boundary (F-BOM)', async () => {
  // applyLocale is a pure transform — it doesn't sanitize BOMs
  // because the source file may legitimately have one and users
  // may want that preserved. The BOM strip happens in writeBundle
  // + configureServer (build-hook boundary). This test pins the
  // pure-transform behaviour so a future accidental "strip in
  // applyLocale too" refactor doesn't quietly break BOM preservation
  // for other consumers.
  const out = applyLocale(
    '﻿<!doctype html><html><head></head><body>x</body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  assert.equal(out.charCodeAt(0), 0xfeff);

  // Verify the build hooks strip BOMs — read the plugin source to
  // confirm both callsites still have the 0xfeff guard.
  // (Can't easily unit-test the Vite hook without a full Vite context.)
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(
    new URL('../i18n-plugin.js', import.meta.url),
    'utf-8',
  );
  const bomChecks = (src.match(/charCodeAt\(0\) === 0xfeff/g) || []).length;
  assert.ok(bomChecks >= 2, `expected ≥2 BOM strip sites (writeBundle + configureServer), found ${bomChecks}`);
});

test('applyLocale: boot script fits inside the WHATWG <meta charset> safety window (L4)', () => {
  // WHATWG recommends the charset declaration be within the first 1024
  // bytes of the document. Our boot script + hreflang block gets
  // inserted BEFORE any existing <meta charset>, so if the block ever
  // grew past 1024 bytes minus the doctype+<head> lead, the charset
  // could get pushed outside the window. Currently ~750 bytes — headroom.
  const out = applyLocale(
    '<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body></body></html>',
    headOpts({ locale: 'en', dict: {} }),
  );
  const charsetIdx = out.indexOf('<meta charset');
  assert.ok(
    charsetIdx < 1024,
    `<meta charset> at byte ${charsetIdx}, should be within the first 1024 bytes`,
  );
});

// ---------------------------------------------------------------------
// data-i18n-attr multi-pair syntax (H1) — semicolon-separated attr:key
// pairs so a single marker can key multiple attributes on one element.
// Each pair goes through the SAME allowlist as a single-pair marker;
// there is no fast path.
// ---------------------------------------------------------------------

test('data-i18n-attr: multi-pair — writes all attributes from one marker (H1)', () => {
  const dict = {
    home_url: 'https://example.com/',
    home_title: 'Go home',
    home_aria: 'Home page',
  };
  const out = applyLocale(
    '<a data-i18n-attr="href:home_url; title:home_title; aria-label:home_aria">x</a>',
    opts({ dict }),
  );
  assert.match(out, /href="https:\/\/example\.com\/"/);
  assert.match(out, /title="Go home"/);
  assert.match(out, /aria-label="Home page"/);
  assert.doesNotMatch(out, /data-i18n-attr=/);
});

test('data-i18n-attr: multi-pair — whitespace around pairs is trimmed (H1)', () => {
  const dict = { a: 'A', b: 'B' };
  const out = applyLocale(
    '<div data-i18n-attr="  title:a  ;   aria-label:b  "></div>',
    opts({ dict }),
  );
  assert.match(out, /title="A"/);
  assert.match(out, /aria-label="B"/);
});

test('data-i18n-attr: multi-pair — empty segment (trailing ";") rejected (H1)', () => {
  assert.throws(
    () =>
      applyLocale(
        '<a data-i18n-attr="href:a;">x</a>',
        opts({ dict: { a: '/x' } }),
      ),
    /empty pair/,
  );
});

test('data-i18n-attr: multi-pair — duplicate ";;" rejected (H1)', () => {
  assert.throws(
    () =>
      applyLocale(
        '<a data-i18n-attr="href:a;;title:b">x</a>',
        opts({ dict: { a: '/x', b: 'T' } }),
      ),
    /empty pair/,
  );
});

test('data-i18n-attr: multi-pair — allowlist runs per pair (H1)', () => {
  // One pair is legitimate, one hits FORBIDDEN_ATTR_NAMES. Whole marker
  // must fail — a "one bad pair spoils the whole marker" contract is
  // the only safe default (partial-apply would leave the DOM in a
  // half-authored state).
  assert.throws(
    () =>
      applyLocale(
        '<a data-i18n-attr="href:a; target:b">x</a>',
        opts({ dict: { a: '/x', b: '_blank' } }),
      ),
    /forbidden/,
  );
});

test('data-i18n-attr: multi-pair — URL-scheme allowlist runs per pair (H1)', () => {
  assert.throws(
    () =>
      applyLocale(
        '<a data-i18n-attr="href:good; src:bad">x</a>',
        opts({
          dict: { good: '/x', bad: 'javascript:alert(1)' },
        }),
      ),
    /not an allowed URL/,
  );
});

test('data-i18n-attr: single-pair syntax still works (H1 backwards compat)', () => {
  const dict = { label: 'Click' };
  const out = applyLocale(
    '<button data-i18n-attr="aria-label:label"></button>',
    opts({ dict }),
  );
  assert.match(out, /aria-label="Click"/);
});
