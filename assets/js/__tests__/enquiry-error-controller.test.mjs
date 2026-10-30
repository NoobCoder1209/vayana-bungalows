// Real behavioral tests for the enquiry error-handling logic that the static
// contract tests (enquiry-email-live / enquiry-error-dismiss) can only grep for.
//
// Two targets:
//   1. isEmailValid — a pure string→bool predicate, exported from enquiry.js
//      and tested directly (empty, whitespace-only, over-length, valid, the
//      malformed-dot family) rather than by occurrence count.
//   2. The error-controller fade/dismiss lifecycle — source-sliced and eval'd
//      over injected fake document/errorEl/window (the repo's new-Function
//      harness pattern, since enquiry.js can't be imported in Node). This pins
//      the mid-fade re-show race: a new error shown WHILE a prior fade is in
//      flight must survive — the in-flight fade's teardown must be cancelled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENQ = join(__dirname, '..', 'enquiry.js');

// --- 1. isEmailValid: import the real exported predicate -------------------
// enquiry.js top-level imports are DOM/flatpickr/import.meta-coupled, so a bare
// import throws in Node. We can't import the module — but we CAN slice the
// pure predicate's source and eval it with its two free deps injected. If the
// slice fails, isEmailValid wasn't exported at module scope (the thing we want).
const SRC = readFileSync(ENQ, 'utf8').replace(/\r\n/g, '\n');

function sliceExportedConst(src, name) {
  const marker = `export const ${name} =`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`export const ${name} not found — is it exported at module scope?`);
  const end = src.indexOf('\n};\n', start);
  if (end === -1) throw new Error(`end of ${name} not found`);
  return src.slice(start, end + 3).replace(/^export /, '');
}

function loadIsEmailValid() {
  const deps = `
    const MAX_EMAIL_LEN = 254;
    const EMAIL_RE = /^[^\\s@.]+(?:\\.[^\\s@.]+)*@[^\\s@.]+(?:\\.[^\\s@.]+)*\\.[^\\s@.]{2,}$/;
  `;
  const body = deps + '\n' + sliceExportedConst(SRC, 'isEmailValid') + '\nreturn isEmailValid;';
  return new Function(body)();
}

test('isEmailValid: empty and whitespace-only are invalid', () => {
  const isEmailValid = loadIsEmailValid();
  assert.equal(isEmailValid(''), false);
  assert.equal(isEmailValid('   '), false);
  assert.equal(isEmailValid(null), false);
  assert.equal(isEmailValid(undefined), false);
});

test('isEmailValid: over 254 chars is invalid', () => {
  const isEmailValid = loadIsEmailValid();
  assert.equal(isEmailValid('a'.repeat(250) + '@b.com'), false);
});

test('isEmailValid: valid addresses pass, malformed-dot family fails', () => {
  const isEmailValid = loadIsEmailValid();
  for (const ok of ['john@example.com', "o'brien@example.com", '1@1.com', 'x@y.co', '  john@example.com  ']) {
    assert.equal(isEmailValid(ok), true, `${JSON.stringify(ok)} should be valid`);
  }
  for (const bad of ['.x@y.com', 'x.@y.com', 'x@y..com', 'a@b']) {
    assert.equal(isEmailValid(bad), false, `${JSON.stringify(bad)} should be invalid`);
  }
});

// --- 2. Error-controller lifecycle: mid-fade re-show must not wipe new pill --
// Slice the controller closures out of initEnquiry and run them over fakes.
// We grab the contiguous block from `const ERROR_AUTO_HIDE_MS` through the end
// of clearError, inject fake errorEl/document/window, and return showError/
// clearError + a timer-pump so we can fire the orphaned fade timeout manually.

