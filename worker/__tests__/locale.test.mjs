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
  assert.equal(res.status, 303);
});
