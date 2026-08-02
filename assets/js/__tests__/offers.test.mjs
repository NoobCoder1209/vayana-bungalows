import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOffers } from '../offers.js';

// Minimal DOM stand-in: this module only uses createElement, append,
// textContent, dataset, and className. We use a tiny fake so the test
// runs under plain node:test with no jsdom dependency (matches the repo's
// existing dependency-free test style).
function makeEl() {
  return {
    children: [], dataset: {}, className: '', textContent: '',
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    append(...kids) { this.children.push(...kids); },
    querySelectorAll(sel) {
      // only '.offer-card' and '.offers__msg' are queried in tests
      const cls = sel.replace('.', '');
      const out = [];
      const walk = (n) => { if (n.className && n.className.split(' ').includes(cls)) out.push(n); (n.children||[]).forEach(walk); };
      this.children.forEach(walk);
      return out;
    },
  };
}
// Patch a global document factory the module uses via a small shim.
globalThis.document = { createElement: () => makeEl() };

const container = () => {
  const c = makeEl();
  c.dataset = {
    labelDates: 'Dates', labelDiscount: 'Discount',
    labelPriceBefore: 'Price before', labelPriceAfter: 'Price after',
    labelNights: 'Nights', labelMessage: 'Message',
    emptyMsg: 'No current offers.', errorMsg: 'Unavailable.',
  };
  return c;
};

test('renders one card per offer and sets data-count', () => {
  const c = container();
  renderOffers(c, [
    { dates: '12 Jun', discountPct: '20', priceBefore: '400', priceAfter: '320', nights: '4', message: 'Hi' },
    { dates: '1 Jul', discountPct: null, priceBefore: null, priceAfter: null, nights: null, message: 'Yo' },
  ]);
  assert.equal(c.dataset.count, '2');
  assert.equal(c.querySelectorAll('.offer-card').length, 2);
});

test('omits blank fields (null → no row)', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: null, nights: null, message: 'Only me' }]);
  const card = c.querySelectorAll('.offer-card')[0];
  const rows = card.querySelectorAll('.offer-card__row');
  assert.equal(rows.length, 1);
});

test('formats discount with % and prices with €', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '20', priceBefore: '400', priceAfter: '320', nights: null, message: null }]);
  const rows = c.querySelectorAll('.offer-card')[0].querySelectorAll('.offer-card__row');
  const text = rows.map(r => r.textContent).join('|');
  assert.match(text, /20%/);
  assert.match(text, /€400/);
  assert.match(text, /€320/);
});

test('zero offers → single message card, data-count=0, uses emptyMsg', () => {
  const c = container();
  renderOffers(c, []);
  assert.equal(c.dataset.count, '0');
  const msgs = c.querySelectorAll('.offers__msg');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].textContent, 'No current offers.');
});
