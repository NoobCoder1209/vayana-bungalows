import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOffers, serialToISO } from '../src/offers.js';
import { jsonCacheableResponse, corsHeaders } from '../src/lib/response.js';

const req = (origin = 'http://localhost:5173') =>
  new Request('https://w.example/offers', { headers: origin ? { origin } : {} });
const env = { ALLOWED_ORIGINS: 'http://localhost:5173,https://noobcoder1209.github.io' };

// New 13-column Offers schema, range A3:M8 → row-array indices (A=0):
//   [0]=A label, [1]=B Start Date (serial|text|blank), [2]=C End Date (serial|blank),
//   [3]=D High Price, [4]=E Mid Price, [5]=F Low Price, [6]=G Price Tier,
//   [7]=H Minimum To Book, [8]=I Paid Nights, [9]=J Free Nights,
//   [10]=K V1 (TRUE/FALSE), [11]=L V2 (TRUE/FALSE), [12]=M Enabled
//
// Under valueRenderOption=UNFORMATTED_VALUE real dates come back as numeric
// serials and prices/nights as numbers. Known serials (Sheets epoch 1899-12-30):
//   46204 = 2026-07-01, 46210 = 2026-07-07
const START_SERIAL = 46204; // 2026-07-01
const END_SERIAL = 46210;   // 2026-07-07

// Build a VALID new-schema row (all eligibility gates pass) with per-index
// overrides. Enabled, real date serials, valid tier + positive price, exactly
// one V-method, minimumToBook & paidNights ≥ 1.
const enabled = (over = {}) => {
  const base = [
    'Offer 1',      // 0  A label
    START_SERIAL,   // 1  B Start Date (serial)
    END_SERIAL,     // 2  C End Date (serial)
    100,            // 3  D High Price
    80,             // 4  E Mid Price
    60,             // 5  F Low Price
    'High',         // 6  G Price Tier
    4,              // 7  H Minimum To Book
    3,              // 8  I Paid Nights
    1,              // 9  J Free Nights
    true,           // 10 K V1
    false,          // 11 L V2
    true,           // 12 M Enabled — real boolean (matches the live sheet's checkbox under UNFORMATTED_VALUE)
  ];
  const r = [...base];
  for (const [i, v] of Object.entries(over)) r[i] = v;
  return r;
};

test('serialToISO converts a known serial to ISO (46204 → 2026-07-01)', () => {
  assert.equal(serialToISO(46204), '2026-07-01');
  assert.equal(serialToISO(46210), '2026-07-07');
});

test('serialToISO returns null for non-finite / non-number / bad values', () => {
  assert.equal(serialToISO('The whole July'), null);
  assert.equal(serialToISO(''), null);
  assert.equal(serialToISO(null), null);
  assert.equal(serialToISO(undefined), null);
  assert.equal(serialToISO(NaN), null);
  assert.equal(serialToISO(Infinity), null);
});

test('keeps a fully-valid enabled offer, mapping to the new shape', () => {
  const out = parseOffers([enabled()]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    label: 'Offer 1',
    startDate: '2026-07-01',
    endDate: '2026-07-07',
    startRaw: '2026-07-01',
    endRaw: '2026-07-07',
    rate: 100,
    tier: 'High',
    minimumToBook: 4,
    paidNights: 3,
    freeNights: 1,
    method: 'V1',
  });
});

test('tier selects the matching price cell (Mid → E, Low → F)', () => {
  const mid = parseOffers([enabled({ 6: 'Mid' })]);
  assert.equal(mid[0].tier, 'Mid');
  assert.equal(mid[0].rate, 80);
  const low = parseOffers([enabled({ 6: 'Low' })]);
  assert.equal(low[0].tier, 'Low');
  assert.equal(low[0].rate, 60);
});

