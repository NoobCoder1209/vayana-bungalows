// Offer detail modal — opened from the home-page offer cards' CTA.
//
// The card CTA used to link to /stay/; now it opens this modal, which shows
// the FULL offer (dates, prices, savings, nights, message) plus a templated
// rules/terms block that is identical for every offer. Only the per-offer
// dynamic values differ — they're injected into the static #offer-modal
// template's [data-offer-slot] placeholders (all boilerplate copy is
// localized at build time via data-i18n markers; there is no runtime dict).
//
// The modal is info-only except for the bottom "Take the offer" button, which
// deep-links to /enquiries/ carrying a prefilled ?offer=<message> so the
// enquiry form's message textarea is pre-populated with the offer details.
//
// Reuses the .modal pattern (sections.css) and the focus-trap / Escape /
// focus-restore conventions from enquiry.js.

import { euro, deriveSave } from './offers.js';
import { currentLocale, isDefaultLocale } from './util/current-locale.js';

// Remember what was focused before opening so we can restore it on close.
let lastFocusBeforeModal = null;

// Build the locale-aware /enquiries/ deep link with a prefilled ?offer=
// message. Mirrors booking.js's BASE_URL + localePrefix pattern so it works
// from any page depth under the GitHub Pages base (/vayana-bungalows/) and in
// dev (/), and keeps a /bg/ visitor in Bulgarian. Exported for unit testing.
export function buildEnquiryUrl(offer, takeMsg) {
  // import.meta.env is a Vite build-time value; guard so `node --test` (which
  // has no import.meta.env) falls back to the dev base '/'.
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  const localePrefix = isDefaultLocale() ? '' : `${currentLocale()}/`;
  const url = new URL(`${base}${localePrefix}enquiries/`, window.location.origin);

  // Compose the prefilled message: localized opener + the offer's own details.
  // The structural glue words stay English — the guest can edit the free-text
  // message anyway, and this avoids a fan-out of extra locale keys.
  const parts = [takeMsg || 'I’m taking the offer'];
  if (offer.dates) parts.push(`Dates: ${offer.dates}`);
  if (offer.priceAfter) parts.push(`Price: ${euro(offer.priceAfter)}`);
  if (offer.nights) parts.push(`Nights: ${offer.nights}`);
  if (offer.message) parts.push(offer.message);
  url.searchParams.set('offer', parts.join('. '));
  return url.toString();
}

// Show/hide a [data-offer-slot] element and set its text in one step.
function setSlot(modal, name, text) {
  const el = modal.querySelector(`[data-offer-slot="${name}"]`);
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.removeAttribute('hidden');
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function openModal(modal) {
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  // Focus the explicit close button — the first [data-modal-close] is the
  // backdrop <div> (not focusable). Same convention as the other modals.
  const focusable = modal.querySelector('.modal__close')
    || modal.querySelector('button[data-modal-close]')
    || modal.querySelector('.btn');
  focusable?.focus();
}

function closeModal(modal) {
  modal.hidden = true;
  document.body.style.overflow = '';
  if (lastFocusBeforeModal && typeof lastFocusBeforeModal.focus === 'function'
      && document.contains(lastFocusBeforeModal)) {
    lastFocusBeforeModal.focus();
  }
}

/**
 * Populate and open the offer detail modal for one offer object.
 * offer: { dates, discountPct, priceBefore, priceAfter, nights, message }.
 * triggerEl: the card CTA button that opened it (for focus restore).
 */
export function openOfferModal(offer, triggerEl) {
  const modal = document.getElementById('offer-modal');
  if (!modal || !offer) return;
  lastFocusBeforeModal = triggerEl || document.activeElement;

  // Dynamic summary — mirror buildCard's field gating (offers.js:82-98).
  setSlot(modal, 'dates', offer.dates);
  setSlot(modal, 'struck', offer.priceBefore ? euro(offer.priceBefore) : '');
  setSlot(modal, 'hero', offer.priceAfter ? euro(offer.priceAfter) : '');
  setSlot(modal, 'save', deriveSave(offer, modal.dataset));
  const nightsLabel = modal.dataset.nightsLabel
    || document.querySelector('[data-offers]')?.dataset.nightsLabel
    || 'nights';
  setSlot(modal, 'nights', offer.nights ? `${offer.nights} ${nightsLabel}` : '');
  setSlot(modal, 'message', offer.message);

  // Fixed-dates callout: show only when the offer has a date range. The
  // boilerplate prefix (<span>) is already localized; we set the <strong>.
  const callout = modal.querySelector('[data-offer-slot="callout"]');
  if (callout) {
    if (offer.dates) {
      const strong = modal.querySelector('[data-offer-slot="callout-dates"]');
      if (strong) strong.textContent = offer.dates;
      callout.removeAttribute('hidden');
    } else {
      callout.hidden = true;
    }
  }

  // "Take the offer" → locale-aware /enquiries/?offer=<prefill>. The take
  // message template is baked onto the anchor as data-take-message at build.
  const take = modal.querySelector('[data-offer-take]');
  if (take) {
    take.setAttribute('href', buildEnquiryUrl(offer, take.dataset.takeMessage));
  }

  openModal(modal);
}

/**
 * Wire the modal's close controls, Escape, and Tab focus-trap. No-ops if the
 * static template is absent (e.g. on pages other than the home page).
 */
export function initOfferModal() {
  const modal = document.getElementById('offer-modal');
  if (!modal) return;
  if (modal.dataset.offerModalInit === '1') return; // idempotent
  modal.dataset.offerModalInit = '1';

  modal.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(modal));
  });

  // Modal-scoped Escape (not document-level) so it only fires while open.
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal(modal);
  });

  // Light Tab focus-trap over the panel's focusables (copies enquiry.js).
  const panel = modal.querySelector('.modal__panel');
  if (panel) {
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || modal.hidden) return;
      const focusables = panel.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }
}
