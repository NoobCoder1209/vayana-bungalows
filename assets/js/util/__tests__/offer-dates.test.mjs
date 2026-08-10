import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatOfferDates, offerPrefillDates } from '../offer-dates.js';

// ── Environment guards ────────────────────────────────────────────────────
// If the runner's ICU build lacks Bulgarian month names, the BG format tests
// will silently produce wrong output. Fail fast with a clear diagnosis instead.
const bgProbe = new Intl.DateTimeFormat('bg-BG', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2027, 5, 15)));
test('environment: ICU has Bulgarian month names (full-icu)', () => {
  assert.equal(bgProbe, 'юни', `runner ICU lacks BG month names (got "${bgProbe}"); Node needs full ICU`);
});

// EN short-month for July/September varies across ICU builds. Probe the actual
// values at module load so the format tests below are pinned to what this
// runner produces, rather than a hardcoded assumption that breaks on ICU
// upgrades. (September: 'Sep' on older builds, 'Sept' on ICU 73+/Node 22+.)
const enJulProbe = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 6, 1)));
const enSepProbe = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2027, 8, 15)));
const bgJulProbe = new Intl.DateTimeFormat('bg-BG', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 6, 1)));

test('environment: EN ICU September short-month probe (Sep vs Sept detection)', () => {
  const known = ['Sep', 'Sept'];
  assert.ok(
    known.includes(enSepProbe),
    `unexpected EN short month for September: "${enSepProbe}"; expected "Sep" or "Sept". ` +
    `ICU version mismatch — update the September format tests to match.`,
  );
});

// Convenience: build an offer object with sane defaults.
function offer(overrides = {}) {
  return {
    startDate: null,
    endDate: null,
    startRaw: null,
    endRaw: null,
    ...overrides,
  };
}

// ── formatOfferDates: both ISO present ────────────────────────────────────

test('formatOfferDates: EN both ISO → "1 Jul 2026 – 15 Jul 2026" (en-dash)', () => {
  const out = formatOfferDates(offer({ startDate: '2026-07-01', endDate: '2026-07-15' }), 'en');
  assert.equal(out, `1 ${enJulProbe} 2026 – 15 ${enJulProbe} 2026`);
});

test('formatOfferDates: BG both ISO → hyphen-joined, no "г.", no en-dash', () => {
  const out = formatOfferDates(offer({ startDate: '2026-07-01', endDate: '2026-07-15' }), 'bg');
  assert.equal(out, `1 ${bgJulProbe} 2026 - 15 ${bgJulProbe} 2026`);
  assert.ok(!out.includes('г.'), 'BG format must not carry the "г." era suffix');
  assert.ok(!out.includes('–'), 'BG format uses a plain hyphen, not an en-dash');
});

test('formatOfferDates: EN September both ISO → exact string this runner produces', () => {
  const expected = `15 ${enSepProbe} 2027 – 20 ${enSepProbe} 2027`;
  const out = formatOfferDates(offer({ startDate: '2027-09-15', endDate: '2027-09-20' }), 'en');
  assert.equal(out, expected, `Expected "${expected}" — update pin if ICU changed (probe="${enSepProbe}")`);
});

test('formatOfferDates: unknown locale falls back to EN formatting', () => {
  const out = formatOfferDates(offer({ startDate: '2026-07-01', endDate: '2026-07-15' }), 'fr');
  assert.equal(out, `1 ${enJulProbe} 2026 – 15 ${enJulProbe} 2026`);
});

// ── formatOfferDates: one ISO present (bare single date, no prefix) ────────

test('formatOfferDates: only startDate ISO → bare single date, no separator/prefix', () => {
  const out = formatOfferDates(offer({ startDate: '2026-07-01', startRaw: null, endRaw: null }), 'en');
  assert.equal(out, `1 ${enJulProbe} 2026`);
  assert.ok(!out.includes('–'));
});

test('formatOfferDates: only endDate ISO → bare single date, no separator/prefix', () => {
  const out = formatOfferDates(offer({ endDate: '2026-07-15' }), 'en');
  assert.equal(out, `15 ${enJulProbe} 2026`);
  assert.ok(!out.includes('–'));
});

test('formatOfferDates: one ISO wins even when a raw string is also present', () => {
  const out = formatOfferDates(offer({ startDate: '2026-07-01', startRaw: 'The whole July' }), 'en');
  assert.equal(out, `1 ${enJulProbe} 2026`);
});

