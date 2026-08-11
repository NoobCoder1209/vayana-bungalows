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

// Seasonal rate-band rows [startSerial, endSerial, price] for the no-offer path.
// Serials: 46204=2026-07-01, 46234=2026-07-31, 46235=2026-08-01, 46265=2026-08-31.
// July = €130/night, August = €110/night.
const BAND_ROWS = [
  [46204, 46234, 130], // 1–31 Jul @ 130
  [46235, 46265, 110], // 1–31 Aug @ 110
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
      return new Response(JSON.stringify({ valueRanges: [{ values: valuesOrThrow }, { values: BAND_ROWS }] }), { status: 200 });
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
    // The response must be EXACTLY {ok,total,applied} — no rate/tier/discount
    // params or any other offer internals leak through /price.
    assert.deepEqual(Object.keys(body).sort(), ['applied', 'ok', 'total']);
  });
});

test('POST /price: Type 1 % applies to all in-window nights', async () => {
  await withMockedSheets([OFFER_T1], async () => {
    // Book 2026-07-01..2026-07-11 → 10 in-window nights, 20% off → 800.
    const res = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-11' }), env, {});
    const body = await res.json();
    assert.equal(body.applied, true);
    assert.equal(body.total, 800);
    // Type-1 offers carry discountPct internally — assert it does NOT leak.
    assert.deepEqual(Object.keys(body).sort(), ['applied', 'ok', 'total']);
  });
});

test('POST /price: fractional offer total is rounded to a whole euro', async () => {
  // Type-1 per-day €12.50 off, Mid €100, book 5 in-window nights (>= min 5):
  // 5 * (100 - 12.5) = 437.5 → rounded to 438. Must be an integer so the
  // enquiry price field / Worker validation (integer-only) can record it.
  const OFFER_FRACTION = [
    'Offer F', 46204, 46234, '', 100, '', 'Mid', '', 12.5, '', 5, '', '', 'Type 1',
  ];
  await withMockedSheets([OFFER_FRACTION], async () => {
    const res = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-06' }), env, {});
    const body = await res.json();
    assert.equal(body.applied, true);
    assert.equal(body.total, 438);
    assert.equal(Number.isInteger(body.total), true);
  });
});

test('POST /price: no offer applies → standard rate from the seasonal bands', async () => {
  await withMockedSheets([OFFER_T2], async () => {
    // Dates entirely outside the offer window → no offer. Book 1–5 Aug =
    // 4 nights (1,2,3,4 Aug), August band €110 → 4 × 110 = 440.
    const res = await worker.fetch(priceReq({ checkin: '2026-08-01', checkout: '2026-08-05' }), env, {});
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.applied, false);
    assert.equal(body.total, 440);
  });
});

test('POST /price: below-minimum in-window → offer not applied, standard band rate', async () => {
  await withMockedSheets([OFFER_T2], async () => {
    // 2 in-window nights (< min 9) → no discount. Book 1–3 Jul = 2 nights
    // (1,2 Jul), July band €130 → 2 × 130 = 260.
    const res = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-03' }), env, {});
    const body = await res.json();
    assert.equal(body.applied, false);
    assert.equal(body.total, 260);
  });
});

test('POST /price: no offer + a night outside all bands → 400', async () => {
  await withMockedSheets([OFFER_T2], async () => {
    // Sep is in no band (bands only cover Jul/Aug here) → standardPrice null → 400.
    const res = await worker.fetch(priceReq({ checkin: '2026-09-10', checkout: '2026-09-13' }), env, {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'bad-dates');
  });
});

test('POST /price: no offer + EMPTY rate-band table → 502 (retryable), never a silent 400', async () => {
  // A structurally-valid read whose band range parses to zero rows (transient
  // bad read, or misconfigured table). Pricing off an empty table must NOT
  // 400/blank the enquiry price — it's a server-side rate-config failure, so
  // 502 price-unavailable (retryable), distinct from the bands-present
  // uncovered-night 400 above.
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('sheets.googleapis.com')) {
      // Offers present, band range present-but-empty (→ parseRateBands → []).
      return new Response(JSON.stringify({ valueRanges: [{ values: [OFFER_T2] }, { values: [] }] }), { status: 200 });
    }
    return new Response('unexpected', { status: 418 });
  };
  try {
    // Dates outside every offer window → no-offer branch, needs bands.
    const res = await worker.fetch(priceReq({ checkin: '2026-08-01', checkout: '2026-08-05' }), env, {});
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'price-unavailable');
  } finally {
    globalThis.fetch = real; _resetForTests(); _resetOffersCacheForTests();
  }
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

test('POST /price: reversing offer order changes which applies (order-sensitive)', async () => {
  // Both windows start 07-01; T2 first now. Book 07-01..07-11 (10 nights).
  // OFFER_T2 (min 9, free 3) applies first → (10-3)*100 = 700 (differs from T1's
  // 800), proving the loop is order-sensitive, not that T1 just always wins.
  await withMockedSheets([OFFER_T2, OFFER_T1], async () => {
    const res = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-11' }), env, {});
    const body = await res.json();
    assert.equal(body.applied, true);
    assert.equal(body.total, 700);
  });
});

