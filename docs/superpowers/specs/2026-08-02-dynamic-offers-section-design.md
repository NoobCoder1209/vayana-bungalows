# Dynamic Offers Section — Design

**Date:** 2026-08-02
**Status:** Approved (brainstorming) — pending implementation plan
**Replaces:** the static "Image CTA" block (`index.html` section 11, `.cta-block`)

## Summary

Replace the static Image-CTA block on the home page with a **dynamic offers
section** driven by a Google Sheet. The section renders 1–6 portrait offer
cards, fetched at runtime from a new `GET /offers` route on the existing
`vayana-enquiries` Cloudflare Worker, edge-cached ~1 minute.

Offers are edited ~2–3×/year in the `Offers` tab of the same spreadsheet the
bookings calendar and enquiries Worker already use
(`1d_NAxImy1UbRx70os2sXxWRweduqWevQPR0v6fG7Ew8`, `gid=980376630`). Because
the tab is in that same spreadsheet file, the Worker's existing service
account already has read access — **no new Google permissions, no new
secrets**.

## Why runtime Worker (not build-time JSON)

The site already reads a sheet at BUILD time (`scripts/fetch-bookings.mjs` →
`bookings.json`), but build-time offers would only appear on the next push to
`main`. The owner requires near-instant updates after a sheet edit without a
deploy, so a runtime read (edge-cached 1 min) was chosen. 1-minute cache is
effectively free given ≤6 offers edited a few times a year.

## Sheet contract

Range read: `'Offers'!B3:H8` (6 rows = up to 6 offers).

| Col | Field         | Notes                                                    |
|-----|---------------|----------------------------------------------------------|
| B   | Dates         | raw text                                                 |
| C   | Discount %    | number (may be a formula — Worker reads computed value)  |
| D   | Price before  | **bare number** (front-end prepends €)                   |
| E   | Price after   | **bare number** (front-end prepends €)                   |
| F   | Nights        | raw text/number                                          |
| G   | Message       | raw text                                                 |
| H   | Enable flag   | **only `'True'` (case-insensitive, trimmed) shows**      |

**Suggested C-column formula** (paste in C3, fill down to C8):

```
=IF(OR($D3="",$E3=""), "", ROUND(($D3-$E3)/$D3*100, 0))
```

### Filtering rules (applied in the Worker)

1. **Enable filter** — keep a row only if `H.trim().toLowerCase() === 'true'`.
   Blank / `'false'` / anything else → dropped. (Blank = hidden, per owner.)
2. **Non-empty filter** — of the enabled rows, drop any where B–G are all
   blank (no empty cards).
3. Offer numbers/positions are **disregarded** — surviving rows are collected
   in sheet order and treated uniformly (offer in row 3 and row 6 → 2 offers).

## Data source — Worker `GET /offers`

New route on the existing `vayana-enquiries` Worker (`worker/src/index.js`).

- **Auth/read:** reuse the JWT service-account token flow in
  `worker/src/sheets.js`. Extract a shared `readRange(env, tab, range)` helper
  (or a dedicated `offers.js` read module) alongside the existing
  `appendEnquiry`. Uses the Sheets `values.get` API.
- **New config:** `GSHEETS_OFFERS_TAB="Offers"` — non-secret var in
  `wrangler.toml` `[vars]` and `.dev.vars.example`. No new secret.
- **Response:** `{ ok: true, offers: [...] }` where each offer is raw cell
  text with `null` for blanks — the front-end adds labels/symbols, NOT the
  Worker:
  ```json
  { "dates": "12–18 Jun 2026", "discountPct": "20", "priceBefore": "400",
    "priceAfter": "320", "nights": "4", "message": "Free breakfast included" }
  ```
- **Caching:** `Cache-Control: public, max-age=60` + Worker Cache API so
  repeat hits within ~1 min are served from the edge (no Google round-trip).
- **Routing/CORS:** widen the current single-route/POST-only gate to allow
  `GET /offers` **without** loosening the enquiries path — GET valid only on
  `/offers`, POST only on `/enquiries`, 404 everywhere else. Reuse the
  existing origin-allowlist CORS logic.
- **Security:** every catch logs a generic string only (never `err.message`),
  mirroring the existing `sheets.js` private-key-leak-avoidance convention.

## Front-end

New module `assets/js/offers.js` (`initOffers()`), wired into `main.js` after
the other inits. No-op on any page without a `[data-offers]` container (home
only).

- **Data access:** mirror `bookings-data.js` — a cached `fetch()` to the
  Worker's `/offers`, resolving to the offers array or `null` on failure. The
  Worker base URL comes from `site-config.js` (same place the enquiries
  endpoint is configured).
- **Render flow:**
  1. Show a lightweight loading state (or nothing) in `[data-offers]`.
  2. Fetch `/offers`.
  3. Success with ≥1 offer → build cards, set `data-count="N"` on the grid.
  4. Success with 0 offers → render localized `home.offers.empty` message.
  5. Fetch fails / `null` → render localized `home.offers.error` message.
