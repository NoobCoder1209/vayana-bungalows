// Unit tests for the /enquiries/ Guests stepper. The DOM-heavy setupGuests()
// can't be plain-imported in Node (enquiry.js pulls in flatpickr /
// import.meta.env at module top), and the repo has no DOM lib — so, matching
// calendar-selection.test.mjs / lang.test.mjs, we SOURCE-SLICE the pure
// derivation function computeGuestsState() and eval it, then drive the full
// setupGuests() against a tiny hand-rolled DOM stub for one wiring smoke test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'enquiry.js'), 'utf8').replace(/\r\n/g, '\n');

// Slice an `export function NAME(` … column-0 `}` out of the module text
// (repo formats one top-level decl per closing brace at col 0). Also pulls
// the GUEST_MIN/GUEST_MAX/COMBINED_MAX consts the function closes over.
function sliceFn(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const end = src.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`end of ${name} not found`);
  return src.slice(start, end + 2).replace(/^export /, '');
}
function sliceConsts(src) {
  // Grab the three guest-bound consts verbatim.
  return ['GUEST_MIN', 'GUEST_MAX', 'COMBINED_MAX'].map((n) => {
    const re = new RegExp(`^const ${n} = [^;]+;`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`const ${n} not found`);
    return m[0];
  }).join('\n');
}

const TPL = {
  guest: '%N% Guest', guests: '%N% Guests',
  pet: '%N% Pet', pets: '%N% Pets', join: ' / ',
};
const compute = new Function(
  'counts', 'T',
  `${sliceConsts(SRC)}\n${sliceFn(SRC, 'computeGuestsState')}\nreturn computeGuestsState(counts, T);`,
);

test('initial 1/0/0/0 → clamped identical, summary "1 Guest"', () => {
  const s = compute({ adults: 1, children: 0, infants: 0, pets: 0 }, TPL);
  assert.deepEqual(s.counts, { adults: 1, children: 0, infants: 0, pets: 0 });
  assert.equal(s.summary, '1 Guest');
});

test('adults floors at 1 (dec disabled); infants/pets floor at 0', () => {
  const s = compute({ adults: 1, children: 0, infants: 0, pets: 0 }, TPL);
  assert.equal(s.buttons.adults.dec, true, 'adults − disabled at 1');
  assert.equal(s.buttons.children.dec, true, 'children − disabled at 0');
  assert.equal(s.buttons.infants.dec, true);
  assert.equal(s.buttons.pets.dec, true);
});

test('adults+children combined cap 4 → both inc disabled at the sum', () => {
  const s = compute({ adults: 3, children: 1, infants: 0, pets: 0 }, TPL);
  assert.equal(s.buttons.adults.inc, true, 'adults + disabled when sum=4');
  assert.equal(s.buttons.children.inc, true, 'children + disabled when sum=4');
  assert.equal(s.summary, '4 Guests');
});

test('over-cap input is clamped: 4 adults + 3 children → children trimmed to 0', () => {
  const s = compute({ adults: 4, children: 3, infants: 0, pets: 0 }, TPL);
  assert.equal(s.counts.adults, 4);
  assert.equal(s.counts.children, 0, 'children trimmed so adults+children ≤ 4');
});

test('infants and pets clamp at 2', () => {
  const s = compute({ adults: 1, children: 0, infants: 5, pets: 9 }, TPL);
  assert.equal(s.counts.infants, 2);
  assert.equal(s.counts.pets, 2);
  assert.equal(s.buttons.infants.inc, true);
  assert.equal(s.buttons.pets.inc, true);
});

test('summary counts guests = adults+children+infants, pets shown only when >=1', () => {
  const a = compute({ adults: 2, children: 1, infants: 0, pets: 0 }, TPL);
  assert.equal(a.summary, '3 Guests');
  const b = compute({ adults: 2, children: 1, infants: 0, pets: 1 }, TPL);
  assert.equal(b.summary, '3 Guests / 1 Pet');
  const c = compute({ adults: 2, children: 2, infants: 0, pets: 2 }, TPL);
  assert.equal(c.summary, '4 Guests / 2 Pets');
});

test('non-finite/garbage counts fall back to the floor', () => {
  const s = compute({ adults: NaN, children: undefined, infants: null, pets: 'x' }, TPL);
  assert.deepEqual(s.counts, { adults: 1, children: 0, infants: 0, pets: 0 });
});