test('tier is case-insensitive but normalised to canonical casing', () => {
  const out = parseOffers([enabled({ 6: 'high' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tier, 'High');
  assert.equal(out[0].rate, 100);
});

// --- Eligibility DROP rules ---------------------------------------------

test("DROP: Enabled (M) not 'true' (case/space insensitive)", () => {
  assert.equal(parseOffers([enabled({ 12: 'FALSE' })]).length, 0);
  assert.equal(parseOffers([enabled({ 12: '' })]).length, 0);
  assert.equal(parseOffers([enabled({ 12: 'yes' })]).length, 0);
  assert.equal(parseOffers([enabled({ 12: false })]).length, 0);
  assert.equal(parseOffers([enabled({ 12: '  true  ' })]).length, 1); // trims+lowercases
});

test('KEEP: Enabled (M) accepts a real boolean TRUE and the string "TRUE"', () => {
  // The live sheet returns column M as a JS boolean under UNFORMATTED_VALUE;
  // a checkbox-typed Enabled cell must NOT be dropped (regression: the gate
  // once required a string and silently hid every boolean-enabled offer).
  assert.equal(parseOffers([enabled({ 12: true })]).length, 1);
  assert.equal(parseOffers([enabled({ 12: 'TRUE' })]).length, 1);
});

test('DROP: Start (B) is free text', () => {
  assert.equal(parseOffers([enabled({ 1: 'The whole July' })]).length, 0);
});

test('DROP: Start (B) blank', () => {
  assert.equal(parseOffers([enabled({ 1: '' })]).length, 0);
});

test('DROP: End (C) is free text or blank', () => {
  assert.equal(parseOffers([enabled({ 2: 'sometime' })]).length, 0);
  assert.equal(parseOffers([enabled({ 2: '' })]).length, 0);
});

test('DROP: Price Tier (G) blank or unknown', () => {
  assert.equal(parseOffers([enabled({ 6: '' })]).length, 0);
  assert.equal(parseOffers([enabled({ 6: 'Premium' })]).length, 0);
});

test('DROP: matching tier price blank or ≤ 0', () => {
  assert.equal(parseOffers([enabled({ 6: 'High', 3: '' })]).length, 0);
  assert.equal(parseOffers([enabled({ 6: 'High', 3: 0 })]).length, 0);
  assert.equal(parseOffers([enabled({ 6: 'Mid', 4: -5 })]).length, 0);
});

test('method: both V true → V1 wins', () => {
  const out = parseOffers([enabled({ 10: true, 11: true })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].method, 'V1');
});

test("method: only V2 true → 'V2'", () => {
  const out = parseOffers([enabled({ 10: false, 11: true })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].method, 'V2');
});

test('method: accepts string "TRUE"/"FALSE" for V1/V2', () => {
  const out = parseOffers([enabled({ 10: 'FALSE', 11: 'TRUE' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].method, 'V2');
});

test('DROP: neither V true', () => {
  assert.equal(parseOffers([enabled({ 10: false, 11: false })]).length, 0);
  assert.equal(parseOffers([enabled({ 10: 'FALSE', 11: 'FALSE' })]).length, 0);
});

test('DROP: minimumToBook (H) < 1', () => {
  assert.equal(parseOffers([enabled({ 7: 0 })]).length, 0);
  assert.equal(parseOffers([enabled({ 7: '' })]).length, 0);
});

test('DROP: paidNights (I) < 1', () => {
  assert.equal(parseOffers([enabled({ 8: 0 })]).length, 0);
  assert.equal(parseOffers([enabled({ 8: '' })]).length, 0);
});

test('parseOffers returns [] for non-array / empty input', () => {
  assert.deepEqual(parseOffers(null), []);
  assert.deepEqual(parseOffers([]), []);
  assert.deepEqual(parseOffers(['not-a-row']), []);
});

test('preserves sheet order, dropping ineligible rows in place', () => {
  const out = parseOffers([
    enabled({ 0: 'first' }),
    enabled({ 12: 'FALSE', 0: 'disabled' }), // dropped
    enabled({ 0: 'third' }),
  ]);
  assert.deepEqual(out.map(o => o.label), ['first', 'third']);
});

test('defensive: price as formatted string "100.00€" still parses positive', () => {
  const out = parseOffers([enabled({ 3: '100.00€' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].rate, 100);
});

test('corsHeaders advertises GET alongside POST and OPTIONS', () => {
  const h = corsHeaders(req(), env);
  assert.match(h['access-control-allow-methods'], /GET/);
  assert.match(h['access-control-allow-methods'], /POST/);
});

test('jsonCacheableResponse sets public max-age and echoes allowed origin', async () => {
  const res = jsonCacheableResponse({ ok: true, offers: [] }, 200, req(), env, 60);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await res.json(), { ok: true, offers: [] });
});

import { generateKeyPairSync } from 'node:crypto';
import worker from '../src/index.js';
import { _resetForTests } from '../src/sheets.js';

// Minimal env for the /offers path. No Turnstile/IP salt needed — /offers
// never reaches those gates. GSHEETS_SA_JSON carries a throwaway RSA key
// generated fresh per test run: it must be a *real* PKCS8 key because
// getAccessToken() imports it via jose.importPKCS8 and RS256-signs a JWT
// BEFORE the (mocked) OAuth fetch — a placeholder key would fail import
// and the success paths could never reach the mocked network. The key
// never leaves the test process; we mock global fetch so no token is used.
const FAKE_SA_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' });
const FAKE_SA = JSON.stringify({
  client_email: 'x@y.iam.gserviceaccount.com',
  private_key: FAKE_SA_KEY,
});
const offersEnv = {
  ALLOWED_ORIGINS: 'http://localhost:5173',
  GSHEETS_SHEET_ID: 'SHEET',
  GSHEETS_OFFERS_TAB: 'Offers',
  GSHEETS_SA_JSON: FAKE_SA,
};
const getReq = (path = '/offers') =>
  new Request(`https://w.example${path}`, {
    method: 'GET',
    headers: { origin: 'http://localhost:5173' },
  });

// A valid new-schema row for the integration mocks (numeric date serials).
const validRow = [
  'Offer 1', 46204, 46210, 100, 80, 60, 'High', 4, 3, 1, true, false, 'TRUE',
];

// Swap global fetch for a scripted stub over the two upstream calls the
// offers path makes: (1) the OAuth token exchange, (2) the Sheets values.get.
// Captures the Sheets URL so we can assert the range + valueRenderOption.
let lastSheetsUrl = null;
function withMockedSheets(valuesOrThrow, run) {
  const real = globalThis.fetch;
  lastSheetsUrl = null;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('sheets.googleapis.com')) {
      lastSheetsUrl = u;
      if (valuesOrThrow === 'ERR') return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ values: valuesOrThrow }), { status: 200 });
    }
    return new Response('unexpected', { status: 418 });
  };
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = real; _resetForTests(); });
}

