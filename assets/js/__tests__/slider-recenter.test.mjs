// Unit tests for the native-scroll gallery infinite-loop recenter math
// (recenterTarget in slider.js). The DOM wiring (clone insertion, the scroll-
// idle listener, mode switching) is not exercised here — these lock the pure
// decision of "given where a settled scroll has landed, how far do we silently
// jump to stay inside the real strip?", which is what makes last→first feel
// like a normal next with no visible jump or lag.
//
// slider.js imports nothing, so unlike calendar-selection we can import the
// pure helper directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recenterTarget } from '../slider.js';

// Representative geometry. `firstRealLeft` is the resting scrollLeft of the
// first real card (= leading-clone width + any side padding): ~32px on the
// home gallery (container padding), 0 on the bungalow galleries. `lastRealLeft`
// is the rest position of the LAST real card; the first trailing clone (which
// mirrors real[0]) sits one card-step past it. `BLOCK` is one full real strip.
const BLOCK = 1400;
const CARD = 200; // one card + gap
const FIRST = 32;
const LAST = FIRST + BLOCK - CARD; // last real's resting offset

test('inside the real strip → no jump', () => {
  assert.equal(recenterTarget(FIRST, FIRST, LAST, BLOCK, 10), null);
  assert.equal(recenterTarget(FIRST + BLOCK / 2, FIRST, LAST, BLOCK, 10), null);
  // Resting on the last real card (just inside the far edge).
  assert.equal(recenterTarget(LAST - 50, FIRST, LAST, BLOCK, 10), null);
});

test('resting on a leading clone (any) → +block', () => {
  // One card-step before the first real = the first leading clone.
  assert.equal(recenterTarget(FIRST - CARD, FIRST, LAST, BLOCK, 10), BLOCK);
  assert.equal(recenterTarget(FIRST - 15, FIRST, LAST, BLOCK, 10), BLOCK);
});

test('resting on the FIRST trailing clone → -block (the regression case)', () => {
  // Previously this returned null until the whole block was traversed; now the
  // jump fires as soon as the rest lands one card past the last real.
  assert.equal(recenterTarget(LAST + CARD, FIRST, LAST, BLOCK, 10), -BLOCK);
  // A mid-trailing clone still jumps back.
  assert.equal(recenterTarget(LAST + 2 * CARD, FIRST, LAST, BLOCK, 10), -BLOCK);
});

test('tolerance band holds a snap settling a hair shy of either edge', () => {
  assert.equal(recenterTarget(FIRST - 5, FIRST, LAST, BLOCK, 10), null);  // within tol, hold
  assert.equal(recenterTarget(FIRST - 15, FIRST, LAST, BLOCK, 10), BLOCK); // clearly leading clone
  assert.equal(recenterTarget(LAST + 5, FIRST, LAST, BLOCK, 10), null);   // within tol, hold
  assert.equal(recenterTarget(LAST + 15, FIRST, LAST, BLOCK, 10), -BLOCK); // clearly trailing clone
});

test('bungalow galleries rest at firstRealLeft = 0', () => {
  const last0 = BLOCK - CARD;
  assert.equal(recenterTarget(0, 0, last0, BLOCK, 10), null);
  assert.equal(recenterTarget(-15, 0, last0, BLOCK, 10), BLOCK);      // momentum overscroll past tol
  assert.equal(recenterTarget(last0 + CARD, 0, last0, BLOCK, 10), -BLOCK); // first trailing clone
});

test('degenerate block width → no jump (never divide into a zero strip)', () => {
  assert.equal(recenterTarget(50, 0, 100, 0, 10), null);
  assert.equal(recenterTarget(50, 0, 100, -100, 10), null);
});

test('default tolerance of 0 still works', () => {
  assert.equal(recenterTarget(FIRST - CARD, FIRST, LAST, BLOCK), BLOCK);
  assert.equal(recenterTarget(FIRST + 100, FIRST, LAST, BLOCK), null);
});
