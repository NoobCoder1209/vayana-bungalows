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

// Field render order + how each value is decorated. label is the dataset key
// holding the localized label; format wraps the raw sheet value.
const FIELDS = [
  { key: 'dates', label: 'labelDates', format: v => v },
  { key: 'discountPct', label: 'labelDiscount', format: v => `${v}%` },
  { key: 'priceBefore', label: 'labelPriceBefore', format: v => `€${v}` },
  { key: 'priceAfter', label: 'labelPriceAfter', format: v => `€${v}` },
  { key: 'nights', label: 'labelNights', format: v => v },
  { key: 'message', label: 'labelMessage', format: v => v },
];

function buildCard(container, offer) {
  const card = document.createElement('article');
  card.className = 'offer-card';
  for (const field of FIELDS) {
    const raw = offer[field.key];
    if (raw == null || raw === '') continue; // omit blank fields
    const row = document.createElement('p');
    row.className = 'offer-card__row';
    // Label goes in a leading block span (CSS puts it on its own uppercase
    // line); the formatted value is the row's own text. Assigning textContent
    // for the value keeps us inside createElement/append/textContent — the
    // tiny DOM surface the unit test's fake element provides (no createTextNode).
    row.textContent = field.format(raw);
    const label = document.createElement('span');
    label.className = 'offer-card__label';
    label.textContent = container.dataset[field.label] || field.key;
    // prepend in the real browser so the label renders above the value;
    // the array-based test fake has no prepend, so fall back to append
    // (child order is irrelevant there — the test reads row.textContent).
    if (typeof row.prepend === 'function') row.prepend(label);
    else row.append(label);
    card.append(row);
  }
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
  // Clear any prior render (loading state / re-init).
  while (container.children && container.children.length) container.children.pop?.();
  if (typeof container.replaceChildren === 'function') container.replaceChildren();

  if (!offers || offers.length === 0) {
    container.dataset.count = '0';
    container.append(buildMessage(container.dataset.emptyMsg || 'No current offers.'));
    return;
  }
  container.dataset.count = String(offers.length);
  for (const offer of offers) container.append(buildCard(container, offer));
}

function renderError(container) {
  container.dataset.count = '0';
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  container.append(buildMessage(container.dataset.errorMsg || 'Offers are temporarily unavailable.'));
}

/**
 * Wire the offers section on the home page. No-op elsewhere.
 */
export function initOffers() {
  const container = document.querySelector('[data-offers]');
  if (!container) return;

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
