import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nightsInWindow, computeOfferPrice, standardPrice } from '../src/pricing.js';

// ── standardPrice: seasonal per-night band pricing ─────────────────────────
// Bands use month/day (year-agnostic); End is INCLUSIVE (the last night charged).
// Real sheet bands (subset): Apr 1–30 = 75, May 1–31 = 75, Jun 1–14 = 90,
// Jun 15–30 = 110.
const BANDS = [
  { startISO: '2026-04-01', endISO: '2026-04-30', rate: 75 },
  { startISO: '2026-05-01', endISO: '2026-05-31', rate: 75 },
  { startISO: '2026-06-01', endISO: '2026-06-14', rate: 90 },
  { startISO: '2026-06-15', endISO: '2026-06-30', rate: 110 },
];

test('standardPrice: 28 Apr → 3 May (owner example) = 5 nights × €75 = €375', () => {
  // nights 28,29,30 Apr + 1,2 May (checkout 3 May not a night).
  assert.deepEqual(standardPrice('2026-04-28', '2026-05-03', BANDS), { total: 375 });
});

test('standardPrice: band-spanning stay 13 → 17 Jun = €400 (90+90+110+110)', () => {
  // nights 13,14 Jun @ €90 + 15,16 Jun @ €110.
  assert.deepEqual(standardPrice('2026-06-13', '2026-06-17', BANDS), { total: 400 });
});

test('standardPrice: single night', () => {
  assert.deepEqual(standardPrice('2026-06-15', '2026-06-16', BANDS), { total: 110 });
});

test('standardPrice: year-agnostic — a 2027 April night prices same as 2026', () => {
  assert.deepEqual(standardPrice('2027-04-10', '2027-04-13', BANDS), { total: 225 }); // 3 × 75
});

test('standardPrice: a night outside every band → null (uncovered)', () => {
  // Oct is in no band (table is Apr–Sep). One out-of-band night poisons the whole total.
  assert.equal(standardPrice('2026-10-01', '2026-10-03', BANDS), null);
  // A stay that starts in-band but crosses into an uncovered night is also null.
  assert.equal(standardPrice('2026-09-29', '2026-10-02', BANDS), null);
});

test('standardPrice: bad / non-positive date range → null, never throws', () => {
  assert.equal(standardPrice('garbage', '2026-06-17', BANDS), null);
  assert.equal(standardPrice('2026-06-17', '2026-06-13', BANDS), null); // reversed
  assert.equal(standardPrice('2026-06-15', '2026-06-15', BANDS), null); // zero nights
  assert.equal(standardPrice('2026-06-13', '2026-06-17', []), null);    // no bands
});

test('standardPrice: null / non-array bands → null (no throw)', () => {
  assert.equal(standardPrice('2026-06-13', '2026-06-17', null), null);
  assert.equal(standardPrice('2026-06-13', '2026-06-17', undefined), null);
  assert.equal(standardPrice('2026-06-13', '2026-06-17', 'nope'), null);
});

test('standardPrice: overlapping bands → first match wins (deterministic)', () => {
  const overlap = [
    { startISO: '2026-06-01', endISO: '2026-06-30', rate: 50 },
    { startISO: '2026-06-10', endISO: '2026-06-20', rate: 999 },
  ];
  // Jun 15 & 16 both fall in both bands → first (50) wins → 2 × 50 = 100.
  assert.deepEqual(standardPrice('2026-06-15', '2026-06-17', overlap), { total: 100 });
});

test('standardPrice: impossible date (Feb 30) is rejected → null', () => {
  assert.equal(standardPrice('2026-02-30', '2026-03-02', BANDS), null);
});

// ── nightsInWindow ────────────────────────────────────────────────────────
// Nights are the dates slept: checkin..checkout-1. A booked night N is
// "in-window" when winStart <= N < winEnd (End = checkout day, exclusive).

