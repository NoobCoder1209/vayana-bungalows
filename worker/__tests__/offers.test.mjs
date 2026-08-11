import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOffers, serialToISO } from '../src/offers.js';
import { jsonCacheableResponse, corsHeaders } from '../src/lib/response.js';

const req = (origin = 'http://localhost:5173') =>
  new Request('https://w.example/offers', { headers: origin ? { origin } : {} });
const env = { ALLOWED_ORIGINS: 'http://localhost:5173,https://noobcoder1209.github.io' };

// New 14-column Offers schema, range A3:N8 → row-array indices (A=0):
//   [0]=A label, [1]=B Start Date (serial|text|blank), [2]=C End Date (serial|blank),
//   [3]=D High Price, [4]=E Mid Price, [5]=F Low Price, [6]=G Price Tier,
//   [7]=H Discount %, [8]=I Discount per Day, [9]=J Discount Total,
//   [10]=K Minimum To Book, [11]=L Paid Nights, [12]=M Free Nights,
//   [13]=N Type 1/2 ("Type 1" | "Type 2" | empty)
//
// Under valueRenderOption=UNFORMATTED_VALUE real dates come back as numeric
// serials and prices/nights as numbers. Known serials (Sheets epoch 1899-12-30):
//   46204 = 2026-07-01, 46210 = 2026-07-07
const START_SERIAL = 46204; // 2026-07-01
const END_SERIAL = 46210;   // 2026-07-07

// Build a VALID Type-2 (pay-X-get-Y-free) row (all gates pass) with per-index
// overrides. minToBook 4 = paid 3 + free 1.
const type2 = (over = {}) => {
  const base = [
    'Offer 1',      // 0  A label
    START_SERIAL,   // 1  B Start Date (serial)
    END_SERIAL,     // 2  C End Date (serial)
    100,            // 3  D High Price
    80,             // 4  E Mid Price
    60,             // 5  F Low Price
    'High',         // 6  G Price Tier
    '',             // 7  H Discount % (unused for Type 2)
    '',             // 8  I Discount per Day
    '',             // 9  J Discount Total
    4,              // 10 K Minimum To Book
    3,              // 11 L Paid Nights
    1,              // 12 M Free Nights
    'Type 2',       // 13 N Type 1/2
  ];
  const r = [...base];
  for (const [i, v] of Object.entries(over)) r[i] = v;
  return r;
};

// Build a VALID Type-1 row with a single discount mechanism (default: 20% off).
const type1 = (over = {}) => {
  const base = [
    'Offer T1', START_SERIAL, END_SERIAL, 100, 80, 60, 'High',
    20,   // 7  H Discount % (the one mechanism)
    '',   // 8  I Discount per Day
    '',   // 9  J Discount Total
    4,    // 10 K Minimum To Book
    '',   // 11 L Paid Nights (unused for Type 1)
    '',   // 12 M Free Nights
    'Type 1', // 13 N
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

// --- Type 2 mapping ------------------------------------------------------

test('keeps a valid Type-2 offer, mapping to the internal shape', () => {
  const out = parseOffers([type2()]);
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
    type: 'Type 2',
    paidNights: 3,
    freeNights: 1,
  });
});

// --- Type 1 mapping ------------------------------------------------------

test('keeps a valid Type-1 % offer with the discount param', () => {
  const out = parseOffers([type1()]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    label: 'Offer T1',
    startDate: '2026-07-01',
    endDate: '2026-07-07',
    startRaw: '2026-07-01',
    endRaw: '2026-07-07',
    rate: 100,
    tier: 'High',
    minimumToBook: 4,
    type: 'Type 1',
    discountPct: 20,
  });
});

