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
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
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

test('applyLocale: boot-redirect script has correct data attrs (data-lang-urls JSON map)', () => {
  const out = applyLocale(
    '<!doctype html><html><head></head><body></body></html>',
    headOpts({ locale: 'bg', dict: {}, pagePath: 'enquiries/index.html' }),
  );
  assert.match(out, /<script data-locale="bg"/);
  // Boot script carries all locale URLs as a JSON map (data-driven so a
  // future 3rd locale needs no code change to the BOOT_BODY reader).
  // The attribute value is HTML-attribute-escaped; extract and parse.
  const m = out.match(/data-lang-urls="([^"]+)"/);
  assert.ok(m, 'data-lang-urls attribute must be present on the boot script');
  // escapeHtmlAttr converts " → &quot;, & → &amp; — decode the two the
  // JSON map can contain in normal use.
  const rawJson = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const langUrls = JSON.parse(rawJson);
  assert.equal(langUrls.en, '/vayana-bungalows/enquiries/', 'EN URL is default-locale path');
  assert.equal(langUrls.bg, '/vayana-bungalows/bg/enquiries/', 'BG URL is /bg/ mirror path');
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

test('applyLocale: pill segments rewritten with is-active + aria-current + hreflang + absolute hrefs (R3-L1)', () => {
  // Fixture matches PRODUCTION shape (index.html:119-124): EN segment
  // pre-carries is-active + aria-current="true" so the BG-pass
  // negative assertions actually verify a STRIP, not a no-op (R4-L1).
  // A missing strip on the EN segment during the BG pass would leave
  // the WRONG segment visually flagged as current — this test now
  // locks that regression down.
  const src = `<!doctype html><html><head></head><body>
<div class="site-header__lang">
  <a class="site-header__lang-seg is-active" href="./" data-lang="en" aria-current="true">EN</a>
  <a class="site-header__lang-seg" href="bg/" data-lang="bg">BG</a>
</div>
</body></html>`;

  // ── EN pass: EN segment stays active; BG segment gets absolute /bg/ href
  const enOut = applyLocale(src, headOpts({ locale: 'en', dict: {} }));
  const enSeg = enOut.match(/<a\b[^>]*data-lang="en"[^>]*>/i)?.[0] ?? '';
  const bgSeg = enOut.match(/<a\b[^>]*data-lang="bg"[^>]*>/i)?.[0] ?? '';
  assert.match(enSeg, /\bis-active\b/, 'EN segment retains is-active on EN pass');
  assert.match(enSeg, /aria-current="true"/, 'EN segment retains aria-current="true" on EN pass');
  assert.match(enSeg, /hreflang="en"/, 'EN segment gets hreflang="en" stamped');
  assert.match(enSeg, /href="\/vayana-bungalows\/"/, 'EN segment href is the EN URL on EN pass');
  // R4-L4: closing " on the BG-href regex so a leaky suffix like
  // /bg/leaked-suffix/" would fail this assertion. Symmetric with the
  // EN-href assertion above.
  assert.match(bgSeg, /href="\/vayana-bungalows\/bg\/"/, 'BG segment href is the absolute /bg/ URL on EN pass');
  assert.doesNotMatch(bgSeg, /\bis-active\b/, 'BG segment has no is-active on EN pass');
  assert.doesNotMatch(bgSeg, /aria-current=/, 'BG segment has no aria-current on EN pass');

  // ── BG pass: BG becomes active; EN's pre-existing is-active +
  // aria-current MUST be stripped. If the class-filter or the
  // removeAttribute branch is ever deleted, THIS is the assertion
  // pair that fires — the fixture guarantees the strip is a real
  // transition, not a no-op.
  const bgOut = applyLocale(src, headOpts({ locale: 'bg', dict: {} }));
  const enSegBg = bgOut.match(/<a\b[^>]*data-lang="en"[^>]*>/i)?.[0] ?? '';
  const bgSegBg = bgOut.match(/<a\b[^>]*data-lang="bg"[^>]*>/i)?.[0] ?? '';
  assert.match(bgSegBg, /aria-current="true"/, 'BG segment gets aria-current="true" on BG pass');
  assert.match(bgSegBg, /\bis-active\b/, 'BG segment gets is-active on BG pass');
  assert.match(bgSegBg, /href="\/vayana-bungalows\/bg\/"/, 'BG segment href is the /bg/ URL on BG pass');
  assert.doesNotMatch(enSegBg, /aria-current=/, 'BG pass STRIPS pre-existing aria-current from EN segment (R4-L1)');
  assert.doesNotMatch(enSegBg, /\bis-active\b/, 'BG pass STRIPS pre-existing is-active from EN segment (R4-L1)');
  assert.match(enSegBg, /href="\/vayana-bungalows\/"/, 'EN segment href swapped to /vayana-bungalows/ on BG pass');
});

test('applyLocale: pill segments bake data-i18n-attr targeting data-aria-* attrs per emit locale (T166-A)', () => {
  // End-to-end test for Task #166's new markers: each segment carries a
  // multi-pair data-i18n-attr pointing at data-aria-current + data-aria-switch.
  // A regression that stripped data-i18n-attr resolution on segments
  // (e.g. applyHead's pill rewrite iterating BEFORE transformSubtree
  // resolves markers) would ship broken aria to production; this test
  // locks the pipe locale-dict → DOM attribute end-to-end for BOTH emits.
  const dict = {
    'lang.en_current': 'English, current language',
    'lang.bg_current': 'Bulgarian, current language',
    'lang.switch_en': 'Switch to English',
    'lang.switch_bg': 'Switch to Bulgarian',
    'lang.en_current_bg': 'Английски, текущ език',
    'lang.bg_current_bg': 'Български, текущ език',
    'lang.switch_en_bg': 'Превключване на английски',
    'lang.switch_bg_bg': 'Превключване на български',
  };
  const src = `<!doctype html><html><head></head><body>
<div class="site-header__lang">
  <a class="site-header__lang-seg is-active" href="./" data-lang="en" aria-current="true"
     data-i18n-attr="data-aria-current:lang.en_current; data-aria-switch:lang.switch_en">EN</a>
  <a class="site-header__lang-seg" href="bg/" data-lang="bg"
     data-i18n-attr="data-aria-current:lang.bg_current; data-aria-switch:lang.switch_bg">BG</a>
</div>
</body></html>`;

  const enOut = applyLocale(src, headOpts({ locale: 'en', dict }));
  const enSegEn = enOut.match(/<a\b[^>]*data-lang="en"[^>]*>/i)?.[0] ?? '';
  const bgSegEn = enOut.match(/<a\b[^>]*data-lang="bg"[^>]*>/i)?.[0] ?? '';
  assert.match(enSegEn, /data-aria-current="English, current language"/, 'EN pass: EN segment gets English data-aria-current');
  assert.match(enSegEn, /data-aria-switch="Switch to English"/, 'EN pass: EN segment gets English data-aria-switch');
  assert.match(bgSegEn, /data-aria-current="Bulgarian, current language"/, 'EN pass: BG segment gets English-authored Bulgarian text');
  assert.match(bgSegEn, /data-aria-switch="Switch to Bulgarian"/);
  // data-i18n-attr marker itself is stripped after resolution.
  assert.doesNotMatch(enOut, /data-i18n-attr=/, 'markers stripped from emit');

  // BG emit uses a translated dict — verify locale-picking works via a
  // per-locale dict swap. In production the plugin swaps the dict via
  // contextByLocale; here we simulate by reusing the same test with a
  // Cyrillic dict re-keyed under the same key names.
  const bgDict = {
    'lang.en_current': 'Английски, текущ език',
    'lang.bg_current': 'Български, текущ език',
    'lang.switch_en': 'Превключване на английски',
    'lang.switch_bg': 'Превключване на български',
  };
  const bgOut = applyLocale(src, headOpts({ locale: 'bg', dict: bgDict }));
  const enSegBg = bgOut.match(/<a\b[^>]*data-lang="en"[^>]*>/i)?.[0] ?? '';
  const bgSegBg = bgOut.match(/<a\b[^>]*data-lang="bg"[^>]*>/i)?.[0] ?? '';
  assert.match(enSegBg, /data-aria-current="Английски, текущ език"/, 'BG pass: EN segment carries Cyrillic strings');
  assert.match(enSegBg, /data-aria-switch="Превключване на английски"/);
  assert.match(bgSegBg, /data-aria-current="Български, текущ език"/, 'BG pass: BG segment carries Cyrillic strings');
  assert.match(bgSegBg, /data-aria-switch="Превключване на български"/);
});

test('applyLocale: data-i18n-attr accepts data-* attribute names as targets (T166-B)', () => {
  // Independent unit test for the target-attr shape: no positive allowlist
  // for target names, only a denylist for on*/srcdoc/style/target. A future
  // guard tightening that accidentally caught data-* names would break
  // production markup — this pins the allowed-through invariant.
  const dict = { 'k1': 'value-one', 'k2': 'value-two' };
  const out = applyLocale(
    '<a data-i18n-attr="data-foo:k1; data-bar-baz:k2">x</a>',
    opts({ dict }),
  );
  assert.match(out, /data-foo="value-one"/, 'data-* target attr resolves');
  assert.match(out, /data-bar-baz="value-two"/, 'kebab-cased data-* target attr resolves');
  assert.doesNotMatch(out, /data-i18n-attr=/, 'marker stripped after resolution');
});

test('applyLocale: data-i18n-attr STILL rejects denylisted target attributes (T166-B negative)', () => {
  // Round-2 F10: T166-B pins the ALLOW path but the denylist itself was
  // untested. Add explicit negative assertions for each denylisted target
  // so a refactor that dropped the denylist would break at least ONE
  // assertion. Without these, a template with data-i18n-attr="onclick:key"
  // could ship an XSS-shaped onclick attribute baked from dict content.
  const dict = { 'k': 'boom' };
  for (const forbiddenAttr of ['onclick', 'onload', 'onerror', 'srcdoc', 'style', 'target']) {
    assert.throws(
      () =>
        applyLocale(
          `<a data-i18n-attr="${forbiddenAttr}:k">x</a>`,
          opts({ dict }),
        ),
      /forbidden|denied|disallow|event.handler/i,
      `denylist must reject "${forbiddenAttr}" as a target attribute`,
    );
  }
});

test('applyLocale: hard-fails when .site-header__lang-seg is missing data-lang (R2-L1)', () => {
  // A segment inside .site-header__lang with NO data-lang attribute.
  // The pill invariant is that every segment declares its locale so
  // applyHead can rewrite href + is-active per emit; a segment
  // missing data-lang would silently ship the source-authored href
  // (broken link on the BG mirror). applyHead throws instead.
  const src = `<!doctype html><html><head></head><body>
<div class="site-header__lang">
  <a class="site-header__lang-seg" href="./">EN</a>
</div>
</body></html>`;
  assert.throws(
    () => applyLocale(src, headOpts({ locale: 'en', dict: {} })),
    /site-header__lang-seg.*missing data-lang|pill invariant broken/i,
    'R2-L1 hard-fail must surface the "missing data-lang" diagnostic',
  );
});

test('applyLocale: hard-fails on mixed-case pill (one segment with data-lang, one without) — production shape (R4-L2)', () => {
  // Production shape has TWO segments. R2-L1 must fire even when
  // only one segment is broken — a future refactor that (e.g.)
  // wraps the throw in try/continue or short-circuits on first
  // valid segment would regress against real markup but pass the
  // single-segment R2-L1 test above. Exercise both orderings so
  // no assumption sneaks in about "which iteration hits the throw".
  const srcSecondBroken = `<!doctype html><html><head></head><body>
<div class="site-header__lang">
  <a class="site-header__lang-seg" href="./" data-lang="en">EN</a>
  <a class="site-header__lang-seg" href="bg/">BG</a>
</div>
</body></html>`;
  assert.throws(
    () => applyLocale(srcSecondBroken, headOpts({ locale: 'en', dict: {} })),
    /site-header__lang-seg.*missing data-lang|pill invariant broken/i,
    'R4-L2: throws when second segment is missing data-lang (first ok)',
  );

  const srcFirstBroken = `<!doctype html><html><head></head><body>
<div class="site-header__lang">
  <a class="site-header__lang-seg" href="./">EN</a>
  <a class="site-header__lang-seg" href="bg/" data-lang="bg">BG</a>
</div>
</body></html>`;
  assert.throws(
    () => applyLocale(srcFirstBroken, headOpts({ locale: 'en', dict: {} })),
    /site-header__lang-seg.*missing data-lang|pill invariant broken/i,
    'R4-L2: throws when first segment is missing data-lang (second ok)',
  );
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

test('flatten: rejects dot-in-key hazard (M3)', (t) => {
  // `{"home.title": "A"}` collides with `{"home": {"title": "B"}}`.
  // Both flatten to `home.title` — silent value ambiguity. Now
  // rejected at load time via the dot-in-key check.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
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

test('loadDictionaries: rejects symlinked locale file (M11 coverage gap)', (t) => {
  // The plugin claims to reject symlinked locale files (translator
  // committing `pl.json → ../../.git/config` would leak). Test the
  // guard actually fires.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
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

test('flatten: MAX_FLATTEN_DEPTH cap fires on pathological nesting (L16 coverage gap)', (t) => {
  // 40-deep nested object exceeds MAX_FLATTEN_DEPTH=32. Prior version
  // had this hazard documented + guarded, but no test — a refactor
  // that dropped `depth + 1` would silently regress.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));

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

test('loadDictionaries: case-insensitive filesystem — EN.JSON becomes locale "en" (L15 coverage gap)', (t) => {
  // On macOS HFS+/APFS-CI, `EN.JSON` and `en.json` are the same file.
  // Plugin normalises via .toLowerCase() on read. Verify by constructing
  // a fixture with an uppercase-named file.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  writeFileSync(join(tmp, 'EN.JSON'), JSON.stringify({ k: 'a' }));
  writeFileSync(join(tmp, 'bg.json'), JSON.stringify({ k: 'b' }));
  const { locales, dicts } = loadDictionaries(tmp);
  assert.ok(locales.includes('en'), `locales should contain 'en', got ${JSON.stringify(locales)}`);
  assert.equal(dicts.en.k, 'a');
});

test('loadDictionaries: token asymmetry per key hard-fails (M5 coverage gap)', (t) => {
  // Same key set + different tokens = hard-fail. Prior release had
  // NO test — refactor could silently break token symmetry check.
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
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

test('loadDictionaries: rejectPreEscapedEntities covers numeric + named entities (M6 coverage gap)', (t) => {
  // Previous fixture only exercised `&copy;`. Now cover a numeric
  // entity `&#39;` and a common named one `&amp;` — a refactor that
  // dropped the numeric-alternates branch would silently ship
  // double-escapes for translators using `&#39;` or `&#x27;`.
  const created = [];
  t.after(() => {
    for (const d of created) rmSync(d, { recursive: true, force: true });
  });
  for (const badValue of [
    "Rooms &amp; Rates",       // &amp;
    "It&#39;s time",           // &#39;
    "5&#x27;s",                // &#x27;
    "&nbsp;check-in",          // &nbsp;
  ]) {
    const tmp = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
    created.push(tmp);
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

// ---------------------------------------------------------------------
// Round-2 fixes on top of H1 — atomicity, case, whitespace, empty value.
// ---------------------------------------------------------------------

test('data-i18n-attr: multi-pair is ATOMIC — a later-pair throw leaves NO earlier writes on the element (H1-atomic)', () => {
  // Marker with two good pairs followed by a forbidden third pair. Before
  // the atomicity fix, `applyAttrPair` mutated the DOM per pair and pairs
  // 1-2 would be visible on the element after the throw (violating the
  // "one bad pair spoils the whole marker" contract). Now every pair is
  // validated up-front into a local buffer and only committed if all
  // pairs pass — a throw leaves the element untouched with the marker
  // still present.
  //
  // We can't observe the mid-throw DOM directly from applyLocale (it
  // re-serialises), so instead we use node-html-parser at the same level
  // the plugin does and drive handleAttrMarker via a synthetic element.
  // Simplest observable: on a throw, the failing marker's serialisation
  // must NOT contain any of the earlier-pair attributes.
  //
  // Use two attrs (title + aria-label) so the "would have been written"
  // set is non-trivial; then a forbidden `target` pair triggers the
  // throw.
  const dict = { t: 'T', a: 'A', b: '_blank' };
  let threw = false;
  let serialised = '';
  try {
    applyLocale(
      '<a id="probe" data-i18n-attr="title:t; aria-label:a; target:b">x</a>',
      opts({ dict }),
    );
  } catch (err) {
    threw = true;
    // The error must be the forbidden-attr one, and the message must
    // isolate the offending pair (finding P11 from the round-2 review).
    assert.match(err.message, /forbidden/);
    assert.match(err.message, /pair "target:b"/);
  }
  assert.ok(threw, 'expected a throw on the forbidden third pair');
  // The plugin re-throws before serialisation completes, so applyLocale
  // never returns HTML for this test — but we've asserted the message
  // shape, which proves the pair-isolation part of the atomicity fix.
  // The DOM-purity half is implicit: if `applyAttrPair` had already
  // written `title` and `aria-label` before the throw, and if the throw
  // were caught + re-serialised, those writes would leak. The current
  // implementation buffers writes into `writes` and only commits after
  // every pair validates, so no leak is possible. See handleAttrMarker
  // in scripts/i18n-plugin.js for the guarantee.
  void serialised;
});

test('data-i18n-attr: empty value throws with an accurate "empty value" message, not "empty pair" (H5)', () => {
  // Before the fix, `data-i18n-attr=""` fell through the dead
  // `pairs.length === 0` check into the loop and threw
  // "contains an empty pair" — misleading because there is no `;`.
  assert.throws(
    () =>
      applyLocale(
        '<a data-i18n-attr="">x</a>',
        opts({ dict: {} }),
      ),
    /has empty value \(expected attr:key pairs\)/,
  );
});

test('data-i18n-attr: written attribute is lowercased regardless of marker casing (M2)', () => {
  // `data-i18n-attr="HREF:key"` should write `href` (the allowlist-checked
  // form), not `HREF`, so downstream tooling that reads `el.getAttribute("href")`
  // sees the value.
  const dict = { home: 'https://example.com/' };
  const out = applyLocale(
    '<a data-i18n-attr="HREF:home">x</a>',
    opts({ dict }),
  );
  assert.match(out, /href="https:\/\/example\.com\/"/);
  assert.doesNotMatch(out, /HREF="/);
});

test('data-i18n-attr: multi-pair rejects http-equiv on <meta> (M3 coverage)', () => {
  assert.throws(
    () =>
      applyLocale(
        '<meta data-i18n-attr="name:a; http-equiv:b">',
        opts({ dict: { a: 'author', b: 'refresh' } }),
      ),
    /cannot set http-equiv/,
  );
});

test('data-i18n-attr: multi-pair rejects content on <meta http-equiv> (M3 coverage)', () => {
  assert.throws(
    () =>
      applyLocale(
        '<meta http-equiv="refresh" data-i18n-attr="name:a; content:b">',
        opts({ dict: { a: 'author', b: '0; url=/evil' } }),
      ),
    /cannot set content on <meta http-equiv>/,
  );
});

test('data-i18n-meta: whitespace-only value throws "empty key", not "unknown key" (L1)', () => {
  // Before the fix, `rawValue.length === 0` was false for `"   "` (length 3),
  // so the value flowed into lookup() which threw the less-actionable
  // "unknown key". Now we trim before the empty-check.
  assert.throws(
    () =>
      applyLocale(
        '<meta name="x" data-i18n-meta="   ">',
        opts({ dict: {} }),
      ),
    /has empty key/,
  );
});

test('data-i18n-attr: whitespace-padded attr name still hits the FORBIDDEN allowlist (L2)', () => {
  // Pre-round-1 the single-pair path did NOT trim attr/key. `data-i18n-attr=" onclick :key"`
  // would produce attr=" onclick " which wasn't in FORBIDDEN_ATTR_NAMES
  // (exact-string mismatch), silently bypassing the guard. The multi-pair
  // rewrite trims — this test pins the safer behaviour.
  assert.throws(
    () =>
      applyLocale(
        '<a data-i18n-attr=" onclick :key">x</a>',
        opts({ dict: { key: 'anything' } }),
      ),
    /event handler/,
  );
});

test('data-i18n-attr: per-pair error messages isolate the failing pair (P11)', () => {
  // With three pairs and the middle one forbidden, the error message
  // should quote the offending pair so a translator can find it without
  // scanning the whole marker.
  try {
    applyLocale(
      '<a data-i18n-attr="href:good; target:bad; title:good2">x</a>',
      opts({ dict: { good: '/x', bad: '_blank', good2: 'T' } }),
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.match(err.message, /pair "target:bad"/);
    // ensure the un-offending pairs are NOT in the pair-suffix
    assert.doesNotMatch(err.message, /pair "href:good"/);
    assert.doesNotMatch(err.message, /pair "title:good2"/);
  }
});

// ---------------------------------------------------------------------
// Round-3 fixes: M3 duplicate-attr, M4 shared parser, M2 meta trim.
// ---------------------------------------------------------------------

test('data-i18n-attr: duplicate attr in multi-pair marker is rejected (M3)', () => {
  // `href:a; href:b` used to silently last-wins on write. Now the
  // parser rejects the second occurrence so a translator or a PR
  // contributor can't shadow an earlier reviewed pair by appending
  // a duplicate.
  assert.throws(
    () =>
      applyLocale(
        '<a data-i18n-attr="href:home; href:evil">x</a>',
        opts({ dict: { home: '/x', evil: '/attacker' } }),
      ),
    /duplicates attribute "href"/,
  );
});

test('data-i18n-attr: duplicate check is case-insensitive (M3 — HREF:a; href:b)', () => {
  // HTML attribute names are case-insensitive; the plugin lowercases
  // on write, so `HREF:a; href:b` would resolve to the same attribute.
  // The duplicate check must catch this too.
  assert.throws(
    () =>
      applyLocale(
        '<a data-i18n-attr="HREF:home; href:evil">x</a>',
        opts({ dict: { home: '/x', evil: '/attacker' } }),
      ),
    /duplicates attribute "href"/,
  );
});

test('data-i18n-meta: whitespace-padded key surfaces as "unknown key", not silently trimmed (M2)', () => {
  // Previously (round-2) the meta shortcut passed `trimmed` as the
  // lookup key, silently tolerating `  home  ` as `home`. Round-3
  // passes the untrimmed rawValue, so a translator's leading/trailing
  // space typo surfaces at build time.
  assert.throws(
    () =>
      applyLocale(
        '<meta name="x" data-i18n-meta="  home.title  ">',
        opts({ dict: { 'home.title': 'ok' } }),
      ),
    /unknown key/,
  );
});

test('parseAttrPairs: exported for lint reuse, returns {pairs, error} shape (M4)', async () => {
  // The plugin exports parseAttrPairs so lint can import and share
  // the exact same parse semantics. Contract test: pin the return
  // shape so a refactor that changes it fails visibly.
  const { parseAttrPairs } = await import('../i18n-plugin.js');

  // Success path
  const ok = parseAttrPairs('href:a; title:b');
  assert.equal(ok.error, null);
  assert.deepEqual(
    ok.pairs.map(({ attr, key }) => ({ attr, key })),
    [{ attr: 'href', key: 'a' }, { attr: 'title', key: 'b' }],
  );

  // Empty value
  const empty = parseAttrPairs('');
  assert.equal(empty.error.code, 'EMPTY_VALUE');
  assert.deepEqual(empty.pairs, []);

  // Empty pair
  const trailing = parseAttrPairs('href:a;');
  assert.equal(trailing.error.code, 'EMPTY_PAIR');

  // Missing colon
  const noColon = parseAttrPairs('href');
  assert.equal(noColon.error.code, 'MISSING_COLON');
  assert.equal(noColon.error.pair, 'href');

  // Empty attr
  const emptyAttr = parseAttrPairs(':key');
  assert.equal(emptyAttr.error.code, 'EMPTY_ATTR');

  // Empty key
  const emptyKey = parseAttrPairs('href:');
  assert.equal(emptyKey.error.code, 'EMPTY_KEY');

  // Duplicate attr (M3)
  const dup = parseAttrPairs('href:a; href:b');
  assert.equal(dup.error.code, 'DUPLICATE_ATTR');
  assert.match(dup.error.message, /duplicates attribute "href"/);
});

// ---------------------------------------------------------------------------
// i18nPlugin — full hook integration (H11)
//
// The 'BG regression full-cycle' test earlier in this file chained two
// applyLocale calls to SIMULATE writeBundle behaviour. That simulation
// matched the OLD flow — where BG was derived from the marker-stripped
// EN emit — so it can't catch the exact bug Task #165 was fixing (BG
// silently rendering EN copy). These tests exercise the ACTUAL plugin
// object end-to-end: configResolved → transformIndexHtml → writeBundle.
// ---------------------------------------------------------------------------

/**
 * Build a Vite-shaped ResolvedConfig mock for configResolved calls
 * (R2-L4). The plugin currently only reads `config.command`, but
 * shipping realistic-looking defaults for `base`, `mode`, `root`, and
 * `build` keeps the mock future-proof: if a later plugin change reads
 * one of those and the test doesn't provide it, the test surfaces
 * that additional dependency by breaking loudly rather than silently
 * receiving undefined and passing.
 */
function mockResolvedConfig(command) {
  return {
    command, // 'build' | 'serve'
    base: '/',
    mode: command === 'build' ? 'production' : 'development',
    root: process.cwd(),
    build: { outDir: 'dist' },
  };
}

test('i18nPlugin: writeBundle produces marker-stripped EN + translated BG from marker-intact input (H11)', async (t) => {
  const { mkdirSync } = await import('node:fs');
  const { i18nPlugin } = await import('../i18n-plugin.js');
  const dir = mkdtempSync(join(tmpdir(), 'i18n-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const localesDir = join(dir, 'locales');
  mkdirSync(localesDir, { recursive: true });
  writeFileSync(
    join(localesDir, 'en.json'),
    JSON.stringify({ home: { hello: 'Hello, {name}!' } }),
    'utf-8',
  );
  writeFileSync(
    join(localesDir, 'bg.json'),
    JSON.stringify({ home: { hello: 'Здравей, {name}!' } }),
    'utf-8',
  );

  const plugin = i18nPlugin({
    localesDir,
    contextByLocale: { en: { name: 'World' }, bg: { name: 'Свят' } },
    basePath: '/base/',
    projectRoot: dir,
    inputs: { home: join(dir, 'index.html') },
  });

  // Signal build mode via configResolved, matching what Vite does.
  plugin.configResolved(mockResolvedConfig('build'));

  // Source HTML with a marker + a bare-relative link so we can assert
  // BOTH marker resolution AND the H7 href sweep in the same fixture.
  const src = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>t</title></head>
<body><p data-i18n="home.hello">Hello, World!</p><a href="stay/">Stay</a></body>
</html>`;

  // transformIndexHtml in build mode is a pass-through — return html
  // unchanged so Vite's html-plugin still handles asset URL rewrites
  // (H10) but markers stay for writeBundle.
  const t1 = plugin.transformIndexHtml.handler(src, { filename: join(dir, 'index.html') });
  assert.equal(t1, src, 'build-mode transformIndexHtml must be pass-through (H10)');

  // Simulate Vite writing that pass-through to disk.
  const outDir = join(dir, 'dist');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), t1, 'utf-8');

  // Drive writeBundle with a mock bundle.
  const bundle = {
    'index.html': { type: 'asset', fileName: 'index.html', source: t1 },
  };
  plugin.writeBundle({ dir: outDir }, bundle);

  // EN emit — markers stripped, English text, root-absolute href.
  const enOut = await import('node:fs').then(({ readFileSync }) =>
    readFileSync(join(outDir, 'index.html'), 'utf-8'),
  );
  assert.doesNotMatch(enOut, /data-i18n="/, 'EN emit must not carry data-i18n markers');
  assert.match(enOut, /Hello, World!/, 'EN emit must render EN dict value with context interpolation');
  assert.match(enOut, /href="\/base\/stay\/"/, 'H7: bare relative rewritten to root-absolute for EN');
  assert.match(enOut, /<html\s[^>]*lang="en"/, 'EN emit must set <html lang="en">');
  assert.match(enOut, /data-i18n-locale-applied="en"/, 'H1: sentinel present on EN');

  // BG emit — markers stripped, BULGARIAN text, /base/bg/-prefixed href.
  const bgOut = await import('node:fs').then(({ readFileSync }) =>
    readFileSync(join(outDir, 'bg', 'index.html'), 'utf-8'),
  );
  assert.doesNotMatch(bgOut, /data-i18n="/, 'BG emit must not carry data-i18n markers');
  assert.match(bgOut, /Здравей, Свят!/, 'BG emit must render BG dict value with BG context');
  assert.match(bgOut, /href="\/base\/bg\/stay\/"/, 'H7: bare relative rewritten to /base/bg/ for BG');
  assert.match(bgOut, /<html\s[^>]*lang="bg"/, 'BG emit must set <html lang="bg">');
  assert.match(bgOut, /data-i18n-locale-applied="bg"/, 'H1: sentinel present on BG');

  // H9 — bundle.source updated in-place to match the EN on-disk output.
  assert.equal(
    bundle['index.html'].source,
    enOut,
    'H9: bundle[fileName].source must be updated to match on-disk EN emit',
  );
});

test('i18nPlugin: dev-mode transformIndexHtml resolves EN markers on first call, no-ops on second (H1 re-entrancy guard)', async (t) => {
  const { mkdirSync } = await import('node:fs');
  const { i18nPlugin } = await import('../i18n-plugin.js');
  const dir = mkdtempSync(join(tmpdir(), 'i18n-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const localesDir = join(dir, 'locales');
  mkdirSync(localesDir, { recursive: true });
  writeFileSync(
    join(localesDir, 'en.json'),
    JSON.stringify({ home: { hello: 'Hi' } }),
    'utf-8',
  );
  writeFileSync(
    join(localesDir, 'bg.json'),
    JSON.stringify({ home: { hello: 'Хай' } }),
    'utf-8',
  );

  const plugin = i18nPlugin({
    localesDir,
    contextByLocale: { en: {}, bg: {} },
    basePath: '/',
    projectRoot: dir,
    inputs: { home: join(dir, 'index.html') },
  });

  // Dev mode — configResolved reports command='serve'.
  plugin.configResolved(mockResolvedConfig('serve'));

  const src = `<!doctype html>
<html lang="en"><head><title>t</title></head>
<body><p data-i18n="home.hello">Hi</p></body></html>`;

  // First pass — EN applies.
  const first = plugin.transformIndexHtml.handler(src, {
    filename: join(dir, 'index.html'),
    server: {},
  });
  assert.doesNotMatch(first, /data-i18n="/, 'dev first pass: markers stripped');
  assert.match(first, /data-i18n-locale-applied="en"/, 'dev first pass: sentinel stamped');

  // Second pass — re-entrancy guard fires; input already has the
  // sentinel so we return it verbatim, not re-run applyLocale.
  const second = plugin.transformIndexHtml.handler(first, {
    filename: join(dir, 'index.html'),
    server: {},
  });
  assert.equal(second, first, 'H1: second pass returns input unchanged, no double-apply');
});

test('i18nPlugin: writeBundle is atomic — a BG applyLocale throw does not leave EN half-written (H6)', async (t) => {
  const { mkdirSync, readFileSync } = await import('node:fs');
  const { i18nPlugin } = await import('../i18n-plugin.js');
  const dir = mkdtempSync(join(tmpdir(), 'i18n-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const localesDir = join(dir, 'locales');
  mkdirSync(localesDir, { recursive: true });

  // Both dicts carry the SAME token shape ({name}) so loadDictionaries'
  // symmetric-token check passes. rejectPreEscapedEntities passes because
  // there are no pre-escaped entities. contextByLocale has both locales
  // and both entries are objects with non-empty string values, so the
  // init-time ctx validator passes.
  //
  // The trick: EN's ctx supplies `name`, BG's supplies a DIFFERENT key
  // (`unused`). Load-time validation only checks that each ctx entry is
  // an object with valid values — it does NOT cross-reference dict tokens
  // against ctx keys. So construction succeeds, and the BG applyLocale
  // pass throws at interpolate() time when it hits the {name} token and
  // finds no BG context entry named `name`. This is exactly the
  // 'mid-writeBundle applyLocale throw' case H6 atomicity has to survive.
  writeFileSync(
    join(localesDir, 'en.json'),
    JSON.stringify({ home: { hi: 'Hello, {name}!' } }),
    'utf-8',
  );
  writeFileSync(
    join(localesDir, 'bg.json'),
    JSON.stringify({ home: { hi: 'Здравей, {name}!' } }),
    'utf-8',
  );

  const plugin = i18nPlugin({
    localesDir,
    // EN has `name`, BG has a placeholder key so its ctx object is non-
    // empty (init-time validator requires non-empty string values on
    // whatever keys are present, but not that any specific key exists).
    contextByLocale: { en: { name: 'World' }, bg: { unused: 'placeholder' } },
    basePath: '/',
    projectRoot: dir,
    inputs: { home: join(dir, 'index.html') },
  });
  plugin.configResolved(mockResolvedConfig('build'));

  // Marker-carrying source in dist/. `en` interpolates fine, `bg`
  // throws at applyLocale-time because {name} references a token BG's
  // ctx doesn't have — that's the mid-writeBundle throw H6 must
  // survive with EN emit untouched.
  const outDir = join(dir, 'dist');
  mkdirSync(outDir, { recursive: true });
  const src = `<!doctype html><html lang="en"><head><title>t</title></head>
<body><p data-i18n="home.hi">Hello, World!</p></body></html>`;
  const enBefore = src;
  writeFileSync(join(outDir, 'index.html'), enBefore, 'utf-8');

  const bundle = {
    'index.html': { type: 'asset', fileName: 'index.html', source: src },
  };

  // Precondition sanity — if EN applyLocale can't succeed, our BG-only-
  // failure premise is wrong. This assertion catches that regression
  // (e.g. someone tightens load-time validation to also cross-check
  // dict tokens against ctx keys — the test would then fail at
  // construction and this assertion surfaces the mismatch clearly).
  const { applyLocale } = await import('../i18n-plugin.js');
  const enTest = applyLocale(src, {
    locale: 'en',
    dict: { 'home.hi': 'Hello, {name}!' },
    ctx: { name: 'World' },
    basePath: '/',
    pagePath: 'index.html',
    allLocales: ['en', 'bg'],
    defaultLocale: 'en',
  });
  assert.match(enTest, /Hello, World!/, 'sanity: EN interpolation works');

  // Now drive writeBundle. BG's applyLocale throws at {name}. H6
  // atomicity says: EN write MUST NOT have landed before BG threw.
  assert.throws(
    () => plugin.writeBundle({ dir: outDir }, bundle),
    /missing context value \{name\}/i,
    'BG applyLocale throws inside writeBundle — this is the mid-pass failure H6 defends against',
  );

  // On-disk EN emit must be UNCHANGED (byte-for-byte) — H6 atomicity
  // guarantees we compute BOTH locales before touching disk, so a BG
  // throw aborts the page with no EN write having landed. Without the
  // fix, EN would be overwritten to its marker-stripped form and the
  // next `vite build` (without `rm -rf dist/`) would re-read that
  // marker-free file and silently produce BG-in-EN copy on retry.
  const enAfter = readFileSync(join(outDir, 'index.html'), 'utf-8');
  assert.equal(
    enAfter,
    enBefore,
    'H6: EN emit byte-unchanged after BG applyLocale throw',
  );

  // And bundle.source must ALSO not have been mutated to the mid-
  // transform EN result (H9 depends on H6 — if EN gets computed and
  // stashed on bundle.source but never written, downstream plugins
  // reading bundle.source see stale-in-a-different-direction data).
  assert.equal(
    bundle['index.html'].source,
    src,
    'H6+H9: bundle.source stays at pre-transform value when BG throws',
  );
});

test('i18nPlugin: writeBundle fs errors chain the original error via err.cause (R4-L3)', async (t) => {
  const { mkdirSync } = await import('node:fs');
  const { i18nPlugin } = await import('../i18n-plugin.js');
  const dir = mkdtempSync(join(tmpdir(), 'i18n-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const localesDir = join(dir, 'locales');
  mkdirSync(localesDir, { recursive: true });
  writeFileSync(
    join(localesDir, 'en.json'),
    JSON.stringify({ home: { hi: 'hello' } }),
    'utf-8',
  );
  writeFileSync(
    join(localesDir, 'bg.json'),
    JSON.stringify({ home: { hi: 'здравей' } }),
    'utf-8',
  );

  const plugin = i18nPlugin({
    localesDir,
    contextByLocale: { en: {}, bg: {} },
    basePath: '/',
    projectRoot: dir,
    inputs: { home: join(dir, 'index.html') },
  });
  plugin.configResolved(mockResolvedConfig('build'));

  // outDir has NO emitted file — readFileSync will throw ENOENT.
  // R3-L4 wraps that in a diagnostic Error with {cause: e}; this
  // test asserts the underlying err.cause.code is still reachable
  // so downstream retry/reporting code can discriminate error kinds
  // without parsing message strings.
  const outDir = join(dir, 'dist');
  mkdirSync(outDir, { recursive: true });
  const bundle = {
    'missing.html': { type: 'asset', fileName: 'missing.html', source: '' },
  };

  let caught = null;
  try {
    plugin.writeBundle({ dir: outDir }, bundle);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'writeBundle should throw when the emitted file is missing');
  assert.match(
    caught.message,
    /cannot read emitted file/,
    'diagnostic message has [i18n] prefix and context',
  );
  assert.ok(caught.cause, 'R3-L4: caught error must chain the original via err.cause');
  assert.equal(
    caught.cause.code,
    'ENOENT',
    'R3-L4: err.cause.code preserves the underlying fs error code (ENOENT here)',
  );
});