function loadController() {
  const startMarker = 'const ERROR_AUTO_HIDE_MS';
  const start = SRC.indexOf(startMarker);
  if (start === -1) throw new Error('controller start not found');
  // clearError is the last closure in the block; slice to the end of its body.
  const clearErrIdx = SRC.indexOf('const clearError = () => {', start);
  const end = SRC.indexOf('\n  };', clearErrIdx);
  if (clearErrIdx === -1 || end === -1) throw new Error('controller end not found');
  const block = SRC.slice(start, end + 5);

  // Minimal fakes. Timers are queued so the test can fire them on demand and
  // model "an orphaned fade timer fires AFTER a re-show".
  const harness = `
    const timers = [];
    let now = 0;
    const win = {
      setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id; },
      clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
      matchMedia: () => ({ matches: false }),
    };
    const listeners = { scroll: [], pointerdown: [], keydown: [], transitionend: [] };
    const doc = {
      addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener: (ev, fn) => { const a = listeners[ev]||[]; const i = a.indexOf(fn); if (i>=0) a.splice(i,1); },
    };
    const errorEl = {
      hidden: true,
      textContent: '',
      _classes: new Set(),
      classList: {
        add: (c) => errorEl._classes.add(c),
        remove: (c) => errorEl._classes.delete(c),
        contains: (c) => errorEl._classes.has(c),
      },
      addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener: (ev, fn) => { const a = listeners[ev]||[]; const i = a.indexOf(fn); if (i>=0) a.splice(i,1); },
    };
    const allFields = [];
    const ERROR_PILL_ID = 'eq-error';
    // Alias the injected fakes to the names the sliced code references.
    const window = win;
    const document = doc;
  `;
  const body = harness + '\n' + block + `
    // Fire every currently-queued timer (models the browser clock advancing
    // past both the 5s auto-hide and the 260ms fade fallback).
    const fireAllTimers = () => { const pending = timers.splice(0); pending.forEach(t => t.fn()); };
    return { showError, clearError, errorEl, fireAllTimers };
  `;
  return new Function(body)();
}

test('re-show during a mid-fade keeps the new pill (I-1 race)', () => {
  const { showError, clearError, errorEl, fireAllTimers } = loadController();

  // 1. Show a transient (email-nudge) error, then start a fade (as a scroll
  //    dismiss would) by invoking fadeOutError indirectly: simplest is to show
  //    then clear via a fade. We model the fade by calling showError (arms),
  //    then simulating the dismiss that begins the fade.
  showError('Please enter a valid email address.', null, { transient: true });
  assert.equal(errorEl.hidden, false, 'pill shown');

  // Begin the fade: the scroll/pointer/key dismiss handlers call fadeOutError.
  // We reach it by firing a queued dismiss — but dismiss handlers are stored on
  // the fake document listeners. Trigger the first keydown listener.
  // (armDismiss attached scroll/pointerdown/keydown each calling fadeOutError.)
  // Simulate a keypress dismiss:
  // Grab the keydown listener and call it.
  // Note: fadeOutError adds .is-leaving and queues the 260ms finish timer.
  // We can't reach `listeners` from here, so instead model the fade via a 2nd
  // path: fire the transient 5s timer, which also calls fadeOutError.
  fireAllTimers(); // fires the 5s auto-hide → fadeOutError → .is-leaving + 260ms finish queued
  assert.equal(errorEl.classList.contains('is-leaving'), true, 'fade started');
  assert.equal(errorEl.hidden, false, 'still visible mid-fade');

  // 2. A NEW (submit-blocking) error is shown while the fade is in flight.
  showError('Please enter your full name.', null); // non-transient
  assert.equal(errorEl.hidden, false, 'new pill visible');
  assert.equal(errorEl.textContent, 'Please enter your full name.');
  assert.equal(errorEl.classList.contains('is-leaving'), false, 're-show cleared is-leaving');

  // 3. The orphaned fade finish timer fires. WITHOUT the fix it calls
  //    clearError and wipes the new pill. WITH the fix (cancelFade in
  //    disarmDismiss, run during the step-2 showError) it was cancelled.
  fireAllTimers();
  assert.equal(errorEl.hidden, false, 'orphaned fade must NOT wipe the new submit error');
  assert.equal(errorEl.textContent, 'Please enter your full name.', 'new error text survives');
});
