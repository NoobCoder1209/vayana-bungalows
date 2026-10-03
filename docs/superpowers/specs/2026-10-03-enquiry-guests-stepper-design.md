# Enquiry form: Guests stepper popover + Pets column

**Date:** 2026-10-03
**Page:** `/enquiries/` (EN) + `/bg/enquiries/` (BG mirror)
**Status:** design — awaiting review

## Goal

Replace the three separate guest `<select>` fields (Adults / Children /
Infants) with a **single "GUESTS" field** that opens an Airbnb-style
**stepper popover** (−/count/+ per category), and add a **fourth
category, Pets**. All four counts flow through to their own columns in
the Google Sheet. A new **Pets** column is inserted between Infants and
Message, growing the sheet row from A:O (15 cols) to **A:P (16 cols)**.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Widget | Airbnb-style stepper popover, single `GUESTS*` trigger pill |
| Categories | Adults, Children, Infants, **Pets** (new) |
| Initial counts | Adults **1** (min 1, required), Children 0, Infants 0, Pets 0 |
| Limits | Adults + Children **≤ 4**; Infants **≤ 2** (independent); Pets **≤ 2** (independent); Adults min **1** |
| Captions | Adults "Ages 13+", Children "Ages 2–12", Infants "Under 2", Pets "Max 2" |
| Pill summary | `N Guests` where **Guests = adults + children + infants**, plus `/ M Pet(s)` only when pets ≥ 1. Pluralised. Examples: `1 Guest`, `3 Guests`, `4 Guests / 2 Pets` |
| Pets sheet format | Numeric 0–2, new Column **K** |
| Service-animal note | No (plain "Pets") |

## Data contract (unchanged field names + one new)

The submit payload keeps string values keyed `adults`/`children`/
`infants`, and adds `pets`. Values are now sourced from **hidden inputs**
written by the stepper, not from `<select>.value`. The Worker's accepted
range widens: adults `1..4`, children/infants/pets `0..2` (and `-`/`''`
still normalise to `0` for back-compat — see Worker section).

## Section 1 — Markup (`enquiries/index.html`)

Replace the entire `.enquiry-form__guests` block (3 `<select>`s, ~lines
299–341) with one full-width field:

```html
<!-- 4–7. Guests — single field opening an Airbnb-style stepper popover.
     Four hidden inputs (adults/children/infants/pets) are the single
     source of truth the submit handler reads; the stepper writes to
     them. Adults is required (min 1); the others start at 0. Limits:
     adults+children ≤ 4, infants ≤ 2, pets ≤ 2. See assets/js/enquiry.js
     (data-enquiry-guests-* hooks). -->
<div class="enquiry-form__field enquiry-form__field--full enquiry-form__guests"
     data-enquiry-guests>
  <input type="hidden" name="adults"   value="1" data-enquiry-adults />
  <input type="hidden" name="children" value="0" data-enquiry-children />
  <input type="hidden" name="infants"  value="0" data-enquiry-infants />
  <input type="hidden" name="pets"     value="0" data-enquiry-pets />

  <button type="button" class="enquiry-form__guests-toggle"
          data-enquiry-guests-toggle
          aria-haspopup="dialog" aria-expanded="false"
          aria-controls="eq-guests-popover">
    <span class="enquiry-form__guests-summary" data-enquiry-guests-summary>
      <!-- JS writes "1 Guest" etc. JS-off fallback below. -->
      GUESTS*
    </span>
    <span class="enquiry-form__guests-caret" aria-hidden="true"><!-- chevron SVG --></span>
  </button>

  <div class="enquiry-form__guests-popover" id="eq-guests-popover"
       role="dialog" aria-label="Choose guests"
       data-i18n-attr="aria-label:enquiries.a11y.guests_dialog_aria"
       data-enquiry-guests-popover hidden>
    <!-- one .enquiry-form__guests-row per category, data-guest-row="adults" … -->
    <div class="enquiry-form__guests-row" data-guest-row="adults">
      <div class="enquiry-form__guests-meta">
        <span class="enquiry-form__guests-label"  data-i18n="enquiries.guests.adults_label">Adults</span>
        <span class="enquiry-form__guests-caption" data-i18n="enquiries.guests.adults_caption">Ages 13 or above</span>
      </div>
      <div class="enquiry-form__guests-stepper">
        <button type="button" class="enquiry-form__guests-dec" data-guest-dec
                aria-label="Decrease adults"
                data-i18n-attr="aria-label:enquiries.a11y.guests_dec_adults">&minus;</button>
        <output class="enquiry-form__guests-count" data-guest-count aria-live="off">1</output>
        <button type="button" class="enquiry-form__guests-inc" data-guest-inc
                aria-label="Increase adults"
                data-i18n-attr="aria-label:enquiries.a11y.guests_inc_adults">+</button>
      </div>
    </div>
    <!-- children / infants / pets rows identical shape -->
  </div>

  <!-- Single polite live region for the whole popover; JS writes
       "Adults, 2" on each change so AT users hear the new count. -->
  <span class="sr-only" aria-live="polite" data-enquiry-guests-live></span>
</div>
```

