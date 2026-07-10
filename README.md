# Vayana Bungalows

A boutique resort marketing site. Multi-page static site built with hand-written HTML, CSS, and vanilla JS, bundled by Vite.

## Run locally

Prerequisites: [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/NoobCoder1209/vayana-bungalows.git
cd vayana-bungalows
npm install
npm run dev
```

Vite opens http://localhost:5173 automatically. First run needs internet
for `npm install` and the Google Fonts loaded by `index.html`.

## Stack

- HTML / CSS / vanilla JS — no framework
- [Vite](https://vitejs.dev) for the dev server (HMR)
- [flatpickr](https://flatpickr.js.org/) for the booking date range picker
- Google Fonts: Marcellus (headings) + Jost (body)
- Cloudflare Worker at `worker/` handling `/enquiries/` submissions
  (Turnstile verify + Google Sheets append)

## Scripts

```bash
npm run dev            # Vite dev server + HMR
npm run build          # production build → dist/
npm run preview        # serve dist/ locally (respects /vayana-bungalows/ base)
npm test               # run all node:test suites (i18n plugin, lang.js, worker)
npm run i18n:lint      # verify all data-i18n markers have keys + no orphans
```

## Structure

```
index.html                          # home (only page with the EN/BG pill)
stay/                               # bungalows index
destination/                        # area guide + map
contacts/                           # contact details
enquiries/                          # enquiry form
premier-oceanview-villa/            # bungalow 1
deluxe-hilltop-residence/           # bungalow 2
premier-beachfront-suite/           # bungalow 3
assets/
  css/                  # tokens, base, layout, sections
  js/                   # header, parallax, slider, booking, reveal, lang, ...
    util/               # small shared helpers (isPrimaryClick, currentLocale)
    __tests__/          # node:test suites for browser modules
  img/                  # photography (Unsplash, license-clear)
locales/                # i18n dictionaries — one JSON per locale
  en.json               # canonical English strings + orphan _note anchors
  bg.json               # Bulgarian translations (same key set)
scripts/                # build-time tooling — i18n plugin, lint, tests
  i18n-plugin.js        # the Vite plugin that resolves data-i18n markers
  i18n-lint.js          # `npm run i18n:lint` — missing / orphan key detector
  __tests__/            # plugin + smoke tests
worker/                 # Cloudflare Worker: /enquiries/ POST → Sheets append
```

## Internationalization (i18n)

The site ships in two locales: **English** (default, served at the site
root) and **Bulgarian** (mirror served under `/bg/`). Translation
happens at BUILD time — there is no runtime string swap, so a language
change is a full navigation to the mirror URL. This keeps the runtime
JS bundle small and lets each locale be indexed independently by search
engines (hreflang alternates emitted per page).

### The Vite plugin

`scripts/i18n-plugin.js` is a custom Vite plugin that runs in
`writeBundle`. For every emitted HTML page it produces TWO files:
`dist/<path>` (default locale, EN) and `dist/bg/<path>` (BG mirror).
Both come from the same marker-annotated source HTML.

The plugin resolves five marker attributes on source HTML elements:

| Marker             | Purpose                                                    | Example                                                            |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `data-i18n`        | Replace the element's text content with a dict value       | `<h1 data-i18n="home.hero.title">Welcome</h1>`                     |
| `data-i18n-html`   | Replace with a sanitized HTML fragment (`<em>`/`<br>` only) | `<p data-i18n-html="home.subtitle">Fallback</p>`                   |
| `data-i18n-attr`   | Set one or more attributes from dict keys (semicolon-separated pairs) | `<a data-i18n-attr="aria-label:home.cta_aria; title:home.cta_title">CTA</a>` |
| `data-i18n-meta`   | Shortcut for `content:<key>` on `<meta>` elements          | `<meta name="description" data-i18n-meta="home.meta.description">` |

Every marker is STRIPPED from the emitted HTML — the presence of any
`data-i18n*` attribute in production is a bug (locked by the
`i18n-smoke.test.mjs` "no forbidden markers survived" test).

### Locale dictionaries

`locales/en.json` and `locales/bg.json` are the two dictionaries. Both
files MUST have the exact same key set — the plugin throws at build
time if keys diverge. Values can contain `{token}` placeholders that
the plugin substitutes from `contextByLocale` (per-locale context
values like `siteName`, `year`).

Special note: keys prefixed with `_note` are metadata / documentation
for future editors and are intentionally orphan (never referenced by
HTML). The lint tool tolerates them.

### The language pill

The home page carries a `.site-header__lang` component with two
`.site-header__lang-seg` anchors. The plugin's `applyHead` phase
rewrites each segment's `href` to the correct locale-mirror URL, adds
`is-active` + `aria-current="true"` to the currently-emitted locale's
segment, and rewrites `hreflang` on each.

Only the home page has the pill in source. To flag pages where the
pill is EXPECTED but somehow missing (a real regression), the plugin
stamps `<html data-lang-pill-expected="1">` on pages whose source
contains `.site-header__lang`. Runtime `lang.js` warns only when the
marker says the pill should be here.

### Runtime language switching

`assets/js/lang.js` (`initLang()`) wires the pill's clicks + aria labels.
See its module docstring for the full contract — highlights:

- Reads the emit-locale from `<html lang>` (plugin-stamped).
- Promotes `data-aria-current` (active) or `data-aria-switch`
  (inactive) to `aria-label` per segment. The plugin bakes both
  localized strings onto each segment via `data-i18n-attr` markers.
- Click on the inactive segment writes `localStorage['vb.lang']` then
  lets default anchor navigation follow the `href` to the mirror URL.
- Click on the active segment is a no-op (preventDefault).
- Cmd / Ctrl / Shift / Alt clicks and non-primary buttons open the
  target in a new tab and DO NOT persist to localStorage — the current
  tab hasn't switched locale.
- Idempotent via `<html data-lang-init="1">` sentinel stamped AFTER
  successful wiring (so an early-return can be retried by a valid
  re-init on HMR / dynamic mount).

### Boot-redirect script

Each emitted page carries a tiny inline `<script data-locale>` in
`<head>`. It runs BEFORE the main JS bundle (before `<body>` is
parsed) and:

1. Reads `?lang=<code>` from the URL. If the code matches any locale
   in the emitted `data-lang-urls` JSON map, writes it to localStorage
   and redirects to that locale's mirror.
2. Otherwise, reads `localStorage['vb.lang']`. If it names a different
   locale than the currently-emitted one, redirects to that mirror.
3. Sets `<html data-i18n-redirecting="1">` before `location.replace()`
   so `lang.js` can distinguish "redirect in flight" from "committed
   navigation" (and clear the flag on successful boot).

The map is emitted as `data-lang-urls='{"en":"/…","bg":"/…"}'` so
adding a locale needs no code change in the boot script — the loader
walks the map dynamically.

### Locale-aware integrations

- **flatpickr** (`assets/js/booking.js`, `assets/js/enquiry.js`) —
  imports `flatpickr/dist/l10n/bg.js` and passes `locale: <emit-locale>`
  to every `flatpickr(...)` call. Bulgarian users see Cyrillic month
  names and weekday headers.
- **Cloudflare Turnstile** (`assets/js/enquiry.js`) — passes
  `language: currentLocale()` to `window.turnstile.render(...)`. The
  widget's own copy ("I am human", errors, verifying status) matches
  the emit locale.
- **Enquiries Worker** (`worker/`) — accepts a `locale` field on the
  POST payload, redirects (no-JS path) to `/bg/enquiries/...` on the
  mirror for non-default locales, and writes a `Locale` column to the
  Google Sheet so the reply-back operator knows which language to
  answer in.

### Testing

The whole i18n pipeline is guarded by 228 tests:

- **`scripts/__tests__/i18n-plugin.test.mjs`** — plugin unit tests.
  Every marker shape, every error path, atomicity, dev/build modes.
- **`scripts/__tests__/i18n-lint.test.mjs`** — lint tool self-tests.
- **`scripts/__tests__/i18n-smoke.test.mjs`** — end-to-end smoke.
  Runs `npm run build`, walks every emitted page (12 EN + 12 BG), and
  asserts: every page has a matching mirror, `<html lang>` matches
  emit, boot-redirect script present with correct `data-lang-urls`,
  hreflang alternates present, pill-expected marker on home only, NO
  forbidden markers leaked to production, Cyrillic present on BG
  emit, canonical / og:url / twitter:url point at emit-locale.
- **`assets/js/__tests__/lang.test.mjs`** — runtime pill wiring.
- **`assets/js/__tests__/current-locale.test.mjs`** — locale helper.
- **`worker/__tests__/locale.test.mjs`** — Worker locale field
  validation + redirect prefix.

Run `npm test` for the full suite (~3 seconds, includes a fresh
`vite build` when `dist/` is stale relative to source).

### Adding a new locale

To add a third locale (say Serbian, `sr`):

1. Create `locales/sr.json` with the exact same key set as `en.json`
   (translated values). The plugin throws at build time if keys diverge.
2. In `vite.config.js`, add the new locale to the plugin's
   `contextByLocale` map with any per-locale context values
   (site name variants, etc).
3. In `index.html`, add a third `<a class="site-header__lang-seg"
   data-lang="sr" data-i18n-attr="data-aria-current:common.header.lang_sr_current_aria;
   data-aria-switch:common.header.lang_switch_to_sr_aria">SR</a>`
   segment to the pill, and add the four
   `common.header.lang_sr_current_aria`, `..._switch_to_sr_aria` keys
   to `en.json` / `bg.json` / `sr.json`.
4. In `assets/js/booking.js` and `assets/js/enquiry.js`, import
   `flatpickr/dist/l10n/sr.js` and add it to the `FLATPICKR_LOCALES`
   map. If flatpickr doesn't ship the locale, users get English
   flatpickr copy on Serbian pages — acceptable fallback.
5. In `assets/js/util/current-locale.js`, add `sr` to `KNOWN_LOCALES`.
6. In `worker/src/validation.js`, add `sr` to `ALLOWED_LOCALES`.
7. In `worker/src/lib/response.js`, add `sr` to `KNOWN_LOCALES`.
8. In `worker/src/index.js`, add `sr` to the `KNOWN_LOCALES` used by
   `sniffLocale()`.
9. Extend the Google Sheet's header row: the `Locale` column will
   now receive `sr` values (no schema change needed for the sheet —
   the column already exists).

The boot-redirect script, hreflang emit, and pill runtime all
discover the locale automatically from the `data-lang-urls` map /
segment DOM — no changes needed there.
