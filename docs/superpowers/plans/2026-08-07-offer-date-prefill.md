# Offer Date Prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a guest clicks "Take the offer", the enquiry form's date pickers prefill with the offer's dates.

**Architecture:** The Offers-sheet `Dates` cell becomes a strict ISO range (`YYYY-MM-DD/YYYY-MM-DD`). A new dependency-free frontend util parses that cell into two ISO dates (for the `?checkin=&checkout=` link params that `enquiry.js` already consumes) and formats it into a localized display string for the card/modal. Malformed/freehand cells fail safe: raw text shown, prefill skipped. No Worker change.

**Tech Stack:** Vanilla ESM, Vite multi-page build, `node:test` + `node:assert/strict`, `Intl.DateTimeFormat` for localized month names.

## Global Constraints

- No new dependencies — util is dependency-free vanilla ESM (`Intl` is built-in).
- No new locale keys — the helper is code, not copy (`npm run i18n:lint` must stay green).
- No Worker change — the Worker returns `offer.dates` raw; all parse/format is client-side.
- `enquiry.js` MUST NOT change — its shipped `?checkin/?checkout` reader (lines 373-408) does the prefill and is the booking-date authority.
- EN display format: `15 Jun 2027 – 20 Jun 2027` (en-dash ` – ` separator).
- BG display format: `15 юни 2027 - 20 юни 2027` (plain hyphen ` - `, NO trailing ` г.` era suffix).
- Fail-safe contract: any cell that is not a valid ISO range (blank, freehand, single date, reversed, impossible date) → `formatOfferDates` returns the raw input unchanged and `parseOfferDates` returns `null` (no prefill). NEVER throw, NEVER break an offer.
- Branch `feature/offer-date-prefill` (already created; spec already committed there). PR to `main`, owner `NoobCoder1209`, squash-merge. Do NOT merge until CI green AND owner approves.
- After PR is raised: run pr-reviewer, list ALL findings to owner, fix NOTHING until owner selects.

---

## File Structure

- **Create** `assets/js/util/offer-dates.js` — the pure parse + format helper. One responsibility: turn a raw `Dates` cell into either `{checkin, checkout}` ISO (for prefill) or a display string (for rendering), with a hard fail-safe.
- **Create** `assets/js/util/__tests__/offer-dates.test.mjs` — unit tests for the helper in isolation.
- **Modify** `assets/js/offer-modal.js` — import the helper; use formatted dates for the modal slots + callout + `?offer=` prose; emit `?checkin=&checkout=` in `buildEnquiryUrl`.
- **Modify** `assets/js/offers.js` — import `currentLocale` + `formatOfferDates`; format the card eyebrow.
- **Modify** `assets/js/__tests__/offer-modal.test.mjs` — assert the two date params for an ISO-range offer; none for freehand.
- **Modify** `assets/js/__tests__/offers.test.mjs` — add a `documentElement` stub to the DOM fake (needed once the eyebrow calls `currentLocale()`); assert pretty eyebrow for an ISO-range offer, raw for freehand.

---

## Task 1: The `offer-dates` util (parse + format)

**Files:**
- Create: `assets/js/util/offer-dates.js`
- Test: `assets/js/util/__tests__/offer-dates.test.mjs`

**Interfaces:**
- Consumes: nothing (dependency-free; uses built-in `Intl.DateTimeFormat`).
- Produces:
  - `parseOfferDates(raw: string) => { checkin: string, checkout: string } | null` — `checkin`/`checkout` are `YYYY-MM-DD` ISO strings; `null` when `raw` is not a valid strictly-increasing ISO range of two real calendar dates.
  - `formatOfferDates(raw: string, locale: string) => string` — localized display string when `raw` is a valid range, else `raw` returned unchanged. `locale` is `'en'` | `'bg'` (unknown → EN formatting).

- [ ] **Step 1: Write the failing tests**

