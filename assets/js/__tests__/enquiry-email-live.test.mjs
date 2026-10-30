// Live (on-blur) email validation — static contract test.
//
// assets/js/enquiry.js can't be imported in Node (DOM/flatpickr/import.meta
// chain), so — like enquiry-errors.test.mjs and enquiry-email-regex.test.mjs —
// we assert the SOURCE wires the behavior rather than executing it.
//
// Behaviour pinned: the email field is validated on `blur` using the SAME
// check the submit handler uses (one shared predicate, no duplicated regex
// logic), and the blur path does NOT steal focus (the guest is tabbing away
// on purpose).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const JS = readFileSync(join(ROOT, 'assets', 'js', 'enquiry.js'), 'utf8');

test('a blur listener is wired on the email input', () => {
  assert.match(
    JS,
    /email\.addEventListener\(\s*['"]blur['"]/,
    'expected email.addEventListener("blur", …) in enquiry.js',
  );
});

test('a single shared email predicate is defined and reused (submit + blur)', () => {
  assert.match(JS, /const\s+isEmailValid\s*=/, 'expected a shared isEmailValid predicate');
  // Used at least twice beyond its declaration would be 3 occurrences; require
  // the identifier to appear ≥3 times total (decl + submit + blur).
  const count = (JS.match(/isEmailValid/g) || []).length;
  assert.ok(count >= 3, `expected isEmailValid to be defined once and used ≥2×, saw ${count}`);
});

test('the blur path does not steal focus back to the email field', () => {
  // Narrow guard: there must be no `email.focus()` inside a blur handler.
  // We check that the only `email.focus()` lives in the submit handler by
  // asserting it does not appear within ~200 chars after a blur registration.
  const m = JS.match(/email\.addEventListener\(\s*['"]blur['"][\s\S]{0,400}/);
  assert.ok(m, 'blur handler not found');
  assert.ok(!/email\.focus\(\)/.test(m[0]), 'blur handler must not call email.focus()');
});
