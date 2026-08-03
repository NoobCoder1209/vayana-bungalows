import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOffers } from '../offers.js';

// Dependency-free DOM fake. offers.js uses only createElement, append,
// textContent, className, dataset, and (guarded) prepend/replaceChildren.
// The fake deliberately omits prepend/replaceChildren/createTextNode to lock
// the module to that minimal surface.
function makeEl() {
  return {
    children: [], dataset: {}, className: '', textContent: '',
    append(...kids) { this.children.push(...kids); },
    querySelectorAll(sel) {
      const cls = sel.replace('.', '');
      const out = [];
      const walk = (n) => {
        if (n.className && n.className.split(' ').includes(cls)) out.push(n);
        (n.children || []).forEach(walk);
      };
      this.children.forEach(walk);
      return out;
    },
  };
}
globalThis.document = { createElement: () => makeEl() };

const container = () => {
  const c = makeEl();
  c.dataset = {
    saveLabel: 'Save', offLabel: 'off', nightsLabel: 'nights',
    emptyMsg: 'No current offers.', errorMsg: 'Unavailable.',
  };
  return c;
};

const full = () => ({
  dates: '12–18 Jun 2026', discountPct: '20',
  priceBefore: '400', priceAfter: '320', nights: '4',
  message: 'Free breakfast included',
});
const txt = (card, cls) => {
  const n = card.querySelectorAll(cls);
  return n.length ? n[0].textContent : null;
};

test('full offer → all Price Hero rows present with correct text', () => {
  const c = container();
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__eyebrow'), '12–18 Jun 2026');
  assert.equal(txt(card, '.offer-card__struck'), '€400');
  assert.equal(txt(card, '.offer-card__hero'), '€320');
  assert.equal(txt(card, '.offer-card__save'), 'Save €80');
  assert.equal(txt(card, '.offer-card__pct'), '20% off');
  assert.equal(txt(card, '.offer-card__nights'), '4 nights');
  assert.equal(txt(card, '.offer-card__msg'), 'Free breakfast included');
});

test('save pill = derived euro when both prices present and before > after', () => {
  const c = container();
  renderOffers(c, [{ ...full(), discountPct: null, message: null, dates: null, nights: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__save'), 'Save €80');
});

test('pill falls back to "% off" when no before-price but discountPct present', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '20', priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__save'), '20% off');
});

test('pill AND pct line co-occur when both prices and discountPct present', () => {
  const c = container();
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__save'), 'Save €80'); // euro pill
  assert.equal(txt(card, '.offer-card__pct'), '20% off');   // separate line
});

test('no pill when neither euro saving nor discountPct available', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
});

test('only priceAfter present → hero only, no other rows, no divider', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), '€320');
  assert.equal(card.querySelectorAll('.offer-card__struck').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__pct').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__nights').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__msg').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__divider').length, 0);
});

test('offer without priceAfter is dropped; count matches rendered cards', () => {
  const c = container();
  renderOffers(c, [full(), { ...full(), priceAfter: null }]);
  assert.equal(c.querySelectorAll('.offer-card').length, 1);
  assert.equal(c.dataset.count, '1');
});

test('all offers lack priceAfter → empty message, count 0', () => {
  const c = container();
  renderOffers(c, [{ ...full(), priceAfter: null }, { ...full(), priceAfter: '' }]);
  assert.equal(c.querySelectorAll('.offer-card').length, 0);
  assert.equal(c.dataset.count, '0');
  const msgs = c.querySelectorAll('.offers__msg');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].textContent, 'No current offers.');
});

test('zero offers → single message card, count 0', () => {
  const c = container();
  renderOffers(c, []);
  assert.equal(c.dataset.count, '0');
  assert.equal(c.querySelectorAll('.offers__msg').length, 1);
});

test('compose labels come from dataset', () => {
  const c = container();
  c.dataset.saveLabel = 'Спестявате';
  c.dataset.offLabel = 'отстъпка';
  c.dataset.nightsLabel = 'нощувки';
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__save'), 'Спестявате €80');
  assert.equal(txt(card, '.offer-card__pct'), '20% отстъпка');
  assert.equal(txt(card, '.offer-card__nights'), '4 нощувки');
});

test('€ guard: priceAfter already prefixed does not double the symbol', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '€320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), '€320');
});

test('discountPct of 0 → no pct line and no pct pill fallback', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '0', priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(card.querySelectorAll('.offer-card__pct').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
});

test('bad data: before < after → no euro saving; pct pill fallback if present', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '20', priceBefore: '300', priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__struck'), '€300'); // present field still shown
  assert.equal(txt(card, '.offer-card__save'), '20% off'); // euro not derivable → pct fallback
});
