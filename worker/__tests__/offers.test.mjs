import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOffers } from '../src/offers.js';
import { jsonCacheableResponse, corsHeaders } from '../src/lib/response.js';

const req = (origin = 'http://localhost:5173') =>
  new Request('https://w.example/offers', { headers: origin ? { origin } : {} });
const env = { ALLOWED_ORIGINS: 'http://localhost:5173,https://noobcoder1209.github.io' };

// Column order in B3:H8 → row array indices:
//   [0]=B Dates, [1]=C Discount%, [2]=D PriceBefore, [3]=E PriceAfter,
//   [4]=F Nights, [5]=G Message, [6]=H Enable
const enabled = (over = {}) => {
  const base = ['12–18 Jun', '20', '400', '320', '4', 'Free breakfast', 'True'];
  const r = [...base];
  for (const [i, v] of Object.entries(over)) r[i] = v;
  return r;
};

test('keeps a fully-filled enabled offer, mapping columns to fields', () => {
  const out = parseOffers([enabled()]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    dates: '12–18 Jun', discountPct: '20', priceBefore: '400',
    priceAfter: '320', nights: '4', message: 'Free breakfast',
  });
});

test("drops a row whose H is not 'true' (case/space insensitive)", () => {
  assert.equal(parseOffers([enabled({ 6: 'False' })]).length, 0);
  assert.equal(parseOffers([enabled({ 6: '' })]).length, 0);
  assert.equal(parseOffers([enabled({ 6: 'yes' })]).length, 0);
  assert.equal(parseOffers([enabled({ 6: '  TRUE  ' })]).length, 1); // trims+lowercases
});

test('drops an enabled row whose B–G are all blank', () => {
  const row = ['', '', '', '', '', '', 'True'];
  assert.equal(parseOffers([row]).length, 0);
});

test('keeps an enabled row with only ONE field filled; blanks become null', () => {
  const row = ['', '', '', '', '', 'Just a message', 'True'];
  const out = parseOffers([row]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    dates: null, discountPct: null, priceBefore: null,
    priceAfter: null, nights: null, message: 'Just a message',
  });
});

test('handles short/sparse rows (Sheets omits trailing empty cells)', () => {
  // Row physically ends at C but H is logically blank → disabled → dropped.
  assert.equal(parseOffers([['12 Jun', '20']]).length, 0);
});

test('preserves sheet order and treats every surviving row uniformly', () => {
  const out = parseOffers([
    enabled({ 5: 'first' }),
    ['', '', '', '', '', '', 'False'], // disabled → gone
    enabled({ 5: 'third' }),
  ]);
  assert.deepEqual(out.map(o => o.message), ['first', 'third']);
});

test('trims whitespace-only cells to null', () => {
  const out = parseOffers([enabled({ 0: '   ' })]);
  assert.equal(out[0].dates, null);
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

// Swap global fetch for a scripted stub over the two upstream calls the
// offers path makes: (1) the OAuth token exchange, (2) the Sheets values.get.
function withMockedSheets(valuesOrThrow, run) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('sheets.googleapis.com')) {
      if (valuesOrThrow === 'ERR') return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ values: valuesOrThrow }), { status: 200 });
    }
    return new Response('unexpected', { status: 418 });
  };
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = real; _resetForTests(); });
}

test('GET /offers returns enabled offers as JSON with cache header', async () => {
  await withMockedSheets(
    [['12 Jun', '20', '400', '320', '4', 'Breakfast', 'True']],
    async () => {
      const res = await worker.fetch(getReq(), offersEnv, {});
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.offers.length, 1);
      assert.equal(body.offers[0].message, 'Breakfast');
    },
  );
});

test('GET /offers returns [] when the sheet has no enabled rows', async () => {
  await withMockedSheets(
    [['', '', '', '', '', '', 'False']],
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
