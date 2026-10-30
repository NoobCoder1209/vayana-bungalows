// Email-regex lockstep contract (malformed-dot tightening).
//
// assets/js/enquiry.js can't be imported in Node (it pulls in a DOM /
// flatpickr / import.meta.env chain), so — like enquiry-errors.test.mjs —
// we assert the regex SOURCE TEXT statically rather than executing it.
//
// Two guarantees:
//   1. The client EMAIL_RE equals the tightened pattern (leading/trailing/
//      consecutive-dot shapes rejected).
//   2. The client EMAIL_RE is byte-identical to the Worker's copy in
//      worker/src/validation.js — the two are duplicated by design (the
//      Worker never trusts the client) and MUST NOT silently drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

const CLIENT = readFileSync(join(ROOT, 'assets', 'js', 'enquiry.js'), 'utf8');
const SERVER = readFileSync(join(ROOT, 'worker', 'src', 'validation.js'), 'utf8');

// The exact tightened pattern source (the slashes-and-flags literal body).
const EXPECTED = String.raw`/^[^\s@.]+(?:\.[^\s@.]+)*@[^\s@.]+(?:\.[^\s@.]+)*\.[^\s@.]{2,}$/`;

// Pull the `EMAIL_RE = <regex-literal>;` from a source file. Non-greedy up
// to the first `;` after the declaration, trimmed.
const extractEmailRe = (src, label) => {
  const m = src.match(/const EMAIL_RE\s*=\s*(\/.*?\/[a-z]*)\s*;/);
  assert.ok(m, `could not find EMAIL_RE literal in ${label}`);
  return m[1];
};

test('client EMAIL_RE is the tightened malformed-dot-rejecting pattern', () => {
  assert.equal(extractEmailRe(CLIENT, 'enquiry.js'), EXPECTED);
});

test('client and Worker EMAIL_RE are byte-identical (no drift)', () => {
  assert.equal(extractEmailRe(CLIENT, 'enquiry.js'), extractEmailRe(SERVER, 'validation.js'));
});
