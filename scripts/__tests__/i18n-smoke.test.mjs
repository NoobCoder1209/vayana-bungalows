// End-to-end i18n smoke test (Task #168).
//
// Builds the site (or reuses an existing dist/ if fresh) and walks the
// emitted tree — 12 EN pages under dist/ + 12 BG mirrors under dist/bg/.
// Asserts the invariants the plugin promises across the WHOLE emitted
// set, not just a single fixture:
//
//   1. Every EN page has a matching BG mirror at the same relative path.
//   2. Every emitted page carries a boot-redirect script with the correct
//      data-locale + data-lang-urls JSON attributes.
//   3. Every emitted page has hreflang alternates for EN + BG + x-default.
//   4. <html lang> matches the emit locale on every page.
//   5. The pill's data-lang-pill-expected="1" marker appears on the home
//      page (which has the pill) and is absent on all sub-pages (which
//      don't).
//   6. No page emits marker leakage — no data-i18n / data-i18n-attr /
//      data-i18n-meta / data-i18n-html attributes survive to production.
//   7. No page emits an EN string on the BG mirror (spot-check via
//      the /[Ѐ-ӿ]/ Cyrillic-range regex — any Cyrillic anywhere is
//      enough to prove the dict swap ran end-to-end).
//   8. The canonical / og:url / twitter:url URLs point at the emit
//      locale's own URL (exact-match .endsWith, no .includes fallback).
//
// This is the "big net" — the plugin's own tests exercise the
// applyLocale + applyHead + writeBundle mechanisms; this test proves
// the full pipeline produces something coherent when run over the
// real content set.
//
// Rebuild policy: the test rebuilds dist/ when ANY source HTML page,
// locale JSON, plugin script, or vite config is newer than
// dist/index.html. Set env SKIP_SMOKE_BUILD=1 to force-skip the rebuild
// (useful for a running `vite build --watch` in another terminal).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { parse } from 'node-html-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DIST_DIR = join(REPO_ROOT, 'dist');

// Compute the expected locale-prefixed URL for a page at `relPath`
// inside dist/. Used by BOTH the boot-script assertion AND the
// canonical/og:url/twitter:url assertion — extracting the derivation
// keeps them in lockstep if the URL scheme ever changes (e.g., a
// custom domain drops the /vayana-bungalows/ base).
function expectedUrlForRelPath(relPath) {
  if (relPath === 'index.html') return '/vayana-bungalows/';
  if (relPath === 'bg/index.html') return '/vayana-bungalows/bg/';
  return `/vayana-bungalows/${relPath.replace(/\/?index\.html$/, '/')}`;
}

// Walk the tree of all source HTML pages for staleness comparison. We
// include EVERY *.html file outside dist/ + node_modules/ + .git/ so
// editing any sub-page (`stay/index.html`, `enquiries/thanks/index.html`,
// etc.) correctly triggers a rebuild. The prior version only watched
// the top-level index.html and missed 11 pages.
function findSourceHtmlFiles() {
  const out = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['dist', 'node_modules', '.git', 'worker'].includes(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (entry.name.endsWith('.html')) out.push(join(dir, entry.name));
    }
  }
  walk(REPO_ROOT);
  return out;
}

// Rebuild if dist is missing OR older than any source input. The watch
// list now includes all source HTML pages + the plugin + all locale
// dictionaries + vite.config.js.
function distIsStale() {
  if (!existsSync(join(DIST_DIR, 'index.html'))) return true;
  const distMtime = statSync(join(DIST_DIR, 'index.html')).mtimeMs;
  const alwaysWatch = [
    join(REPO_ROOT, 'scripts', 'i18n-plugin.js'),
    join(REPO_ROOT, 'vite.config.js'),
    // Every locale JSON — a new locale add would appear here via
    // readdirSync below anyway, but pinning the two known ones
    // documents them as required inputs.
    join(REPO_ROOT, 'locales', 'en.json'),
    join(REPO_ROOT, 'locales', 'bg.json'),
  ];
  const watch = [...alwaysWatch, ...findSourceHtmlFiles()];
  for (const p of watch) {
    if (existsSync(p) && statSync(p).mtimeMs > distMtime) return true;
  }
  return false;
}

