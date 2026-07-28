// Unit tests for the availability-calendar season logic + the shared
// bookings-data.availabilityFor parser (added when these were refactored into
// shared helpers). The main npm-test suite otherwise exercises none of the
// booking/calendar JS, so these lock the two pieces most prone to silent
// regression: the season floor/ceil + off-season month stepping, and the
// bookings.json shape guard.
//
// Neither target is import-clean for a plain dynamic import in Node:
// availability-calendar.js pulls in flatpickr/DOM, and bookings-data.js reads
// import.meta.env at module top. So (matching lang.test.mjs / is-primary-click
// harness style) we SOURCE-SLICE the specific functions under test and eval
// them via `new Function`, injecting the small pure deps. season.js itself has
// no imports, so we load the REAL isOffSeason / seasonMaxDate from it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAL_SRC = readFileSync(join(__dirname, '..', 'availability-calendar.js'), 'utf8');
const BOOKINGS_SRC = readFileSync(join(__dirname, '..', 'bookings-data.js'), 'utf8');

// Pull the real season primitives (season.js has no imports of its own).
const { isOffSeason, seasonMaxDate } = await import(
  pathToFileURL(join(__dirname, '..', 'season.js')).href
);

// Slice a named function's full source (from `function NAME(` to its matching
// closing brace at column 0) out of a module's text. Relies on the repo's
// one-function-per-top-level-decl formatting (closing `}` in column 0).
function sliceFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const end = src.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`end of ${name} not found`);
  return src.slice(start, end + 2);
}

// Build the season-stepping helpers into one scope with isOffSeason +
// seasonMaxDate injected, and a controllable `todayMidnight` (so floor tests
// don't depend on the real clock).
function loadSeasonHelpers(today) {
  const body = [
    sliceFn(CAL_SRC, 'stepUntilInSeason'),
    sliceFn(CAL_SRC, 'firstOfMonth'),
    sliceFn(CAL_SRC, 'monthCmp'),
    sliceFn(CAL_SRC, 'seasonCeilMonth'),
    // seasonFloorMonth uses todayMidnight(); inject a fixed one for determinism.
    'function todayMidnight() { return INJECTED_TODAY; }',
    sliceFn(CAL_SRC, 'seasonFloorMonth'),
    'return { stepUntilInSeason, firstOfMonth, monthCmp, seasonFloorMonth, seasonCeilMonth };',
  ].join('\n\n');
  const factory = new Function('isOffSeason', 'seasonMaxDate', 'INJECTED_TODAY', body);
  return factory(isOffSeason, seasonMaxDate, today);
}

function loadAvailabilityFor() {
  const body = `${sliceFn(BOOKINGS_SRC, 'availabilityFor')}\nreturn availabilityFor;`;
  return new Function(body)();
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ── season stepping ────────────────────────────────────────────────────────

test('stepUntilInSeason: an in-season month is returned unchanged', () => {
  const { stepUntilInSeason } = loadSeasonHelpers(new Date(2026, 6, 1));
  const jul = new Date(2026, 6, 1); // July — in season
  assert.equal(iso(stepUntilInSeason(jul, 1)), '2026-07');
  assert.equal(iso(stepUntilInSeason(jul, -1)), '2026-07');
});

test('stepUntilInSeason: forward from off-season lands on the next May', () => {
  const { stepUntilInSeason } = loadSeasonHelpers(new Date(2026, 0, 1));
  // Nov 2026 (off-season) stepping +1 → skips Dec/Jan…Apr → May 2027.
  const nov = new Date(2026, 10, 1);
  assert.equal(iso(stepUntilInSeason(nov, 1)), '2027-05');
});

test('stepUntilInSeason: backward from off-season lands on the previous September', () => {
  const { stepUntilInSeason } = loadSeasonHelpers(new Date(2026, 0, 1));
  // Feb 2027 (off-season) stepping -1 → skips Jan → back to Sep 2026.
  const feb = new Date(2027, 1, 1);
  assert.equal(iso(stepUntilInSeason(feb, -1)), '2026-09');
});

test('seasonFloorMonth: in-season "today" floors to this month', () => {
  const { seasonFloorMonth } = loadSeasonHelpers(new Date(2026, 6, 15)); // Jul 15
  assert.equal(iso(seasonFloorMonth()), '2026-07');
});

test('seasonFloorMonth: off-season "today" floors to the next open May', () => {
  const { seasonFloorMonth } = loadSeasonHelpers(new Date(2026, 1, 10)); // Feb 10
  assert.equal(iso(seasonFloorMonth()), '2026-05');
});

test('seasonCeilMonth: ceiling is the September of seasonMaxDate\'s year', () => {
  const { seasonCeilMonth } = loadSeasonHelpers(new Date(2026, 6, 1));
  const ceil = seasonCeilMonth();
  // seasonMaxDate() is Dec 31 of currentYear+5 → step back to that year's Sep.
  assert.equal(ceil.getMonth(), 8, 'ceil month should be September (index 8)');
  assert.equal(ceil.getFullYear(), seasonMaxDate().getFullYear());
});

// ── availabilityFor shape guard ──────────────────────────────────────────────

test('availabilityFor: normal entry → unavailable + checkIn Sets', () => {
  const availabilityFor = loadAvailabilityFor();
  const bookings = {
    bungalows: {
      B1: { unavailable: ['2026-08-10', '2026-08-11'], checkIn: ['2026-08-10'] },
    },
  };
  const r = availabilityFor(bookings, 'B1');
  assert.ok(r.unavailable instanceof Set && r.checkIn instanceof Set);
  assert.equal(r.unavailable.size, 2);
  assert.ok(r.unavailable.has('2026-08-10'));
  assert.ok(r.checkIn.has('2026-08-10'));
});

test('availabilityFor: missing key / null bookings → empty Sets (fail safe)', () => {
  const availabilityFor = loadAvailabilityFor();
  for (const args of [[null, 'B1'], [{ bungalows: {} }, 'B1'], [{}, 'B9']]) {
    const r = availabilityFor(...args);
    assert.equal(r.unavailable.size, 0);
    assert.equal(r.checkIn.size, 0);
  }
});

test('availabilityFor: legacy array shape → empty Sets + one warn', () => {
  const availabilityFor = loadAvailabilityFor();
  const warnings = [];
  const orig = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    const r = availabilityFor({ bungalows: { B1: ['2026-08-10'] } }, 'B1');
    assert.equal(r.unavailable.size, 0);
    assert.equal(r.checkIn.size, 0);
  } finally {
    console.warn = orig;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /legacy array shape/);
});

test('availabilityFor: entry missing unavailable/checkIn fields → empty Sets', () => {
  const availabilityFor = loadAvailabilityFor();
  const r = availabilityFor({ bungalows: { B1: {} } }, 'B1');
  assert.equal(r.unavailable.size, 0);
  assert.equal(r.checkIn.size, 0);
});