Create `assets/js/util/__tests__/offer-dates.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfferDates, formatOfferDates } from '../offer-dates.js';

// ── parseOfferDates ───────────────────────────────────────────────────────

test('parseOfferDates: valid ISO range → {checkin, checkout}', () => {
  assert.deepEqual(parseOfferDates('2027-06-15/2027-06-20'), {
    checkin: '2027-06-15',
    checkout: '2027-06-20',
  });
});

test('parseOfferDates: tolerates surrounding whitespace around each half', () => {
  assert.deepEqual(parseOfferDates('  2027-06-15 / 2027-06-20 '), {
    checkin: '2027-06-15',
    checkout: '2027-06-20',
  });
});

test('parseOfferDates: blank / null / undefined → null', () => {
  assert.equal(parseOfferDates(''), null);
  assert.equal(parseOfferDates(null), null);
  assert.equal(parseOfferDates(undefined), null);
});

test('parseOfferDates: freehand display string → null', () => {
  assert.equal(parseOfferDates('12–18 Jun'), null);
  assert.equal(parseOfferDates('12–18 June 2026'), null);
});

test('parseOfferDates: single date (no range) → null', () => {
  assert.equal(parseOfferDates('2027-06-15'), null);
});

test('parseOfferDates: reversed order (checkout <= checkin) → null', () => {
  assert.equal(parseOfferDates('2027-06-20/2027-06-15'), null);
  assert.equal(parseOfferDates('2027-06-15/2027-06-15'), null); // equal = not a range
});

test('parseOfferDates: impossible calendar date → null (Feb 30 does not roll over)', () => {
  assert.equal(parseOfferDates('2027-02-30/2027-03-05'), null);
});

test('parseOfferDates: non-ISO-shaped halves → null', () => {
  assert.equal(parseOfferDates('2027/6/15/2027/6/20'), null);
  assert.equal(parseOfferDates('27-06-15/27-06-20'), null);
});

// ── formatOfferDates ──────────────────────────────────────────────────────

test('formatOfferDates: EN valid range → "15 Jun 2027 – 20 Jun 2027" (en-dash)', () => {
  assert.equal(
    formatOfferDates('2027-06-15/2027-06-20', 'en'),
    '15 Jun 2027 – 20 Jun 2027',
  );
});

test('formatOfferDates: BG valid range → "15 юни 2027 - 20 юни 2027" (hyphen, no г.)', () => {
  const out = formatOfferDates('2027-06-15/2027-06-20', 'bg');
  assert.equal(out, '15 юни 2027 - 20 юни 2027');
  assert.ok(!out.includes('г.'), 'BG format must not carry the "г." era suffix');
  assert.ok(!out.includes('–'), 'BG format uses a plain hyphen, not an en-dash');
});

test('formatOfferDates: unknown locale falls back to EN formatting', () => {
  assert.equal(
    formatOfferDates('2027-06-15/2027-06-20', 'fr'),
    '15 Jun 2027 – 20 Jun 2027',
  );
});

test('formatOfferDates: freehand / blank / malformed → raw input returned unchanged', () => {
  assert.equal(formatOfferDates('12–18 Jun', 'en'), '12–18 Jun');
  assert.equal(formatOfferDates('', 'en'), '');
  assert.equal(formatOfferDates('2027-02-30/2027-03-05', 'en'), '2027-02-30/2027-03-05');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test assets/js/util/__tests__/offer-dates.test.mjs`
Expected: FAIL — `Cannot find module '../offer-dates.js'`.

- [ ] **Step 3: Write the implementation**

Create `assets/js/util/offer-dates.js`:

