# Prefill enquiry dates when a guest "Takes an offer"

## Context

When a guest clicks **"Take the offer"** in the home-page offer modal, they land on
`/enquiries/` with the message textarea pre-filled (`?offer=<prose>`) and the hidden
price field set (`?price=<n>`, shipped in PR #106). But the **date pickers stay
empty** — the offer's dates never reach the form. The guest has to re-enter the exact
dates the offer is for, which is friction and an error source.

The `/stay/` top booking bar already solves the same problem for its own flow: it
links to `/enquiries/?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD`, and `enquiry.js`
(lines 373-408) reads those params into the flatpickr pickers behind a set of
defensive guards (valid ISO, not in the past, in the open season, checkout > checkin).
That reader is already shipped and tested. The offer modal simply never emits those
two params.

### Why this needs a data-format decision

The offer's dates come from the **Offers sheet, Column B (`Dates`)** — read by the
Worker (`worker/src/offers.js`, `COL.dates = 0`) and returned verbatim as
`offer.dates`. Today that column is **completely free-form**: the operator types any
display string (test/spec fixtures show inconsistent examples like `12–18 Jun 2026`,
`12–18 June 2026`, `12–18 Jun`, `12 Jun`). Nothing parses it — it's rendered as-is on
the card eyebrow, in the modal, and stuffed into the `?offer=` prose.

To prefill the pickers we need unambiguous ISO `checkin`/`checkout`. A freehand string
like `12–18 Jun` cannot be parsed safely (no year, locale-dependent month names,
en-dash vs hyphen). So the fix requires the `Dates` cell to become **machine-readable**.

### Decisions (confirmed with owner)

- **One cell, strict ISO range.** The operator types `2027-06-15/2027-06-20`
  (`YYYY-MM-DD` / slash / `YYYY-MM-DD`) in Column B. No new sheet columns.
- **Store ISO, render pretty.** The guest never sees raw ISO. A frontend formatter
  renders a friendly display string on the card and in the modal.
  - EN: `15 Jun 2027 – 20 Jun 2027` (en-dash separator).
  - BG (`/bg/`): `15 юни 2027 - 20 юни 2027` — localized month names, **plain hyphen
    separator, and NO trailing " г."** era suffix (owner's explicit format).
- **Soft contract — fails safe.** A cell that is NOT a clean ISO range (old freehand
  text, typo, blank, single date, reversed order) degrades to today's behavior: the
  **raw cell text is shown verbatim** on the card and prefill is skipped. An offer
  never breaks because of a malformed dates cell.
- **Frontend-only.** The Worker keeps returning the raw `dates` string untouched; all
  parsing and formatting happens client-side, where the offer already renders and
  where the enquiry date helpers already live. No Worker redeploy needed for this
  feature.
- **enquiry.js is the authority on bookable dates.** Its existing `?checkin/?checkout`
  reader re-validates (not past, in-season, checkout > checkin). An offer whose dates
  are valid ISO but in the past or off-season still prefills nothing — same fail-safe
  as the `/stay/` bar.

## Approach

Add a small pure helper module that both (a) splits a valid ISO-range cell into two
ISO dates for the prefill params and (b) formats it into a locale-aware display
string, returning the raw input unchanged when it isn't a valid range. Wire the
formatter into the card/modal display and the `?offer=` prose; wire the splitter into
`buildEnquiryUrl` so the "Take the offer" link carries `?checkin=&checkout=`.
`enquiry.js` needs no change — its shipped prefill reader consumes those params.

### New module: `assets/js/util/offer-dates.js`

Two exported pure functions, no DOM, unit-testable in isolation:

- **`parseOfferDates(raw)` → `{ checkin, checkout }` | `null`**
  - Coerce `raw` to string; split on `/`.
  - Require exactly two parts, each matching `^\d{4}-\d{2}-\d{2}$` (so a
    date written with slashes, e.g. `2027/6/15/...`, yields >2 parts → null).
  - Validate each half is a REAL calendar date via a UTC round-trip
    (`new Date(Date.UTC(y, m-1, d))` and assert the components come back
    unchanged) so `2027-02-30` is rejected rather than silently rolling to
    `2027-03-02`. NOTE: `parseIso` in `bookings-data.js` does NOT do this
    (`new Date(2027,1,30)` rolls over), so the helper carries its own inline
    round-trip check rather than reusing `parseIso` — this keeps the util
    dependency-free and strictly correct. The downstream `enquiry.js` reader is
    still the booking-authority regardless.
  - Require `checkout > checkin` (string compare is safe for zero-padded ISO;
    but compare via the parsed dates for clarity).
  - Any failure → `null`.
- **`formatOfferDates(raw, locale)` → `string`**
  - If `parseOfferDates(raw)` is `null` → return `raw` unchanged (the fail-safe
    passthrough; also covers freehand/blank/single-date cells).
  - Otherwise format each endpoint with `Intl.DateTimeFormat` (`{ day: 'numeric',
    month: 'short', year: 'numeric' }`) keyed to `locale`.
    - `en` → `15 Jun 2027`, joined with ` – ` (en-dash) → `15 Jun 2027 – 20 Jun 2027`.
    - `bg` → build from BG month names, strip a trailing ` г.`/`г.` and any era
      artifacts, join with ` - ` (plain hyphen) → `15 юни 2027 - 20 юни 2027`.
  - If start and end are the same calendar day, render a single formatted date (no
    range separator). (Out-of-contract for a real range — `checkout > checkin` is
    required — so this only matters defensively.)
  - Locale resolution: caller passes `currentLocale()`; an unknown locale falls back
    to `en` formatting.

### Display wiring

- **`assets/js/offers.js` `buildCard`** (line 89): replace
  `add('offer-card__eyebrow', offer.dates)` with the formatted string —
  `add('offer-card__eyebrow', formatOfferDates(offer.dates, currentLocale()))`.
  Import `currentLocale` (already imported in `offer-modal.js`, add to `offers.js`).
- **`assets/js/offer-modal.js` `openOfferModal`** (lines 107, 119-121): the
  `setSlot(modal, 'dates', ...)` call and the `callout-dates` `<strong>` text use
  `formatOfferDates(offer.dates, currentLocale())`.
- **`assets/js/offer-modal.js` `buildEnquiryUrl`** (line 38): the `?offer=` prose
  `Dates: ${offer.dates}` switches to the formatted string so the pre-filled message
  reads `Dates: 15 Jun 2027 – 20 Jun 2027`, not raw ISO.

### Prefill wiring (the fix)

- **`assets/js/offer-modal.js` `buildEnquiryUrl`** — after the existing `?price=`
  block (~line 53):
  ```js
  const range = parseOfferDates(offer.dates);
  if (range) {
    url.searchParams.set('checkin', range.checkin);
    url.searchParams.set('checkout', range.checkout);
  }
  ```
  Import `parseOfferDates`/`formatOfferDates` from `./util/offer-dates.js`.
- **`assets/js/enquiry.js` — NO CHANGE.** The `?checkin=&checkout=` reader
  (lines 373-408) already validates and populates the pickers, driving
  `fpCheckout`'s `minDate` explicitly. Verify only.

### Files to modify / add

- **add** `assets/js/util/offer-dates.js` — `parseOfferDates`, `formatOfferDates`.
- **add** `assets/js/util/__tests__/offer-dates.test.mjs` — unit tests for both.
- `assets/js/offer-modal.js` — import helpers; format display + prose; emit
  `?checkin/?checkout` in `buildEnquiryUrl`.
- `assets/js/offers.js` — import `currentLocale` + `formatOfferDates`; format the
  card eyebrow.
- `assets/js/__tests__/offer-modal.test.mjs` — `buildEnquiryUrl` emits the two date
  params for a valid ISO-range offer; omits them for a freehand offer.
- `assets/js/__tests__/offers.test.mjs` — card eyebrow shows pretty for an ISO-range
  offer, raw for freehand.
- **manual, out-of-repo:** the operator switches the Offers-tab `Dates` cells to the
  `YYYY-MM-DD/YYYY-MM-DD` format. Existing freehand cells keep working (raw display,
  no prefill) until migrated — documented in the PR body.

## Testing

- `assets/js/util/__tests__/offer-dates.test.mjs`
  - `parseOfferDates`: `'2027-06-15/2027-06-20'` → `{checkin:'2027-06-15',
    checkout:'2027-06-20'}`; blank / `null` / freehand `'12–18 Jun'` / single
    `'2027-06-15'` / reversed `'2027-06-20/2027-06-15'` / invalid `'2027-02-30/...'`
    → `null`; tolerant of surrounding whitespace.
  - `formatOfferDates`: EN valid → `'15 Jun 2027 – 20 Jun 2027'`; BG valid →
    `'15 юни 2027 - 20 юни 2027'` (assert NO ` г.` and hyphen separator); malformed /
    blank / freehand → raw input returned unchanged; unknown locale → EN formatting.
- `assets/js/__tests__/offer-modal.test.mjs` (extend): a valid-ISO-range offer makes
  `buildEnquiryUrl` include `checkin=2027-06-15&checkout=2027-06-20`; a freehand-dates
  offer includes neither; the `?offer=` prose carries the formatted (not raw) dates.
- `assets/js/__tests__/offers.test.mjs` (extend): `buildCard`/`renderOffers` renders
  the pretty eyebrow for an ISO-range offer and the raw string for a freehand one.
- Full gates: `npm run test`, `npm run i18n:lint` (no new locale keys — the helper is
  code, not copy), `npm run build` (clean).
- **Firefox Playwright** on the built `dist` served under `/vayana-bungalows/`:
  - Mock `/offers` with one ISO-range offer (`dates:'2027-06-15/2027-06-20'`,
    `priceAfter:'400'`). Home page → card eyebrow reads `15 Jun 2027 – 20 Jun 2027`.
    Open modal → same pretty dates + fixed-dates callout. Click **Take** → follow the
    href → enquiry check-in picker shows `15/06/2027`, check-out `20/06/2027`, hidden
    price `400`.
  - Freehand offer (`dates:'12–18 Jun'`) → card shows `12–18 Jun` verbatim; Take →
    enquiry pickers empty (no prefill), no crash.
  - `/bg/` home page with the ISO-range offer → card reads `15 юни 2027 - 20 юни 2027`
    (no ` г.`).

## Delivery

- Branch `feature/offer-date-prefill` → PR to `main` (owner `NoobCoder1209`),
  squash-merge (git-safety). Do NOT merge until CI is green AND the owner approves.
- After the PR is raised, run **pr-reviewer** against it and list ALL findings to the
  owner. Do NOT fix anything until the owner specifies which findings to address.

## Out of scope

- Any Worker change (the Worker returns `dates` raw; formatting is client-side).
- The `/stay/` flow (its `?checkin/?checkout` prefill already works).
- The `?villa=` message-prefill flow.
- Structured per-endpoint date columns in the sheet (single-cell range is the design).
- Re-pricing / per-bungalow rates.
