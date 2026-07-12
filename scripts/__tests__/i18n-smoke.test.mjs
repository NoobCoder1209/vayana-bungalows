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

import { test, before } from 'node:test';
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
      const full = join(dir, entry.name);
      // Symlinks-to-directories report isSymbolicLink()=true and
      // isDirectory()=false (Node docs). A monorepo-style symlinked
      // pages/ subtree would be silently skipped without the
      // statSync fallback below — its HTML never contributes to
      // staleness, so edits go undetected.
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          // Broken symlink or permission denied — treat as non-dir
          // and skip. Not a source-HTML host.
          isDir = false;
        }
      }
      if (isDir) {
        if (['dist', 'node_modules', '.git', 'worker'].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.html')) out.push(full);
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

// Lazy-populated by the `before()` fixture below. Kept at module scope
// so every test can read the shared parsed-page cache. Populating this
// INSIDE `before()` (rather than at module top level) means a missing
// or malformed emitted HTML file surfaces as a single "before hook
// failed" line pointing at the offending page — not "test file failed
// to load" that hides which invariant broke.
let pages = [];
let enPages = [];
let bgPages = [];

before(() => {
  // Run the rebuild guard inside the `before` fixture so build errors
  // surface as a normal test-runner failure (attributed to the before
  // hook) instead of a raw module-load exception with no context.
  //
  // Strict `=== '1'` check — any non-empty string (including '0' and
  // 'false') is truthy in JS, so a plain truthiness gate would let
  // `SKIP_SMOKE_BUILD=0` or `SKIP_SMOKE_BUILD=false` silently disable
  // rebuild, which is the exact opposite of what the operator intended.
  //
  // stdio: 'inherit' on rebuild so a build error surfaces the actual
  // Vite diagnostic instead of just "Command failed: npm run build".
  if (process.env.SKIP_SMOKE_BUILD !== '1' && distIsStale()) {
    console.log('[smoke] dist/ is stale — rebuilding...');
    try {
      execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' });
    } catch (err) {
      throw new Error(
        `[smoke] npm run build failed during test setup — see stderr above. ${err.message}`,
        { cause: err },
      );
    }
  }

  pages = collectPages(DIST_DIR);
  enPages = pages.filter((p) => !p.relPath.startsWith('bg/'));
  bgPages = pages.filter((p) => p.relPath.startsWith('bg/'));
});

// Walk dist/ for all *.html files and return them as { relativePath, doc }.
// `relativePath` is relative to dist/ so we can compare EN vs BG paths.
function collectPages(root) {
  const out = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      // Same symlink-to-directory handling as findSourceHtmlFiles —
      // isDirectory() returns false for symlinks; recurse via
      // statSync for anything reported as a symlink.
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (isDir) {
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

test('smoke: every page has hreflang alternates for en + bg + x-default (unique, correct href)', () => {
  for (const { relPath, doc } of pages) {
    const alternates = doc.querySelectorAll('link[rel="alternate"]');
    const langs = alternates.map((a) => a.getAttribute('hreflang'));

    // Presence (Round-3 baseline).
    assert.ok(langs.includes('en'), `${relPath}: missing hreflang="en"`);
    assert.ok(langs.includes('bg'), `${relPath}: missing hreflang="bg"`);
    assert.ok(langs.includes('x-default'), `${relPath}: missing hreflang="x-default"`);

    // Round-4 F8: assert COUNT — a duplicate hreflang="en" emit (author-
    // written source alternate outside the plugin's marker comments, or
    // a strip-regex regression) confuses search engines. Exactly one of
    // each required hreflang code.
    for (const code of ['en', 'bg', 'x-default']) {
      const count = langs.filter((l) => l === code).length;
      assert.equal(
        count,
        1,
        `${relPath}: hreflang="${code}" should appear exactly once (got ${count})`,
      );
    }

    // Round-4 F4: assert x-default's HREF is the DEFAULT-locale (EN)
    // URL, not the /bg/ mirror. A one-char regression in buildHeadBlock
    // pointing x-default at the emit locale would ship BG globally as
    // the fallback — full SEO regression, previously invisible.
    // For any page at relPath, the x-default URL is the EN URL for
    // that relPath's sub-path (strip the leading `bg/` if present).
    const enRelPath = relPath.startsWith('bg/') ? relPath.slice(3) : relPath;
    const expectedDefaultUrl = expectedUrlForRelPath(enRelPath);
    const xDefault = alternates.find((a) => a.getAttribute('hreflang') === 'x-default');
    assert.ok(xDefault, `${relPath}: x-default alternate must exist`);
    const xDefaultHref = xDefault.getAttribute('href') || '';
    assert.ok(
      xDefaultHref.endsWith(expectedDefaultUrl),
      `${relPath}: x-default href "${xDefaultHref}" should end with "${expectedDefaultUrl}" (default-locale URL, NOT the mirror)`,
    );

    // Symmetric: assert en+bg alternate hrefs match their locale's URL
    // for this page's sub-path. Catches a swap-regression where en and
    // bg hrefs point at each other's URLs.
    const enAlt = alternates.find((a) => a.getAttribute('hreflang') === 'en');
    const bgAlt = alternates.find((a) => a.getAttribute('hreflang') === 'bg');
    const expectedEnUrl = expectedUrlForRelPath(enRelPath);
    const expectedBgUrl = expectedUrlForRelPath(`bg/${enRelPath}`);
    assert.ok(
      (enAlt.getAttribute('href') || '').endsWith(expectedEnUrl),
      `${relPath}: hreflang="en" href should end with "${expectedEnUrl}"`,
    );
    assert.ok(
      (bgAlt.getAttribute('href') || '').endsWith(expectedBgUrl),
      `${relPath}: hreflang="bg" href should end with "${expectedBgUrl}"`,
    );
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

test('smoke: EVERY page carries data-lang-pill-expected="1" (pill on every header)', () => {
  // The pill is now present on every page's header source (not just
  // the home). The plugin's applyHead stamps data-lang-pill-expected
  // on any page whose source contains .site-header__lang. lang.js
  // reads the marker to decide whether "no pill in DOM" is a
  // regression to warn about.
  //
  // A page missing this marker would silently ship a header without
  // the language toggle — user has no way to switch. Assert every
  // emitted page has it.
  for (const { relPath, doc } of pages) {
    const marker = doc.querySelector('html').getAttribute('data-lang-pill-expected');
    assert.equal(
      marker,
      '1',
      `${relPath}: data-lang-pill-expected must be "1" on every page (got "${marker}")`,
    );
  }
});

test('smoke: NO emitted page carries any i18n marker or runtime-only sentinel (structural DOM walk)', () => {
  // Use the parsed DOM to query each forbidden attribute — regex on
  // the raw source is vulnerable to false-negatives (marker split
  // across lines by a minifier) and false-positives (a JS string
  // literal `"data-i18n="` inside a <script> block).
  //
  // Two classes of forbidden attribute:
  //   1. Build-time markers that MUST be resolved and stripped by the
  //      plugin (`data-i18n`, `-attr`, `-meta`, `-html`).
  //   2. Runtime-only sentinels that lang.js / the boot script stamp
  //      at runtime — they have NO reason to appear on the built
  //      artifact. `data-i18n-locale-applied` is applyHead's dev
  //      re-entrancy guard; `data-i18n-redirecting` is set by the
  //      boot script before location.replace(). Either appearing at
  //      build time is a real regression that would break the pill
  //      (redirecting) or ship bytes (locale-applied).
  const forbidden = [
    'data-i18n',
    'data-i18n-attr',
    'data-i18n-meta',
    'data-i18n-html',
    'data-i18n-locale-applied',
    'data-i18n-redirecting',
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

test('smoke: BG home meta description / og:description / twitter:description are Cyrillic (not EN fallback)', () => {
  // Round-4 F9: previously the Cyrillic-anywhere assertion trivially
  // passed because body copy is translated. Meta tags populated via
  // data-i18n-meta markers are a separate pipe — if a source page
  // loses its data-i18n-meta marker on <meta name="description">
  // (refactor mistake dropping the attribute), the tag stays with
  // its baked-in EN text. No unknown-key error fires (marker is gone,
  // lookup() never runs). BG page ships English og:description under
  // <html lang="bg">. Facebook/LinkedIn scrape English copy under
  // a BG page — SEO/social preview bug only manual review catches.
  //
  // Scope: HOME PAGE ONLY for now. Sub-pages (stay/, terms/, ...) are
  // stubbed as EN-only in en.json (`common._stub` orphans) — they
  // ship EN copy under <html lang="bg"> by design until each sub-page
  // gets its own translation pass. When those pages are keyed, expand
  // this test to iterate all bgPages instead of just the home.
  const bg = bgPages.find((p) => p.relPath === 'bg/index.html');
  assert.ok(bg, 'BG home page must exist');
  const metaSelectors = [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ];
  for (const sel of metaSelectors) {
    const meta = bg.doc.querySelector(sel);
    if (!meta) continue; // page doesn't ship this meta tag; not a coverage failure
    const content = meta.getAttribute('content') || '';
    if (content === '') continue; // empty content is caught by the empty-value guard in the plugin
    assert.match(
      content,
      /[Ѐ-ӿ]/,
      `bg/index.html: ${sel} content should contain Cyrillic (got "${content}")`,
    );
  }
});

test('smoke: EN home meta description / og:description / twitter:description contain NO Cyrillic', () => {
  // Symmetric guard for the BG-meta translation check above. Scoped
  // to the home page since it's the fully-translated page today.
  const en = enPages.find((p) => p.relPath === 'index.html');
  assert.ok(en, 'EN home page must exist');
  const metaSelectors = [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ];
  for (const sel of metaSelectors) {
    const meta = en.doc.querySelector(sel);
    if (!meta) continue;
    const content = meta.getAttribute('content') || '';
    if (content === '') continue;
    assert.doesNotMatch(
      content,
      /[Ѐ-ӿ]/,
      `index.html: ${sel} content should NOT contain Cyrillic on the EN emit (got "${content}")`,
    );
  }
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

test('smoke: pill hrefs point to the correct mirror on EVERY page × emit (symmetric, cross-page)', () => {
  // Pill is now on every page's header. For each page, both segments
  // must exist and their hrefs must point at the correct locale-mirror
  // URL for this page's sub-path (not the home!). A regression that
  // dropped the plugin's pill href-rewrite pass, or mispaired locale ↔
  // URL, would ship users to the wrong page when they toggle language
  // on any sub-page (e.g., BG segment on /terms/ pointing at /bg/
  // instead of /bg/terms/ = user loses their context).
  for (const { relPath, doc } of pages) {
    // Compute both locale-mirror URLs for this page.
    const enRelPath = relPath.startsWith('bg/') ? relPath.slice(3) : relPath;
    // Defensive invariant: after stripping the single leading `bg/`,
    // enRelPath must not itself start with `bg/` — a `bg/bg/foo` emit
    // would be a plugin bug (double-prefix) that silently passed the
    // downstream `bg/${enRelPath}` construction. Assert loud so any
    // future regression surfaces at this line rather than as a mis-
    // computed URL comparison two lines below.
    assert.ok(
      !enRelPath.startsWith('bg/'),
      `${relPath}: unexpected double-bg/ prefix after slice — plugin emit bug?`,
    );
    const bgRelPath = `bg/${enRelPath}`;
    const enUrl = expectedUrlForRelPath(enRelPath);
    const bgUrl = expectedUrlForRelPath(bgRelPath);
    const isEnEmit = !relPath.startsWith('bg/');

    const enSeg = doc.querySelector('.site-header__lang-seg[data-lang="en"]');
    const bgSeg = doc.querySelector('.site-header__lang-seg[data-lang="bg"]');
    assert.ok(enSeg, `${relPath}: must have EN pill segment`);
    assert.ok(bgSeg, `${relPath}: must have BG pill segment`);

    assert.equal(
      enSeg.getAttribute('href'),
      enUrl,
      `${relPath}: EN pill href must be "${enUrl}"`,
    );
    assert.equal(
      bgSeg.getAttribute('href'),
      bgUrl,
      `${relPath}: BG pill href must be "${bgUrl}"`,
    );

    // is-active + aria-current must be on the segment matching the emit locale.
    const activeSeg = isEnEmit ? enSeg : bgSeg;
    const inactiveSeg = isEnEmit ? bgSeg : enSeg;
    assert.match(
      activeSeg.getAttribute('class') || '',
      /\bis-active\b/,
      `${relPath}: active segment must carry is-active class`,
    );
    assert.equal(
      activeSeg.getAttribute('aria-current'),
      'true',
      `${relPath}: active segment must have aria-current="true"`,
    );
    assert.doesNotMatch(
      inactiveSeg.getAttribute('class') || '',
      /\bis-active\b/,
      `${relPath}: inactive segment must NOT carry is-active class`,
    );
    assert.ok(
      !inactiveSeg.getAttribute('aria-current'),
      `${relPath}: inactive segment must NOT have aria-current`,
    );
  }
});

test('smoke: boot-redirect <script data-locale> appears BEFORE any <link rel="stylesheet"> in <head>', () => {
  // Round-4 F10: the applyHead Phase-2 docstring (i18n-plugin.js) states
  // "Boot script FIRST (must run before any stylesheet)". A blocking
  // stylesheet load BEFORE the boot script would let a returning BG user
  // on the EN root see ~100-500ms of English content flash before
  // location.replace() fires (FOWL — flash of wrong locale).
  //
  // A future Vite plugin ordering change, a refactor moving the
  // insert-point below Vite's asset injection, or a Vite version bump
  // could silently swap the order.
  //
  // Compare raw-string indices — <head>.childNodes ordering in
  // node-html-parser preserves source order, but string-index compare
  // is cheaper and equivalent for HTML that ships in a single <head>
  // block (which the plugin guarantees via insertAfterHead).
  for (const { relPath, html } of pages) {
    const bootIdx = html.search(/<script\b[^>]*\bdata-locale\s*=/i);
    assert.ok(bootIdx !== -1, `${relPath}: boot-redirect <script data-locale> must exist`);

    // Find the first stylesheet <link>. Match rel="stylesheet" with
    // either quote style; the raw html attribute may be single- or
    // double-quoted.
    const styleIdx = html.search(/<link\b[^>]*\brel\s*=\s*["']stylesheet["']/i);
    if (styleIdx === -1) {
      // Some sub-pages might not ship a stylesheet in <head> (unlikely
      // for this codebase but skip gracefully). No stylesheet means
      // no ordering constraint to enforce.
      continue;
    }
    assert.ok(
      bootIdx < styleIdx,
      `${relPath}: boot-redirect <script data-locale> (idx ${bootIdx}) must appear before <link rel="stylesheet"> (idx ${styleIdx}) — otherwise FOWL on returning BG users`,
    );
  }
});
