// Worker-side test pinning the ENQUIRY SHEET ROW CONTRACT.
//
// The whole point of the "record originating bungalow" change is that the
// bungalow label must land in *Column B* of the Enquires sheet (index 1 of the
// appended row), and the row must stay 14 columns wide (range A:N). validateBody
// coverage (locale.test.mjs) stops one layer short of that — it proves the label
// is *computed*, not that it lands in the right *cell*. This test closes that
// gap by driving a real POST /submit through worker.fetch and capturing the
// exact array sent to the Sheets append API.
//
// A future refactor that reorders the row array, or a fat-finger swapping two
// lines in sheets.js, would silently write the bungalow into the wrong column
// and every other test would still pass. This one would fail — which is exactly
// the "schema drift" the sheets.js column-order comment warns about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import worker from '../src/index.js';
import { _resetForTests } from '../src/sheets.js';

// Real throwaway RSA key: getAccessToken() imports it via jose.importPKCS8 and
// RS256-signs a JWT before the (mocked) OAuth fetch, so a placeholder would fail
// import and never reach the mocked network. Never leaves the test process.
const FAKE_SA_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' });
const FAKE_SA = JSON.stringify({
  client_email: 'x@y.iam.gserviceaccount.com',
  private_key: FAKE_SA_KEY,
});

const submitEnv = {
  ALLOWED_ORIGINS: 'http://localhost:5173',
  GSHEETS_SHEET_ID: 'SHEET',
  GSHEETS_ENQUIRES_TAB: 'Enquires',
  GSHEETS_SA_JSON: FAKE_SA,
  TURNSTILE_SECRET: 'test-secret',
  // hashIp hard-fails on a salt < 32 chars; give it a 32-char hex.
  IP_HASH_SALT: '0'.repeat(32),
};

// A complete, valid enquiry body. bungalow:'2' is the field under test.
function submitBody(overrides = {}) {
  return JSON.stringify({
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
    locale: 'en',
    'cf-turnstile-response': 'dummy-token',
    alt_url: '', // honeypot empty → real submit path
    ...overrides,
  });
}

const submitReq = (body) =>
  new Request('https://w.example/submit', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
    },
    body,
  });

// Mock the three upstreams POST /submit hits: OAuth token, Turnstile
// siteverify (force success), and the Sheets values:append — capturing the
// append request body so the test can inspect the exact row array written.
function withCapturedAppend(run) {
  const real = globalThis.fetch;
  const captured = { appendBody: null };
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('challenges.cloudflare.com/turnstile')) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (u.includes('sheets.googleapis.com') && u.includes(':append')) {
      captured.appendBody = JSON.parse(opts.body);
      // Shape Google returns on a successful append.
      return new Response(JSON.stringify({ updates: { updatedRows: 1 } }), { status: 200 });
    }
    return new Response('unexpected', { status: 418 });
  };
  return Promise.resolve()
    .then(() => run(captured))
    .finally(() => { globalThis.fetch = real; _resetForTests(); });
}

test('POST /submit writes the bungalow label into Column B (row index 1)', async () => {
  await withCapturedAppend(async (captured) => {
    const res = await worker.fetch(submitReq(submitBody({ bungalow: '2' })), submitEnv, {});
    assert.equal(res.status, 200, 'a valid submit must succeed');
    assert.ok(captured.appendBody, 'the Sheets append must have been called');
    const row = captured.appendBody.values[0];
    assert.equal(row[1], 'Bungalow 2', 'Column B (index 1) must carry the bungalow label');
    assert.equal(row.length, 14, 'row must stay 14 columns wide (range A:N)');
  });
});

test('POST /submit with no bungalow leaves Column B blank (still 14 columns)', async () => {
  await withCapturedAppend(async (captured) => {
    // Omit the bungalow key entirely — the direct-/enquiries/ visit case.
    const body = submitBody();
    const parsed = JSON.parse(body);
    delete parsed.bungalow;
    const res = await worker.fetch(submitReq(JSON.stringify(parsed)), submitEnv, {});
    assert.equal(res.status, 200);
    const row = captured.appendBody.values[0];
    assert.equal(row[1], '', 'Column B must be blank when no bungalow was sent');
    assert.equal(row.length, 14);
  });
});

test('POST /submit does not put the bungalow anywhere else in the row', async () => {
  // Guard against a copy-paste that writes the label into two cells: the
  // label must appear ONLY at index 1, nowhere else in the row.
  await withCapturedAppend(async (captured) => {
    await worker.fetch(submitReq(submitBody({ bungalow: '3' })), submitEnv, {});
    const row = captured.appendBody.values[0];
    const hits = row.filter((c) => c === 'Bungalow 3');
    assert.equal(hits.length, 1, 'the bungalow label must occupy exactly one cell');
    assert.equal(row[1], 'Bungalow 3');
  });
});
