import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { i18nPlugin } from './scripts/i18n-plugin.js';

// The GitHub Pages sub-path — the site is served from
// noobcoder1209.github.io/vayana-bungalows/, so every asset URL needs
// this prefix in prod. Hoisted to a variable so the i18n plugin and
// build config share the exact same value; a mismatch here would emit
// mixed-prefix URLs across the two locales.
const BASE = '/vayana-bungalows/';

// Multi-page build: one entry per HTML page. Vite emits each as its own
// index.html under the matching folder, so the URLs stay /<page>/.
// Hoisted so the i18n plugin can enumerate the same set for BG-mirror
// emission (Part 2 of Task #163) rather than duplicating the list.
const INPUTS = {
  home: resolve(__dirname, 'index.html'),
  premierOceanviewVilla: resolve(__dirname, 'premier-oceanview-villa/index.html'),
  deluxeHilltopResidence: resolve(__dirname, 'deluxe-hilltop-residence/index.html'),
  premierBeachfrontSuite: resolve(__dirname, 'premier-beachfront-suite/index.html'),
  enquiries: resolve(__dirname, 'enquiries/index.html'),
  enquiriesThanks: resolve(__dirname, 'enquiries/thanks/index.html'),
  stay: resolve(__dirname, 'stay/index.html'),
  destination: resolve(__dirname, 'destination/index.html'),
  contacts: resolve(__dirname, 'contacts/index.html'),
  privacy: resolve(__dirname, 'privacy/index.html'),
  terms: resolve(__dirname, 'terms/index.html'),
  cancellation: resolve(__dirname, 'cancellation/index.html'),
};

// Per-locale interpolation context for the i18n plugin (#47). Values here
// resolve locale-value {token} references in locales/*.json.
//
// Design: the context is PER LOCALE (not a single shared dict) so the
// same {token} name can point at different values in different locales.
// Today only URLs vary — privacy_url and email_href stay identical in
// prod, but the plugin's contract accepts locale-specific overrides so
// a future locale rollout (e.g. a country-specific phone number) needs
// no plugin change.
//
// The values duplicate what assets/js/site-config.js already ships to
// the client. Deliberate — the build-time and runtime worlds don't share
// a module system, and importing site-config.js into vite.config.js would
// pull in JS that's meant for the browser. Kept in lockstep by convention;
// if these ever drift, the client-side site-config-inject.js will overwrite
// the plugin's baked-in phone number at hydration time, so the client-side
// value wins visually — but the head-metadata + no-JS paths only see the
// build-time value, so KEEP THESE IN SYNC when SITE_CONFIG changes.
const i18nContext = {
  en: {
    phone: '+359 88 888 8888',
    credit: 'Vayana di Mare',
    privacy_url: `${BASE}privacy/`,
    email_href: 'mailto:contact@vayanabungalows.com',
    email_display: 'contact@vayanabungalows.com',
    // Runtime-interpolated tokens: the offers nights-deal template
    // (home.offers.nights_deal) carries {min}/{free}, which offers.js /
    // offer-modal.js fill from offer.minimumToBook / offer.freeNights at
    // runtime. The i18n plugin interpolates EVERY {token} at build time and
    // hard-fails on an unknown one, so we resolve these to the literal token
    // string — the plugin substitutes `{min}` → `{min}` (global replace does
    // not re-scan inserted text), leaving the runtime token intact in the
    // baked data-nights-deal-label attribute. Keep in both locales.
    // pct/amount are the same for the Type-1 discount templates
    // (discount_pct/{pct}, discount_per_day/{amount}, discount_total/{amount}).
    min: '{min}',
    free: '{free}',
    pct: '{pct}',
    amount: '{amount}',
  },
  bg: {
    phone: '+359 88 888 8888',
    credit: 'Vayana di Mare',
    // BG privacy path lives under /bg/privacy/. Plugin's Part 2 head-
    // injection block sets <html lang="bg"> and rewrites the canonical
    // URL; this URL is the one the locale JSON's {privacy_url} token
    // interpolates into the newsletter-consent link.
    privacy_url: `${BASE}bg/privacy/`,
    email_href: 'mailto:contact@vayanabungalows.com',
    email_display: 'contact@vayanabungalows.com',
    // See EN note above — {min}/{free} in home.offers.nights_deal are
    // runtime tokens; resolve them to the literal token so the plugin
    // leaves them intact for the client-side interpolation.
    min: '{min}',
    free: '{free}',
    pct: '{pct}',
    amount: '{amount}',
  },
};

// On GitHub Pages the site is served from /vayana-bungalows/, so we set the
// base to that subpath only when building for production. In dev (npm run dev)
// it stays at /, so localhost works without prefixing every URL.
export default defineConfig(({ command }) => ({
  root: '.',
  base: command === 'build' ? BASE : '/',
  plugins: [
    i18nPlugin({
      localesDir: resolve(__dirname, 'locales'),
      contextByLocale: i18nContext,
      basePath: command === 'build' ? BASE : '/',
      projectRoot: __dirname,
      inputs: INPUTS,
    }),
  ],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: INPUTS,
    },
  },
}));
