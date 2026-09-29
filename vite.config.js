import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { i18nPlugin } from './scripts/i18n-plugin.js';
import { sitemapPlugin } from './scripts/sitemap-plugin.js';

// The GitHub Pages sub-path — the site is served from
// noobcoder1209.github.io/vayana-bungalows/, so every asset URL needs
// this prefix in prod. Hoisted to a variable so the i18n plugin and
// build config share the exact same value; a mismatch here would emit
// mixed-prefix URLs across the two locales.
const BASE = '/vayana-bungalows/';

// The absolute deployment origin (scheme + host, NO trailing slash). Combined
// with BASE it forms the full public URL prefix
// (https://noobcoder1209.github.io/vayana-bungalows/). Centralised here as the
// single source of truth: canonical/og:url tags in the page HTML use this same
// origin, and the sitemap generator needs absolute URLs. If a custom domain
// ever ships, changing this one line (and BASE) moves every generated URL.
const ORIGIN = 'https://noobcoder1209.github.io';

// LodgingBusiness JSON-LD ("business card") data — schema.org structured data
// the i18n plugin injects into the home + contacts pages so Google can build a
// rich result / knowledge panel. Co-located with ORIGIN here (build-time
// constants), matching how this config already mirrors assets/js/site-config.js
// values into i18nContext — the build-time and runtime worlds don't share a
// module system, so these are duplicated by convention. KEEP IN SYNC with
// SITE_CONFIG (brand / phone / email / address / social) if those change.
// Deliberately PREFIX-FREE: the description must NOT be pulled from the locale
// files (they carry "Code NNN·" tracer prefixes that would poison the data).
const BUSINESS = {
  name: 'Vayana Bungalows',
  description:
    'Boutique bungalows on the Black Sea coast in Tsarevo, Bulgaria — '
    + 'handcrafted hospitality, garden views, and quiet days by the sea.',
  telephone: '+359 899 873 990',
  email: 'vayanamare@gmail.com',
  streetAddress: 'Arapya',
  addressLocality: 'Tsarevo',
  addressRegion: 'Burgas Province',
  addressCountry: 'BG',
  latitude: 42.1885867,
  longitude: 27.8350773,
  image: `${ORIGIN}/vayana-bungalows/og-home.jpg`,
  sameAs: [
    'https://www.facebook.com/profile.php?id=61573811610794',
    'https://www.instagram.com/vayana.joy.arapya/',
  ],
};

// Multi-page build: one entry per HTML page. Vite emits each as its own
// index.html under the matching folder, so the URLs stay /<page>/.
// Hoisted so the i18n plugin can enumerate the same set for BG-mirror
// emission (Part 2 of Task #163) rather than duplicating the list.
const INPUTS = {
  home: resolve(__dirname, 'index.html'),
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
    phone: '+359 899 873 990',
    credit: 'Vayana di Mare',
    privacy_url: `${BASE}privacy/`,
    email_href: 'mailto:vayanamare@gmail.com',
    email_display: 'vayanamare@gmail.com',
    // Build-time SSOT tokens for the legal pages (terms/privacy/cancellation),
    // where brand / licence / address appear mid-sentence inside translatable
    // paragraphs. The data-i18n-html sanitizer allows only <a>/<strong>/<em>/
    // <br>, so we can't embed the runtime data-site-config spans in a keyed
    // value — instead the prose carries {brand}/{license}/{address_street}/
    // {address_country} tokens the plugin fills at build. These are
    // always-English literals (identical in both locales), kept in lockstep
    // with assets/js/site-config.js — update both if the values change.
    brand: 'Vayana Bungalows',
    license: 'Ц2-0ТИ-В2Т-С0',
    address_street: 'Arapya',
    address_country: 'Bulgaria',
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
    // price is the home room-card "From €{price} / night" template
    // (home.rooms.price_from_tmpl), filled by offers.js from the Worker's
    // fromPrice (min seasonal rate) at runtime — same self-referential no-op.
    min: '{min}',
    free: '{free}',
    pct: '{pct}',
    amount: '{amount}',
    price: '{price}',
  },
  bg: {
    phone: '+359 899 873 990',
    credit: 'Vayana di Mare',
    // BG privacy path lives under /bg/privacy/. Plugin's Part 2 head-
    // injection block sets <html lang="bg"> and rewrites the canonical
    // URL; this URL is the one the locale JSON's {privacy_url} token
    // interpolates into the newsletter-consent link.
    privacy_url: `${BASE}bg/privacy/`,
    email_href: 'mailto:vayanamare@gmail.com',
    email_display: 'vayanamare@gmail.com',
    // Same always-English SSOT tokens as EN (see note above) — brand /
    // licence / physical address are not translated.
    brand: 'Vayana Bungalows',
    license: 'Ц2-0ТИ-В2Т-С0',
    address_street: 'Arapya',
    address_country: 'Bulgaria',
    // See EN note above — {min}/{free} in home.offers.nights_deal are
    // runtime tokens; resolve them to the literal token so the plugin
    // leaves them intact for the client-side interpolation. {price} is the
    // room-card "From €{price} / night" template, same treatment.
    min: '{min}',
    free: '{free}',
    pct: '{pct}',
    amount: '{amount}',
    price: '{price}',
  },
};

// On GitHub Pages the site is served from /vayana-bungalows/, so we set the
// base to that subpath when building for production. In dev (npm run dev) it
// stays at /, so localhost works without prefixing every URL.
//
// `command` alone can't tell dev from preview (Vite runs *both* with
// command='serve'), so we key off `mode` instead: dev defaults to
// 'development', while `vite preview` resolves config with mode='production'
// — exactly like `vite build`. That makes `npm run preview` mount the dist/
// under /vayana-bungalows/ (matching the deployed site), so the language
// pill's /bg/ mirrors resolve instead of falling through to an EN index.
export default defineConfig(({ command, mode }) => ({
  root: '.',
  base: mode === 'development' ? '/' : BASE,
  plugins: [
    i18nPlugin({
      localesDir: resolve(__dirname, 'locales'),
      contextByLocale: i18nContext,
      basePath: mode === 'development' ? '/' : BASE,
      projectRoot: __dirname,
      inputs: INPUTS,
      // JSON-LD LodgingBusiness injection (home + contacts). Wired only for a
      // PRODUCTION build: the block carries ABSOLUTE URLs (ORIGIN + BASE), so
      // it must not run when base is the dev '/' (mode === 'development'),
      // which would bake ORIGIN-without-BASE URLs. Dev server + dev build both
      // skip it; omitting these makes the plugin skip the JSON-LD entirely.
      ...(command === 'build' && mode !== 'development'
        ? { jsonldBusiness: BUSINESS, origin: ORIGIN }
        : {}),
    }),
    // Emit sitemap.xml + robots.txt at build. Only in a real (non-dev) build:
    // the sitemap carries ABSOLUTE URLs (ORIGIN + BASE), which only make sense
    // for the deployed site — a dev build with base '/' would bake wrong URLs.
    // `command === 'build'` gates it (the plugin also sets apply:'build').
    ...(command === 'build'
      ? [sitemapPlugin({
          inputs: INPUTS,
          projectRoot: __dirname,
          basePath: BASE,
          origin: ORIGIN,
          defaultLocale: 'en',
          locales: ['en', 'bg'],
        })]
      : []),
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