```javascript
// Parse + format the Offers-sheet `Dates` cell (Column B).
//
// The cell is a strict single-cell ISO range: `YYYY-MM-DD/YYYY-MM-DD`
// (e.g. "2027-06-15/2027-06-20"). This is the machine-readable contract that
// lets "Take the offer" prefill the enquiry date pickers. Two consumers:
//   - parseOfferDates → the ?checkin/?checkout link params (offer-modal.js)
//   - formatOfferDates → the pretty display on the card / modal / ?offer= prose
//
// SOFT contract: anything that is not a valid strictly-increasing range of two
// real calendar dates fails safe — parseOfferDates returns null (no prefill)
// and formatOfferDates returns the raw input unchanged (old freehand cells
// keep rendering verbatim). Never throws. Dependency-free (Intl is built-in).

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real-calendar-date check via UTC round-trip: rejects 2027-02-30 (which a
// naive `new Date(2027, 1, 30)` would silently roll to Mar 2). Returns a UTC
// Date on success, or null.
function toRealDate(iso) {
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/**
 * Split a raw `Dates` cell into { checkin, checkout } ISO strings, or null.
 * Requires exactly two `/`-separated ISO halves, both real dates, checkout
 * strictly after checkin.
 */
export function parseOfferDates(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('/');
  if (parts.length !== 2) return null;
  const a = parts[0].trim();
  const b = parts[1].trim();
  const da = toRealDate(a);
  const db = toRealDate(b);
  if (!da || !db) return null;
  if (db.getTime() <= da.getTime()) return null;
  return { checkin: a, checkout: b };
}

// Locale → Intl locale tag. Unknown locales fall back to English.
const INTL_LOCALE = { en: 'en-GB', bg: 'bg-BG' };

// Format one UTC ISO date as "15 Jun 2027" (EN) / "15 юни 2027" (BG, no era).
function formatOne(iso, locale) {
  const dt = toRealDate(iso);
  const tag = INTL_LOCALE[locale] || INTL_LOCALE.en;
  const parts = new Intl.DateTimeFormat(tag, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(dt);
  // Build from parts so we control the exact glue and drop any BG era/literal
  // artifacts ("г."): keep only day, month, year, in that order, space-joined.
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return `${day} ${month} ${year}`;
}

/**
 * Localized display string for a valid range, else the raw input unchanged.
 * EN joins with an en-dash " – "; BG joins with a plain hyphen " - ".
 */
export function formatOfferDates(raw, locale) {
  const range = parseOfferDates(raw);
  if (!range) return raw;
  const sep = locale === 'bg' ? ' - ' : ' – ';
  return `${formatOne(range.checkin, locale)}${sep}${formatOne(range.checkout, locale)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test assets/js/util/__tests__/offer-dates.test.mjs`
Expected: PASS (all cases). If the BG month name or spacing differs from `15 юни 2027` on the runner's ICU build, adjust the assertion to the exact `formatToParts` output — the CONTRACT is "no `г.`, hyphen separator, day-month-year order", not a byte-for-byte ICU string. Confirm the actual output and pin the test to it.

- [ ] **Step 5: Commit**

```bash
git add assets/js/util/offer-dates.js assets/js/util/__tests__/offer-dates.test.mjs
git commit -m "feat(offers): add offer-dates parse+format util

parseOfferDates splits a strict ISO range (YYYY-MM-DD/YYYY-MM-DD) into
checkin/checkout for enquiry prefill; formatOfferDates renders it as a
localized display string (EN en-dash, BG hyphen no era). Malformed/freehand
cells fail safe: null / raw passthrough."
```

---

## Task 2: Wire prefill + formatting into the offer modal

**Files:**
- Modify: `assets/js/offer-modal.js` (import line 17; `buildEnquiryUrl` lines 27-56; `openOfferModal` slots lines 107 + 119-121)
- Test: `assets/js/__tests__/offer-modal.test.mjs`

**Interfaces:**
- Consumes: `parseOfferDates`, `formatOfferDates` from `./util/offer-dates.js` (Task 1); `currentLocale` from `./util/current-locale.js` (already imported).
- Produces: `buildEnquiryUrl(offer, takeMsg)` now additionally sets `checkin` and `checkout` search params when `offer.dates` is a valid ISO range; the `?offer=` prose and modal date slots show the formatted string.

- [ ] **Step 1: Write the failing tests**

Append to `assets/js/__tests__/offer-modal.test.mjs` (the file already stubs `window`/`document.documentElement`):

```javascript
test('ISO-range offer: buildEnquiryUrl emits checkin/checkout + pretty prose (EN)', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(
    { dates: '2027-06-15/2027-06-20', priceBefore: null, priceAfter: '320', nights: null, message: null },
    "I'm taking the offer",
  );
  const url = new URL(href);
  assert.equal(url.searchParams.get('checkin'), '2027-06-15');
  assert.equal(url.searchParams.get('checkout'), '2027-06-20');
  // Prose carries the FORMATTED range, not the raw ISO.
  const msg = url.searchParams.get('offer');
  assert.ok(msg.includes('15 Jun 2027 – 20 Jun 2027'), 'prose shows pretty dates');
  assert.ok(!msg.includes('2027-06-15/2027-06-20'), 'prose does not leak raw ISO');
});

