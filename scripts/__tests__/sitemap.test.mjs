// Unit tests for the sitemap + robots.txt generator (scripts/sitemap.js).
//
// Run with:  node --test scripts/__tests__/sitemap.test.mjs
//
// Pure-function coverage: entry derivation (indexable filtering), the bilingual
// hreflang XML shape, robots.txt content, XML escaping, and gitLastmod's
// never-throw contract. Reuses the REAL pageUrl from the i18n plugin so the
// sitemap URLs are proven to match the canonical/hreflang URLs the site emits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  xmlEscape,
  NOINDEX_PAGES,
  buildSitemapEntries,
  buildSitemapXml,
  buildRobotsTxt,
  collapseDisallowPaths,
  gitLastmod,
} from '../sitemap.js';
import { pageUrl } from '../i18n-plugin.js';

const BASE = '/vayana-bungalows/';
const ORIGIN = 'https://noobcoder1209.github.io';
const LOCALES = ['bg', 'en'];
const DEFAULT = 'en';
const PAGES = [
  'index.html',
  'stay/index.html',
  'enquiries/index.html',
  'enquiries/thanks/index.html',
  'destination/index.html',
  'contacts/index.html',
  'privacy/index.html',
  'terms/index.html',
  'cancellation/index.html',
];

function entries(extra = {}) {
  return buildSitemapEntries({
    pagePaths: PAGES,
    locales: LOCALES,
    defaultLocale: DEFAULT,
    origin: ORIGIN,
    basePath: BASE,
    pageUrl,
    ...extra,
  });
}

// ── xmlEscape ────────────────────────────────────────────────────────────────