// Cache tests need to count sheets round-trips, so they use a bespoke mock.
function withCountingSheets(values, run) {
  const real = globalThis.fetch;
  let sheetsHits = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('sheets.googleapis.com')) {
      sheetsHits += 1;
      // Non-empty bands so the cache actually warms — getCachedData refuses to
      // cache a zero-band read (see the self-heal test below), which would
      // otherwise make every call re-read and defeat these cache assertions.
      return new Response(JSON.stringify({ valueRanges: [{ values }, { values: BAND_ROWS }] }), { status: 200 });
    }
    return new Response('unexpected', { status: 418 });
  };
  return Promise.resolve()
    .then(() => run(() => sheetsHits))
    .finally(() => { globalThis.fetch = real; _resetForTests(); _resetOffersCacheForTests(); });
}

test('POST /price: second call within 60s serves offers from cache (no extra sheets hit)', async () => {
  await withCountingSheets([OFFER_T2], async (hits) => {
    await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-10' }), env, {});
    const afterFirst = hits();
    await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-10' }), env, {});
    assert.equal(hits(), afterFirst, 'second /price call must not re-hit the sheet (cache warm)');
    assert.equal(afterFirst, 1, 'first call reads the sheet exactly once');
  });
});

test('POST /price: a zero-band read is NOT cached — the next call re-reads and self-heals', async () => {
  // Regression guard for the intermittent blank-price bug. A transient bad
  // read returns empty bands; it must not stick for the 60s TTL. While the
  // transient lasts, no-offer stays 502 (and nothing caches); once the sheet
  // returns real bands, the very next request prices correctly instead of
  // 502-ing for a full minute.
  const real = globalThis.fetch;
  let phase = 'bad';   // flip to 'good' to simulate the transient clearing
  let reads = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('sheets.googleapis.com')) {
      reads += 1;
      const bandRange = phase === 'bad' ? { values: [] } : { values: BAND_ROWS };
      return new Response(JSON.stringify({ valueRanges: [{ values: [OFFER_T2] }, bandRange] }), { status: 200 });
    }
    return new Response('unexpected', { status: 418 });
  };
  try {
    // Transient bad read → no-offer Aug stay 502s, and the empty result is not
    // cached (so it can't stick). Independent of how many reads happened.
    const r1 = await worker.fetch(priceReq({ checkin: '2026-08-01', checkout: '2026-08-05' }), env, {});
    assert.equal(r1.status, 502);
    // Transient clears. Because the empty read was never cached, the next call
    // re-reads and now sees real bands → prices (4 nights × €110 = 440).
    phase = 'good';
    const r2 = await worker.fetch(priceReq({ checkin: '2026-08-01', checkout: '2026-08-05' }), env, {});
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).total, 440);
    // That good read WAS cached (non-empty) → a third call does not re-read.
    const readsAfterHeal = reads;
    const r3 = await worker.fetch(priceReq({ checkin: '2026-08-01', checkout: '2026-08-05' }), env, {});
    assert.equal(r3.status, 200);
    assert.equal(reads, readsAfterHeal, 'third call served from warm cache (no extra read)');
  } finally {
    globalThis.fetch = real; _resetForTests(); _resetOffersCacheForTests();
  }
});

test('POST /price: warm cache is still served even if the sheet later errors', async () => {
  const real = globalThis.fetch;
  let mode = 'ok';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('sheets.googleapis.com')) {
      return mode === 'ok'
        ? new Response(JSON.stringify({ valueRanges: [{ values: [OFFER_T2] }, { values: BAND_ROWS }] }), { status: 200 })
        : new Response('nope', { status: 500 });
    }
    return new Response('unexpected', { status: 418 });
  };
  try {
    const r1 = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-10' }), env, {});
    assert.equal((await r1.json()).total, 600);   // warms the cache
    mode = 'err';                                  // sheet now errors
    const r2 = await worker.fetch(priceReq({ checkin: '2026-07-01', checkout: '2026-07-10' }), env, {});
    assert.equal(r2.status, 200);                  // still served from warm cache
    assert.equal((await r2.json()).total, 600);
  } finally {
    globalThis.fetch = real; _resetForTests(); _resetOffersCacheForTests();
  }
});

test('POST /price: 400 on bad/missing dates', async () => {
  await withMockedSheets([OFFER_T2], async () => {
    for (const b of [
      { checkin: 'x', checkout: '2026-07-10' },
      { checkin: '2026-07-10', checkout: '2026-07-01' }, // reversed
      { checkin: '2026-07-05', checkout: '2026-07-05' }, // equal (checkin < checkout fails)
      { checkin: '2026-02-30', checkout: '2026-03-05' }, // impossible-but-ISO-shaped
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

test('POST /price: a batchGet missing the band range → 502, NOT a silent 400', async () => {
  // Regression guard for the Column-L blanking bug: an anomalous batchGet that
  // returns only the offers range (no band range) must surface as a retryable
  // 502 price-unavailable — never a 400 bad-dates that silently drops the
  // price and never a cached empty-bands state. A no-offer stay is used so the
  // path goes through standardPrice(bands).
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('sheets.googleapis.com')) {
      // Only the offers valueRange present — the band range is absent.
      return new Response(JSON.stringify({ valueRanges: [{ values: [OFFER_T2] }] }), { status: 200 });
    }
    return new Response('unexpected', { status: 418 });
  };
  try {
    // Dates outside every offer window → no-offer branch → needs bands.
    const res = await worker.fetch(priceReq({ checkin: '2026-08-01', checkout: '2026-08-05' }), env, {});
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'price-unavailable');
  } finally {
    globalThis.fetch = real; _resetForTests(); _resetOffersCacheForTests();
  }
});