test('nightsInWindow: booking entirely inside the window', () => {
  // window 2026-09-01..2026-09-10 (nights 1..9). Book 2..7 (nights 2,3,4,5,6) = 5.
  const r = nightsInWindow('2026-09-02', '2026-09-07', '2026-09-01', '2026-09-10');
  assert.deepEqual(r, { inWindow: 5, outside: 0 });
});

test('nightsInWindow: booking fully outside the window', () => {
  const r = nightsInWindow('2026-10-01', '2026-10-05', '2026-09-01', '2026-09-10');
  assert.deepEqual(r, { inWindow: 0, outside: 4 });
});

test('nightsInWindow: booking straddling the window end (extra nights after)', () => {
  // window 09-01..09-10 (nights 1..9). Book 09-08..09-12 → nights 8,9,10,11.
  // in-window: 8,9 = 2; outside: 10,11 = 2.
  const r = nightsInWindow('2026-09-08', '2026-09-12', '2026-09-01', '2026-09-10');
  assert.deepEqual(r, { inWindow: 2, outside: 2 });
});

test('nightsInWindow: booking straddling the window start (extra nights before)', () => {
  // Book 08-30..09-03 → nights 08-30,08-31,09-01,09-02. in-window: 09-01,09-02 = 2; outside 2.
  const r = nightsInWindow('2026-08-30', '2026-09-03', '2026-09-01', '2026-09-10');
  assert.deepEqual(r, { inWindow: 2, outside: 2 });
});

test('nightsInWindow: booking covers the whole window plus both sides', () => {
  // window nights 1..9 = 9. Book 08-30..09-12 → nights 08-30,08-31, 01..11.
  // in-window 01..09 = 9; outside 08-30,08-31,10,11 = 4.
  const r = nightsInWindow('2026-08-30', '2026-09-12', '2026-09-01', '2026-09-10');
  assert.deepEqual(r, { inWindow: 9, outside: 4 });
});

// ── computeOfferPrice: Type 2 (pay X, get Y free) ─────────────────────────

const t2 = (over = {}) => ({
  type: 'Type 2', rate: 100, minimumToBook: 9, paidNights: 6, freeNights: 3,
  startDate: '2026-09-01', endDate: '2026-09-10', // 9-night window
  ...over,
});

test('Type 2: exact window booking → (W - free) * rate', () => {
  // Book all 9 window nights (09-01..09-10). W=9, X=0. (9-3)*100 = 600.
  const r = computeOfferPrice(t2(), '2026-09-01', '2026-09-10');
  assert.equal(r.applied, true);
  assert.equal(r.total, 600);
});

test('Type 2: window + extra nights outside → discount on window, extras full', () => {
  // Book 09-01..09-12 → W=9, X=2. (9-3)*100 + 2*100 = 800.
  const r = computeOfferPrice(t2(), '2026-09-01', '2026-09-12');
  assert.equal(r.applied, true);
  assert.equal(r.total, 800);
});

test('Type 2: below minimum in-window → NOT applied, plain nights * rate', () => {
  // Book 09-01..09-06 → W=5 < minToBook 9. Plain: 5 nights * 100 = 500, applied:false.
  const r = computeOfferPrice(t2(), '2026-09-01', '2026-09-06');
  assert.equal(r.applied, false);
  assert.equal(r.total, 500);
});

test('Type 2: minToBook < window span, only N in-window needed', () => {
  // Broad window 09-01..09-30 (29 nights), minToBook 5, free 2, paid 3.
  // Book 09-10..09-18 → 8 in-window nights (>=5 → applies). ALL 8 discounted.
  // (8 - 2) * 100 = 600.
  const r = computeOfferPrice(
    t2({ minimumToBook: 5, paidNights: 3, freeNights: 2, endDate: '2026-09-30' }),
    '2026-09-10', '2026-09-18',
  );
  assert.equal(r.applied, true);
  assert.equal(r.total, 600);
});

// ── computeOfferPrice: Type 1 % ───────────────────────────────────────────

const t1pct = (over = {}) => ({
  type: 'Type 1', rate: 100, minimumToBook: 5, discountPct: 20,
  startDate: '2026-09-01', endDate: '2026-09-30',
  ...over,
});

