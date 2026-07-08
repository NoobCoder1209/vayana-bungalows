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
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadDictionaries,
  interpolate,
  escapeHtmlAttr,
  sanitizeHtmlFragment,
  applyLocale,
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
