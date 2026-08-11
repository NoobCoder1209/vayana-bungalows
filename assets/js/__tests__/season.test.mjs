import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOffSeason } from '../season.js';

// The open season is April..September (months 3..8, 0-indexed). isOffSeason
// keys off getMonth() only (year/day-agnostic). A local-time Date at noon
// avoids any midnight-TZ ambiguity in the month reading.
const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);

test('April is now IN season (the season extension)', () => {
  assert.equal(isOffSeason(at(2026, 4, 1)), false);
  assert.equal(isOffSeason(at(2026, 4, 30)), false);
});

test('May through September remain in season', () => {
  for (const month of [5, 6, 7, 8, 9]) {
    assert.equal(isOffSeason(at(2026, month, 15)), false, `${month} should be in season`);
  }
});

test('October through March are off season', () => {
  for (const month of [10, 11, 12, 1, 2, 3]) {
    assert.equal(isOffSeason(at(2026, month, 15)), true, `${month} should be off season`);
  }
});

test('March 31 off / April 1 on — the season boundary', () => {
  assert.equal(isOffSeason(at(2026, 3, 31)), true);
  assert.equal(isOffSeason(at(2026, 4, 1)), false);
});
