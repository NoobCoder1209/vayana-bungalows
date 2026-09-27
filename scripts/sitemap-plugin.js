// Thin Vite plugin that emits dist/sitemap.xml and dist/robots.txt at build.
//
// All the logic lives in the pure, unit-tested scripts/sitemap.js; this file
// only wires it to Vite: it reuses the SAME `inputs`, `basePath`, `origin`,
// and the i18n plugin's `pageUrl` helper, so the sitemap URL set is guaranteed
// to match the canonical/hreflang URLs the pages emit. It runs in `writeBundle`
// with `enforce: 'post'` so it lands after the i18n plugin has written the EN
// emits and BG mirrors (order-independent for correctness — we don't read the
// HTML — but keeping it post is tidy).

import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pageUrl } from './i18n-plugin.js';
import {
  buildSitemapEntries,
  buildSitemapXml,
  buildRobotsTxt,
  gitLastmod,
  NOINDEX_PAGES,
} from './sitemap.js';

/**
 * @param {object} options
 * @param {Record<string,string>} options.inputs   Vite rollup inputs (name → abs path)
 * @param {string} options.projectRoot             repo root (abs)
 * @param {string} options.basePath                e.g. '/vayana-bungalows/'
 * @param {string} options.origin                  e.g. 'https://noobcoder1209.github.io' (no trailing slash)
 * @param {string} [options.defaultLocale='en']
 * @param {string[]} [options.locales=['en','bg']]
 */
export function sitemapPlugin(options) {
  const {
    inputs,
    projectRoot,
    basePath,
    origin,
    defaultLocale = 'en',
    locales = ['en', 'bg'],
  } = options || {};

  if (!inputs || !projectRoot || !basePath || !origin) {
    throw new Error(
      '[sitemap] sitemapPlugin({ inputs, projectRoot, basePath, origin }) — all four required',
    );
  }

  // Map the Vite inputs (absolute source paths) to source-tree page paths in
  // forward-slash index-form ('index.html', 'stay/index.html', …) — exactly
  // the shape pageUrl() and NOINDEX_PAGES expect.
  const pagePaths = Object.values(inputs).map((abs) => {
    const rel = resolve(abs).slice(resolve(projectRoot).length + 1);
    return rel.split(/[\\/]/).join('/');
  });

  return {
    name: 'vayana-sitemap',
    apply: 'build',
    enforce: 'post',
    writeBundle(outOpts) {
      const outDir = outOpts?.dir || resolve(projectRoot, 'dist');

      const entries = buildSitemapEntries({
        pagePaths,
        locales,
        defaultLocale,
        origin,
        basePath,
        pageUrl,
        lastmodFor: (pagePath) => {
          // Resolve the page path back to its source file for the git date.
          const abs = resolve(projectRoot, pagePath);
          return gitLastmod(abs, projectRoot);
        },
      });

      const xml = buildSitemapXml({ entries, defaultLocale });

      // robots.txt: Disallow the site-absolute path of every noindex page's
      // directory, and advertise the sitemap at its absolute URL.
      const disallowPaths = [...NOINDEX_PAGES].map((p) =>
        pageUrl({ basePath, pagePath: p, locale: defaultLocale, defaultLocale }),
      ).sort();
      const sitemapUrl = `${origin}${basePath}sitemap.xml`;
      const robots = buildRobotsTxt({ sitemapUrl, disallowPaths });

      const sitemapPath = resolve(outDir, 'sitemap.xml');
      const robotsPath = resolve(outDir, 'robots.txt');
      mkdirSync(dirname(sitemapPath), { recursive: true });
      writeFileSync(sitemapPath, xml, 'utf-8');
      writeFileSync(robotsPath, robots, 'utf-8');

      // eslint-disable-next-line no-console
      console.log(
        `[sitemap] wrote sitemap.xml (${entries.length} indexable page(s) × ${locales.length} locale(s)) + robots.txt`,
      );
    },
  };
}
