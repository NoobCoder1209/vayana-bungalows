// Home-page offers section — fetches GET /offers and renders 1–6 cards.
//
// Data comes from the Worker (SITE_CONFIG.endpoints.offers), NOT a static
// file, so this can't reuse bookings-data.js. Localized copy (field labels,
// empty/error messages) is baked onto the [data-offers] container as data-*
// attributes at build time by the i18n plugin (there is no runtime dict);
// we read them from dataset. On any failure the section shows a localized
// error message and the rest of the page is unaffected.
//
// Layout is CSS's job: this module only sets container.dataset.count so the
// stylesheet can pick the right grid (desktop) / carousel (touch) rule.

import { SITE_CONFIG } from './site-config.js';
import { openOfferModal } from './offer-modal.js';
import { currentLocale } from './util/current-locale.js';
import { formatOfferDates } from './util/offer-dates.js';

// Parse a raw sheet price string (bare number, maybe with € or spaces) to a
// finite number, or NaN. Tolerates "€400", "400", " 400 ".
// Exported so offer-modal.js can derive the same bare number for the ?price=
// enquiry param (single source of truth with the card/modal formatting).
export function parsePrice(v) {
  if (v == null || v === '') return NaN;
  return Number(String(v).replace(/[^0-9.]/g, ''));
}

// Prepend € unless the raw value already carries it (avoid €€).
// Exported so offer-modal.js formats prices identically to the card.
export function euro(raw) {
  const s = String(raw);
  return s.startsWith('€') ? s : `€${s}`;
}