- **Card structure** (portrait; fields one-per-line in B→G order for now —
  exact per-field placement is a later refinement; labels localized, symbols
  auto-added, blank fields omitted):
  ```html
  <article class="offer-card">
    <p class="offer-card__row"><span class="offer-card__label">Dates</span> 12–18 Jun 2026</p>
    <p class="offer-card__row"><span class="offer-card__label">Discount</span> 20%</p>
    <p class="offer-card__row"><span class="offer-card__label">Price before</span> €400</p>
    <p class="offer-card__row"><span class="offer-card__label">Price after</span> €320</p>
    <p class="offer-card__row"><span class="offer-card__label">Nights</span> 4</p>
    <p class="offer-card__row"><span class="offer-card__label">Message</span> Free breakfast included</p>
  </article>
  ```
- **Symbol formatting** (in JS, from raw sheet text): Discount → append `%`;
  Price before/after → prepend `€`; Nights / Dates / Message → raw.

## Layout

Row rules by offer count (approved):

| Count | Desktop rows            |
|-------|-------------------------|
| 1     | 1 centered              |
| 2     | 2 centered, one row     |
| 3     | 3, one row              |
| 4     | 2 + 2                   |
| 5     | 3 + 2                   |
| 6     | 3 + 3                   |

Second row is absent when ≤3.

- **Desktop / pure-mouse (Bucket A):** static CSS grid, all cards visible, no
  slider, no arrows. Layout selected purely by the `data-count` attribute in
  CSS (no JS layout math).
- **Touch (Buckets B & C — phones, tablets, touch-laptops):** the same
  container becomes a horizontal scroll-snap carousel, swipe to move, one card
  snapped at a time. No arrows on pure-touch; touch-laptops get both swipe +
  arrows.
- **Bucket media queries:** reuse PR #91's exact conditions from `slider.js` /
  `sections.css` — `STEPPER_MQ =
  (hover:hover) and (pointer:fine) and (not (any-pointer:coarse))`, arrow-hide
  `@media not all and (hover:hover) and (pointer:fine)`. Keyed off input
  capability, not width.
- **a11y / motion:** section heading via `aria-labelledby`; carousel track
  keyboard-scrollable; respects `prefers-reduced-motion` like existing sliders.

## Removals

- **HTML** (`index.html` section 11): delete the entire
  `<section class="cta-block section">` (image frame, eyebrow, h3, body, dead
  "View the offer" button). Replace with:
  ```html
  <section class="offers section" aria-labelledby="offers-title">
    <div class="container offers__head reveal">
      <span class="eyebrow" data-i18n="home.offers.eyebrow">Special offers</span>
      <h3 id="offers-title" data-i18n="home.offers.title">Current offers</h3>
    </div>
    <div class="container">
      <div class="offers__grid" data-offers></div>
    </div>
  </section>
  ```
- **CSS:** remove `.cta-block*` rules from `sections.css` (~L777–830); add
  `.offers` / `.offer-card` block with `data-count` grid rules + scroll-snap
  media queries.

## i18n

Remove the 4 orphaned `home.cta_block.*` keys from **both** `en.json` and
`bg.json` (plugin enforces key parity; `i18n:lint` fails on orphans). Add new
keys to both dicts:

| Key                              | EN (example)                          |
|----------------------------------|---------------------------------------|
| `home.offers.eyebrow`            | Special offers                        |
| `home.offers.title`              | Current offers                        |
| `home.offers.label_dates`        | Dates                                 |
| `home.offers.label_discount`     | Discount                              |
| `home.offers.label_price_before` | Price before                          |
| `home.offers.label_price_after`  | Price after                           |
| `home.offers.label_nights`       | Nights                                |
| `home.offers.label_message`      | Message                               |
| `home.offers.empty`              | No current offers at the moment.      |
| `home.offers.error`              | Offers are temporarily unavailable.   |

- UI/labels localized; **offer content stays as-typed in the sheet**.
- Runtime labels are read the way `enquiry.js` reads its dynamic strings
  (follow that pattern so `i18n:lint` stays green — these are runtime lookups,
  not build-time `data-i18n` markers on card rows).
- Offers section is home-only → header/footer KEEP-IN-SYNC blocks untouched;
  no change to the other 7 entry pages.

## Testing & verification

- **`worker/__tests__/offers.test.mjs`** — enable filter (only 'True' shows),
  non-empty filter (all-blank dropped), B–G→object parsing, CORS/origin gate,
  GET-only on `/offers` + POST rejected there, 404 on other paths, cache
  header present. Sheets API mocked.
- **`assets/js/__tests__/offers.test.mjs`** — no-op without `[data-offers]`;
  renders N cards + sets `data-count`; blank fields omitted; symbol/label
  formatting; zero-offers → empty message; fetch-fail → error message;
  localized labels resolved.
- **i18n smoke** — existing `i18n-smoke.test.mjs` + `npm run i18n:lint` must
  stay green after the key swap.
- **Done gate:** `npm run build` clean · `npm test` all green ·
  `npm run i18n:lint` clean · Playwright (Firefox) across buckets — desktop
  grid rows for counts 1–6, phone/tablet swipe, touch-laptop swipe+arrows.

## Edge cases

- Range partially empty → only valid rows render.
- Row with only H='True', B–G blank → dropped.
- Discount as a formula in C → Worker reads computed value; front-end appends
  `%`.
- Prices: bare numbers in D/E; front-end prepends `€` (no double-symbol risk).
- Worker/network down → localized error message; rest of page unaffected.

## Open items (later refinement, not blocking)

- Exact per-field placement within the card (currently one-per-line B→G).
- Final heading/eyebrow copy (placeholders: "Special offers" / "Current
  offers").
