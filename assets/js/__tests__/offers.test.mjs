import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOffers, euro } from '../offers.js';

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
// Mutable lang so the BG variant test can flip the locale that offers.js reads
// via currentLocale() → documentElement.getAttribute('lang'). Defaults to EN.
let htmlLang = 'en';
globalThis.document = {
  createElement: () => makeEl(),
  documentElement: { getAttribute: (k) => (k === 'lang' ? htmlLang : null) },
};

const container = () => {
  const c = makeEl();
  c.dataset = {
    ctaLabel: 'Take the offer',
    emptyMsg: 'No current offers.', errorMsg: 'Unavailable.',
    // EN deal templates (build bakes the localized values; keys must match
    // what offerDealLine reads).
    nightsDealLabel: 'stay minimum {min} nights get {free} free',
    discountPctLabel: '{pct}% off',
    discountPerDayLabel: '€{amount}/night off',
    discountTotalLabel: '€{amount} off',
  };
  return c;
};

// Public offer shape (Task 3 /offers projection): generic `price`, `type`, no
// rate/tier. Default fixture is a Type-2 pay-X-get-Y-free offer.
const full = () => ({
  label: 'Offer 1', startDate: '2026-07-01', endDate: '2026-07-15',
  startRaw: '2026-07-01', endRaw: '2026-07-15', price: 100,
  minimumToBook: 7, paidNights: 5, freeNights: 2, type: 'Type 2',
});
// A Type-1 percentage-discount offer.
const type1Pct = () => ({
  label: 'Offer T1', startDate: '2026-07-01', endDate: '2026-07-31',
  startRaw: '2026-07-01', endRaw: '2026-07-31', price: 100,
  minimumToBook: 5, type: 'Type 1', discountPct: 20,
});
const txt = (card, cls) => {
  const n = card.querySelectorAll(cls);
  return n.length ? n[0].textContent : null;
};

test('full offer → new-schema rows present; no dormant banner/struck/save', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  // Eyebrow = formatted ISO range (EN en-dash).
  assert.equal(txt(card, '.offer-card__eyebrow'), '1 Jul 2026 – 15 Jul 2026');
  // Hero = per-night rate.
  assert.equal(txt(card, '.offer-card__hero'), '€100');
  // Nights-deal line interpolated from the dataset template.
  assert.equal(txt(card, '.offer-card__nights'), 'stay minimum 7 nights get 2 free');
  // Divider present because the nights line renders.
  assert.equal(card.querySelectorAll('.offer-card__divider').length, 1);
  // Dormant elements are NOT rendered (no data source in the new shape).
  assert.equal(card.querySelectorAll('.offer-card__banner').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__struck').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__msg').length, 0);
  // Gold CTA present, correct label; a <button> that opens the modal
  // (no href) carrying its card index.
  const cta = card.querySelectorAll('.offer-card__cta')[0];
  assert.equal(cta.textContent, 'Take the offer');
  assert.equal(cta.type, 'button');
  assert.equal(cta.getAttribute('href'), null);
  assert.equal(cta.getAttribute('data-offer-index'), '0');
});

test('nights line falls back to the English template when the attr is absent', () => {
  htmlLang = 'en';
  const c = container();
  delete c.dataset.nightsDealLabel;
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__nights'), 'stay minimum 7 nights get 2 free');
});

test('nights line interpolates ALL occurrences of a repeated token (global replace)', () => {
  htmlLang = 'en';
  const c = container();
  // A template that repeats {min}/{free} must have every occurrence replaced —
  // no literal {min}/{free} may leak through.
  c.dataset.nightsDealLabel = '{min} {min} / {free} {free}';
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__nights'), '7 7 / 2 2');
});

test('CTA is present on every rendered card with localized label', () => {
  htmlLang = 'en';
  const c = container();
  c.dataset.ctaLabel = 'Вземете офертата';
  renderOffers(c, [{ ...full(), minimumToBook: 0, freeNights: 0 }]);
  const card = c.querySelectorAll('.offer-card')[0];
  const cta = card.querySelectorAll('.offer-card__cta')[0];
  assert.equal(cta.textContent, 'Вземете офертата');
  assert.equal(cta.type, 'button');
  assert.equal(cta.getAttribute('href'), null);
  assert.equal(cta.getAttribute('data-offer-index'), '0');
  // The zeroed deal fields (minimumToBook:0, freeNights:0) must suppress the
  // nights line — assert it so this override is load-bearing, not decorative.
  assert.equal(txt(card, '.offer-card__nights'), null);
});