**JS-off fallback:** with JS disabled the submit button already ships
`disabled` and the `<noscript>` mailto block is the CTA, so the popover
never needing to open without JS is consistent with the existing design.
The toggle button shows the literal `GUESTS*` placeholder text; the
hidden inputs carry the sensible defaults (adults=1). No regression —
the no-JS path could never submit anyway (Turnstile needs JS).

**a11y:** the toggle is a disclosure (`aria-expanded` + `aria-controls`).
The popover is `role="dialog"` with an `aria-label`. Steppers are real
`<button>`s with per-button `aria-label`s. Counts render in `<output>`
(semantic for computed values) with a shared polite live region for
announcements. Disabled bound-buttons get `disabled` + `aria-disabled`.

## Section 2 — JS (`assets/js/enquiry.js`)

New self-contained `setupGuests(form)` helper wiring the popover; called
from `initEnquiry()` after the element lookups.

**State:** read initial counts from the four hidden inputs
(`adults=1, others=0`). Keep an in-memory `counts` object; the hidden
inputs are the serialisation target (written on every change so the
submit payload + any bfcache snapshot are always current).

**Limits (per category):**
- `adults`: min **1**, and `adults + children ≤ 4`
- `children`: min 0, and `adults + children ≤ 4`
- `infants`: 0..2
- `pets`: 0..2

After each change, recompute each button's disabled state:
- `−` disabled when at the category min (adults→1, others→0)
- `+` disabled when at the category max (adults/children → when
  `adults+children === 4`; infants → 2; pets → 2)

**Summary string:** `guests = adults + children + infants`;
`N Guest(s)` + (pets ≥ 1 ? ` / M Pet(s)` : ''). Pluralisation uses the
i18n singular/plural keys (`guests.summary_guest` /
`guests.summary_guests`, `guests.summary_pet` / `guests.summary_pets`),
with a count placeholder `%N%`. Written to `[data-enquiry-guests-summary]`.

**Open/close:**
- Toggle click flips `hidden` on the popover + `aria-expanded`.
- Close on: outside pointerdown (not inside the field), `Escape`
  (returns focus to the toggle), and `focusout` leaving the field.
- Opening moves focus to the first `+/−` control.

**Validation (submit handler):** the existing adults gate
(`ALLOWED_ADULTS` → `1..4`) stays, now reading the hidden input. Add
belt-and-braces clamps so a DevTools-tampered hidden value can't break
the contract: coerce each to int, enforce the same bounds, reject out of
range (adults falls back to the existing `ADULTS_ERROR_MSG`). Payload
gains `pets: pets.value`.