// One-time build fixture — runs before all tests below.
//
// SKIP_SMOKE_BUILD=1 in the environment forces us to skip rebuild even
// when dist/ is stale. Use when `vite build --watch` is already running
// in another terminal (concurrent rebuilds fight each other) or when
// running the smoke against a specific pre-built dist/ artifact.
//
// stdio: 'inherit' on rebuild so a build error surfaces the actual Vite
// diagnostic instead of just "Command failed: npm run build".
if (!process.env.SKIP_SMOKE_BUILD && distIsStale()) {
  console.log('[smoke] dist/ is stale — rebuilding...');
  try {
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' });
  } catch (err) {
    // execSync already printed the error via inherited stderr. Re-throw
    // with a clearer message so the failing test surfaces "rebuild
    // failed" rather than a raw "Command failed" spawn error.
    throw new Error(
      `[smoke] npm run build failed during test setup — see stderr above. ${err.message}`,
      { cause: err },
    );
  }
}

// Walk dist/ for all *.html files and return them as { relativePath, doc }.
// `relativePath` is relative to dist/ so we can compare EN vs BG paths.
function collectPages(root) {
  const out = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip Vite's asset chunks — they never contain our HTML pages
        // and reading them would slow the test for no coverage gain.
        if (entry.name === 'assets') continue;
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.html')) {
        const relPath = relative(root, full);
        const html = readFileSync(full, 'utf8');
        out.push({ relPath, html, doc: parse(html, { comment: true }) });
      }
    }
  }
  walk(root);
  return out;
}

const pages = collectPages(DIST_DIR);
const enPages = pages.filter((p) => !p.relPath.startsWith('bg/'));
const bgPages = pages.filter((p) => p.relPath.startsWith('bg/'));

test('smoke: emitted at least 12 EN pages', () => {
  assert.ok(enPages.length >= 12, `expected ≥12 EN pages, got ${enPages.length}`);
});

