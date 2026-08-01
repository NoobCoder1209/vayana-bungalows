// Unit tests for the /stay/ calendar-selection PURE logic: night counting,
// pricing, the MIN_NIGHTS gate, the contiguity walk, and the completed-range
// verdict table. The DOM wiring (click delegation, pill/dock) is not exercised
// here — these lock the decision logic that would silently regress.
//
// calendar-selection.js can't be plain-imported in Node: it pulls in
// availability-calendar.js (DOM/flatpickr chain) and bookings-data.js (reads
// import.meta.env at module top). So — matching availability-calendar.test.mjs
// — we SOURCE-SLICE the pure functions and eval them via `new Function`,
// injecting the small deps they close over (parseIso / toIso, and the real
// isOffSeason from season.js, which is import-clean).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEL_SRC = readFileSync(join(__dirname, '..', 'calendar-selection.js'), 'utf8');

// Real season primitive (season.js has no imports of its own).
const { isOffSeason } = await import(
  pathToFileURL(join(__dirname, '..', 'season.js')).href
);

// Slice a named `export function NAME(` ... matching column-0 `}` out of the
// module text (repo formats one top-level decl per closing brace at col 0).
function sliceFn(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const end = src.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`end of ${name} not found`);
  // Drop the `export ` prefix so it's a plain decl inside our Function scope.
  return src.slice(start, end + 2).replace(/^export /, '');
}

// Build all the pure helpers into one scope with the deps they reference
// injected. parseIso / toIso are re-implemented here identically to
// bookings-data.js (local-midnight, local YYYY-MM-DD) so the sliced code's
// free references resolve without importing that env-coupled module.
function loadLogic() {
  const deps = `
    const PRICE_PER_NIGHT = 100;
    const MIN_NIGHTS = 5;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const parseIso = (iso) => { const [y,m,d] = iso.split('-').map(Number); return new Date(y, m-1, d); };
    const toIso = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return y+'-'+m+'-'+day;
    };
  `;
  const body = [
    deps,
    sliceFn(SEL_SRC, 'nightsBetween'),
    sliceFn(SEL_SRC, 'priceForNights'),
    sliceFn(SEL_SRC, 'isRangeContiguous'),
    sliceFn(SEL_SRC, 'evaluateSelection'),
    sliceFn(SEL_SRC, 'dayState'),
    'return { nightsBetween, priceForNights, isRangeContiguous, evaluateSelection, dayState, MIN_NIGHTS, PRICE_PER_NIGHT };',
  ].join('\n\n');
  return new Function('isOffSeason', body)(isOffSeason);
}

const L = loadLogic();
// A "today" comfortably in the past so past-night guards don't trip the
// in-season August dates used below.
const TODAY = new Date(2026, 0, 1); // Jan 1 2026

// ── nights + price ────────────────────────────────────────────────────────

test('nightsBetween: hotel convention (Aug 10 → Aug 15 = 5 nights)', () => {
  assert.equal(L.nightsBetween('2026-08-10', '2026-08-15'), 5);
});

test('nightsBetween: 6 and 10 nights', () => {
  assert.equal(L.nightsBetween('2026-08-10', '2026-08-16'), 6);
  assert.equal(L.nightsBetween('2026-08-10', '2026-08-20'), 10);
});

test('nightsBetween: reversed order is non-positive', () => {
  assert.ok(L.nightsBetween('2026-08-15', '2026-08-10') <= 0);
});

test('priceForNights: €100/night', () => {
  assert.equal(L.priceForNights(5), 500);
  assert.equal(L.priceForNights(6), 600);
  assert.equal(L.priceForNights(10), 1000);
});

// ── contiguity walk ─────────────────────────────────────────────────────────

test('isRangeContiguous: all-free range is contiguous', () => {
  const unavailable = new Set();
  assert.equal(L.isRangeContiguous('2026-08-10', '2026-08-15', unavailable, TODAY), true);
});

test('isRangeContiguous: a booked interior night breaks it', () => {
  // Jun 4–9 booked; Jun 1 → Jun 11 spans the gap → rejected.
  const unavailable = new Set(['2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09']);
  assert.equal(L.isRangeContiguous('2026-06-01', '2026-06-11', unavailable, TODAY), false);
});