test('Type 1 per-day and total variants carry the right single param', () => {
  const perDay = parseOffers([type1({ 7: '', 8: 15 })]);
  assert.equal(perDay.length, 1);
  assert.equal(perDay[0].discountPerDay, 15);
  assert.equal(perDay[0].discountPct, undefined);
  assert.equal(perDay[0].discountTotal, undefined);

  const total = parseOffers([type1({ 7: '', 9: 50 })]);
  assert.equal(total.length, 1);
  assert.equal(total[0].discountTotal, 50);
  assert.equal(total[0].discountPct, undefined);
  assert.equal(total[0].discountPerDay, undefined);
});

test('Type 2 ignores any populated discount columns (uses paid/free only)', () => {
  // A Type-2 row that also has discount cells filled must still map as Type 2
  // with paid/free and NO discount params leaking onto the object.
  const out = parseOffers([type2({ 7: 20, 8: 10, 9: 50 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'Type 2');
  assert.equal(out[0].paidNights, 3);
  assert.equal(out[0].freeNights, 1);
  assert.equal(out[0].discountPct, undefined);
  assert.equal(out[0].discountPerDay, undefined);
  assert.equal(out[0].discountTotal, undefined);
});

test('tier selects the matching price cell (Mid → E, Low → F), case-insensitive', () => {
  const mid = parseOffers([type2({ 6: 'Mid' })]);
  assert.equal(mid[0].tier, 'Mid');
  assert.equal(mid[0].rate, 80);
  const low = parseOffers([type2({ 6: 'low' })]);
  assert.equal(low[0].tier, 'Low');
  assert.equal(low[0].rate, 60);
});

// --- Eligibility DROP rules ---------------------------------------------

test('DROP: Type (N) blank or unknown', () => {
  assert.equal(parseOffers([type2({ 13: '' })]).length, 0);
  assert.equal(parseOffers([type2({ 13: 'Type 3' })]).length, 0);
  assert.equal(parseOffers([type2({ 13: 'yes' })]).length, 0);
});

test('KEEP: Type accepts case/space-insensitive "type 2" / "TYPE 1"', () => {
  assert.equal(parseOffers([type2({ 13: '  type 2 ' })]).length, 1);
  assert.equal(parseOffers([type1({ 13: 'TYPE 1' })]).length, 1);
});

test('DROP: Start (B) free text or blank', () => {
  assert.equal(parseOffers([type2({ 1: 'The whole July' })]).length, 0);
  assert.equal(parseOffers([type2({ 1: '' })]).length, 0);
});

test('DROP: End (C) free text or blank', () => {
  assert.equal(parseOffers([type2({ 2: 'sometime' })]).length, 0);
  assert.equal(parseOffers([type2({ 2: '' })]).length, 0);
});

test('DROP: Price Tier (G) blank or unknown', () => {
  assert.equal(parseOffers([type2({ 6: '' })]).length, 0);
  assert.equal(parseOffers([type2({ 6: 'Premium' })]).length, 0);
});

test('DROP: matching tier price blank or ≤ 0', () => {
  assert.equal(parseOffers([type2({ 6: 'High', 3: '' })]).length, 0);
  assert.equal(parseOffers([type2({ 6: 'High', 3: 0 })]).length, 0);
  assert.equal(parseOffers([type2({ 6: 'Mid', 4: -5 })]).length, 0);
});

test('DROP: minimumToBook (K) < 1 or blank', () => {
  assert.equal(parseOffers([type2({ 10: 0 })]).length, 0);
  assert.equal(parseOffers([type2({ 10: '' })]).length, 0);
});

// --- Type 2 config validity ---------------------------------------------

test('DROP: Type 2 with paid + free !== minimumToBook', () => {
  // minToBook 4 but paid 3 + free 2 = 5.
  assert.equal(parseOffers([type2({ 11: 3, 12: 2 })]).length, 0);
});

test('DROP: Type 2 with paidNights < 1', () => {
  assert.equal(parseOffers([type2({ 11: 0, 12: 4 })]).length, 0);
  assert.equal(parseOffers([type2({ 11: '', 12: 4 })]).length, 0);
});

// --- Type 1 config validity ---------------------------------------------

test('DROP: Type 1 with zero discount mechanisms', () => {
  assert.equal(parseOffers([type1({ 7: '', 8: '', 9: '' })]).length, 0);
});

test('DROP: Type 1 with two discount mechanisms', () => {
  assert.equal(parseOffers([type1({ 7: 20, 8: 10 })]).length, 0); // pct + perDay
  assert.equal(parseOffers([type1({ 7: 20, 9: 50 })]).length, 0); // pct + total
  assert.equal(parseOffers([type1({ 7: '', 8: 10, 9: 50 })]).length, 0); // perDay + total
  assert.equal(parseOffers([type1({ 7: 20, 8: 10, 9: 50 })]).length, 0); // all three
});

test('DROP: Type 1 % not a whole number 1..99', () => {
  assert.equal(parseOffers([type1({ 7: 20.5 })]).length, 0);
  assert.equal(parseOffers([type1({ 7: 0 })]).length, 0);
  assert.equal(parseOffers([type1({ 7: 100 })]).length, 0);
  assert.equal(parseOffers([type1({ 7: 0.2 })]).length, 0);
});

test('DROP: Type 1 per-day / total ≤ 0', () => {
  assert.equal(parseOffers([type1({ 7: '', 8: 0 })]).length, 0);
  assert.equal(parseOffers([type1({ 7: '', 9: -10 })]).length, 0);
});

test('parseOffers returns [] for non-array / empty input', () => {
  assert.deepEqual(parseOffers(null), []);
  assert.deepEqual(parseOffers([]), []);
  assert.deepEqual(parseOffers(['not-a-row']), []);
});

test('preserves sheet order, dropping ineligible rows in place', () => {
  const out = parseOffers([
    type2({ 0: 'first' }),
    type2({ 13: '', 0: 'disabled' }), // dropped (no type)
    type1({ 0: 'third' }),
  ]);
  assert.deepEqual(out.map(o => o.label), ['first', 'third']);
});

test('defensive: price as formatted string "100.00€" still parses positive', () => {
  const out = parseOffers([type2({ 3: '100.00€' })]);
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

// Minimal env for the /offers path. GSHEETS_SA_JSON carries a throwaway RSA key
// generated fresh per test run (must be a real PKCS8 key — getAccessToken()
// imports it via jose.importPKCS8 before the mocked OAuth fetch).
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

// A valid Type-2 new-schema row for the integration mocks (numeric serials).
const validRow = [
  'Offer 1', 46204, 46210, 100, 80, 60, 'High', '', '', '', 4, 3, 1, 'Type 2',
];

// Swap global fetch for a scripted stub over the two upstream calls the offers
// path makes: (1) OAuth token exchange, (2) Sheets values.get. Captures the
// Sheets URL so we can assert the range + valueRenderOption.
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
      assert.equal(body.offers[0].type, 'Type 2');
      assert.equal(body.offers[0].startDate, '2026-07-01');
      assert.equal(body.offers[0].endDate, '2026-07-07');
      assert.equal(body.offers[0].minimumToBook, 4);
    },
  );
});

test('fetchOffers requests A3:N8 with valueRenderOption=UNFORMATTED_VALUE', async () => {
  await withMockedSheets(
    [validRow],
    async () => {
      await worker.fetch(getReq(), offersEnv, {});
      assert.ok(lastSheetsUrl, 'sheets URL was captured');
      assert.match(lastSheetsUrl, /valueRenderOption=UNFORMATTED_VALUE/);
      assert.match(decodeURIComponent(lastSheetsUrl), /!A3:N8/);
    },
  );
});

test('GET /offers returns [] when the sheet has no eligible rows', async () => {
  await withMockedSheets(
    [['Offer 1', '', '', '', '', '', '', '', '', '', '', '', '', '']],
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
