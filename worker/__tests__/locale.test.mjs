// Worker-side tests for Task #167 locale integration.
//
// - validation.js: `locale` field accepted, unknown/missing degrades to
//   default, does NOT invalidate the whole submission.
// - lib/response.js: redirectResponse() prefixes /bg for non-default,
//   leaves EN unprefixed, and refuses unknown locales.
//
// Worker modules are ESM; node:test loads them directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBody } from '../src/validation.js';
import { redirectResponse } from '../src/lib/response.js';

// Baseline "valid enquiry body" — used as a template each test mutates.
function baseBody(overrides = {}) {
  return {
    name: 'Ivan Petrov',
    email: 'ivan@example.com',
    phone: '+359888123456',
    checkin: '2027-06-15',
    checkout: '2027-06-20',
    adults: '2',
    children: '0',
    infants: '0',
    message: 'Hi',
    consent: 'true',
    ...overrides,
  };
}

// ── validation.js: locale field ──────────────────────────────────────────

test('validateBody: accepts locale="en" and returns cleaned.locale="en"', () => {
  const r = validateBody(baseBody({ locale: 'en' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.locale, 'en');
});

test('validateBody: accepts locale="bg" and returns cleaned.locale="bg"', () => {
  const r = validateBody(baseBody({ locale: 'bg' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.locale, 'bg');
});

test('validateBody: missing locale key defaults to "en"', () => {
  const r = validateBody(baseBody());
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.locale, 'en');
});

test('validateBody: unknown locale value silently degrades to "en" (does NOT invalidate)', () => {
  const r = validateBody(baseBody({ locale: 'de' }));
  assert.equal(r.ok, true, 'unknown locale must not fail the whole submission');
  assert.equal(r.cleaned.locale, 'en');
});

test('validateBody: non-string locale (number) degrades to "en"', () => {
  const r = validateBody(baseBody({ locale: 42 }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.locale, 'en');
});

test('validateBody: whitespace-only locale degrades to "en"', () => {
  const r = validateBody(baseBody({ locale: '   ' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.locale, 'en');
});

test('validateBody: padded but valid locale is trimmed and accepted', () => {
  const r = validateBody(baseBody({ locale: '  bg  ' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.locale, 'bg');
});

// ── validation.js: bungalow field ────────────────────────────────────────
// Optional metadata sent by the /stay/ pill as a compact key ('1'|'2'|'3');
// mapped to a human label for Column B. Unknown/missing degrades to '' (blank
// column) and must NEVER invalidate the submission — same contract as locale.

test('validateBody: bungalow="1" maps to cleaned.bungalow="Bungalow 1"', () => {
  const r = validateBody(baseBody({ bungalow: '1' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.bungalow, 'Bungalow 1');
});

test('validateBody: bungalow="2" maps to "Bungalow 2"', () => {
  const r = validateBody(baseBody({ bungalow: '2' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.bungalow, 'Bungalow 2');
});

test('validateBody: bungalow="3" maps to "Bungalow 3"', () => {
  const r = validateBody(baseBody({ bungalow: '3' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.bungalow, 'Bungalow 3');
});

test('validateBody: missing bungalow key → cleaned.bungalow="" (blank, still ok)', () => {
  const r = validateBody(baseBody());
  assert.equal(r.ok, true, 'a non-bungalow enquiry must still validate');
  assert.equal(r.cleaned.bungalow, '');
});

test('validateBody: unknown bungalow value silently degrades to "" (does NOT invalidate)', () => {
  const r = validateBody(baseBody({ bungalow: '9' }));
  assert.equal(r.ok, true, 'a bad bungalow value must not fail the whole submission');
  assert.equal(r.cleaned.bungalow, '');
});

test('validateBody: junk/non-string bungalow degrades to ""', () => {
  const r = validateBody(baseBody({ bungalow: { evil: true } }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.bungalow, '');
});

test('validateBody: padded bungalow key is trimmed and mapped', () => {
  const r = validateBody(baseBody({ bungalow: '  2  ' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.bungalow, 'Bungalow 2');
});

test('validateBody: a client-supplied label (not a key) does NOT leak into the sheet', () => {
  // Defence: only our own keys map to labels; a spoofed "Bungalow 9000" or a
  // formula string can never reach Column B — it falls through to ''.
  const r = validateBody(baseBody({ bungalow: '=cmd|/c calc' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.bungalow, '');
});

// ── validation.js: price field ───────────────────────────────────────────
// Optional client-originated metadata (the end price), sanitised to a bare
// digit string for Column L. Currency symbols/whitespace are stripped, but a
// separator (decimal/thousands) makes the magnitude untrustworthy → blank, not
// a mangled integer. Unknown/missing → '' and NEVER invalidates the submission.

test('validateBody: price="500" → cleaned.price="500"', () => {
  const r = validateBody(baseBody({ price: '500' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.price, '500');
});

test('validateBody: price="€400" strips the currency symbol → "400"', () => {
  const r = validateBody(baseBody({ price: '€400' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.price, '400');
});

test('validateBody: price with surrounding whitespace is trimmed → digits', () => {
  const r = validateBody(baseBody({ price: '  600 ' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.price, '600');
});

test('validateBody: decimal price degrades to "" (honest blank, not an inflated integer)', () => {
  // "400.50" must NOT become "40050" — a separator means we can't trust the
  // magnitude, so we record blank rather than a 100× wrong number.
  const r = validateBody(baseBody({ price: '400.50' }));
  assert.equal(r.ok, true, 'a bad price must not fail the submission');
  assert.equal(r.cleaned.price, '');
});

test('validateBody: thousands-separated price degrades to ""', () => {
  const r = validateBody(baseBody({ price: '1,250' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.price, '');
});

test('validateBody: non-numeric price degrades to ""', () => {
  const r = validateBody(baseBody({ price: 'free' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.price, '');
});

test('validateBody: missing price key → cleaned.price="" (blank, still ok)', () => {
  const r = validateBody(baseBody());
  assert.equal(r.ok, true, 'a priceless enquiry must still validate');
  assert.equal(r.cleaned.price, '');
});

test('validateBody: over-long (8+ digit) price degrades to ""', () => {
  const r = validateBody(baseBody({ price: '12345678' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.price, '');
});

test('validateBody: non-string/junk price degrades to "" without throwing', () => {
  const r = validateBody(baseBody({ price: { evil: true } }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.price, '');
});

test('validateBody: a formula-shaped price cannot reach the sheet', () => {
  const r = validateBody(baseBody({ price: '=1+1' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.price, '');
});

test('validateBody: price="0" is kept as "0" (documents server behavior)', () => {
  // The frontend only ever emits price>0 (the pill guards `price > 0`; the
  // offer modal guards `p > 0`), so '0' is out-of-contract from real callers.
  // The Worker does not special-case it — a literal '0' passes /^\d{1,7}$/ and
  // is recorded as-is. Pinned so a future change to blank-out zero is a
  // deliberate, test-visible decision rather than an accident.
  const r = validateBody(baseBody({ price: '0' }));
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.price, '0');
});

// ── lib/response.js: redirectResponse locale prefix ──────────────────────

// Minimal Request-shaped object — redirectResponse reads .headers.get()
// via pickOrigin, and env supplies ALLOWED_ORIGINS + SITE_BASE.
function makeReq(origin) {
  return {
    headers: {
      get(name) {
        if (name === 'origin') return origin;
        return null;
      },
    },
  };
}
const ENV = {
  ALLOWED_ORIGINS: 'https://example.test',
  SITE_BASE: '/vayana-bungalows',
};

async function locationOf(res) {
  return res.headers.get('location');
}

test('redirectResponse: EN locale → no /bg/ prefix (default locale is unprefixed)', async () => {
  const res = redirectResponse('/enquiries/thanks/', makeReq('https://example.test'), ENV, 'en');
  assert.equal(await locationOf(res), 'https://example.test/vayana-bungalows/enquiries/thanks/');
});

test('redirectResponse: BG locale → /bg/ prefix inserted between base and path', async () => {
  const res = redirectResponse('/enquiries/thanks/', makeReq('https://example.test'), ENV, 'bg');
  assert.equal(await locationOf(res), 'https://example.test/vayana-bungalows/bg/enquiries/thanks/');
});

test('redirectResponse: unknown locale silently falls back to default (no /xx/ prefix)', async () => {
  // A future locale not yet in the Worker's allowlist should NOT
  // produce /xx/enquiries/... — that URL would 404 on the mirror.
  // Fall back to the default locale's URL so the user still lands
  // on a real page.
  const res = redirectResponse('/enquiries/thanks/', makeReq('https://example.test'), ENV, 'xx');
  assert.equal(await locationOf(res), 'https://example.test/vayana-bungalows/enquiries/thanks/');
});

test('redirectResponse: missing locale param falls back to default', async () => {
  const res = redirectResponse('/enquiries/thanks/', makeReq('https://example.test'), ENV);
  assert.equal(await locationOf(res), 'https://example.test/vayana-bungalows/enquiries/thanks/');
});

test('redirectResponse: null locale falls back to default', async () => {
  const res = redirectResponse('/enquiries/thanks/', makeReq('https://example.test'), ENV, null);
  assert.equal(await locationOf(res), 'https://example.test/vayana-bungalows/enquiries/thanks/');
});

test('redirectResponse: error path (?err=captcha) with BG locale routes to /bg/enquiries/', async () => {
  const res = redirectResponse('/enquiries/?err=captcha', makeReq('https://example.test'), ENV, 'bg');
  assert.equal(await locationOf(res), 'https://example.test/vayana-bungalows/bg/enquiries/?err=captcha');
});

test('redirectResponse: returns status 303 (post-redirect-get)', async () => {
  const res = redirectResponse('/enquiries/thanks/', makeReq('https://example.test'), ENV, 'bg');
  assert.equal(res.status, 303);});

test('redirectResponse: SITE_BASE with trailing slash is normalized (no double-slash)', async () => {
  // Round-4 F13 regression guard: an operator typo of SITE_BASE ending
  // in a slash previously emitted `//bg/enquiries/thanks/` (double slash
  // between base and locale prefix). redirectResponse now trims the
  // trailing slash before concatenation.
  const envWithTrailing = {
    ALLOWED_ORIGINS: 'https://example.test',
    SITE_BASE: '/vayana-bungalows/',
  };
  const res = redirectResponse(
    '/enquiries/thanks/',
    makeReq('https://example.test'),
    envWithTrailing,
    'bg',
  );
  assert.equal(
    await locationOf(res),
    'https://example.test/vayana-bungalows/bg/enquiries/thanks/',
    'trailing-slash SITE_BASE must not emit //bg/ double-slash',
  );
});

test('redirectResponse: SITE_BASE without trailing slash (canonical form) unchanged', async () => {
  // Sanity check: the fix must not break the canonical no-trailing-slash
  // config that ships in production wrangler.toml.
  const res = redirectResponse(
    '/enquiries/thanks/',
    makeReq('https://example.test'),
    ENV,
    'bg',
  );
  assert.equal(
    await locationOf(res),
    'https://example.test/vayana-bungalows/bg/enquiries/thanks/',
  );
});