**Retire the bfcache select-snapshot block (lines ~476–522 +
`SELECT_SNAPSHOT_KEY` refs in `successPath`).** That code exists only
because `disabled+selected+hidden` placeholder `<select>`s lose state on
bfcache restore. Hidden inputs keep their `.value` in the bfcache
snapshot natively, so the whole snapshot/restore dance (and its
`sessionStorage` read/write) is no longer needed. On success,
`successPath()` resets the four hidden inputs back to defaults
(adults=1, rest=0), re-syncs the summary + button states, and closes the
popover. (Removing the sessionStorage calls also removes a private-mode
Safari failure surface.)

**`allFields` / error focus:** the adults `<select>` reference in
`allFields` becomes the toggle button (so `aria-invalid` + `.focus()` on
an adults error land on the visible control, not an invisible hidden
input).

## Section 3 — i18n (`locales/en.json` + `locales/bg.json`)

Add an `enquiries.guests` group + new `a11y` keys. **Remove** the now-unused
`form.adults_placeholder` / `children_placeholder` / `infants_placeholder`
and `a11y.adults_label` / `children_label` / `infants_label` (replaced by
the guests group). BG values keep the `Код NNN·` tracer prefix per the
standing rule; **new BG codes start at 634** (current max is 633).

EN additions:
```json
"enquiries": {
  "guests": {
    "toggle_placeholder": "GUESTS*",
    "adults_label": "Adults",    "adults_caption": "Ages 13 or above",
    "children_label": "Children", "children_caption": "Ages 2 – 12",
    "infants_label": "Infants",  "infants_caption": "Under 2",
    "pets_label": "Pets",        "pets_caption": "Max 2",
    "summary_guest": "%N% Guest", "summary_guests": "%N% Guests",
    "summary_pet": "%N% Pet",     "summary_pets": "%N% Pets",
    "summary_join": " / "
  },
  "a11y": {
    "guests_dialog_aria": "Choose guests",
    "guests_toggle_aria": "Guests — %SUMMARY%",
    "guests_dec_adults": "Decrease adults", "guests_inc_adults": "Increase adults",
    "guests_dec_children": "Decrease children", "guests_inc_children": "Increase children",
    "guests_dec_infants": "Decrease infants", "guests_inc_infants": "Increase infants",
    "guests_dec_pets": "Decrease pets", "guests_inc_pets": "Increase pets",
    "guests_live": "%LABEL%, %N%"
  }
}
```
BG mirror with `Код 634·`… prefixes, same keys. `npm run i18n:lint` must
stay green (locale parity).

## Section 4 — Worker (`worker/src/validation.js` + `sheets.js`)

**validation.js:**
- Add `const ALLOWED_PETS = new Set(['', '-', '0', '1', '2']);` and widen
  children/infants to the same 0..2 set? **No** — keep children/infants
  as-is (`ALLOWED_OPTIONAL_COUNT` already accepts 0..4; our client only
  ever emits 0..2 but accepting the wider historical range is harmless
  and avoids rejecting legacy/third-party bodies). Add a dedicated
  `ALLOWED_PETS` (0..2) and `cleaned.pets = normaliseOptionalCount(petsRaw)`.
- Children stays bounded by the client UI (adults+children ≤ 4); the
  Worker does not enforce the *sum* (it never did a cross-field check and
  the sheet is advisory). Documented in a comment.
- `cleaned` key order: insert `pets` right after `infants` so the
  spread into the row keeps columns in order.

**sheets.js:**
- Range `A:O` → **`A:P`**.
- Insert `row.pets` into the `values` array between `row.infants` and
  `row.message`.
- Update the column-map comment block to the new 16-column layout:
  `A timestamp | B bungalow | C name | D email | E phone | F checkin |
  G checkout | H adults | I children | J infants | K pets | L message |
  M price | N consent | O source_ip_hash | P locale`.

**index.js:** no change — it builds the row as
`{ timestamp, ...validation.cleaned, source_ip_hash }`; `pets` rides in
via the spread. (Order in the sheet is governed by the `values` array in
`sheets.js`, not object key order, so this is safe.)

## Section 5 — Tests + sheet column change

