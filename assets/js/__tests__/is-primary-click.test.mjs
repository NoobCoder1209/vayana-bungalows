// Tests for assets/js/util/is-primary-click.js.
//
// The util is imported by both lang.js and header.js, but was previously
// only exercised transitively via lang.test.mjs's string-inlined copy. A
// util-only regression (e.g. `e.button !== 0` → `!!e.button`) would break
// header.js in production while lang.test.mjs stayed green because its
// _dispatchClick shim always sends button=0 explicitly. These direct-import
// tests remove that gap — the util is now tested at the module boundary
// it exposes to real callers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrimaryClick } from '../util/is-primary-click.js';

// ── Baseline: plain left-click with no modifiers ─────────────────────────

test('isPrimaryClick: plain left-click (button 0, no modifiers) → true', () => {
  assert.equal(isPrimaryClick({ button: 0 }), true);
});

test('isPrimaryClick: event with no button property at all → true (default primary)', () => {
  // Synthetic events / older browsers may not populate `button`. The
  // guard checks `button !== undefined` first so absence-of-button
  // defaults to primary — matching the DOM spec's default.
  assert.equal(isPrimaryClick({}), true);
});

// ── Modifier-key gating ───────────────────────────────────────────────────

test('isPrimaryClick: metaKey (Cmd on macOS) → false', () => {
  assert.equal(isPrimaryClick({ button: 0, metaKey: true }), false);
});

test('isPrimaryClick: ctrlKey (Ctrl on Windows/Linux) → false', () => {
  assert.equal(isPrimaryClick({ button: 0, ctrlKey: true }), false);
});

test('isPrimaryClick: shiftKey → false (opens in new window in most browsers)', () => {
  assert.equal(isPrimaryClick({ button: 0, shiftKey: true }), false);
});

test('isPrimaryClick: altKey → false (Alt-click can trigger download / other)', () => {
  assert.equal(isPrimaryClick({ button: 0, altKey: true }), false);
});

test('isPrimaryClick: multiple modifiers held → false (short-circuits on first)', () => {
  assert.equal(isPrimaryClick({ button: 0, ctrlKey: true, shiftKey: true }), false);
});

// ── Non-primary-button gating ─────────────────────────────────────────────

test('isPrimaryClick: middle-click (button 1) → false', () => {
  // Modern browsers dispatch auxclick for button=1, so this event
  // shouldn't reach a click handler at all — but the guard is
  // belt-and-braces for older engines.
  assert.equal(isPrimaryClick({ button: 1 }), false);
});

test('isPrimaryClick: right-click (button 2) → false', () => {
  assert.equal(isPrimaryClick({ button: 2 }), false);
});

test('isPrimaryClick: back-button (button 3) → false', () => {
  assert.equal(isPrimaryClick({ button: 3 }), false);
});

test('isPrimaryClick: forward-button (button 4) → false', () => {
  assert.equal(isPrimaryClick({ button: 4 }), false);
});

// ── Falsy-zero regression guard ───────────────────────────────────────────

test('isPrimaryClick: button 0 must NOT be treated as falsy (regression guard for `!!e.button` bug)', () => {
  // A "cleanup" refactor might replace `e.button !== undefined && e.button !== 0`
  // with a naive `!e.button` — which is TRUE for button=0. This test
  // explicitly proves button=0 → true so that regression can't ship.
  assert.equal(isPrimaryClick({ button: 0 }), true);
});

// ── Composite events ──────────────────────────────────────────────────────

test('isPrimaryClick: primary button with modifier held → false (modifier wins)', () => {
  assert.equal(isPrimaryClick({ button: 0, metaKey: true }), false);
});

test('isPrimaryClick: non-primary button with no modifier → false (button wins)', () => {
  assert.equal(isPrimaryClick({ button: 1 }), false);
});
