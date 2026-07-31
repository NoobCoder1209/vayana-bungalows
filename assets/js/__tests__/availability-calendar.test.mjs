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

// Build the calendar's nav helpers into one scope with seasonMaxDate injected
// and a controllable `todayMidnight` (so floor tests don't depend on the real
// clock). The two-month calendar navigates all 12 months: floor = today's
// month, ceil = the month containing seasonMaxDate.
function loadNavHelpers(today) {
  const body = [
    'let _navBounds = null;', // module-level memo the sliced navBounds() closes over
    sliceFn(CAL_SRC, 'firstOfMonth'),
    sliceFn(CAL_SRC, 'monthCmp'),
    'function todayMidnight() { return INJECTED_TODAY; }',
    sliceFn(CAL_SRC, 'navBounds'),
    'return { firstOfMonth, monthCmp, navBounds };',
  ].join('\n\n');
  const factory = new Function('seasonMaxDate', 'INJECTED_TODAY', body);
  return factory(seasonMaxDate, today);
}

function loadAvailabilityFor() {
  const body = `${sliceFn(BOOKINGS_SRC, 'availabilityFor')}\nreturn availabilityFor;`;
  return new Function(body)();
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ── nav bounds + off-season classification ──────────────────────────────────

test('navBounds: floor is the current month (paging is not season-clamped)', () => {
  // Feb (off-season) → floor is still Feb, since all 12 months are navigable
  // now (off-season days just render greyed, not skipped).
  const { navBounds } = loadNavHelpers(new Date(2026, 1, 10)); // Feb 10
  assert.equal(iso(navBounds().floor), '2026-02');
});

test('navBounds: floor tracks an in-season "today" too', () => {
  const { navBounds } = loadNavHelpers(new Date(2026, 6, 15)); // Jul 15
  assert.equal(iso(navBounds().floor), '2026-07');
});

test('navBounds: ceil is the month of seasonMaxDate (Dec of currentYear+5)', () => {
  const { navBounds } = loadNavHelpers(new Date(2026, 6, 1));
  const ceil = navBounds().ceil;
  const max = seasonMaxDate();
  assert.equal(ceil.getMonth(), max.getMonth(), 'ceil month matches seasonMaxDate month');
  assert.equal(ceil.getFullYear(), max.getFullYear());
});

test('isOffSeason: May–Sep are open; Oct–Apr are off-season (greyed in the grid)', () => {
  // Open season (returns false = in season)
  for (const m of [4, 5, 6, 7, 8]) { // May..Sep
    assert.equal(isOffSeason(new Date(2026, m, 15)), false, `month ${m} should be open`);
  }
  // Off season (returns true = greyed)
  for (const m of [0, 1, 2, 3, 9, 10, 11]) { // Jan..Apr, Oct..Dec
    assert.equal(isOffSeason(new Date(2026, m, 15)), true, `month ${m} should be off-season`);
  }
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
