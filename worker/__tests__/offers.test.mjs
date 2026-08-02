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