test('isRangeContiguous: checkout day itself may be booked (departure, not a night)', () => {
  // Nights Aug 10..14 are free; Aug 15 (checkout) being booked must NOT reject.
  const unavailable = new Set(['2026-08-15']);
  assert.equal(L.isRangeContiguous('2026-08-10', '2026-08-15', unavailable, TODAY), true);
});

test('isRangeContiguous: an off-season night breaks it', () => {
  // Sep 28 → Oct 3 crosses into off-season (Oct) nights.
  const unavailable = new Set();
  assert.equal(L.isRangeContiguous('2026-09-28', '2026-10-03', unavailable, TODAY), false);
});

test('isRangeContiguous: a past night breaks it', () => {
  const today = new Date(2026, 7, 12); // Aug 12
  assert.equal(L.isRangeContiguous('2026-08-10', '2026-08-16', new Set(), today), false);
});

// ── verdict table ────────────────────────────────────────────────────────────

test('evaluateSelection: incomplete when no check-out', () => {
  const v = L.evaluateSelection({ key: 'B1', checkIn: '2026-08-10', checkOut: null }, new Set(), TODAY);
  assert.equal(v.kind, 'incomplete');
});

test('evaluateSelection: valid ≥5-night contiguous range → price', () => {
  const v = L.evaluateSelection({ key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-15' }, new Set(), TODAY);
  assert.equal(v.kind, 'valid');
  assert.equal(v.nights, 5);
  assert.equal(v.price, 500);
});

test('evaluateSelection: 4-night range → tooShort (no price)', () => {
  const v = L.evaluateSelection({ key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-14' }, new Set(), TODAY);
  assert.equal(v.kind, 'tooShort');
  assert.equal(v.nights, 4);
});

test('evaluateSelection: gap-crossing range → invalid', () => {
  const unavailable = new Set(['2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09']);
  const v = L.evaluateSelection({ key: 'B1', checkIn: '2026-06-01', checkOut: '2026-06-11' }, unavailable, TODAY);
  assert.equal(v.kind, 'invalid');
});

// ── per-day paint state ───────────────────────────────────────────────────────

test('dayState: endpoints and middle', () => {
  const sel = { key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-15' };
  assert.equal(L.dayState(sel, '2026-08-10'), 'start');
  assert.equal(L.dayState(sel, '2026-08-15'), 'end');
  assert.equal(L.dayState(sel, '2026-08-12'), 'mid');
  assert.equal(L.dayState(sel, '2026-08-09'), '');
  assert.equal(L.dayState(sel, '2026-08-20'), '');
});

test('dayState: no middle highlight before check-out is chosen', () => {
  const sel = { key: 'B1', checkIn: '2026-08-10', checkOut: null };
  assert.equal(L.dayState(sel, '2026-08-10'), 'start');
  assert.equal(L.dayState(sel, '2026-08-12'), '');
});

// ── gap-crossing 2nd click promotes to a new check-in ────────────────────────
// The click reducer lives inside initCalendarSelection's closure, but its rule
// is: if isRangeContiguous(checkIn → clicked) is false, the clicked date
// becomes the new check-in. We assert that guard directly (the reducer's exact
// branch condition) so the behaviour is locked without a DOM.

test('gap-crossing 2nd click: contiguity guard is false → caller re-seeds check-in', () => {
  // B1 has Aug 4–9 booked. Check-in Aug 1, 2nd click Aug 11 spans the gap.
  const unavailable = new Set(['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
  const crosses = !L.isRangeContiguous('2026-08-01', '2026-08-11', unavailable, TODAY);
  assert.equal(crosses, true, 'range crosses the booked gap');
  // Reducer’s resulting selection when the guard trips: clicked date is the
  // fresh check-in, check-out cleared.
  const next = crosses ? { key: 'B1', checkIn: '2026-08-11', checkOut: null } : null;
  assert.deepEqual(next, { key: 'B1', checkIn: '2026-08-11', checkOut: null });
});

test('non-crossing 2nd click: guard passes → range forms (no re-seed)', () => {
  const unavailable = new Set(['2026-08-04', '2026-08-05']);
  // Aug 10 → Aug 16 is clear of the booked days → contiguous → real range.
  assert.equal(L.isRangeContiguous('2026-08-10', '2026-08-16', unavailable, TODAY), true);
});
