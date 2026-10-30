// Auto-dismiss layer for the enquiry error pill — static contract test.
//
// enquiry.js isn't importable in Node (DOM/flatpickr chain), so we assert the
// SOURCE wires the arm/disarm behaviour. Behaviour pinned:
//   - showError arms a 5s idle auto-fade ONLY when opts.transient is set
//     (the live on-blur email nudge); submit errors get no timer.
//   - any visible error is dismissed by scroll / pointerdown / keydown.
//   - clearError disarms everything (timer + the three listeners) so nothing
//     leaks across page lifecycles.
//   - the fade honours prefers-reduced-motion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const JS = readFileSync(join(ROOT, 'assets', 'js', 'enquiry.js'), 'utf8');

test('showError accepts an opts arg and the 5s auto-fade is guarded by a transient flag', () => {
  assert.match(JS, /showError\s*=\s*\(\s*msg\s*,\s*field\s*,\s*opts/, 'showError must take (msg, field, opts)');
  // A 5000ms constant exists and a setTimeout arms the fade.
  assert.match(JS, /ERROR_AUTO_HIDE_MS\s*=\s*5000/, 'expected ERROR_AUTO_HIDE_MS = 5000');
  assert.match(JS, /setTimeout\(/, 'expected a setTimeout arming the auto-fade');
  // The timer is conditional on the transient option (not armed unconditionally).
  assert.match(JS, /transient/, 'the auto-fade must be gated on opts.transient');
});

test('visible errors are dismissed by scroll, pointerdown, and keydown', () => {
  for (const ev of ['scroll', 'pointerdown', 'keydown']) {
    assert.match(
      JS,
      new RegExp(`addEventListener\\(\\s*['"]${ev}['"]`),
      `expected a dismiss listener for ${ev}`,
    );
  }
});

test('clearError disarms the timer and removes the three dismiss listeners', () => {
  assert.match(JS, /clearTimeout\(/, 'clearError (or a helper) must clearTimeout the auto-fade');
  for (const ev of ['scroll', 'pointerdown', 'keydown']) {
    assert.match(
      JS,
      new RegExp(`removeEventListener\\(\\s*['"]${ev}['"]`),
      `expected removeEventListener for ${ev}`,
    );
  }
});

test('the fade path honours prefers-reduced-motion', () => {
  assert.match(
    JS,
    /matchMedia\(\s*['"]\(prefers-reduced-motion: reduce\)['"]\s*\)/,
    'expected a prefers-reduced-motion check in the fade path',
  );
});