test('Type 1 %: 20% off all in-window nights', () => {
  // Book 09-01..09-13 → 12 in-window nights, X=0. 12*100*0.8 = 960.
  const r = computeOfferPrice(t1pct(), '2026-09-01', '2026-09-13');
  assert.equal(r.applied, true);
  assert.equal(r.total, 960);
});

test('Type 1 %: below minimum → plain price', () => {
  // Book 09-01..09-04 → 3 in-window < 5. plain 3*100 = 300.
  const r = computeOfferPrice(t1pct(), '2026-09-01', '2026-09-04');
  assert.equal(r.applied, false);
  assert.equal(r.total, 300);
});

// ── computeOfferPrice: Type 1 per-day ─────────────────────────────────────

test('Type 1 per-day: fixed € off each in-window night', () => {
  // rate 100, discountPerDay 10, window broad, book 5 in-window. 5*(100-10)=450.
  const r = computeOfferPrice(
    { type: 'Type 1', rate: 100, minimumToBook: 5, discountPerDay: 10,
      startDate: '2026-09-01', endDate: '2026-09-30' },
    '2026-09-01', '2026-09-06',
  );
  assert.equal(r.applied, true);
  assert.equal(r.total, 450);
});

// ── computeOfferPrice: Type 1 total ───────────────────────────────────────

test('Type 1 total: flat € off the in-window portion', () => {
  // window 1-5 Sept (4 nights), minToBook 4, discountTotal 60. Book 09-01..09-05.
  // W=4, X=0. (4*100 - 60) = 340.
  const r = computeOfferPrice(
    { type: 'Type 1', rate: 100, minimumToBook: 4, discountTotal: 60,
      startDate: '2026-09-01', endDate: '2026-09-05' },
    '2026-09-01', '2026-09-05',
  );
  assert.equal(r.applied, true);
  assert.equal(r.total, 340);
});

test('Type 1 total: extras added at full rate on top of the flat-discounted window', () => {
  // window 1-5 (4 nights), discountTotal 60, book 09-01..09-07 → W=4, X=2.
  // (4*100 - 60) + 2*100 = 340 + 200 = 540.
  const r = computeOfferPrice(
    { type: 'Type 1', rate: 100, minimumToBook: 4, discountTotal: 60,
      startDate: '2026-09-01', endDate: '2026-09-05' },
    '2026-09-01', '2026-09-07',
  );
  assert.equal(r.applied, true);
  assert.equal(r.total, 540);
});

test('Type 1 total: no clamp — window discount may exceed cost (trust the sheet)', () => {
  // window 4 nights * 100 = 400, discountTotal 500 → in-window portion 400-500 = -100.
  // Book exactly the window, X=0 → total -100 (no clamp, per spec).
  const r = computeOfferPrice(
    { type: 'Type 1', rate: 100, minimumToBook: 4, discountTotal: 500,
      startDate: '2026-09-01', endDate: '2026-09-05' },
    '2026-09-01', '2026-09-05',
  );
  assert.equal(r.applied, true);
  assert.equal(r.total, -100);
});

// ── fail-safe / no-throw ──────────────────────────────────────────────────

test('never throws on bad input; returns plain price when it can', () => {
  // Missing rate → can't price at all → total null, applied false (no throw).
  const r = computeOfferPrice({ type: 'Type 2', minimumToBook: 5, freeNights: 2,
    startDate: '2026-09-01', endDate: '2026-09-10' }, '2026-09-01', '2026-09-06');
  assert.equal(r.applied, false);
  assert.equal(r.total, null);
});

test('non-ISO booking dates → null total, no throw', () => {
  const r = computeOfferPrice(t2(), 'garbage', '2026-09-10');
  assert.equal(r.total, null);
  assert.equal(r.applied, false);
});

// ── Type 1 % — whole-number guard + float hygiene (review findings I1/I2) ──

