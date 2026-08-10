import { test } from 'node:test';
import assert from 'node:assert/strict';

// buildEnquiryUrl reads window.location.origin and (via current-locale.js)
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
  const take = { _attrs: { }, dataset: { takeMessage: "I'm taking the offer" }, setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] ?? null; } };
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
const offersContainer = { dataset: { nightsDealLabel: 'stay minimum {min} nights get {free} free' } };

globalThis.window = { location: { origin: 'https://example.test' } };
globalThis.document = {
  documentElement: { getAttribute: (k) => (k === 'lang' ? htmlLang : null) },
  getElementById: (id) => (id === 'offer-modal' ? currentModal : null),
  querySelector: (sel) => (sel === '[data-offers]' ? offersContainer : null),
  body: { style: {} },
  activeElement: null,
};

const { buildEnquiryUrl, openOfferModal } = await import('../offer-modal.js');

// New offer shape (Task 1). rate is a Number; startDate/endDate ISO-or-null.
const offer = () => ({
  label: 'Offer 1', startDate: '2026-07-01', endDate: '2026-07-15',
  startRaw: '2026-07-01', endRaw: '2026-07-15', rate: 100, tier: 'Mid',
  minimumToBook: 7, paidNights: 5, freeNights: 2, method: 'V1',
});

test('default locale (EN): links to enquiries/ with prefilled ?offer= + checkin/checkout, no price', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(offer(), "I'm taking the offer");
  const url = new URL(href);
  assert.equal(url.pathname, '/enquiries/');
  // Structured date params from offerPrefillDates.
  assert.equal(url.searchParams.get('checkin'), '2026-07-01');
  assert.equal(url.searchParams.get('checkout'), '2026-07-15');
  // No price param this phase.
  assert.equal(url.searchParams.get('price'), null);
  const msg = url.searchParams.get('offer');
  assert.ok(msg.startsWith("I'm taking the offer"), 'starts with take message');
  assert.ok(msg.includes('Dates: 1 Jul 2026 – 15 Jul 2026'), 'includes pretty dates');
  assert.ok(!msg.includes('Price:'), 'no price prose');
  assert.ok(!msg.includes('2026-07-01/2026-07-15'), 'no raw ISO range leak');
  assert.ok(!msg.includes('Nights:'), 'no nights prose');
});

test('BG locale: prefixes /bg/ before enquiries/', () => {
  htmlLang = 'bg';
  const href = buildEnquiryUrl(offer(), 'Заявявам офертата');
  const url = new URL(href);
  assert.equal(url.pathname, '/bg/enquiries/');
  assert.ok(url.searchParams.get('offer').startsWith('Заявявам офертата'));
});

test('start-only offer: only checkin, bare single-date prose, no price', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(
    { ...offer(), endDate: null, endRaw: null },
    "I'm taking the offer",
  );
  const url = new URL(href);
  assert.equal(url.searchParams.get('checkin'), '2026-07-01');
  assert.equal(url.searchParams.get('checkout'), null);
  assert.equal(url.searchParams.get('price'), null);
  const msg = url.searchParams.get('offer');
  assert.ok(msg.includes('Dates: 1 Jul 2026'), 'bare single-date prose');
  assert.ok(!msg.includes('–'), 'no range separator for a single date');
});

test('missing take message falls back to a default opener', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(offer(), undefined);
  const msg = new URL(href).searchParams.get('offer');
  assert.ok(msg.length > 0);
  assert.ok(msg.includes('taking the offer'));
});

test('freehand-dates offer: NO checkin/checkout, prose keeps raw text, no price', () => {
  htmlLang = 'en';
  const href = buildEnquiryUrl(
    { ...offer(), startDate: null, endDate: null, startRaw: 'The whole July', endRaw: null },
    "I'm taking the offer",
  );
  const url = new URL(href);
  assert.equal(url.searchParams.get('checkin'), null);
  assert.equal(url.searchParams.get('checkout'), null);
  assert.equal(url.searchParams.get('price'), null);
  assert.ok(url.searchParams.get('offer').includes('The whole July'));
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
  // Take anchor got a prefilled href.
  assert.ok(currentModal._take.getAttribute('href').includes('/enquiries/'));
});

test('openOfferModal: no nights deal → nights slot hidden', () => {
  htmlLang = 'en';
  currentModal = makeModal();
  openOfferModal({ ...offer(), minimumToBook: 0, freeNights: 0 }, null);
  assert.equal(currentModal._slots.nights.textContent, '');
  assert.equal(currentModal._slots.nights.hidden, true);
});
