import { test } from 'node:test';
import assert from 'node:assert/strict';

// buildStayUrl reads window.location.origin and (via current-locale.js)
// document.documentElement.getAttribute('lang'). openOfferModal also reads
// document.getElementById('offer-modal') and querySelector('[data-offers]').
// A mutable lang lets us exercise the default (EN) and /bg/ locale paths.
let htmlLang = 'en';

// Minimal element fake supporting the modal's slot API + querySelector by
// [data-offer-slot="name"], [data-offer-take], [data-offer-slot="callout*"].
function makeSlot(name) {
  return {
    _name: name, textContent: '', hidden: false, _attrs: {},
    removeAttribute(k) { if (k === 'hidden') this.hidden = false; delete this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    focus() {},
  };
}

// A modal fake whose querySelector resolves the slots we set up by name.
function makeModal() {
  const slots = {
    dates: makeSlot('dates'), struck: makeSlot('struck'), hero: makeSlot('hero'),
    save: makeSlot('save'), nights: makeSlot('nights'), message: makeSlot('message'),
    callout: makeSlot('callout'), 'callout-dates': makeSlot('callout-dates'),
  };
  const take = { _attrs: { }, dataset: { }, setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] ?? null; } };
  const closeBtn = { focus() {} };
  return {
    hidden: true, dataset: {}, _slots: slots, _take: take,
    querySelector(sel) {
      let m = /\[data-offer-slot="([^"]+)"\]/.exec(sel);
      if (m) return slots[m[1]] || null;
      if (sel === '[data-offer-take]') return take;
      if (sel === '.modal__close' || sel === 'button[data-modal-close]' || sel === '.btn') return closeBtn;
      if (sel === '.modal__panel') return null;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    contains() { return false; },
  };
}

let currentModal = makeModal();
const offersContainer = { dataset: {
  nightsDealLabel: 'stay minimum {min} nights get {free} free',
  discountPctLabel: '{pct}% off',
  discountPerDayLabel: '€{amount}/night off',
  discountTotalLabel: '€{amount} off',
} };

globalThis.window = { location: { origin: 'https://example.test' } };
globalThis.document = {
  documentElement: { getAttribute: (k) => (k === 'lang' ? htmlLang : null) },
  getElementById: (id) => (id === 'offer-modal' ? currentModal : null),
  querySelector: (sel) => (sel === '[data-offers]' ? offersContainer : null),
  body: { style: {} },
  activeElement: null,
};

const { buildStayUrl, openOfferModal } = await import('../offer-modal.js');

// New offer shape (Task 1). rate is a Number; startDate/endDate ISO-or-null.
const offer = () => ({
  label: 'Offer 1', startDate: '2026-07-01', endDate: '2026-07-15',
  startRaw: '2026-07-01', endRaw: '2026-07-15', price: 100,
  minimumToBook: 7, paidNights: 5, freeNights: 2, type: 'Type 2',
});

test('default locale (EN): links to /stay/ with ?offerMonth from the offer start; no offer/checkin/price', () => {
  htmlLang = 'en';
  const href = buildStayUrl(offer());
  const url = new URL(href);
  assert.equal(url.pathname, '/stay/');
  assert.equal(url.searchParams.get('offerMonth'), '2026-07');
  // The old enquiry params must NOT be carried anymore.
  assert.equal(url.searchParams.get('checkin'), null);
  assert.equal(url.searchParams.get('checkout'), null);
  assert.equal(url.searchParams.get('offer'), null);
  assert.equal(url.searchParams.get('price'), null);
});

test('BG locale: prefixes /bg/ before stay/ and keeps ?offerMonth', () => {
  htmlLang = 'bg';
  const url = new URL(buildStayUrl(offer()));
  assert.equal(url.pathname, '/bg/stay/');
  assert.equal(url.searchParams.get('offerMonth'), '2026-07');
});

test('start-only offer: ?offerMonth still derived from the start ISO', () => {
  htmlLang = 'en';
  const url = new URL(buildStayUrl({ ...offer(), endDate: null, endRaw: null }));
  assert.equal(url.pathname, '/stay/');
  assert.equal(url.searchParams.get('offerMonth'), '2026-07');
});

test('freehand-dates offer (no real start ISO): plain /stay/, no ?offerMonth', () => {
  htmlLang = 'en';
  const url = new URL(buildStayUrl(
    { ...offer(), startDate: null, endDate: null, startRaw: 'The whole July', endRaw: null },
  ));
  assert.equal(url.pathname, '/stay/');
  assert.equal(url.searchParams.get('offerMonth'), null);
  assert.equal(url.search, ''); // no query at all
});

test('openOfferModal populates dates/hero/nights slots; struck/save stay hidden', () => {
  htmlLang = 'en';
  currentModal = makeModal();
  openOfferModal(offer(), null);
  const s = currentModal._slots;
  assert.equal(s.dates.textContent, '1 Jul 2026 – 15 Jul 2026');
  assert.equal(s.dates.hidden, false);
  assert.equal(s.hero.textContent, '€100');
  assert.equal(s.hero.hidden, false);
  assert.equal(s.nights.textContent, 'stay minimum 7 nights get 2 free');
  assert.equal(s.nights.hidden, false);
  // Dormant slots: empty text and hidden.
  assert.equal(s.struck.textContent, '');
  assert.equal(s.struck.hidden, true);
  assert.equal(s.save.textContent, '');
  assert.equal(s.save.hidden, true);
  // Callout shows the formatted dates when a date range is present.
  assert.equal(currentModal._slots['callout-dates'].textContent, '1 Jul 2026 – 15 Jul 2026');
  assert.equal(currentModal._slots.callout.hidden, false);
  // Take anchor points at /stay/ (with the offer's month) — not the enquiry.
  const takeHref = currentModal._take.getAttribute('href');
  assert.ok(takeHref.includes('/stay/'), `take href → /stay/: ${takeHref}`);
  assert.ok(takeHref.includes('offerMonth=2026-07'), `carries offerMonth: ${takeHref}`);
  assert.ok(!takeHref.includes('/enquiries/'), 'no longer links to the enquiry');
});

test('openOfferModal renders Type-1 discount framing in the nights slot', () => {
  htmlLang = 'en';
  currentModal = makeModal();
  // A Type-1 % offer routes through the SAME offerDealLine helper as the card.
  openOfferModal({
    label: 'T1', startDate: '2026-07-01', endDate: '2026-07-31',
    startRaw: '2026-07-01', endRaw: '2026-07-31', price: 100,
    minimumToBook: 5, type: 'Type 1', discountPct: 20,
  }, null);
  const s = currentModal._slots;
  assert.equal(s.hero.textContent, '€100');
  assert.equal(s.nights.textContent, '20% off');
  assert.equal(s.nights.hidden, false);
});

test('openOfferModal: no nights deal → nights slot hidden', () => {
  htmlLang = 'en';
  currentModal = makeModal();
  openOfferModal({ ...offer(), minimumToBook: 0, freeNights: 0 }, null);
  assert.equal(currentModal._slots.nights.textContent, '');
  assert.equal(currentModal._slots.nights.hidden, true);
});
