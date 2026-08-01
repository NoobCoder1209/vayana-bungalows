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
    const KEY_ORDER = ['B1', 'B2', 'B3'];
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
    sliceFn(SEL_SRC, 'firstAvailableBungalow'),
    sliceFn(SEL_SRC, 'dayState'),
    sliceFn(SEL_SRC, 'reduceClick'),
    'return { nightsBetween, priceForNights, isRangeContiguous, evaluateSelection, firstAvailableBungalow, dayState, reduceClick, MIN_NIGHTS, PRICE_PER_NIGHT, KEY_ORDER };',
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

// ── firstAvailableBungalow (home-dock deep-link resolver) ────────────────────
// Given the three bungalows' booked-night sets + a candidate range, return the
// first hosting bungalow (B1→B2→B3) or null. Folds in the 5-night minimum that
// the /stay/ calendars enforce but the home dock does not.

const KO = ['B1', 'B2', 'B3'];
const boarded = (b1 = [], b2 = [], b3 = []) =>
  new Map([['B1', new Set(b1)], ['B2', new Set(b2)], ['B3', new Set(b3)]]);

test('firstAvailableBungalow: all three free → B1 (numeric order)', () => {
  const key = L.firstAvailableBungalow(boarded(), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, 'B1');
});

test('firstAvailableBungalow: B1+B3 free, B2 booked mid-range → B1 (order)', () => {
  const b2 = ['2026-08-12']; // a night inside the range
  const key = L.firstAvailableBungalow(boarded([], b2, []), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, 'B1');
});

test('firstAvailableBungalow: only B2 free (B1+B3 booked mid-range) → B2', () => {
  const booked = ['2026-08-12'];
  const key = L.firstAvailableBungalow(boarded(booked, [], booked), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, 'B2');
});

test('firstAvailableBungalow: none free (all booked mid-range) → null', () => {
  const booked = ['2026-08-12'];
  const key = L.firstAvailableBungalow(boarded(booked, booked, booked), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, null);
});

test('firstAvailableBungalow: contiguous but <5 nights → null even when all free', () => {
  // Aug 10 → Aug 13 = 3 nights; every bungalow free, but under the minimum.
  const key = L.firstAvailableBungalow(boarded(), '2026-08-10', '2026-08-13', TODAY, KO);
  assert.equal(key, null);
});

test('firstAvailableBungalow: gap-crossing for B1, clean for B2 → B2', () => {
  // B1 has Aug 4–9 booked; range Aug 1 → Aug 11 spans the gap (invalid for B1),
  // B2 is free → B2.
  const b1 = ['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
  const key = L.firstAvailableBungalow(boarded(b1, [], []), '2026-08-01', '2026-08-11', TODAY, KO);
  assert.equal(key, 'B2');
});

test('firstAvailableBungalow: checkout day booked is fine (departure, not a night)', () => {
  // Aug 15 (the checkout) booked for B1, nights Aug 10..14 free → still B1.
  const key = L.firstAvailableBungalow(boarded(['2026-08-15'], [], []), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, 'B1');
});

test('firstAvailableBungalow: default keyOrder resolves B1→B2→B3', () => {
  // Omit the explicit keyOrder → uses the exported KEY_ORDER default.
  const key = L.firstAvailableBungalow(boarded(['2026-08-12'], [], []), '2026-08-10', '2026-08-15', TODAY);
  assert.equal(key, 'B2');
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
// The click reducer is now an exported pure function — test its transitions
// directly (the previous version could only assert the guard in isolation).

const click = (key, iso, unavailable = new Set(), today = TODAY) => ({ key, iso, unavailable, today });

test('reduceClick: first click → fresh check-in', () => {
  const next = L.reduceClick(null, click('B1', '2026-08-10'));
  assert.deepEqual(next, { key: 'B1', checkIn: '2026-08-10', checkOut: null });
});

test('reduceClick: second later contiguous click → completes range', () => {
  const s1 = L.reduceClick(null, click('B1', '2026-08-10'));
  const s2 = L.reduceClick(s1, click('B1', '2026-08-16'));
  assert.deepEqual(s2, { key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-16' });
});

test('reduceClick: third click (both set) → resets to a fresh check-in', () => {
  const s2 = { key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-16' };
  const s3 = L.reduceClick(s2, click('B1', '2026-08-20'));
  assert.deepEqual(s3, { key: 'B1', checkIn: '2026-08-20', checkOut: null });
});

test('reduceClick: clicking a different bungalow clears and re-seeds there', () => {
  const s1 = { key: 'B1', checkIn: '2026-08-10', checkOut: null };
  const s2 = L.reduceClick(s1, click('B2', '2026-08-06'));
  assert.deepEqual(s2, { key: 'B2', checkIn: '2026-08-06', checkOut: null });
});

test('reduceClick: same day re-clicked → re-seed (no zero-night range)', () => {
  const s1 = { key: 'B1', checkIn: '2026-08-10', checkOut: null };
  const s2 = L.reduceClick(s1, click('B1', '2026-08-10'));
  assert.deepEqual(s2, { key: 'B1', checkIn: '2026-08-10', checkOut: null });
});

test('reduceClick: clicking earlier than check-in → that becomes the new check-in', () => {
  const s1 = { key: 'B1', checkIn: '2026-08-10', checkOut: null };
  const s2 = L.reduceClick(s1, click('B1', '2026-08-07'));
  assert.deepEqual(s2, { key: 'B1', checkIn: '2026-08-07', checkOut: null });
});

test('reduceClick: gap-crossing 2nd click → clicked date becomes new check-in', () => {
  // Aug 4–9 booked. Check-in Aug 1, then click Aug 11 → spans the gap → re-seed.
  const unavailable = new Set(['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
  const s1 = { key: 'B1', checkIn: '2026-08-01', checkOut: null };
  const s2 = L.reduceClick(s1, click('B1', '2026-08-11', unavailable));
  assert.deepEqual(s2, { key: 'B1', checkIn: '2026-08-11', checkOut: null });
});

// ── G2: a range valid at click time, invalidated once real bookings load ─────
// Guests can select before bookings.json resolves (empty unavailable = all
// contiguous). Once data lands, evaluateSelection must report 'invalid' so the
// UI layer promotes check-out → new check-in and warns (rather than silently
// keeping a now-illegal range).

test('post-load invalidation: contiguous-at-click range → invalid once bookings arrive', () => {
  // At click time the set was empty → range formed.
  const sel = { key: 'B1', checkIn: '2026-08-01', checkOut: '2026-08-11' };
  assert.equal(L.evaluateSelection(sel, new Set(), TODAY).kind, 'valid');
  // Bookings arrive: Aug 4–9 now booked → same range is invalid.
  const loaded = new Set(['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
  assert.equal(L.evaluateSelection(sel, loaded, TODAY).kind, 'invalid');
});
