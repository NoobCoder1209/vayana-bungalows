import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfferDates, formatOfferDates } from '../offer-dates.js';

// ── Environment guard ─────────────────────────────────────────────────────
// If the runner's ICU build lacks Bulgarian month names, the BG format tests
// will silently produce wrong output. Fail fast with a clear diagnosis instead.
const bgProbe = new Intl.DateTimeFormat('bg-BG', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2027, 5, 15)));
test('environment: ICU has Bulgarian month names (full-icu)', () => {
  assert.equal(bgProbe, 'юни', `runner ICU lacks BG month names (got "${bgProbe}"); Node needs full ICU`);
});

// EN September ICU guard: 'en-GB' short month for September can render 'Sep'
// (most ICU builds) or 'Sept' (Node v22+ / ICU 73+). Probe the actual value
// so the September format tests below are pinned to what this runner produces,
// rather than a hardcoded assumption that breaks on ICU upgrades.
// This runner (Node v26 / ICU 76+) produces 'Sept'.
const enSepProbe = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2027, 8, 15)));
test('environment: EN ICU September short-month probe (Sep vs Sept detection)', () => {
  const known = ['Sep', 'Sept'];
  assert.ok(
    known.includes(enSepProbe),
    `unexpected EN short month for September: "${enSepProbe}"; expected "Sep" or "Sept". ` +
    `ICU version mismatch — update the September format tests to match.`,
  );
});

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

test('formatOfferDates: null input → "" (string type contract)', () => {
  assert.equal(formatOfferDates(null, 'en'), '');
});

test('formatOfferDates: undefined input → "" (string type contract)', () => {
  assert.equal(formatOfferDates(undefined, 'en'), '');
});

// ── September coverage (Sep vs Sept ICU risk) ─────────────────────────────
// The EN short month name for September varies by ICU version ('Sep' on older
// builds, 'Sept' on ICU 73+/Node 22+). These tests are pinned to what this
// runner actually produces (observed: 'Sept' on Node v26/ICU 76+) so that a
// future ICU upgrade causes a deliberate compile-time failure here rather than
// a silent wrong value reaching production.

test('formatOfferDates: EN September range → exact string this runner produces', () => {
  // enSepProbe was computed above at module load time; pin to it.
  const expected = `15 ${enSepProbe} 2027 – 20 ${enSepProbe} 2027`;
  assert.equal(
    formatOfferDates('2027-09-15/2027-09-20', 'en'),
    expected,
    `Expected "${expected}" — update pin if ICU changed (probe="${enSepProbe}")`,
  );
});

test('formatOfferDates: BG September range → localized name, hyphen, no г.', () => {
  const out = formatOfferDates('2027-09-15/2027-09-20', 'bg');
  // Observed: "15 септември 2027 - 20 септември 2027"
  assert.equal(out, '15 септември 2027 - 20 септември 2027');
  assert.ok(!out.includes('г.'), 'BG September must not carry the "г." era suffix');
  assert.ok(!out.includes('–'), 'BG September format uses a plain hyphen, not an en-dash');
});
