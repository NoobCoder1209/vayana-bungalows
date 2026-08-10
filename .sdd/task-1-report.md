# Task 1 Report — Migrate Worker offers reader to 13-column schema

## Status: DONE

## Final offer shape (exact keys emitted per ELIGIBLE offer, sheet order)
```js
{
  label,          // string (A)
  startDate,      // ISO "YYYY-MM-DD" (B serial → ISO); real date required for eligibility
  endDate,        // ISO "YYYY-MM-DD" (C serial → ISO)
  startRaw,       // string — mirrors ISO startDate for eligible offers (free-text offers dropped)
  endRaw,         // string — mirrors ISO endDate
  rate,           // Number — per-night price from the tier G names (D/E/F)
  tier,           // "High" | "Mid" | "Low" (canonical casing)
  minimumToBook,  // Number (H)
  paidNights,     // Number (I)
  freeNights,     // Number (J)
  method,         // "V1" | "V2"
}
```
This is the contract downstream frontend tasks consume.

## serial→ISO helper
```js
export function serialToISO(serial): string | null
```
- Sheets epoch `Date.UTC(1899,11,30)`; `iso = new Date(epoch + serial*86400000).toISOString().slice(0,10)`.
- Guards: non-number / non-finite (NaN, Infinity) / string / blank → `null`. Round-trip validated via `Date.parse(iso)`.
- Exported so it is unit-tested directly (46204 → 2026-07-01, 46210 → 2026-07-07).

## Tier → rate resolution
Case-insensitive lookup table mapping the Price Tier label (G) to canonical
casing + the price-column index: `high→D(idx3)`, `mid→E(idx4)`, `low→F(idx5)`.
Unknown/blank tier → drop. Selected price coerced via `toNumber()` (numbers
pass through; defensive strip of non-numeric for a leaked formatted string
like "100.00€"); must be `> 0` else drop.

## Method resolution
`toBool()` accepts real booleans (UNFORMATTED_VALUE) and string 'TRUE'/'true'.
K only → V1; L only → V2; both → V1 wins; neither → drop.

## Eligibility gate (all must hold, else silently DROP; never throws)
1. Enabled (M) trimmed+lowercased === 'true'.
2. Real Start (B) AND End (C) — both `serialToISO` non-null.
3. Tier ∈ {High,Mid,Low} AND matching D/E/F price > 0.
4. Exactly one method (both → V1, neither → drop).
5. minimumToBook ≥ 1 AND paidNights ≥ 1.

## fetchOffers changes
- Range `'<tab>'!B3:H8` → `'<tab>'!A3:M8`.
- URL now appends `&valueRenderOption=UNFORMATTED_VALUE` (kept `majorDimension=ROWS`).
- Preserved: generic-only catch logging (never err.message), generic Error on
  config-missing/token/fetch/parse → 502 in route, 200-with-no-`values[]` → `[]`.
- `worker/src/index.js` route handler left untouched (verified it JSON-wraps the result).

## Deviations from brief
None material. Additions beyond the literal spec:
- `serialToISO` is exported (brief said "add a helper"; exporting enables the
  required direct unit test of serial correctness).
- Added an integration test asserting the URL carries `A3:M8` +
  `valueRenderOption=UNFORMATTED_VALUE` (belt-and-braces on the reader change).
- `freeNights` is coerced via `toNumber` (may be null if the cell is blank);
  it is not part of the eligibility gate, matching the brief.

## Test command + pass counts
- Task file: `cd /tmp/vayana-fresh && node --test worker/__tests__/offers.test.mjs` → 29 pass, 0 fail.
- Full worker suite: `node --test worker/__tests__/*.test.mjs` → 71 pass, 0 fail (baseline was 57; +14 from expanded offers tests). locale + append-row unchanged and green.

## Concerns
- `startRaw`/`endRaw` mirror the ISO dates for eligible offers (free-text
  offers are dropped by rule 2, so raw can never carry free text here). If a
  future phase wants the *pre-serialization* raw for eligible rows, that would
  need UNFORMATTED_VALUE + FORMATTED_VALUE dual-read — out of scope for Task 1.
- `Number.isFinite(46204)` etc. assume the sheet stays on the 1899-12-30 epoch
  (not the 1904 date system). Consistent with the brief.
