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
