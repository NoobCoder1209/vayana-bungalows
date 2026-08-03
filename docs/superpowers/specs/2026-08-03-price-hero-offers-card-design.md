# Price Hero Offers Card — Design

**Date:** 2026-08-03
**Status:** Approved (brainstorming) — pending implementation plan
**Builds on:** the live dynamic offers section (specs/2026-08-02-dynamic-offers-section-design.md,
shipped in PR #97/#98). This spec changes ONLY the offer card's internal
structure + styling; the Worker, fetch flow, responsive grid/carousel, and
empty/error states are untouched.

## Summary

Replace the offer card's current generic "labeled rows" layout with the
**Price Hero** design (mock Batch 1 · #03, chosen by the owner): a
price-forward, understated-luxury card that leads with a large serif
price-after, a small struck price-before above it, a sage "Save €X" pill, an
optional discount-% line, a hairline divider, nights, and an optional message
line. Each field is omitted when blank; **price-after is required** (an offer
without it is not rendered).

The card is driven by the same 6 sheet fields already fetched by the Worker
(`{ dates, discountPct, priceBefore, priceAfter, nights, message }`), so **no
Worker change, no sheet change, no new fetch**. This is a front-end
render + CSS + i18n + test change only.

## Why this card

Chosen by the owner after a 40- then 100-variant mock review, and validated by
the deep-research pass (2026-08-03): for a boutique resort, price-forward with
absolute-€ savings and a quiet anchor reads more premium than a percentage
chip. Whole numbers, restraint, no urgency.

## Card anatomy

Top → bottom. Every row is omitted when its source field is blank, except the
hero (required).

| Slot        | Source (sheet col)        | Rendering                                             | Blank behavior |
|-------------|---------------------------|-------------------------------------------------------|----------------|
| eyebrow     | B Dates                   | muted uppercase, letter-spaced                        | omit row |
| struck      | D Price before            | `€400`, line-through, small, muted                    | omit row |
| **hero**    | E Price after             | `€320`, Marcellus serif, ~3.6rem, `--primary-deep`    | **card not rendered** |
| save pill   | derived (D − E)           | sage pill, `Save €80` (see fallback)                  | see rules |
| pct line    | C Discount %              | small muted line, `20% off`                           | omit row |
| divider     | —                         | 40px hairline rule                                    | always (only if any row follows) |
| nights      | F Nights                  | `4 nights`                                            | omit row |
| message     | G Message                 | small italic sage line                                | omit row |

### Save-pill rules (locked)

1. **Default:** if BOTH `priceBefore` and `priceAfter` are present and numeric
   and `priceBefore > priceAfter`, the pill shows the absolute euro saving:
   `Save €{priceBefore − priceAfter}` (e.g. `Save €80`).
2. **Fallback:** if `priceBefore` is blank/non-numeric (so no euro saving can
   be derived) BUT `discountPct` is present, the pill shows `{discountPct}% off`.
3. **No pill:** if neither a euro saving nor a `discountPct` is available, the
   pill is omitted.
4. The pill uses derived-from-prices € as the premium framing; column C is a
   *fallback* for the pill and *also* renders as its own small line (rule below)
   when present — the two can co-exist (pill "Save €80", line "20% off").

### Pct-line rule

- `discountPct` (col C), when present, always renders as a small muted line
  under the pill (`20% off`), regardless of whether the pill showed € or %.
  This means when both prices AND discountPct are present, the card shows a
  `Save €80` pill *and* a `20% off` line — intentional (research: € as hero,
  % as supporting proof). Omitted when `discountPct` blank.

### Numeric parsing (for derived save)

- `priceBefore`/`priceAfter` arrive as raw sheet strings (bare numbers, e.g.
  `"400"`). Parse with `Number(String(v).replace(/[^0-9.]/g, ''))`. Compute the
  saving only when both parse to finite numbers AND `before > after`; otherwise
  fall to the pill fallback. This tolerates a stray `€` or spaces in the sheet
  without throwing.
- The struck/hero prices themselves still render the raw sheet value with a
  `€` prepended by the front-end (unchanged from today: sheet holds bare
  numbers). No `€` is prepended if the raw value already starts with `€`
  (guard against double symbol).

## Degradation floor (locked)

- **price-after required.** In `renderOffers`, an offer whose `priceAfter` is
  blank/`null`/empty is **skipped** (not rendered as a card). If skipping
  leaves zero offers, the section shows the localized empty message (same as a
  zero-offer fetch). This is a front-end guard; the Worker's existing
  all-blank-row drop is unaffected and complementary.
- Because a card without a hero would be meaningless in this design, this is a
  deliberate content rule, not an error.

## Files touched

### `assets/js/offers.js` — rewrite `buildCard`

Replace the field-loop `buildCard` with a structured builder that emits the
Price Hero DOM. Keep the module's existing shape: `renderOffers`,
`buildMessage`, `initOffers`, the fetch flow, and `container.dataset.count`
logic all stay. Only `buildCard` changes, plus:

- `renderOffers` filters offers to those with a non-blank `priceAfter` BEFORE
  setting `dataset.count` and building cards (so count matches rendered cards
  and the empty state triggers if all were dropped).
- A small helper `deriveSave(offer)` returns `{ kind: 'euro', text }` /
  `{ kind: 'pct', text }` / `null` per the pill rules.

**New DOM (per card):**
```html
<article class="offer-card">
  <p class="offer-card__eyebrow">12–18 Jun 2026</p>          <!-- dates -->
  <p class="offer-card__struck">€400</p>                      <!-- priceBefore -->
  <p class="offer-card__hero">€320</p>                        <!-- priceAfter (required) -->
  <p class="offer-card__save">Save €80</p>                    <!-- derived / pct fallback -->
  <p class="offer-card__pct">20% off</p>                      <!-- discountPct -->
  <span class="offer-card__divider" aria-hidden="true"></span>
  <p class="offer-card__nights">4 nights</p>                  <!-- nights -->
  <p class="offer-card__msg">Free breakfast included</p>      <!-- message -->
</article>
```

- Element creation stays within the tiny DOM surface the unit test's fake
  provides (`createElement`, `append`, `textContent`, `className`,
  `dataset`) — no `createTextNode`, no `innerHTML`. The divider is a
  `<span>` with no text.
- Labels/UI copy come from `container.dataset.*` (build-time i18n), NOT a
  runtime dict — same pattern as today. New dataset keys needed:
  `saveLabel` ("Save"), `offLabel` ("off"), `nightsLabel` ("nights"). Values
  compose as `${saveLabel} €80`, `${pct}% ${offLabel}`, `${nights} ${nightsLabel}`.
  Dates, prices, and message render their raw sheet value (no label).

### `index.html` — update `[data-offers]` dataset attrs

The container currently carries `data-i18n-attr` mappings for the old field
labels (`data-label-dates`, `data-label-discount`, …). Replace those with the
three new keys the Price Hero card reads:
`data-save-label`, `data-off-label`, `data-nights-label` (mapped to the new
i18n keys). Keep `data-empty-msg` / `data-error-msg` and the eyebrow/title
`data-i18n` markers on `.offers__head` unchanged.

### `locales/en.json` + `locales/bg.json` — key swap (parity enforced)

Remove the now-unused field-label keys:
`home.offers.label_dates`, `label_discount`, `label_price_before`,
`label_price_after`, `label_nights`, `label_message` (6 keys × 2 locales).

Add:
| Key                    | EN      | BG        |
|------------------------|---------|-----------|
| `home.offers.save`     | Save    | Спестявате |
| `home.offers.off`      | off     | отстъпка  |
| `home.offers.nights`   | nights  | нощувки   |

Keep `eyebrow`, `title`, `empty`, `error`. The i18n plugin enforces EN/BG key
parity and lints markers — both dicts must match. Run `npm run i18n:lint`.

> BG copy note: "Save €80" → "Спестявате €80"; "20% off" → "20% отстъпка";
> "4 nights" → "4 нощувки". Word order in BG puts the suffix after the number,
> same as the compose pattern — verify with the owner if a nuance is off, but
> these are standard.

### `assets/css/sections.css` — swap `.offer-card` internals

Remove `.offer-card__row` and `.offer-card__label` rules. Keep the
`.offer-card` box itself (flex column, 3:4 ratio, width clamp, scroll-snap,
border, radius — the grid/carousel depends on these). Change the inner layout
to center content (the Price Hero is centered) and add:

```css
.offer-card { /* keep box; adjust: */ justify-content: center; text-align: center; gap: 0; }
.offer-card__eyebrow { font-size: 0.65rem; letter-spacing: 2px; text-transform: uppercase; color: var(--text-muted); }
.offer-card__struck  { font-size: 1rem; margin: 0.75rem 0 0.15rem; text-decoration: line-through; color: var(--text-muted); }
.offer-card__hero    { font-family: var(--font-heading); font-size: 3.6rem; line-height: 1; color: var(--primary-deep); }
.offer-card__save    { display: inline-block; align-self: center; margin-top: 0.75rem; font-size: 0.7rem; letter-spacing: 1.5px; text-transform: uppercase; color: #fff; background: var(--secondary); padding: 0.3rem 0.7rem; border-radius: 20px; }
.offer-card__pct     { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin-top: 0.5rem; }
.offer-card__divider { width: 40px; height: 1px; background: var(--border); margin: 1.5rem auto; }
.offer-card__nights  { font-size: 0.85rem; color: var(--text-dark); }
.offer-card__msg     { font-size: 0.78rem; font-style: italic; color: var(--secondary); margin-top: 0.6rem; }
```

- Retune the hero font-size responsively if needed (the card is `clamp(240px,
  78vw, 320px)` wide on touch; 3.6rem fits 240px — verify no overflow on the
  narrowest card).
- The existing `.offers__grid` desktop/touch rules (data-count 1–6) are
  **unchanged** — they lay out whole cards, agnostic to internals.

### `assets/js/__tests__/offers.test.mjs` — rewrite structure assertions

The current tests assert `.offer-card__row` / `.offer-card__label` (old
design). Rewrite for the Price Hero DOM. New cases:
1. Full offer → renders `.offer-card__hero` with `€320`, `.offer-card__struck`
   `€400`, `.offer-card__save` = "Save €80", `.offer-card__pct` = "20% off",
   `.offer-card__nights` = "4 nights", `.offer-card__msg` present.
2. Save derivation: before 400 / after 320 → "Save €80" (euro kind).
3. Pill fallback: priceBefore blank, discountPct 20 → pill shows "20% off"
   (kind pct). Co-occurrence (decisive): full offer with both prices AND
   discountPct 20 → assert BOTH a `.offer-card__save` pill reading "Save €80"
   AND a separate `.offer-card__pct` line reading "20% off" (they co-exist by
   design — € pill as hero, % line as supporting proof).
4. No pill: priceBefore blank AND discountPct blank → no `.offer-card__save`.
5. Blank omission: only `priceAfter` present → hero only, no struck/save/pct/
   nights/msg rows, no divider.
6. **Price-after required:** an offer with `priceAfter` null is dropped —
   `renderOffers` with `[{after present}, {after null}]` renders 1 card and
   `dataset.count === '1'`.
7. All offers lack price-after → empty message shown, `dataset.count === '0'`.
8. Labels come from dataset (`saveLabel`/`offLabel`/`nightsLabel`) — set custom
   dataset values, assert composed text uses them.
9. € guard: priceAfter `"€320"` (already prefixed) → hero shows `€320`, not
   `€€320`.

Keep the existing fetch/no-op/error tests as-is (they don't touch card
internals).

## Non-goals / unchanged

- Worker `/offers`, `sheets.js`, `offers.js` (worker), `wrangler.toml`, caching.
- The sheet contract and `'Offers'!B3:H8` range.
- `.offers` section, `.offers__head`, `.offers__grid` layout, empty/error
  message rendering, `initOffers` fetch flow, `dataset.count` mechanism.
- The 8 entry pages (offers is home-only).

## Testing & verification

- **Unit:** rewritten `offers.test.mjs` (cases above), all green under `npm test`.
- **i18n:** `npm run i18n:lint` clean after the key swap; EN/BG parity.
- **Build:** `npm run build` clean (both locales).
- **Playwright (Firefox):** render 1–6 offers across desktop grid + touch
  carousel; verify Price Hero layout, blank-field omission, price-after-drop,
  save-€ pill, and no content clipping at the 240px card width.
- **Done gate:** build clean · `npm test` green · `i18n:lint` clean ·
  Playwright buckets pass.

## Edge cases

- Offer with only `priceAfter` → single hero, nothing else. Renders.
- Offer with `priceAfter` but `priceBefore < priceAfter` (bad data) → no euro
  saving (guard `before > after`); pill falls to `discountPct` if present, else
  no pill. Struck price still shows the raw `priceBefore` (design choice: we
  don't hide a present field, we only skip the *derived* saving).
- `discountPct` present but `0` → renders "0% off"? Treat `0`/blank the same:
  omit pct line and pct-fallback when the parsed number is not > 0.
- Non-numeric price (e.g. "call us") → hero renders the raw text; no euro
  saving derivable → pill fallback/omit as usual. (Unusual, but degrades.)
- All offers dropped for missing price-after → localized empty message.

## Open items (non-blocking)

- Exact BG wording for "Save"/"off"/"nights" — owner may refine; defaults given.
- Hero font-size fine-tuning on the narrowest (240px) touch card — settle in
  Playwright during implementation.