**Automated (must stay green, 557 baseline + new):**
- `worker/__tests__/append-row.test.mjs`: update every `row.length`
  assertion `15 → 16`, every "A:O" → "A:P", shift price/consent/ip/locale
  index assertions right by 1 (price 11→12, etc.), add a `pets` field to
  the valid body + assert Column K (index 10) carries it.
- `worker/__tests__/locale.test.mjs`: add `pets: '0'` to the sample body
  (keeps it a valid submission).
- `assets/js/__tests__/enquiry-errors.test.mjs`: this parses the HTML and
  asserts on the `data-err-*` attributes — add nothing unless we add new
  error keys (we reuse `ADULTS_ERROR_MSG`). Verify it still passes against
  the new markup (no `<select>` assertions there).
- `scripts/__tests__/i18n-plugin.test.mjs` + i18n-lint: run; fix any key
  that references removed placeholders.
- Add a focused **new** test `assets/js/__tests__/enquiry-guests.test.mjs`
  (jsdom) covering: initial summary "1 Guest"; increment adults → "2
  Guests"; adults+children clamp at 4 (+ disabled); infants/pets clamp at
  2; summary "3 Guests / 1 Pet"; hidden inputs updated; adults `−`
  disabled at 1. **Register it in `package.json`'s test list.**

**Sheet edit (I do it via gsheets MCP — the Enquires tab lives in the
already-authorized spreadsheet `1d_NAxImy1UbRx70os2sXxWRweduqWevQPR0v6fG7Ew8`,
same workbook as the calendar/offers tabs per `worker/.dev.vars.example`):**
insert a new **"Pets"** header column between "Infants" (J) and "Message"
so existing columns K→O shift to L→P and the Worker's A:P append lines up.
Steps: `get_metadata` → find the Enquires tab `sheet_id`; read row 1 to
locate the "Infants" column index; `insert_dimension` (COLUMNS, one blank
after Infants); `write_range` the "Pets" header into the new cell; read
back row 1 to verify alignment. **Ordering is load-bearing: shift the
header FIRST, then merge the Worker A:P change** — otherwise new rows
write Pets into the old Message column. **Blocker:** the gsheets MCP token
is currently `invalid_grant`; user refreshes auth before this step runs.

## Section 6 — CSS (`assets/css/sections.css`)

Replace the `.enquiry-form__guests` 3-col grid rule with the popover
styling: the full-width toggle pill (matching the existing input pills —
same border/radius/min-height), a chevron, and an absolutely-positioned
popover card (white bg, border, radius, soft shadow, `z-index` above the
form) with stacked rows: label+caption on the left, `[− count +]` stepper
on the right. Circular `−/+` buttons (reuse muted-border tokens),
`:disabled` dimmed. Mobile: popover goes full-width under the toggle.
Keep `--flip`/RTL-agnostic (flex rows, logical spacing). Remove the old
`select` appearance-reset rules only if nothing else uses `<select>` on
this page (verify — contacts/other pages may; the rule is page-scoped by
`.enquiry-form__field select` so it's safe to leave, but the guests-
specific grid rule is replaced).

## Verification

- `npm run build` clean; `npm run i18n:lint` green; `npm test` green
  (updated + new tests).
- `npm run dev` → `/enquiries/`: pill shows "1 Guest"; open popover,
  step counts, verify all four limits + disabled states; summary updates
  live ("3 Guests / 1 Pet"); EN + BG; `--flip` not applicable here but
  check BG. Submit a real enquiry end-to-end against the Worker (or a
  mocked endpoint) and confirm the payload carries `pets`.
- Firefox eyeball per repo convention; bfcache: navigate away + Back,
  confirm counts persist (hidden inputs survive natively) and no console
  error from the removed sessionStorage code.
- Live (post-merge, after sheet header shifted): submit one enquiry,
  confirm the row lands with Pets in Column K and everything else aligned
  through Column P.

## Delivery

Feature branch `feature/enquiry-guests-stepper` → PR → pr-reviewer gate
(fix all findings) → `/security-review` → merge only on explicit "merge"
→ verify live. **Coordinate the sheet-header shift with the merge** (shift
first).