test('smoke: every EN page has a matching BG mirror at the same relative subpath', () => {
  const bgRels = new Set(bgPages.map((p) => p.relPath.replace(/^bg\//, '')));
  for (const enPage of enPages) {
    assert.ok(
      bgRels.has(enPage.relPath),
      `EN page ${enPage.relPath} has no BG mirror at bg/${enPage.relPath}`,
    );
  }
});

test('smoke: every page emits <html lang> matching its emit locale', () => {
  for (const { relPath, doc } of pages) {
    const html = doc.querySelector('html');
    assert.ok(html, `${relPath}: no <html> element`);
    const expected = relPath.startsWith('bg/') ? 'bg' : 'en';
    assert.equal(
      html.getAttribute('lang'),
      expected,
      `${relPath}: <html lang> should be "${expected}"`,
    );
  }
});

test('smoke: every page carries a boot-redirect <script data-locale> with data-lang-urls JSON', () => {
  for (const { relPath, doc } of pages) {
    const script = doc.querySelector('script[data-locale]');
    assert.ok(script, `${relPath}: missing boot-redirect script`);
    const expectedLocale = relPath.startsWith('bg/') ? 'bg' : 'en';
    assert.equal(
      script.getAttribute('data-locale'),
      expectedLocale,
      `${relPath}: boot script data-locale should be "${expectedLocale}"`,
    );
    const urlsRaw = script.getAttribute('data-lang-urls');
    assert.ok(urlsRaw, `${relPath}: boot script missing data-lang-urls`);
    // node-html-parser decodes HTML entities in attribute values by default.
    const langUrls = JSON.parse(urlsRaw);
    assert.ok(langUrls.en, `${relPath}: data-lang-urls.en missing`);
    assert.ok(langUrls.bg, `${relPath}: data-lang-urls.bg missing`);
    // The URL for THIS locale must match this page's URL — the
    // boot-redirect uses this to decide whether to redirect.
    assert.equal(
      langUrls[expectedLocale],
      expectedUrlForRelPath(relPath),
      `${relPath}: data-lang-urls.${expectedLocale} should point at this page's own URL`,
    );
  }
});

test('smoke: every page has hreflang alternates for en + bg + x-default', () => {
  for (const { relPath, doc } of pages) {
    const alternates = doc.querySelectorAll('link[rel="alternate"]');
    const langs = alternates.map((a) => a.getAttribute('hreflang'));
    assert.ok(langs.includes('en'), `${relPath}: missing hreflang="en"`);
    assert.ok(langs.includes('bg'), `${relPath}: missing hreflang="bg"`);
    assert.ok(langs.includes('x-default'), `${relPath}: missing hreflang="x-default"`);
  }
});

test('smoke: home page has data-lang-pill-expected="1" (source contains the pill)', () => {
  const en = enPages.find((p) => p.relPath === 'index.html');
  const bg = bgPages.find((p) => p.relPath === 'bg/index.html');
  assert.ok(en, 'EN home page (dist/index.html) must exist');
  assert.ok(bg, 'BG home page (dist/bg/index.html) must exist');
  assert.equal(
    en.doc.querySelector('html').getAttribute('data-lang-pill-expected'),
    '1',
    'EN home page must carry the pill-expected marker',
  );
  assert.equal(
    bg.doc.querySelector('html').getAttribute('data-lang-pill-expected'),
    '1',
    'BG home mirror must carry the pill-expected marker',
  );
});

test('smoke: sub-pages do NOT carry data-lang-pill-expected (source has no pill)', () => {
  // Every page except the home. If a future edit adds the pill to a
  // sub-page, this assertion will fire — that's a signal to lang.js
  // that the pill is expected there too. Not an error, but should be
  // an intentional decision.
  //
  // Strict test: the attribute must be ENTIRELY absent (not just
  // empty-string). An empty-value emit (regression where the plugin
  // stamps `data-lang-pill-expected=""` on a sub-page) is a distinct
  // failure mode we want to catch, so we assert `undefined` explicitly
  // rather than `!marker` (which would let an empty string through).
  for (const { relPath, doc } of pages) {
    if (relPath === 'index.html' || relPath === 'bg/index.html') continue;
    const marker = doc.querySelector('html').getAttribute('data-lang-pill-expected');
    assert.equal(
      marker,
      undefined,
      `${relPath}: unexpected data-lang-pill-expected on sub-page (got "${marker}")`,
    );
  }
});

test('smoke: NO emitted page carries any i18n marker (structural DOM walk, not regex)', () => {
  // Use the parsed DOM to query each forbidden attribute — regex on
  // the raw source is vulnerable to false-negatives (marker split
  // across lines by a minifier) and false-positives (a JS string
  // literal `"data-i18n="` inside a <script> block).
  const forbidden = [
    'data-i18n',
    'data-i18n-attr',
    'data-i18n-meta',
    'data-i18n-html',
  ];
  for (const { relPath, doc } of pages) {
    for (const attr of forbidden) {
      // Wrap the selector in [...] to force attribute-presence match.
      // The bracket syntax matches the attribute as an exact name, so
      // querying [data-i18n] only matches that specific attr — a
      // separate query for [data-i18n-attr] is needed for the longer
      // name (which is why we iterate the forbidden list).
      const leaked = doc.querySelectorAll(`[${attr}]`);
      assert.equal(
        leaked.length,
        0,
        `${relPath}: forbidden marker "${attr}" survived to emitted HTML on ${leaked.length} element(s)`,
      );
    }
  }
});

test('smoke: BG home page contains Cyrillic characters (translation ran end-to-end)', () => {
  const bg = bgPages.find((p) => p.relPath === 'bg/index.html');
  assert.ok(bg, 'BG home page must exist');
  // Any character in the Cyrillic Unicode block (U+0400-U+04FF) is
  // enough to prove the BG dict was applied. This is deliberately
  // loose — pinning specific strings would couple the test to copy
  // that translators may legitimately edit. The i18n-plugin's own
  // unit tests (scripts/__tests__/i18n-plugin.test.mjs) verify
  // per-string translation lookups; this smoke test only proves the
  // pipeline ran.
  assert.match(bg.html, /[Ѐ-ӿ]/, 'BG home must contain Cyrillic characters');
});

test('smoke: EN <head> contains NO Cyrillic (BG dict must not leak into EN emit)', () => {
  const en = enPages.find((p) => p.relPath === 'index.html');
  assert.ok(en, 'EN home page must exist');
  // Use the parsed DOM's <head>.innerHTML rather than a regex-match
  // on the raw string — a JSON-LD block or comment containing the
  // literal `</head>` would truncate the regex-based extract and hide
  // a leak in the tail.
  const head = en.doc.querySelector('head');
  assert.ok(head, 'EN home page must have a <head> element');
  assert.doesNotMatch(
    head.innerHTML,
    /[Ѐ-ӿ]/,
    'EN <head> must not contain Cyrillic — BG dict must not leak into EN emit',
  );
});

test('smoke: canonical / og:url / twitter:url point at THIS page\'s own emit URL (exact suffix match)', () => {
  for (const { relPath, doc } of pages) {
    const canonical = doc.querySelector('link[rel="canonical"]');
    const ogUrl = doc.querySelector('meta[property="og:url"]');
    const twitterUrl = doc.querySelector('meta[name="twitter:url"]');
    const expectedPath = expectedUrlForRelPath(relPath);
    // .endsWith() ONLY — the previous .includes() fallback was too
    // loose: for relPath='index.html' with expectedPath='/vayana-bungalows/',
    // ANY URL containing that substring (including the BG mirror's
    // '/vayana-bungalows/bg/') passed as valid. .endsWith() forces
    // the URL to terminate at the expected path.
    if (canonical) {
      const href = canonical.getAttribute('href') || '';
      assert.ok(
        href.endsWith(expectedPath),
        `${relPath}: canonical "${href}" should end with "${expectedPath}"`,
      );
    }
    if (ogUrl) {
      const content = ogUrl.getAttribute('content') || '';
      assert.ok(
        content.endsWith(expectedPath),
        `${relPath}: og:url "${content}" should end with "${expectedPath}"`,
      );
    }
    if (twitterUrl) {
      const content = twitterUrl.getAttribute('content') || '';
      assert.ok(
        content.endsWith(expectedPath),
        `${relPath}: twitter:url "${content}" should end with "${expectedPath}"`,
      );
    }
  }
});

test('smoke: BG home page has active-BG pill segment + inactive-EN pill segment', () => {
  const bg = bgPages.find((p) => p.relPath === 'bg/index.html');
  assert.ok(bg, 'BG home page must exist');
  const activeSeg = bg.doc.querySelector('.site-header__lang-seg.is-active');
  assert.ok(activeSeg, 'BG home must have an active pill segment');
  assert.equal(activeSeg.getAttribute('data-lang'), 'bg', 'active segment on BG page must be data-lang="bg"');
  assert.equal(activeSeg.getAttribute('aria-current'), 'true', 'active segment must have aria-current="true"');

  const inactiveSeg = bg.doc.querySelector('.site-header__lang-seg:not(.is-active)');
  assert.ok(inactiveSeg, 'BG home must have an inactive pill segment');
  assert.equal(inactiveSeg.getAttribute('data-lang'), 'en');
  // node-html-parser returns undefined for a missing attribute — check
  // for falsy rather than exact null to stay parser-agnostic.
  assert.ok(
    !inactiveSeg.getAttribute('aria-current'),
    'inactive segment must NOT have aria-current',
  );
});

test('smoke: pill hrefs point to the correct mirror on BOTH EN and BG emits (symmetric)', () => {
  const enHome = enPages.find((p) => p.relPath === 'index.html');
  const bgHome = bgPages.find((p) => p.relPath === 'bg/index.html');
  assert.ok(enHome, 'EN home page must exist');
  assert.ok(bgHome, 'BG home page must exist');

  // EN home: BG segment points at /bg/, EN segment points at root.
  const bgSegOnEnHome = enHome.doc.querySelector('.site-header__lang-seg[data-lang="bg"]');
  const enSegOnEnHome = enHome.doc.querySelector('.site-header__lang-seg[data-lang="en"]');
  assert.ok(bgSegOnEnHome, 'EN home must have BG pill segment');
  assert.ok(enSegOnEnHome, 'EN home must have EN pill segment');
  assert.equal(
    bgSegOnEnHome.getAttribute('href'),
    '/vayana-bungalows/bg/',
    'EN home BG-pill href must be the /bg/ mirror URL',
  );
  assert.equal(
    enSegOnEnHome.getAttribute('href'),
    '/vayana-bungalows/',
    'EN home EN-pill href must be the EN root URL (self-link on active)',
  );

  // BG home: EN segment points at root, BG segment points at /bg/.
  const enSegOnBgHome = bgHome.doc.querySelector('.site-header__lang-seg[data-lang="en"]');
  const bgSegOnBgHome = bgHome.doc.querySelector('.site-header__lang-seg[data-lang="bg"]');
  assert.ok(enSegOnBgHome, 'BG home must have EN pill segment');
  assert.ok(bgSegOnBgHome, 'BG home must have BG pill segment');
  assert.equal(
    enSegOnBgHome.getAttribute('href'),
    '/vayana-bungalows/',
    'BG home EN-pill href must be the EN root URL (round-trip target)',
  );
  assert.equal(
    bgSegOnBgHome.getAttribute('href'),
    '/vayana-bungalows/bg/',
    'BG home BG-pill href must be the /bg/ URL (self-link on active)',
  );
});
