import { test } from 'node:test';
import assert from 'node:assert/strict';

// buildEnquiryUrl reads window.location.origin and (via current-locale.js)
// document.documentElement.getAttribute('lang'). Stub both before importing.
// A mutable lang lets us exercise the default (EN) and /bg/ locale paths.
let htmlLang = 'en';
globalThis.window = { location: { origin: 'https://example.test' } };
globalThis.document = {
  documentElement: { getAttribute: (k) => (k === 'lang' ? htmlLang : null) },
};

const { buildEnquiryUrl } = await import('../offer-modal.js');

const offer = () => ({
  dates: '12–18 June 2026',
  discountPct: '20',
  priceBefore: '400',
  priceAfter: '320',
  nights: '4',
  message: 'Free breakfast included',
});

test('default locale (EN): links to enquiries/ with prefilled ?offer=', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(offer(), "I'm taking the offer");
  const url = new URL(href);
  // No BASE_URL under node --test → dev base '/', no /bg/ prefix on default.
  assert.equal(url.pathname, '/enquiries/');
  const msg = url.searchParams.get('offer');
  assert.ok(msg.startsWith("I'm taking the offer"), 'starts with take message');
  assert.ok(msg.includes('12–18 June 2026'), 'includes dates');
  assert.ok(msg.includes('€320'), 'includes price');
  assert.ok(msg.includes('Nights: 4'), 'includes nights');
  assert.ok(msg.includes('Free breakfast included'), 'includes message');
});

test('BG locale: prefixes /bg/ before enquiries/', () => {
  htmlLang = 'bg';
  const href = buildEnquiryUrl(offer(), 'Заявявам офертата');
  const url = new URL(href);
  assert.equal(url.pathname, '/bg/enquiries/');
  assert.ok(url.searchParams.get('offer').startsWith('Заявявам офертата'));
});

test('sparse offer (hero only): message is just the take opener', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(
    { dates: null, priceBefore: null, priceAfter: '320', nights: null, message: null },
    "I'm taking the offer"
  );
  const msg = new URL(href).searchParams.get('offer');
  // Opener + price (priceAfter present), but no dates/nights/message glue.
  assert.ok(msg.startsWith("I'm taking the offer"));
  assert.ok(msg.includes('€320'));
  assert.ok(!msg.includes('Dates:'));
  assert.ok(!msg.includes('Nights:'));
});

test('missing take message falls back to a default opener', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(offer(), undefined);
  const msg = new URL(href).searchParams.get('offer');
  assert.ok(msg.length > 0);
  assert.ok(msg.includes('taking the offer'));
});

test('ISO-range offer: buildEnquiryUrl emits checkin/checkout + pretty prose (EN)', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(
    { dates: '2027-06-15/2027-06-20', priceBefore: null, priceAfter: '320', nights: null, message: null },
    "I'm taking the offer",
  );
  const url = new URL(href);
  assert.equal(url.searchParams.get('checkin'), '2027-06-15');
  assert.equal(url.searchParams.get('checkout'), '2027-06-20');
  // Prose carries the FORMATTED range, not the raw ISO.
  const msg = url.searchParams.get('offer');
  assert.ok(msg.includes('15 Jun 2027 – 20 Jun 2027'), 'prose shows pretty dates');
  assert.ok(!msg.includes('2027-06-15/2027-06-20'), 'prose does not leak raw ISO');
});

test('freehand-dates offer: buildEnquiryUrl emits NO checkin/checkout, prose keeps raw text', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(
    { dates: '12–18 June 2026', priceBefore: null, priceAfter: '320', nights: null, message: null },
    "I'm taking the offer",
  );
  const url = new URL(href);
  assert.equal(url.searchParams.get('checkin'), null);
  assert.equal(url.searchParams.get('checkout'), null);
  // Freehand passes through unchanged (formatOfferDates returns raw).
  assert.ok(url.searchParams.get('offer').includes('12–18 June 2026'));
});