test('xmlEscape: escapes the five XML predefined entities', () => {
  assert.equal(xmlEscape(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
});

test('xmlEscape: a URL with an ampersand query is made XML-safe', () => {
  assert.equal(
    xmlEscape('https://x.test/?a=1&b=2'),
    'https://x.test/?a=1&amp;b=2',
  );
});

// ── buildSitemapEntries ──────────────────────────────────────────────────────

test('buildSitemapEntries: excludes the noindex enquiry pages', () => {
  const es = entries();
  const paths = es.map((e) => e.pagePath);
  assert.ok(!paths.includes('enquiries/index.html'), 'enquiry form excluded');
  assert.ok(!paths.includes('enquiries/thanks/index.html'), 'thanks excluded');
  // 9 source pages − 2 noindex = 7 indexable.
  assert.equal(es.length, 7);
});

test('buildSitemapEntries: NOINDEX_PAGES is the exclusion source of truth', () => {
  assert.ok(NOINDEX_PAGES.has('enquiries/index.html'));
  assert.ok(NOINDEX_PAGES.has('enquiries/thanks/index.html'));
});

test('buildSitemapEntries: per-locale absolute URLs match the real pageUrl helper', () => {
  const home = entries().find((e) => e.pagePath === 'index.html');
  assert.equal(home.byLocale.en, 'https://noobcoder1209.github.io/vayana-bungalows/');
  assert.equal(home.byLocale.bg, 'https://noobcoder1209.github.io/vayana-bungalows/bg/');
  const stay = entries().find((e) => e.pagePath === 'stay/index.html');
  assert.equal(stay.byLocale.en, 'https://noobcoder1209.github.io/vayana-bungalows/stay/');
  assert.equal(stay.byLocale.bg, 'https://noobcoder1209.github.io/vayana-bungalows/bg/stay/');
});

test('buildSitemapEntries: entries are sorted by page path (deterministic output)', () => {
  const paths = entries().map((e) => e.pagePath);
  assert.deepEqual(paths, [...paths].sort());
});

test('buildSitemapEntries: throws on a trailing-slash origin', () => {
  assert.throws(
    () => entries({ origin: 'https://x.test/' }),
    /trailing slash/,
  );
});

test('buildSitemapEntries: lastmodFor is applied when provided', () => {
  const es = entries({ lastmodFor: (p) => (p === 'index.html' ? '2026-09-27' : null) });
  const home = es.find((e) => e.pagePath === 'index.html');
  assert.equal(home.lastmod, '2026-09-27');
  const stay = es.find((e) => e.pagePath === 'stay/index.html');
  assert.equal(stay.lastmod, null);
});

// ── buildSitemapXml ──────────────────────────────────────────────────────────

test('buildSitemapXml: well-formed urlset with xhtml namespace', () => {
  const xml = buildSitemapXml({ entries: entries(), defaultLocale: DEFAULT });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(xml, /<\/urlset>\n$/);
});

test('buildSitemapXml: one <url> per (indexable page × locale) = 14', () => {
  const xml = buildSitemapXml({ entries: entries(), defaultLocale: DEFAULT });
  const urlCount = (xml.match(/<url>/g) || []).length;
  assert.equal(urlCount, 14); // 7 pages × 2 locales
});

test('buildSitemapXml: every <url> carries en, bg, and x-default alternates', () => {
  const xml = buildSitemapXml({ entries: entries(), defaultLocale: DEFAULT });
  // Split into <url> blocks and assert each has all three hreflang links.
  const blocks = xml.split('<url>').slice(1);
  assert.equal(blocks.length, 14);
  for (const b of blocks) {
    assert.match(b, /hreflang="en"/, 'has en alternate');
    assert.match(b, /hreflang="bg"/, 'has bg alternate');
    assert.match(b, /hreflang="x-default"/, 'has x-default alternate');
  }
});

test('buildSitemapXml: x-default points at the default-locale (en) URL', () => {
  const xml = buildSitemapXml({ entries: entries(), defaultLocale: DEFAULT });
  assert.match(
    xml,
    /hreflang="x-default" href="https:\/\/noobcoder1209\.github\.io\/vayana-bungalows\/"/,
  );
});

test('buildSitemapXml: no noindex enquiry URL appears anywhere', () => {
  const xml = buildSitemapXml({ entries: entries(), defaultLocale: DEFAULT });
  assert.ok(!xml.includes('/enquiries/'), 'no enquiry URL in sitemap');
});

test('buildSitemapXml: emits <lastmod> only when present', () => {
  const es = entries({ lastmodFor: (p) => (p === 'index.html' ? '2026-09-27' : null) });
  const xml = buildSitemapXml({ entries: es, defaultLocale: DEFAULT });
  assert.match(xml, /<lastmod>2026-09-27<\/lastmod>/);
  // Exactly 2 lastmod lines (home × 2 locales); the other pages have none.
  assert.equal((xml.match(/<lastmod>/g) || []).length, 2);
});

// ── buildRobotsTxt ───────────────────────────────────────────────────────────

test('buildRobotsTxt: allows all, disallows given paths, advertises sitemap', () => {
  const txt = buildRobotsTxt({
    sitemapUrl: 'https://noobcoder1209.github.io/vayana-bungalows/sitemap.xml',
    disallowPaths: ['/vayana-bungalows/enquiries/'],
  });
  assert.match(txt, /^User-agent: \*/m);
  assert.match(txt, /^Allow: \/$/m);
  assert.match(txt, /^Disallow: \/vayana-bungalows\/enquiries\/$/m);
  assert.match(txt, /^Sitemap: https:\/\/noobcoder1209\.github\.io\/vayana-bungalows\/sitemap\.xml$/m);
  assert.match(txt, /\n$/);
});

test('buildRobotsTxt: no Disallow lines when none given', () => {
  const txt = buildRobotsTxt({ sitemapUrl: 'https://x.test/sitemap.xml' });
  assert.ok(!/Disallow:/.test(txt));
});

test('buildRobotsTxt: collapses a subpath already covered by a shorter prefix', () => {
  // Both enquiry paths in → only the top-level /enquiries/ is emitted
  // (the /enquiries/thanks/ subtree is already covered by prefix matching).
  const txt = buildRobotsTxt({
    sitemapUrl: 'https://x.test/sitemap.xml',
    disallowPaths: ['/vayana-bungalows/enquiries/thanks/', '/vayana-bungalows/enquiries/'],
  });
  const disallows = txt.split('\n').filter((l) => l.startsWith('Disallow:'));
  assert.deepEqual(disallows, ['Disallow: /vayana-bungalows/enquiries/']);
});

// ── collapseDisallowPaths ────────────────────────────────────────────────────

test('collapseDisallowPaths: drops subpaths covered by a shorter prefix', () => {
  assert.deepEqual(
    collapseDisallowPaths(['/a/', '/a/b/', '/a/b/c/']),
    ['/a/'],
  );
});

test('collapseDisallowPaths: keeps unrelated paths, sorted + de-duped', () => {
  assert.deepEqual(
    collapseDisallowPaths(['/b/', '/a/', '/a/', '/c/x/']),
    ['/a/', '/b/', '/c/x/'],
  );
});

// ── gitLastmod ───────────────────────────────────────────────────────────────

test('gitLastmod: never throws; returns null for a nonexistent file', () => {
  const v = gitLastmod('/no/such/file/really.xyz', process.cwd());
  assert.equal(v, null);
});

test('gitLastmod: returns YYYY-MM-DD or null for a real repo file', () => {
  // This test file itself is tracked once committed; before commit it is
  // untracked → null. Either way the shape contract holds.
  const v = gitLastmod(new URL(import.meta.url).pathname, process.cwd());
  assert.ok(v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), `got "${v}"`);
});