test('GET /offers returns eligible offers as JSON with cache header', async () => {
  await withMockedSheets(
    [validRow],
    async () => {
      const res = await worker.fetch(getReq(), offersEnv, {});
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.offers.length, 1);
      assert.equal(body.offers[0].tier, 'High');
      assert.equal(body.offers[0].rate, 100);
      assert.equal(body.offers[0].method, 'V1');
      assert.equal(body.offers[0].startDate, '2026-07-01');
      assert.equal(body.offers[0].endDate, '2026-07-07');
      assert.equal(body.offers[0].minimumToBook, 4);
      assert.equal(body.offers[0].paidNights, 3);
    },
  );
});

test('fetchOffers requests A3:M8 with valueRenderOption=UNFORMATTED_VALUE', async () => {
  await withMockedSheets(
    [validRow],
    async () => {
      await worker.fetch(getReq(), offersEnv, {});
      assert.ok(lastSheetsUrl, 'sheets URL was captured');
      assert.match(lastSheetsUrl, /valueRenderOption=UNFORMATTED_VALUE/);
      // A3:M8, URL-encoded (the range is encodeURIComponent'd).
      assert.match(decodeURIComponent(lastSheetsUrl), /!A3:M8/);
    },
  );
});

test('GET /offers returns [] when the sheet has no eligible rows', async () => {
  await withMockedSheets(
    [['Offer 1', '', '', '', '', '', '', '', '', '', false, false, 'FALSE']],
    async () => {
      const res = await worker.fetch(getReq(), offersEnv, {});
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).offers, []);
    },
  );
});

test('GET /offers returns 502 when the sheet read fails', async () => {
  await withMockedSheets('ERR', async () => {
    const res = await worker.fetch(getReq(), offersEnv, {});
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'offers-unavailable');
  });
});

test('POST /offers is rejected (405) — offers is GET-only', async () => {
  const res = await worker.fetch(
    new Request('https://w.example/offers', { method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: '{}' }),
    offersEnv, {},
  );
  assert.equal(res.status, 405);
});

test('GET /submit is rejected (405) — submit stays POST-only', async () => {
  const res = await worker.fetch(getReq('/submit'), offersEnv, {});
  assert.equal(res.status, 405);
});

test('GET on an unknown path is 404', async () => {
  const res = await worker.fetch(getReq('/nope'), offersEnv, {});
  assert.equal(res.status, 404);
});
