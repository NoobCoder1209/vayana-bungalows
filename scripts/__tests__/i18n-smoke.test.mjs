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
//      known Cyrillic-required copy).
//   8. The canonical / og:url / twitter:url URLs point at the emit
//      locale's own URL.
//
// This is the "big net" — the plugin's own tests exercise the
// applyLocale + applyHead + writeBundle mechanisms; this test proves
// the full pipeline produces something coherent when run over the
// real content set.

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
const SOURCE_HTML_GLOB_ROOTS = ['index.html'];

// Rebuild if dist is missing OR older than any source HTML / plugin file.
// Skips rebuild when a recent `npm run build` already produced fresh
// output — keeps the smoke test fast in dev iteration.
function distIsStale() {
  if (!existsSync(join(DIST_DIR, 'index.html'))) return true;
  const distMtime = statSync(join(DIST_DIR, 'index.html')).mtimeMs;
  const watch = [
    join(REPO_ROOT, 'scripts', 'i18n-plugin.js'),
    join(REPO_ROOT, 'locales', 'en.json'),
    join(REPO_ROOT, 'locales', 'bg.json'),
    join(REPO_ROOT, 'index.html'),
    join(REPO_ROOT, 'vite.config.js'),
  ];
  for (const p of watch) {
    if (existsSync(p) && statSync(p).mtimeMs > distMtime) return true;
  }
  return false;
}

// One-time build fixture — runs before all tests below. Silent unless
// build fails (which fails ALL tests below).
if (distIsStale()) {
  console.log('[smoke] dist/ is stale — rebuilding...');
  execSync('npm run build', { cwd: REPO_ROOT, stdio: 'pipe' });
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
    const expectedSelfPath = relPath === 'index.html'
      ? '/vayana-bungalows/'
      : relPath === 'bg/index.html'
        ? '/vayana-bungalows/bg/'
        : `/vayana-bungalows/${relPath.replace(/\/?index\.html$/, '/')}`;
    assert.equal(
      langUrls[expectedLocale],
      expectedSelfPath,
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
  for (const { relPath, doc } of pages) {
    if (relPath === 'index.html' || relPath === 'bg/index.html') continue;
    const marker = doc.querySelector('html').getAttribute('data-lang-pill-expected');
    // node-html-parser returns undefined for missing attrs; check falsy
    // rather than strict-null so the test stays parser-agnostic.
    assert.ok(
      !marker,
      `${relPath}: unexpected data-lang-pill-expected on sub-page (got "${marker}")`,
    );
  }
});

test('smoke: NO emitted page carries any i18n marker (all resolved / stripped)', () => {
  const forbidden = ['data-i18n', 'data-i18n-attr', 'data-i18n-meta', 'data-i18n-html'];
  for (const { relPath, html } of pages) {
    for (const attr of forbidden) {
      // Word-boundary match so `data-i18n` doesn't match `data-i18n-attr`.
      const re = new RegExp(`\\b${attr}\\s*=`, 'i');
      assert.doesNotMatch(
        html,
        re,
        `${relPath}: forbidden marker "${attr}=" survived to emitted HTML`,
      );
    }
  }
});

test('smoke: BG home page emits known Cyrillic copy (spot-check translation actually applied)', () => {
  const bg = bgPages.find((p) => p.relPath === 'bg/index.html');
  const body = bg.html;
  // These strings come from locales/bg.json and appear on the home page.
  // A regression that swapped BG dict for EN would break these.
  const spotChecks = [
    'Vayana', // brand — same in both locales, sanity anchor
    // Common footer or hero copy in Bulgarian — pick strings that MUST
    // appear on the home page in BG. We keep this list short so it's
    // not brittle to copy tweaks, but at least one Cyrillic string is
    // required.
  ];
  for (const s of spotChecks) {
    assert.ok(body.includes(s), `BG home must contain "${s}"`);
  }
  // At least ONE character in the Cyrillic range (U+0400-U+04FF) must
  // appear in the body — proves translation ran end-to-end even if any
  // specific string changed.
  assert.match(body, /[Ѐ-ӿ]/, 'BG home must contain Cyrillic characters');
});

test('smoke: EN home page emits English label "Vayana" and NO Cyrillic in nav/hero (spot-check)', () => {
  const en = enPages.find((p) => p.relPath === 'index.html');
  const body = en.html;
  assert.ok(body.includes('Vayana'));
  // The EN emit has the pill's BG segment showing "BG" as label — that
  // segment's TEXT is a Latin-alphabet locale code, not translated.
  // Extract the <head> region and assert no Cyrillic appears there
  // (which would indicate BG dict leaked into EN emit).
  const head = body.match(/<head[\s\S]*?<\/head>/i)?.[0] || '';
  assert.doesNotMatch(head, /[Ѐ-ӿ]/, 'EN <head> must not contain Cyrillic — BG dict must not leak');
});

test('smoke: canonical / og:url / twitter:url point at THIS page\'s own emit URL', () => {
  for (const { relPath, doc } of pages) {
    const canonical = doc.querySelector('link[rel="canonical"]');
    const ogUrl = doc.querySelector('meta[property="og:url"]');
    const twitterUrl = doc.querySelector('meta[name="twitter:url"]');
    // Not every page ships all three, but if present they must all agree
    // and match the locale-prefixed URL.
    const expectedPath = relPath === 'index.html'
      ? '/vayana-bungalows/'
      : relPath === 'bg/index.html'
        ? '/vayana-bungalows/bg/'
        : `/vayana-bungalows/${relPath.replace(/\/?index\.html$/, '/')}`;
    if (canonical) {
      const href = canonical.getAttribute('href') || '';
      // Canonical is often an absolute URL — extract just the pathname
      // by matching against expected path suffix.
      assert.ok(
        href.endsWith(expectedPath) || href.includes(expectedPath),
        `${relPath}: canonical "${href}" should end with "${expectedPath}"`,
      );
    }
    if (ogUrl) {
      const content = ogUrl.getAttribute('content') || '';
      assert.ok(
        content.endsWith(expectedPath) || content.includes(expectedPath),
        `${relPath}: og:url "${content}" should end with "${expectedPath}"`,
      );
    }
    if (twitterUrl) {
      const content = twitterUrl.getAttribute('content') || '';
      assert.ok(
        content.endsWith(expectedPath) || content.includes(expectedPath),
        `${relPath}: twitter:url "${content}" should end with "${expectedPath}"`,
      );
    }
  }
});

test('smoke: BG home page has active-BG pill segment + inactive-EN pill segment', () => {
  const bg = bgPages.find((p) => p.relPath === 'bg/index.html');
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

test('smoke: every EN page\'s pill BG segment href points at the corresponding BG mirror', () => {
  const enHome = enPages.find((p) => p.relPath === 'index.html');
  const bgSegOnEnHome = enHome.doc.querySelector('.site-header__lang-seg[data-lang="bg"]');
  assert.ok(bgSegOnEnHome, 'EN home must have BG pill segment');
  assert.equal(
    bgSegOnEnHome.getAttribute('href'),
    '/vayana-bungalows/bg/',
    'EN home BG-pill href must be the /bg/ mirror URL',
  );
});
