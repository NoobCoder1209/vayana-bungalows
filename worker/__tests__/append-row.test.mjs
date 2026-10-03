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
import { _resetForTests as resetRateLimit } from '../src/rate-limit.js';

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
    pets: '0',
    message: 'Hi',
    consent: 'true',
    locale: 'en',
    'cf-turnstile-response': 'dummy-token',
    alt_url: '', // honeypot empty → real submit path
    ...overrides,
  });
}

// Fixed client IP is fine: each test resets the in-memory rate limiter (and the
// token cache) in withCapturedAppend's finally, so buckets never accumulate
// across tests regardless of run order or how many requests fire.
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
    .finally(() => { globalThis.fetch = real; _resetForTests(); resetRateLimit(); });
}

test('POST /submit writes the bungalow label into Column B (row index 1)', async () => {
  await withCapturedAppend(async (captured) => {
    const res = await worker.fetch(submitReq(submitBody({ bungalow: '2' })), submitEnv, {});
    assert.equal(res.status, 200, 'a valid submit must succeed');
    assert.ok(captured.appendBody, 'the Sheets append must have been called');
    const row = captured.appendBody.values[0];
    assert.equal(row[1], 'Bungalow 2', 'Column B (index 1) must carry the bungalow label');
    assert.equal(row.length, 16, 'row must be 16 columns wide (range A:P)');
  });
});

test('POST /submit with no bungalow leaves Column B blank (still 16 columns)', async () => {
  await withCapturedAppend(async (captured) => {
    // Omit the bungalow key entirely — the direct-/enquiries/ visit case.
    const body = submitBody();
    const parsed = JSON.parse(body);
    delete parsed.bungalow;
    const res = await worker.fetch(submitReq(JSON.stringify(parsed)), submitEnv, {});
    assert.equal(res.status, 200);
    const row = captured.appendBody.values[0];
    assert.equal(row[1], '', 'Column B must be blank when no bungalow was sent');
    assert.equal(row.length, 16);
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

// ── Price → Column M (index 12), with the trailing columns shifted right ──────

test('POST /submit writes the price into Column M (row index 12), consent shifts to N', async () => {
  await withCapturedAppend(async (captured) => {
    const res = await worker.fetch(submitReq(submitBody({ price: '500' })), submitEnv, {});
    assert.equal(res.status, 200, 'a valid submit must succeed');
    const row = captured.appendBody.values[0];
    assert.equal(row[12], '500', 'Column M (index 12) must carry the price');
    assert.equal(row[13], 'true', 'consent must have shifted to Column N (index 13)');
    assert.ok(typeof row[14] === 'string' && row[14].length > 0, 'source_ip_hash present at Column O (index 14)');
    assert.equal(row[15], 'en', 'locale must have shifted to Column P (index 15)');
    assert.equal(row.length, 16, 'row must be 16 columns wide (range A:P)');
    const hits = row.filter((c) => c === '500');
    assert.equal(hits.length, 1, 'the price must occupy exactly one cell');
  });
});

test('POST /submit with no price leaves Column M blank (still 16 columns)', async () => {
  await withCapturedAppend(async (captured) => {
    // Omit price entirely — the direct-/enquiries/ visit case.
    const parsed = JSON.parse(submitBody());
    delete parsed.price;
    const res = await worker.fetch(submitReq(JSON.stringify(parsed)), submitEnv, {});
    assert.equal(res.status, 200);
    const row = captured.appendBody.values[0];
    assert.equal(row[12], '', 'Column M must be blank when no price was sent');
    assert.equal(row.length, 16);
  });
});

test('POST /submit with junk price records blank Column M (never 400, never junk in the sheet)', async () => {
  await withCapturedAppend(async (captured) => {
    const res = await worker.fetch(submitReq(submitBody({ price: 'abc' })), submitEnv, {});
    assert.equal(res.status, 200, 'a junk price must not fail the submission');
    assert.equal(captured.appendBody.values[0][12], '', 'junk price → blank Column M');
  });
});

test('POST /submit with price and bungalow together lands both in their own cells', async () => {
  await withCapturedAppend(async (captured) => {
    await worker.fetch(submitReq(submitBody({ bungalow: '1', price: '600' })), submitEnv, {});
    const row = captured.appendBody.values[0];
    assert.equal(row[1], 'Bungalow 1', 'bungalow stays at Column B (index 1)');
    assert.equal(row[12], '600', 'price at Column M (index 12)');
    assert.equal(row.length, 16);
  });
});

// ── Pets → Column K (index 10), inserted between infants and message ─────────

test('POST /submit writes pets into Column K (index 10); message shifts to L', async () => {
  await withCapturedAppend(async (captured) => {
    const res = await worker.fetch(submitReq(submitBody({ pets: '2' })), submitEnv, {});
    assert.equal(res.status, 200, 'a valid submit must succeed');
    const row = captured.appendBody.values[0];
    assert.equal(row[10], '2', 'Column K (index 10) must carry pets');
    assert.equal(row[11], 'Hi', 'message must have shifted to Column L (index 11)');
    assert.equal(row.length, 16, 'row must be 16 columns wide (range A:P)');
  });
});

test('POST /submit with out-of-range pets rejects (400 validation)', async () => {
  const res = await worker.fetch(submitReq(submitBody({ pets: '5' })), submitEnv, {});
  assert.equal(res.status, 400, 'pets outside 0..2 must fail validation');
});

test('POST /submit with no pets key leaves Column K at "0" (optional, normalised)', async () => {
  await withCapturedAppend(async (captured) => {
    const parsed = JSON.parse(submitBody());
    delete parsed.pets;
    const res = await worker.fetch(submitReq(JSON.stringify(parsed)), submitEnv, {});
    assert.equal(res.status, 200, 'omitting pets must not fail the submission');
    assert.equal(captured.appendBody.values[0][10], '0', 'absent pets normalises to "0" in Column K');
  });
});
