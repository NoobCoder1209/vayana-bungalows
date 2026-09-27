// Sitemap + robots.txt generator for the bilingual (EN root / BG under /bg/)
// static build. Pure, dependency-free functions here; the thin Vite plugin in
// sitemap-plugin.js wires them into the build's writeBundle and writes the two
// files to the dist root.
//
// Why a sitemap AT ALL for a 9-page site: it is the definitive page list we
// hand Google (rather than relying on link-following), it is the prerequisite
// for Search Console sitemap submission, and — because we are bilingual — it
// is where per-URL <xhtml:link hreflang> alternates live so Google pairs the
// EN and BG copies instead of treating them as duplicate content.
//
// Design: the URL set is derived from the SAME `inputs` map + `pageUrl()` the
// i18n plugin uses for canonical/hreflang, so the sitemap can never drift from
// the pages that actually build. Non-indexable pages (the enquiry form + its
// thank-you page) are excluded here AND carry a robots noindex meta in their
// HTML — a sitemap must list only indexable URLs, or it sends Google a
// contradictory signal.

import { execFileSync } from 'node:child_process';

// XML 1.0 predefined entity escaping for text that goes inside an element or a
// double-quoted attribute. URLs in a sitemap are the main risk (a raw & in a
// query string breaks the XML), plus defensive coverage of <>"'.
export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The set of source pages to EXCLUDE from the sitemap (non-indexable). These
 * are matched against the source-tree page path (forward-slash, index-form),
 * e.g. 'enquiries/index.html'. Kept here as the single source of truth so the
 * plugin and the robots Disallow list agree.
 */
export const NOINDEX_PAGES = new Set([
  'enquiries/index.html',
  'enquiries/thanks/index.html',
]);

/**
 * Build the list of sitemap entries from the page inputs. Each entry is one
 * indexable SOURCE page and carries the per-locale absolute URLs (used both as
 * the <loc> for that locale's <url> and as the shared set of hreflang
 * alternates on every locale's <url>).
 *
 * @param {object} args
 * @param {string[]} args.pagePaths  source-tree page paths ('index.html', 'stay/index.html', …)
 * @param {string[]} args.locales    e.g. ['bg','en'] (order irrelevant)
 * @param {string} args.defaultLocale  'en'
 * @param {string} args.origin       'https://noobcoder1209.github.io' (no trailing slash)
 * @param {string} args.basePath     '/vayana-bungalows/'
 * @param {(p:string)=>string|null} [args.lastmodFor]  optional: source path → ISO date or null
 * @param {(o:object)=>string} args.pageUrl  the i18n plugin's pageUrl helper (site-absolute path)
 * @returns {Array<{pagePath:string, lastmod:string|null, byLocale:Record<string,string>}>}
 */
export function buildSitemapEntries({
  pagePaths,
  locales,
  defaultLocale,
  origin,
  basePath,
  lastmodFor,
  pageUrl,
}) {
  if (!Array.isArray(pagePaths)) throw new Error('buildSitemapEntries: pagePaths must be an array');
  if (!origin || /\/$/.test(origin)) {
    throw new Error(`buildSitemapEntries: origin must be set and have no trailing slash (got "${origin}")`);
  }
  const indexable = pagePaths.filter((p) => !NOINDEX_PAGES.has(p)).sort();
  return indexable.map((pagePath) => {
    const byLocale = {};
    for (const locale of locales) {
      const path = pageUrl({ basePath, pagePath, locale, defaultLocale });
      byLocale[locale] = `${origin}${path}`;
    }
    const lastmod = lastmodFor ? lastmodFor(pagePath) : null;
    return { pagePath, lastmod, byLocale };
  });
}

/**
 * Render the entries as a urlset XML string with the xhtml alternates
 * namespace. For each indexable page we emit ONE <url> per locale; every
 * <url> carries the full set of <xhtml:link rel="alternate"> for all locales
 * plus an x-default pointing at the default-locale URL. This is the sitemap
 * equivalent of the in-page hreflang block and is what makes the bilingual
 * pairing explicit to search engines.
 */
export function buildSitemapXml({ entries, defaultLocale }) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
    + 'xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  );
  // Sort locales for deterministic output; default first is not required by
  // the spec but keeps diffs stable.
  for (const entry of entries) {
    const locales = Object.keys(entry.byLocale).sort();
    for (const locale of locales) {
      lines.push('  <url>');
      lines.push(`    <loc>${xmlEscape(entry.byLocale[locale])}</loc>`);
      // hreflang alternates: one per locale, in sorted order, then x-default.
      for (const alt of locales) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${xmlEscape(alt)}" href="${xmlEscape(entry.byLocale[alt])}" />`,
        );
      }
      lines.push(
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(entry.byLocale[defaultLocale])}" />`,
      );
      if (entry.lastmod) {
        lines.push(`    <lastmod>${xmlEscape(entry.lastmod)}</lastmod>`);
      }
      lines.push('  </url>');
    }
  }
  lines.push('</urlset>');
  return `${lines.join('\n')}\n`;
}

/**
 * robots.txt: allow everything, disallow the non-indexable enquiry paths, and
 * advertise the sitemap. `sitemapUrl` is the absolute URL of the emitted
 * sitemap. `disallowPaths` are site-absolute path prefixes to block.
 */
export function buildRobotsTxt({ sitemapUrl, disallowPaths = [] }) {
  const lines = ['User-agent: *', 'Allow: /'];
  for (const p of disallowPaths) lines.push(`Disallow: ${p}`);
  lines.push('');
  lines.push(`Sitemap: ${sitemapUrl}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Last-commit date (YYYY-MM-DD, UTC) for a file from git, or null if git is
 * unavailable / the file is untracked (a brand-new page not yet committed).
 * Uses `git log -1 --format=%cs` (committer date, short ISO). Never throws —
 * a null lastmod just omits the <lastmod> for that page, which is valid.
 *
 * @param {string} filePath  absolute path to the source file
 * @param {string} cwd       repo root (for the git invocation)
 */
export function gitLastmod(filePath, cwd) {
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%cs', '--', filePath],
      { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    // %cs yields YYYY-MM-DD; guard the shape before trusting it.
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}
