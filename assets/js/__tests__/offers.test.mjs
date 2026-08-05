import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOffers } from '../offers.js';

// Dependency-free DOM fake. offers.js uses only createElement, append,
// textContent, className, dataset, and (guarded) prepend/replaceChildren.
// The fake deliberately omits prepend/replaceChildren/createTextNode to lock
// the module to that minimal surface. addEventListener is a no-op (the CTA
// button binds a click handler that never fires in these render tests).
function makeEl() {
  return {
    children: [], dataset: {}, className: '', textContent: '', type: '', _attrs: {},
    append(...kids) { this.children.push(...kids); },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    addEventListener() {},
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
    discountLabel: 'Discount', ctaLabel: 'Take the offer',
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
  assert.equal(txt(card, '.offer-card__banner'), 'Discount 20%');
  assert.equal(txt(card, '.offer-card__eyebrow'), '12–18 Jun 2026');
  assert.equal(txt(card, '.offer-card__struck'), '€400');
  assert.equal(txt(card, '.offer-card__hero'), '€320');
  assert.equal(txt(card, '.offer-card__save'), 'Save €80');
  assert.equal(txt(card, '.offer-card__nights'), '4 nights');
  assert.equal(txt(card, '.offer-card__msg'), 'Free breakfast included');
  // The redundant "20% off" line was removed once the banner carried the %.
  assert.equal(card.querySelectorAll('.offer-card__pct').length, 0);
  // Gold CTA present, correct label; now a <button> that opens the modal
  // (no href) carrying its card index.
  const cta = card.querySelectorAll('.offer-card__cta')[0];
  assert.equal(cta.textContent, 'Take the offer');
  assert.equal(cta.type, 'button');
  assert.equal(cta.getAttribute('href'), null);
  assert.equal(cta.getAttribute('data-offer-index'), '0');
});

test('CTA is present on every rendered card (even hero-only) with localized label', () => {
  const c = container();
  c.dataset.ctaLabel = 'Вземете офертата';
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  const cta = card.querySelectorAll('.offer-card__cta')[0];
  assert.equal(cta.textContent, 'Вземете офертата');
  assert.equal(cta.type, 'button');
  assert.equal(cta.getAttribute('href'), null);
  assert.equal(cta.getAttribute('data-offer-index'), '0');
});

test('banner uses the sheet Discount % (col C) when present', () => {
  const c = container();
  renderOffers(c, [{ ...full(), priceBefore: null }]); // col C present, no before-price
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__banner'), 'Discount 20%');
});

test('banner falls back to derived % from prices when Discount % is blank', () => {
  const c = container();
  // before 400 / after 320 → round((400-320)/400*100) = 20
  renderOffers(c, [{ ...full(), discountPct: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__banner'), 'Discount 20%');
});

test('no banner when neither Discount % nor a derivable % is available', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(card.querySelectorAll('.offer-card__banner').length, 0);
});

test('banner label comes from dataset (localized)', () => {
  const c = container();
  c.dataset.discountLabel = 'Отстъпка';
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__banner'), 'Отстъпка 20%');
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

test('no pill when neither euro saving nor discountPct available', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
});

test('only priceAfter present → hero only, no other rows, no divider, no banner', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), '€320');
  assert.equal(card.querySelectorAll('.offer-card__banner').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__struck').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
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
  c.dataset.nightsLabel = 'нощувки';
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__save'), 'Спестявате €80');
  assert.equal(txt(card, '.offer-card__nights'), '4 нощувки');
});

test('€ guard: priceAfter already prefixed does not double the symbol', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '€320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), '€320');
});

test('discountPct of 0 → no banner and no pct pill fallback', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '0', priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(card.querySelectorAll('.offer-card__banner').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
});

test('bad data: before < after → no euro saving; pct pill fallback if present', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '20', priceBefore: '300', priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__struck'), '€300'); // present field still shown
  assert.equal(txt(card, '.offer-card__save'), '20% off'); // euro not derivable → pct fallback
  // banner still shows col-C % (derived would be negative, so col C is used)
  assert.equal(txt(card, '.offer-card__banner'), 'Discount 20%');
});