test('freehand-dates offer: buildEnquiryUrl emits NO checkin/checkout, prose keeps raw text', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(
    { dates: '12–18 June 2026', priceBefore: null, priceAfter: '320', nights: null, message: null },
    "I'm taking the offer",
  );
  const url = new URL(href);
  assert.equal(url.searchParams.get('checkin'), null);
  assert.equal(url.searchParams.get('checkout'), null);
  // Freehand passes through unchanged (formatOfferDates returns raw).
  assert.ok(url.searchParams.get('offer').includes('12–18 June 2026'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test assets/js/__tests__/offer-modal.test.mjs`
Expected: FAIL — the new `checkin`/`checkout` params are `null` (not yet emitted); the pretty-prose assertion fails (prose still raw).

- [ ] **Step 3: Update the import**

In `assets/js/offer-modal.js` line 17, add the util import below the existing offers import:

```javascript
import { euro, deriveSave, parsePrice } from './offers.js';
import { parseOfferDates, formatOfferDates } from './util/offer-dates.js';
```

- [ ] **Step 4: Emit checkin/checkout + format prose in `buildEnquiryUrl`**

In `buildEnquiryUrl`, change the prose dates line (currently line 38):

```javascript
  if (offer.dates) parts.push(`Dates: ${formatOfferDates(offer.dates, currentLocale())}`);
```

Then, after the existing `?price=` block (currently ending line 53, before `return url.toString()`), add:

```javascript
  // Structured check-in/check-out for the enquiry date pickers. Only when the
  // Dates cell is a valid ISO range (parseOfferDates returns null for freehand/
  // blank/malformed cells, so those simply don't prefill — same fail-safe as a
  // priceless offer). enquiry.js re-validates these (not past, in-season,
  // checkout > checkin), so it stays the authority on bookable dates.
  const range = parseOfferDates(offer.dates);
  if (range) {
    url.searchParams.set('checkin', range.checkin);
    url.searchParams.set('checkout', range.checkout);
  }
```

- [ ] **Step 5: Format the modal date slots**

In `openOfferModal`, replace the raw-dates uses with formatted ones. Line 107:

```javascript
  setSlot(modal, 'dates', formatOfferDates(offer.dates, currentLocale()));
```

And the callout `<strong>` (lines 119-121) — the `if (offer.dates)` gate stays (it's a truthiness check on the raw cell), only the text becomes formatted:

```javascript
    if (offer.dates) {
      const strong = modal.querySelector('[data-offer-slot="callout-dates"]');
      if (strong) strong.textContent = formatOfferDates(offer.dates, currentLocale());
      callout.removeAttribute('hidden');
    } else {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test assets/js/__tests__/offer-modal.test.mjs`
Expected: PASS — all existing tests (freehand `12–18 June 2026` still appears in prose because `formatOfferDates` returns it unchanged) plus the two new ones.

- [ ] **Step 7: Commit**

```bash
git add assets/js/offer-modal.js assets/js/__tests__/offer-modal.test.mjs
git commit -m "feat(offers): prefill enquiry dates + pretty-format from offer modal

buildEnquiryUrl now emits ?checkin/?checkout when the offer's Dates cell is a
valid ISO range, and the modal slots + ?offer= prose show the localized
display string. Freehand cells prefill nothing and render raw (fail-safe)."
```

---

## Task 3: Format the offer-card eyebrow

**Files:**
- Modify: `assets/js/offers.js` (imports line 13-14; `buildCard` eyebrow line 89)
- Test: `assets/js/__tests__/offers.test.mjs` (DOM fake line 29; add cases)

**Interfaces:**
- Consumes: `formatOfferDates` from `./util/offer-dates.js` (Task 1); `currentLocale` from `./util/current-locale.js`.
- Produces: card eyebrow text is the formatted range for an ISO-range offer, raw for freehand. No signature changes.

- [ ] **Step 1: Add a `documentElement` stub to the test DOM fake, then write the failing tests**

`offers.js` will call `currentLocale()`, which reads `document.documentElement.getAttribute('lang')`. The existing test fake (line 29) only stubs `createElement`, so it would throw. First widen the fake, then add assertions.

In `assets/js/__tests__/offers.test.mjs`, change line 29 from:

```javascript
globalThis.document = { createElement: () => makeEl() };
```

to:

```javascript
globalThis.document = {
  createElement: () => makeEl(),
  // offers.js reads currentLocale() → documentElement.getAttribute('lang')
  // when formatting the dates eyebrow. Default to EN for these render tests.
  documentElement: { getAttribute: (k) => (k === 'lang' ? 'en' : null) },
};
```

Then append these tests to the file:

```javascript
test('ISO-range dates render as a pretty EN eyebrow', () => {
  const c = container();
  renderOffers(c, [{ ...full(), dates: '2027-06-15/2027-06-20' }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__eyebrow'), '15 Jun 2027 – 20 Jun 2027');
});

test('freehand dates render verbatim on the eyebrow (fail-safe)', () => {
  const c = container();
  renderOffers(c, [{ ...full(), dates: '12–18 Jun' }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__eyebrow'), '12–18 Jun');
});
```

Note: the pre-existing `full()` fixture uses `dates: '12–18 Jun 2026'` (freehand) and the existing "full offer" test at line 56 asserts the eyebrow equals that raw string — it stays GREEN because `formatOfferDates` returns freehand unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test assets/js/__tests__/offers.test.mjs`
Expected: the new "pretty EN eyebrow" test FAILS (eyebrow still raw `2027-06-15/2027-06-20`). The `documentElement` stub change means the existing tests still pass rather than throwing.

- [ ] **Step 3: Wire the formatter into `buildCard`**

In `assets/js/offers.js`, add imports (after line 13-14's existing imports):

```javascript
import { SITE_CONFIG } from './site-config.js';
import { openOfferModal } from './offer-modal.js';
import { currentLocale } from './util/current-locale.js';
import { formatOfferDates } from './util/offer-dates.js';
```

Change the eyebrow line (currently line 89):

```javascript
  if (offer.dates) add('offer-card__eyebrow', formatOfferDates(offer.dates, currentLocale()));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test assets/js/__tests__/offers.test.mjs`
Expected: PASS — new pretty/freehand eyebrow tests plus all pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add assets/js/offers.js assets/js/__tests__/offers.test.mjs
git commit -m "feat(offers): pretty-format the offer-card dates eyebrow

Card eyebrow now runs offer.dates through formatOfferDates (localized). ISO
ranges render pretty; freehand cells render verbatim (fail-safe)."
```

---

## Task 4: Full-suite gates + build + Playwright verification

**Files:** none modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test`
Expected: PASS. Local note — the Worker tests import `jose`, which needs `npm ci` inside `worker/` to resolve locally (CI does this). If the offer-dates / offers / offer-modal frontend tests pass and only Worker tests error on a missing `jose`, that's the known local-only gap, not a regression from this change.

- [ ] **Step 2: i18n lint**

Run: `npm run i18n:lint`
Expected: PASS (no new locale keys — the helper is code).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean build; `dist/` regenerated for EN and `/bg/`.

- [ ] **Step 4: Firefox Playwright — happy path (ISO range)**

Serve the built `dist` under the `/vayana-bungalows/` base and drive Firefox (per standing preference: Firefox, no `--isolated`, run the script from `~/.claude/tools` where playwright is installed). Mock `GET /offers` to return one enabled offer with `dates:'2027-06-15/2027-06-20'`, `priceAfter:'400'`.

Assert:
- Home page: `.offer-card__eyebrow` text is `15 Jun 2027 – 20 Jun 2027`.
- Open the modal (click `.offer-card__cta`): the dates slot shows the same pretty string; the fixed-dates callout shows it too.
- Click "Take the offer" (`[data-offer-take]`) and follow the href: on `/enquiries/` the check-in input reads `15/06/2027`, check-out reads `20/06/2027` (flatpickr `d/m/Y`), and the hidden `[data-enquiry-price]` value is `400`.

- [ ] **Step 5: Firefox Playwright — fail-safe (freehand) + BG**

- Freehand offer (`dates:'12–18 Jun'`): card eyebrow shows `12–18 Jun` verbatim; "Take the offer" → `/enquiries/` date pickers are EMPTY (no prefill), no console error.
- `/bg/` home page with the ISO-range offer: `.offer-card__eyebrow` reads `15 юни 2027 - 20 юни 2027` (hyphen, no `г.`).

- [ ] **Step 6: Commit any Playwright fixture/script additions (if a script file was added to the repo)**

If verification only used an ad-hoc script under `~/.claude/tools` (not in the repo), skip. If a fixture landed in the repo, commit it:

```bash
git add <fixture-path>
git commit -m "test(offers): Firefox e2e fixture for offer date prefill"
```

---

## Task 5: Raise the PR and run pr-reviewer

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/offer-date-prefill
```

- [ ] **Step 2: Open the PR to `main`**

```bash
gh pr create --repo <owner>/<repo> --base main --head feature/offer-date-prefill \
  --title "feat(offers): prefill enquiry dates when taking an offer" \
  --body "<summary: ISO-range Dates cell → localized display + ?checkin/?checkout prefill; fail-safe for freehand; no Worker change; manual sheet migration note>"
```

Include in the PR body the manual operator action: switch Offers-tab `Dates` cells to `YYYY-MM-DD/YYYY-MM-DD`; existing freehand cells keep working (raw display, no prefill) until migrated.

- [ ] **Step 3: Run pr-reviewer, list ALL findings**

Dispatch the pr-reviewer against the new PR. Present the complete findings list to the owner. Do NOT fix anything — wait for the owner to specify which findings to address, per the standing workflow instruction.

---

## Self-Review

**1. Spec coverage:**
- ISO-range storage contract → Task 1 (`parseOfferDates` shape) + PR-body migration note (Task 5).
- Store ISO / render pretty → Task 1 `formatOfferDates`, wired in Tasks 2 (modal + prose) and 3 (card).
- EN `– ` / BG ` - ` no `г.` → Task 1 impl + tests.
- Fail-safe (freehand/blank/single/reversed/impossible → raw + null) → Task 1 tests, Task 2 freehand test, Task 3 freehand test, Task 4 Playwright.
- `?checkin/?checkout` emit, enquiry.js unchanged → Task 2 (emit) + Task 4 (e2e prefill verify); no task edits enquiry.js. ✅
- Frontend-only, no Worker change → no task touches `worker/`. ✅
- Tests (util, offer-modal, offers) → Tasks 1-3. Gates → Task 4. ✅
- pr-reviewer / no-fix-until-selected → Task 5. ✅

**2. Placeholder scan:** All code steps carry real code; the only `<placeholders>` are the PR `--repo <owner>/<repo>` and `--body` (owner-specific, resolved at push time) — acceptable, not logic gaps.

**3. Type consistency:** `parseOfferDates` returns `{checkin, checkout}` (ISO strings) everywhere it's referenced (Tasks 1, 2); `formatOfferDates(raw, locale) => string` used identically in Tasks 2 and 3; `currentLocale()` returns `'en'|'bg'` matching `formatOfferDates`'s `locale` param and the `INTL_LOCALE` map. Consistent. ✅

**Known runner caveat (flagged, not a gap):** the exact BG ICU string (`15 юни 2027`) can vary by Node ICU build; Task 1 Step 4 instructs pinning the assertion to the actual `formatToParts` output while preserving the contract (no `г.`, hyphen, d-m-y order).