test('Type 1 %: non-integer discountPct is misconfigured → plain price', () => {
  // 20.5 is not a whole 1..99 → fall back to plain, not a 20.5% discount.
  const r = computeOfferPrice(t1pct({ discountPct: 20.5 }), '2026-09-01', '2026-09-11');
  assert.equal(r.applied, false);
  assert.equal(r.total, 1000); // 10 nights * 100 plain
});

test('Type 1 %: a fraction like 0.2 is rejected (not treated as 0.2%)', () => {
  const r = computeOfferPrice(t1pct({ discountPct: 0.2 }), '2026-09-01', '2026-09-11');
  assert.equal(r.applied, false);
  assert.equal(r.total, 1000);
});

test('Type 1 %: pct boundaries — 0 and 100 rejected, 1 and 99 accepted', () => {
  assert.equal(computeOfferPrice(t1pct({ discountPct: 0 }), '2026-09-01', '2026-09-11').applied, false);
  assert.equal(computeOfferPrice(t1pct({ discountPct: 100 }), '2026-09-01', '2026-09-11').applied, false);
  assert.equal(computeOfferPrice(t1pct({ discountPct: 1 }), '2026-09-01', '2026-09-11').applied, true);
  assert.equal(computeOfferPrice(t1pct({ discountPct: 99 }), '2026-09-01', '2026-09-11').applied, true);
});

test('Type 1 %: 33% off yields a clean cents value, not 669.9999…', () => {
  // 10 in-window nights, rate 100, 33% off → 10*100*0.67 = 670 exactly (rounded).
  const r = computeOfferPrice(t1pct({ discountPct: 33 }), '2026-09-01', '2026-09-11');
  assert.equal(r.applied, true);
  assert.equal(r.total, 670);
});

// ── Type 1 — exactly one mechanism ─────────────────────────────────────────

test('Type 1: zero discount mechanisms → plain price', () => {
  const r = computeOfferPrice(
    { type: 'Type 1', rate: 100, minimumToBook: 5, startDate: '2026-09-01', endDate: '2026-09-30' },
    '2026-09-01', '2026-09-11',
  );
  assert.equal(r.applied, false);
  assert.equal(r.total, 1000);
});

test('Type 1: two discount mechanisms → plain price (ambiguous config)', () => {
  const r = computeOfferPrice(
    { type: 'Type 1', rate: 100, minimumToBook: 5, discountPct: 20, discountPerDay: 10,
      startDate: '2026-09-01', endDate: '2026-09-30' },
    '2026-09-01', '2026-09-11',
  );
  assert.equal(r.applied, false);
  assert.equal(r.total, 1000);
});

// ── Type 1 per-day — negative per-night is not clamped (trust the sheet) ───

test('Type 1 per-day: perDay > rate produces a negative per-night (no clamp)', () => {
  // rate 100, perDay 150 → each in-window night = -50. 5 in-window → -250.
  const r = computeOfferPrice(
    { type: 'Type 1', rate: 100, minimumToBook: 5, discountPerDay: 150,
      startDate: '2026-09-01', endDate: '2026-09-30' },
    '2026-09-01', '2026-09-06',
  );
  assert.equal(r.applied, true);
  assert.equal(r.total, -250);
});

// ── Type 2 — misconfiguration falls back to plain ─────────────────────────

test('Type 2: paid + free !== minToBook is misconfigured → plain price', () => {
  // minToBook 9 but paid 5 + free 3 = 8 → mismatch. Book the 9-night window.
  const r = computeOfferPrice(t2({ paidNights: 5, freeNights: 3 }), '2026-09-01', '2026-09-10');
  assert.equal(r.applied, false);
  assert.equal(r.total, 900); // 9 nights * 100 plain
});

test('Type 2: paid < 1 is misconfigured → plain price', () => {
  const r = computeOfferPrice(t2({ paidNights: 0, freeNights: 9 }), '2026-09-01', '2026-09-10');
  assert.equal(r.applied, false);
  assert.equal(r.total, 900);
});