test('hero-only offer (no nights deal) → hero present, no nights line, no divider', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, [{
    label: 'Bare', startDate: null, endDate: null, startRaw: null, endRaw: null,
    price: 120, minimumToBook: 0, paidNights: 0, freeNights: 0, type: 'Type 2',
  }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), '€120');
  assert.equal(card.querySelectorAll('.offer-card__eyebrow').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__nights').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__divider').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__banner').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__struck').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
});

test('nights line only when both minimumToBook >= 1 and freeNights >= 1', () => {
  htmlLang = 'en';
  const c = container();
  // free present but min 0 → no line
  renderOffers(c, [{ ...full(), minimumToBook: 0, freeNights: 2 }]);
  let card = c.querySelectorAll('.offer-card')[0];
  assert.equal(card.querySelectorAll('.offer-card__nights').length, 0);
  // min present but free 0 → no line
  const c2 = container();
  renderOffers(c2, [{ ...full(), minimumToBook: 7, freeNights: 0 }]);
  card = c2.querySelectorAll('.offer-card')[0];
  assert.equal(card.querySelectorAll('.offer-card__nights').length, 0);
});

test('Type 1 % offer → discount framing line, no nights line', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, [type1Pct()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), '€100');
  assert.equal(txt(card, '.offer-card__nights'), '20% off');
});

test('Type 1 per-day and total offers → their discount framing', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, [{ ...type1Pct(), discountPct: undefined, discountPerDay: 10 }]);
  assert.equal(txt(c.querySelectorAll('.offer-card')[0], '.offer-card__nights'), '€10/night off');
  const c2 = container();
  renderOffers(c2, [{ ...type1Pct(), discountPct: undefined, discountTotal: 50 }]);
  assert.equal(txt(c2.querySelectorAll('.offer-card')[0], '.offer-card__nights'), '€50 off');
});

test('all Worker-returned offers are rendered (no dead-field drop-filter)', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, [full(), { ...full(), label: 'Offer 2', price: 90 }]);
  assert.equal(c.querySelectorAll('.offer-card').length, 2);
  assert.equal(c.dataset.count, '2');
});

test('zero offers → single message card, count 0', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, []);
  assert.equal(c.dataset.count, '0');
  assert.equal(c.querySelectorAll('.offers__msg').length, 1);
  assert.equal(c.querySelectorAll('.offers__msg')[0].textContent, 'No current offers.');
});

test('null offers → empty state, count 0', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, null);
  assert.equal(c.dataset.count, '0');
  assert.equal(c.querySelectorAll('.offers__msg').length, 1);
});

test('€ guard: numeric rate renders as €<n> with no double symbol', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, [{ ...full(), price: 100 }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), '€100');
});

test('euro() returns "" for a non-price value (no €undefined / €NaN)', () => {
  assert.equal(euro(100), '€100');
  assert.equal(euro('€100'), '€100');
  assert.equal(euro(undefined), '');
  assert.equal(euro(null), '');
  assert.equal(euro(''), '');
  assert.equal(euro(NaN), '');
  assert.equal(euro('NaN'), '');
  assert.equal(euro('abc'), ''); // no digit → not a price
});

test('€ guard: a malformed offer (missing rate) renders NO hero, not "€NaN"', () => {
  htmlLang = 'en';
  const c = container();
  // Stale/old-shape offer that slipped through with no numeric rate.
  const { price, ...noRate } = full();
  renderOffers(c, [noRate]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), null); // hero element absent
});

test('ISO-range dates render as a pretty EN eyebrow', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, [{ ...full(), startDate: '2027-06-15', endDate: '2027-06-20', startRaw: '2027-06-15', endRaw: '2027-06-20' }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__eyebrow'), '15 Jun 2027 – 20 Jun 2027');
});

test('freehand dates render verbatim on the eyebrow (fail-safe)', () => {
  htmlLang = 'en';
  const c = container();
  renderOffers(c, [{ ...full(), startDate: null, endDate: null, startRaw: 'The whole July', endRaw: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__eyebrow'), 'The whole July');
});

test('BG variant → eyebrow uses a plain hyphen and no "г." era suffix', () => {
  htmlLang = 'bg';
  const c = container();
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  const eyebrow = txt(card, '.offer-card__eyebrow');
  assert.ok(!eyebrow.includes('г.'), 'BG eyebrow must not carry the "г." era suffix');
  assert.ok(!eyebrow.includes('–'), 'BG eyebrow uses a plain hyphen, not an en-dash');
  assert.ok(eyebrow.includes(' - '), 'BG eyebrow joins with a plain hyphen');
});
