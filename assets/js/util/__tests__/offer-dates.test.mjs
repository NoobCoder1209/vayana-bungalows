import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfferDates, formatOfferDates } from '../offer-dates.js';

// ── parseOfferDates ───────────────────────────────────────────────────────

test('parseOfferDates: valid ISO range → {checkin, checkout}', () => {
  assert.deepEqual(parseOfferDates('2027-06-15/2027-06-20'), {
    checkin: '2027-06-15',
    checkout: '2027-06-20',
  });
});

test('parseOfferDates: tolerates surrounding whitespace around each half', () => {
  assert.deepEqual(parseOfferDates('  2027-06-15 / 2027-06-20 '), {
    checkin: '2027-06-15',
    checkout: '2027-06-20',
  });
});

test('parseOfferDates: blank / null / undefined → null', () => {
  assert.equal(parseOfferDates(''), null);
  assert.equal(parseOfferDates(null), null);
  assert.equal(parseOfferDates(undefined), null);
});

test('parseOfferDates: freehand display string → null', () => {
  assert.equal(parseOfferDates('12–18 Jun'), null);
  assert.equal(parseOfferDates('12–18 June 2026'), null);
});

test('parseOfferDates: single date (no range) → null', () => {
  assert.equal(parseOfferDates('2027-06-15'), null);
});

test('parseOfferDates: reversed order (checkout <= checkin) → null', () => {
  assert.equal(parseOfferDates('2027-06-20/2027-06-15'), null);
  assert.equal(parseOfferDates('2027-06-15/2027-06-15'), null); // equal = not a range
});

test('parseOfferDates: impossible calendar date → null (Feb 30 does not roll over)', () => {
  assert.equal(parseOfferDates('2027-02-30/2027-03-05'), null);
});

test('parseOfferDates: non-ISO-shaped halves → null', () => {
  assert.equal(parseOfferDates('2027/6/15/2027/6/20'), null);
  assert.equal(parseOfferDates('27-06-15/27-06-20'), null);
});

// ── formatOfferDates ──────────────────────────────────────────────────────

test('formatOfferDates: EN valid range → "15 Jun 2027 – 20 Jun 2027" (en-dash)', () => {
  assert.equal(
    formatOfferDates('2027-06-15/2027-06-20', 'en'),
    '15 Jun 2027 – 20 Jun 2027',
  );
});

test('formatOfferDates: BG valid range → "15 юни 2027 - 20 юни 2027" (hyphen, no г.)', () => {
  const out = formatOfferDates('2027-06-15/2027-06-20', 'bg');
  assert.equal(out, '15 юни 2027 - 20 юни 2027');
  assert.ok(!out.includes('г.'), 'BG format must not carry the "г." era suffix');
  assert.ok(!out.includes('–'), 'BG format uses a plain hyphen, not an en-dash');
});

test('formatOfferDates: unknown locale falls back to EN formatting', () => {
  assert.equal(
    formatOfferDates('2027-06-15/2027-06-20', 'fr'),
    '15 Jun 2027 – 20 Jun 2027',
  );
});

test('formatOfferDates: freehand / blank / malformed → raw input returned unchanged', () => {
  assert.equal(formatOfferDates('12–18 Jun', 'en'), '12–18 Jun');
  assert.equal(formatOfferDates('', 'en'), '');
  assert.equal(formatOfferDates('2027-02-30/2027-03-05', 'en'), '2027-02-30/2027-03-05');
});