// DORMANT (kept for a future discount phase): pctValue / deriveSave / bannerPct
// are defined-but-unused by the card in the current schema (discountPct and the
// before/after prices are gone). deriveSave/parsePrice/euro stay EXPORTED
// because offer-modal.js imports euro; deriveSave/parsePrice are retained for
// the planned discount phase. Do not delete.
// A positive integer-ish discount, or null.
function pctValue(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Decide the save pill: euro saving preferred, pct fallback, else null.
// Returns the ready-to-render text or null.
// Exported so offer-modal.js derives the same savings text as the card.
export function deriveSave(offer, dataset) {
  const before = parsePrice(offer.priceBefore);
  const after = parsePrice(offer.priceAfter);
  const saveLabel = dataset.saveLabel || 'Save';
  const offLabel = dataset.offLabel || 'off';
  if (Number.isFinite(before) && Number.isFinite(after) && before > after) {
    return `${saveLabel} €${before - after}`;
  }
  const pct = pctValue(offer.discountPct);
  if (pct != null) return `${pct}% ${offLabel}`;
  return null;
}

// Banner discount %: prefer the sheet's Discount % (col C); if blank, derive
// from prices (round(before−after)/before). Returns a positive integer % or null.
function bannerPct(offer) {
  const c = pctValue(offer.discountPct);
  if (c != null) return c;
  const before = parsePrice(offer.priceBefore);
  const after = parsePrice(offer.priceAfter);
  if (Number.isFinite(before) && Number.isFinite(after) && before > after) {
    return Math.round(((before - after) / before) * 100);
  }
  return null;
}

// Build one Price Hero card from the new offer shape (Task 1):
// { label, startDate, endDate, startRaw, endRaw, rate, tier, minimumToBook,
//   paidNights, freeNights, method }. `rate` (per-night, a Number) drives the
// hero and is always rendered.
// `index` is the card's position among the rendered offers (for the CTA's
// data-offer-index, useful for tests/debugging).
function buildCard(container, offer, index) {
  const ds = container.dataset;
  const card = document.createElement('article');
  card.className = 'offer-card';

  const add = (cls, text) => {
    const el = document.createElement('p');
    el.className = cls;
    el.textContent = text;
    card.append(el);
    return el;
  };

  // Banner (DORMANT): the old discount-% banner has no data source in the new
  // shape (discountPct/prices are gone), so it is not rendered. bannerPct /
  // deriveSave / pctValue remain defined-but-unused (see dormant note above),
  // kept for a future discount phase.

  // Eyebrow: localized dates from the offer object (formatOfferDates now takes
  // the offer, resolving ISO range → pretty, or falling back to raw verbatim).
  const eyebrow = formatOfferDates(offer, currentLocale());
  if (eyebrow) add('offer-card__eyebrow', eyebrow);

  // Struck price (DORMANT): no priceBefore in the new shape → not rendered.

  // Hero (required): per-night rate, e.g. "€100".
  add('offer-card__hero', euro(offer.rate));

  // Save pill (DORMANT): no savings data in the new shape → not rendered.

  // Nights-deal line: "stay minimum {min} nights get {free} free" when both
  // numbers are present & >= 1. Template comes from the [data-offers] dataset
  // key `nightsDealLabel` (Task 4 supplies the real localized value); English
  // fallback until then. Divider precedes it, mirroring the old hasFooter gate
  // (footer is now the nights line only — message is gone).
  const hasNights = offer.minimumToBook >= 1 && offer.freeNights >= 1;
  if (hasNights) {
    const d = document.createElement('span');
    d.className = 'offer-card__divider';
    card.append(d);
    const tmpl = ds.nightsDealLabel || 'stay minimum {min} nights get {free} free';
    add('offer-card__nights', tmpl.replace('{min}', offer.minimumToBook).replace('{free}', offer.freeNights));
  }

  // Gold pill CTA → opens the offer detail modal (offer-modal.js) with the
  // full offer + templated rules. A <button> (not <a>) because it triggers
  // in-page UI, not navigation. The offer object is captured in the click
  // closure; data-offer-index is kept for tests/debugging.
  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'offer-card__cta btn btn-primary';
  cta.setAttribute('data-offer-index', String(index));
  cta.textContent = ds.ctaLabel || 'Check the offer';
  cta.addEventListener('click', () => openOfferModal(offer, cta));
  card.append(cta);

  return card;
}

function buildMessage(text) {
  const msg = document.createElement('p');
  msg.className = 'offers__msg';
  msg.textContent = text;
  return msg;
}

/**
 * Render offers into the container. Pure DOM (no network) so it's unit
 * testable. Sets dataset.count = number of offers (0 for the empty state).
 */
export function renderOffers(container, offers) {
  // Clear any prior render (re-init). replaceChildren in the browser;
  // the array-based test fake has no replaceChildren, so reset its children.
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else if (Array.isArray(container.children)) container.children.length = 0;

  // The Worker (Task 1) already returns only eligible offers, so render them
  // all — no client-side re-filter on any (now-dead) field.
  const shown = offers || [];

  if (shown.length === 0) {
    container.dataset.count = '0';
    container.append(buildMessage(container.dataset.emptyMsg || 'No current offers.'));
    return;
  }
  container.dataset.count = String(shown.length);
  shown.forEach((offer, i) => container.append(buildCard(container, offer, i)));
}

function renderError(container) {
  container.dataset.count = '0';
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else if (Array.isArray(container.children)) container.children.length = 0;
  container.append(buildMessage(container.dataset.errorMsg || 'Offers are temporarily unavailable.'));
}

/**
 * Wire the offers section on the home page. No-op elsewhere.
 */
export function initOffers() {
  const container = document.querySelector('[data-offers]');
  if (!container) return;

  // Deterministic layout while the fetch is in flight (avoids a header-over-blank-gap flash); overwritten on render.
  container.dataset.count = '0';

  // No cache override: rely on the Worker's Cache-Control max-age=60 for ~1-min freshness.
  fetch(SITE_CONFIG.endpoints.offers)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      if (!data || data.ok !== true || !Array.isArray(data.offers)) {
        throw new Error('bad-shape');
      }
      renderOffers(container, data.offers);
    })
    .catch((err) => {
      console.warn('[offers] could not load offers:', err.message);
      renderError(container);
    });
}
