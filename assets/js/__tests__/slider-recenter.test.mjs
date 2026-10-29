// Unit tests for the native-scroll gallery infinite-loop recenter math
// (recenterTarget in slider.js). The DOM wiring (clone insertion, the scroll
// listener, mode switching) is not exercised here — these lock the pure
// decision of "given where the user has scrolled, how far do we silently jump
// to stay inside the real strip?", which is what makes last→first feel like a
// normal next with no visible jump.
//
// slider.js imports nothing, so unlike calendar-selection we can import the
// pure helper directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recenterTarget } from '../slider.js';

// Representative geometry. `firstRealLeft` is the resting scrollLeft of the
// first real card (= leading-clone width + any side padding): ~32px on the
// home gallery (container padding), 0 on the bungalow galleries. `block` is
// the width of one full real strip.
const BLOCK = 1400;

test('inside the real strip → no jump', () => {
  assert.equal(recenterTarget(32, 32, BLOCK, 10), null);
  assert.equal(recenterTarget(32 + BLOCK / 2, 32, BLOCK, 10), null);
  // Just inside the right boundary (still < firstRealLeft + block - tol).
  assert.equal(recenterTarget(32 + BLOCK - 20, 32, BLOCK, 10), null);
});

test('scrolled into the leading clones (before first real) → +block', () => {
  assert.equal(recenterTarget(0, 32, BLOCK, 10), BLOCK);
  assert.equal(recenterTarget(10, 32, BLOCK, 10), BLOCK);
});

test('scrolled a full block past first real (into trailing clones) → -block', () => {
  assert.equal(recenterTarget(32 + BLOCK + 50, 32, BLOCK, 10), -BLOCK);
});

test('recenter fires once each clone zone is clearly entered', () => {
  // Leading clones sit LEFT of the first real item: a jump forward only fires
  // once scrollLeft is more than `tol` below firstRealLeft (so a snap settling
  // a pixel or two shy of the edge isn't yanked).
  assert.equal(recenterTarget(32 - 5, 32, BLOCK, 10), null);   // within tol, hold
  assert.equal(recenterTarget(32 - 15, 32, BLOCK, 10), BLOCK); // clearly in leading clones
  // Comfortably inside the real strip: no jump.
  assert.equal(recenterTarget(32 + 50, 32, BLOCK, 10), null);
  // Trailing clones start one block past the first real item; the jump back
  // fires as scrollLeft reaches within `tol` of that far boundary.
  assert.equal(recenterTarget(32 + BLOCK - 5, 32, BLOCK, 10), -BLOCK);
  // A card-width short of the far edge: still inside, no jump.
  assert.equal(recenterTarget(32 + BLOCK - 200, 32, BLOCK, 10), null);
});

test('bungalow galleries rest at firstRealLeft = 0', () => {
  assert.equal(recenterTarget(0, 0, BLOCK, 10), null);
  assert.equal(recenterTarget(-15, 0, BLOCK, 10), BLOCK); // momentum overscroll past tol
  assert.equal(recenterTarget(BLOCK + 20, 0, BLOCK, 10), -BLOCK);
});

test('degenerate block width → no jump (never divide into a zero strip)', () => {
  assert.equal(recenterTarget(50, 0, 0, 10), null);
  assert.equal(recenterTarget(50, 0, -100, 10), null);
});

test('default tolerance of 0 still works', () => {
  assert.equal(recenterTarget(0, 32, BLOCK), BLOCK);
  assert.equal(recenterTarget(100, 32, BLOCK), null);
});
