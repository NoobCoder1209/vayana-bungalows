import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import worker from '../src/index.js';
import { _resetForTests } from '../src/sheets.js';
import { _resetOffersCacheForTests } from '../src/offers.js';

// Real PKCS8 key (getAccessToken imports it before the mocked OAuth fetch).
const FAKE_SA = JSON.stringify({
  client_email: 'x@y.iam.gserviceaccount.com',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' }),
});
const env = {
  ALLOWED_ORIGINS: 'http://localhost:5173',
  GSHEETS_SHEET_ID: 'SHEET',
  GSHEETS_OFFERS_TAB: 'Offers',
  GSHEETS_SA_JSON: FAKE_SA,
};

// Known serials (Sheets epoch 1899-12-30): 46204 = 2026-07-01, 46213 = 2026-07-10.
// Offer window 2026-07-01..2026-07-10 (9 nights). Type 2, Mid €100, min 9, paid 6, free 3.
const OFFER_T2 = [
  'Offer 1', 46204, 46213, '', 100, '', 'Mid', '', '', '', 9, 6, 3, 'Type 2',
];
// Type 1, 20% off, broad window 2026-07-01..2026-07-31, min 5, Mid €100.
const OFFER_T1 = [
  'Offer T1', 46204, 46234, '', 100, '', 'Mid', 20, '', '', 5, '', '', 'Type 1',
];

function priceReq(bodyObj) {
  return new Request('https://w.example/price', {
    method: 'POST',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: JSON.stringify(bodyObj),
  });
}

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
    .finally(() => { globalThis.fetch = real; _resetForTests(); _resetOffersCacheForTests(); });
}

test('POST /price: Type 2 offer applies — discounted total', async () => {
  await withMockedSheets([OFFER_T2], async () => {
    // Book the exact 9-night window → (9-3)*100 = 600, applied true.
    const res = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-10' }), env, {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.applied, true);
    assert.equal(body.total, 600);
    // No rate/discount params leak in the response.
    assert.equal('rate' in body, false);
    assert.equal('tier' in body, false);
  });
});

test('POST /price: Type 1 % applies to all in-window nights', async () => {
  await withMockedSheets([OFFER_T1], async () => {
    // Book 2026-07-01..2026-07-11 → 10 in-window nights, 20% off → 800.
    const res = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-11' }), env, {});
    const body = await res.json();
    assert.equal(body.applied, true);
    assert.equal(body.total, 800);
  });
});

test('POST /price: no offer applies → standard rate (nights * 100)', async () => {
  await withMockedSheets([OFFER_T2], async () => {
    // Dates entirely outside the offer window → no offer; 4 nights * 100 = 400.
    const res = await worker.fetch(priceReq({ checkin: '2026-08-01', checkout: '2026-08-05' }), env, {});
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.applied, false);
    assert.equal(body.total, 400);
  });
});

test('POST /price: below-minimum in-window → offer not applied, standard rate', async () => {
  await withMockedSheets([OFFER_T2], async () => {
    // Book only 2 in-window nights (< min 9) → no discount; 2 nights * 100 = 200.
    const res = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-03' }), env, {});
    const body = await res.json();
    assert.equal(body.applied, false);
    assert.equal(body.total, 200);
  });
});

test('POST /price: first applicable offer wins (sheet order)', async () => {
  await withMockedSheets([OFFER_T1, OFFER_T2], async () => {
    // Both windows start 07-01; book 07-01..07-11 (10 nights).
    // OFFER_T1 (20% off, min 5) applies first → 10*100*0.8 = 800.
    const res = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-11' }), env, {});
    const body = await res.json();
    assert.equal(body.applied, true);
    assert.equal(body.total, 800);
  });
});

test('POST /price: 400 on bad/missing dates', async () => {
  await withMockedSheets([OFFER_T2], async () => {
    for (const b of [
      { checkin: 'x', checkout: '2026-07-10' },
      { checkin: '2026-07-10', checkout: '2026-07-01' }, // reversed
      { checkin: '2026-07-01' }, // missing checkout
      {},
    ]) {
      const res = await worker.fetch(priceReq(b), env, {});
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(b)}`);
    }
  });
});

test('POST /price: 415 on non-JSON content-type', async () => {
  const res = await worker.fetch(
    new Request('https://w.example/price', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'text/plain' },
      body: 'checkin=2026-07-01',
    }), env, {},
  );
  assert.equal(res.status, 415);
});

test('POST /price: 405 on GET', async () => {
  const res = await worker.fetch(
    new Request('https://w.example/price', { method: 'GET', headers: { origin: 'http://localhost:5173' } }),
    env, {},
  );
  assert.equal(res.status, 405);
});

test('POST /price: 502 when the sheet read fails', async () => {
  await withMockedSheets('ERR', async () => {
    const res = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-10' }), env, {});
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'price-unavailable');
  });
});
