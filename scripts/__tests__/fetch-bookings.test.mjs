import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReservationTable } from '../fetch-bookings.mjs';

// parseReservationTable(grid, tabLabel, todayUtc) turns a reservation grid into
// { unavailable: ISO[], checkIn: ISO[], ... }. Columns (0-based): AG=32 №,
// AJ=35 Статус, AK=36 CHECK IN, AL=37 CHECK OUT. Header on row index 9
// (HEADER_ROW 10), data from row index 10 (FIRST_DATA_ROW 11). Dates DD-MM-YYYY.
//
// These lock the availability rule after the fix that made "Completed" a
// BLOCKING status (a Completed but FUTURE stay must grey out the calendar; a
// genuinely-past Completed stay must not) — the exact 26B-105 discrepancy.

// A fixed "today" so the past/future filter is deterministic (2026-08-01 UTC).
const TODAY = new Date(Date.UTC(2026, 7, 1));

// Build a grid: header at index 9, then reservation rows. Each res is
// [status, checkin, checkout] placed at AJ/AK/AL with an id at AG.
function grid(reservations) {
  const rows = [];
  const header = [];
  header[36] = 'CHECK IN';
  header[37] = 'CHECK OUT';
  rows[9] = header;
  reservations.forEach((res, i) => {
    const row = [];
    row[32] = `26B-1${String(i).padStart(2, '0')}`;
    row[35] = res.status;
    row[36] = res.checkin;
    row[37] = res.checkout;
    rows[10 + i] = row;
  });
  return rows;
}

test('Completed + FUTURE stay now blocks the calendar (the 26B-105 fix)', () => {
  // 17-08-2026 → 23-08-2026, Completed. Nights 17..22 must be unavailable; the
  // 23rd (checkout) stays available for the next arrival.
  const r = parseReservationTable(
    grid([{ status: 'Completed', checkin: '17-08-2026', checkout: '23-08-2026' }]),
    'B1 2026', TODAY,
  );
  assert.deepEqual(r.unavailable, [
    '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22',
  ]);
  assert.ok(!r.unavailable.includes('2026-08-23'), 'checkout day is available');
  assert.equal(r.blocked, 1);
});

test('Completed + PAST stay does NOT block (dropped by the past-date filter)', () => {
  // Ended 30-06-2026, before TODAY (01-08-2026) → fully filtered out.
  const r = parseReservationTable(
    grid([{ status: 'Completed', checkin: '15-06-2026', checkout: '30-06-2026' }]),
    'B1 2026', TODAY,
  );
  assert.deepEqual(r.unavailable, []);
});

test('Confirmed future stay still blocks (unchanged)', () => {
  const r = parseReservationTable(
    grid([{ status: 'Confirmed', checkin: '05-09-2026', checkout: '08-09-2026' }]),
    'B1 2026', TODAY,
  );
  assert.deepEqual(r.unavailable, ['2026-09-05', '2026-09-06', '2026-09-07']);
});

test('Cancelled / unknown status is ignored (non-blocking)', () => {
  const r = parseReservationTable(
    grid([{ status: 'Cancelled', checkin: '05-09-2026', checkout: '08-09-2026' }]),
    'B1 2026', TODAY,
  );
  assert.deepEqual(r.unavailable, []);
  assert.equal(r.skippedOther, 1);
});

test('a stay spanning today keeps only the future nights', () => {
  // 28-07-2026 → 03-08-2026, Ongoing. TODAY is 01-08. Past nights 28-31 Jul
  // drop; 01,02 Aug (>= today) remain (03 Aug is checkout → available).
  const r = parseReservationTable(
    grid([{ status: 'Ongoing', checkin: '28-07-2026', checkout: '03-08-2026' }]),
    'B1 2026', TODAY,
  );
  assert.deepEqual(r.unavailable, ['2026-08-01', '2026-08-02']);
});

// ── T-02: coverage for the previously-untested paths ──────────────────────

test('validateHeader throws when the AK/AL header labels have moved', () => {
  // Header row present but the CHECK IN / CHECK OUT columns are wrong — the
  // reservation table layout changed and we must fail loudly, not silently
  // mis-read every row.
  const rows = [];
  rows[9] = []; // header row with no CHECK IN / CHECK OUT labels
  assert.throws(
    () => parseReservationTable(rows, 'B1 2026', TODAY),
    /reservation table layout has changed/i,
  );
});

test('parseDmy rejects a malformed date string', () => {
  assert.throws(
    () => parseReservationTable(
      grid([{ status: 'Confirmed', checkin: '2026/09/05', checkout: '08-09-2026' }]),
      'B1 2026', TODAY,
    ),
    /expected DD-MM-YYYY/i,
  );
});

test('parseDmy rejects an impossible calendar date (31-02-2026)', () => {
  assert.throws(
    () => parseReservationTable(
      grid([{ status: 'Confirmed', checkin: '31-02-2026', checkout: '05-03-2026' }]),
      'B1 2026', TODAY,
    ),
    /not a real calendar date/i,
  );
});

test('a blocking row missing one date throws (CHECK IN or CHECK OUT blank)', () => {
  assert.throws(
    () => parseReservationTable(
      grid([{ status: 'Confirmed', checkin: '05-09-2026', checkout: '' }]),
      'B1 2026', TODAY,
    ),
    /missing CHECK IN or CHECK OUT/i,
  );
});

test('checkout not after checkin throws (reversed / equal dates)', () => {
  assert.throws(
    () => parseReservationTable(
      grid([{ status: 'Confirmed', checkin: '08-09-2026', checkout: '05-09-2026' }]),
      'B1 2026', TODAY,
    ),
    /is not after CHECK IN/i,
  );
});

test('Completed stay ending EXACTLY today is dropped (end <= today, boundary)', () => {
  // Checkout on TODAY (01-08-2026). end.dt <= todayUtc → fully filtered out;
  // nothing is unavailable. Guards the exact past/future boundary.
  const r = parseReservationTable(
    grid([{ status: 'Completed', checkin: '28-07-2026', checkout: '01-08-2026' }]),
    'B1 2026', TODAY,
  );
  assert.deepEqual(r.unavailable, []);
  assert.equal(r.blocked, 0);
});

test('a stay checking in exactly today blocks from today (checkIn day recorded)', () => {
  // CHECK IN on TODAY (01-08) → 04-08 checkout. start.dt >= todayUtc so the
  // arrival day is recorded in checkIn, and 01..03 Aug are unavailable.
  const r = parseReservationTable(
    grid([{ status: 'Confirmed', checkin: '01-08-2026', checkout: '04-08-2026' }]),
    'B1 2026', TODAY,
  );
  assert.deepEqual(r.unavailable, ['2026-08-01', '2026-08-02', '2026-08-03']);
  assert.deepEqual(r.checkIn, ['2026-08-01']);
});