// ── formatOfferDates: neither ISO → verbatim raw ───────────────────────────

test('formatOfferDates: neither ISO, startRaw present → returns startRaw verbatim', () => {
  assert.equal(formatOfferDates(offer({ startRaw: 'The whole July' }), 'en'), 'The whole July');
});

test('formatOfferDates: neither ISO, both raw present → returns startRaw (first non-empty)', () => {
  assert.equal(
    formatOfferDates(offer({ startRaw: 'Whole summer', endRaw: 'end of Aug' }), 'en'),
    'Whole summer',
  );
});

test('formatOfferDates: neither ISO, only endRaw present → returns endRaw', () => {
  assert.equal(formatOfferDates(offer({ endRaw: 'until further notice' }), 'en'), 'until further notice');
});

test('formatOfferDates: neither ISO, startRaw blank/whitespace → falls through to endRaw', () => {
  assert.equal(formatOfferDates(offer({ startRaw: '   ', endRaw: 'August' }), 'en'), 'August');
});

test('formatOfferDates: raw string is trimmed', () => {
  assert.equal(formatOfferDates(offer({ startRaw: '  The whole July  ' }), 'en'), 'The whole July');
});

// ── formatOfferDates: nothing usable → "" ──────────────────────────────────

test('formatOfferDates: nothing usable → ""', () => {
  assert.equal(formatOfferDates(offer(), 'en'), '');
  assert.equal(formatOfferDates(offer({ startRaw: '', endRaw: '' }), 'en'), '');
});

test('formatOfferDates: invalid ISO (Feb 30) falls back to raw, else ""', () => {
  assert.equal(formatOfferDates(offer({ startDate: '2027-02-30' }), 'en'), '');
  assert.equal(formatOfferDates(offer({ startDate: '2027-02-30', startRaw: 'late Feb' }), 'en'), 'late Feb');
});

// ── formatOfferDates: defensive (null/undefined/non-object) → "" ───────────

test('formatOfferDates: null / undefined / non-object offer → "" (no throw)', () => {
  assert.equal(formatOfferDates(null, 'en'), '');
  assert.equal(formatOfferDates(undefined, 'en'), '');
  assert.equal(formatOfferDates('a string', 'en'), '');
  assert.equal(formatOfferDates(42, 'en'), '');
});

// ── offerPrefillDates ──────────────────────────────────────────────────────

test('offerPrefillDates: both ISO → {checkin, checkout}', () => {
  assert.deepEqual(
    offerPrefillDates(offer({ startDate: '2026-07-01', endDate: '2026-07-15' })),
    { checkin: '2026-07-01', checkout: '2026-07-15' },
  );
});

test('offerPrefillDates: start-only ISO → {checkin}', () => {
  assert.deepEqual(offerPrefillDates(offer({ startDate: '2026-07-01' })), { checkin: '2026-07-01' });
});

test('offerPrefillDates: end-only ISO → {checkout}', () => {
  assert.deepEqual(offerPrefillDates(offer({ endDate: '2026-07-15' })), { checkout: '2026-07-15' });
});

test('offerPrefillDates: free-text / no ISO → {}', () => {
  assert.deepEqual(offerPrefillDates(offer({ startRaw: 'The whole July' })), {});
  assert.deepEqual(offerPrefillDates(offer()), {});
});

test('offerPrefillDates: invalid ISO (Feb 30) side omitted', () => {
  assert.deepEqual(offerPrefillDates(offer({ startDate: '2027-02-30', endDate: '2026-07-15' })), { checkout: '2026-07-15' });
});

test('offerPrefillDates: does NOT enforce checkout > checkin (forwards both valid sides)', () => {
  assert.deepEqual(
    offerPrefillDates(offer({ startDate: '2026-07-15', endDate: '2026-07-01' })),
    { checkin: '2026-07-15', checkout: '2026-07-01' },
  );
});

test('offerPrefillDates: null / undefined / non-object offer → {} (no throw)', () => {
  assert.deepEqual(offerPrefillDates(null), {});
  assert.deepEqual(offerPrefillDates(undefined), {});
  assert.deepEqual(offerPrefillDates('a string'), {});
  assert.deepEqual(offerPrefillDates(42), {});
});
