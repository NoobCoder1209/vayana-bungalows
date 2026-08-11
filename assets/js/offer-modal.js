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

import { euro, offerDealLine } from './offers.js';
import { formatOfferDates, offerPrefillDates } from './util/offer-dates.js';
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
  // message anyway, and this avoids a fan-out of extra locale keys. Prose is
  // kept minimal in the new schema: opener + a single Dates line (price prose
  // is omitted this phase; there is no single "nights" value).
  const parts = [takeMsg || 'I’m taking the offer'];
  const formatted = formatOfferDates(offer, currentLocale());
  if (formatted) parts.push(`Dates: ${formatted}`);
  url.searchParams.set('offer', parts.join('. '));

  // ?price is OMITTED this phase (no priceAfter in the new shape).

  // Structured check-in/check-out for the enquiry date pickers, from the
  // offer's real ISO sides only (offerPrefillDates omits freehand/blank sides,
  // so those simply don't prefill). enquiry.js re-validates these (not past,
  // in-season, checkout > checkin), so it stays the authority on bookable dates.
  const pf = offerPrefillDates(offer);
  if (pf.checkin) url.searchParams.set('checkin', pf.checkin);
  if (pf.checkout) url.searchParams.set('checkout', pf.checkout);

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
 * offer: { label, startDate, endDate, startRaw, endRaw, rate, tier,
 *          minimumToBook, paidNights, freeNights, method }.
 * triggerEl: the card CTA button that opened it (for focus restore).
 */
export function openOfferModal(offer, triggerEl) {
  const modal = document.getElementById('offer-modal');
  if (!modal || !offer) return;
  lastFocusBeforeModal = triggerEl || document.activeElement;

  // Dynamic summary — mirror buildCard's field usage (offers.js). The localized
  // nights-deal template lives on the [data-offers] grid container (the i18n
  // plugin bakes it there under `nightsDealLabel`), NOT on #offer-modal — so
  // resolve it from that container, exactly as the card does. Falls back to the
  // English template when absent.
  const offersDs = document.querySelector('[data-offers]')?.dataset || {};
  const formattedDates = formatOfferDates(offer, currentLocale());
  setSlot(modal, 'dates', formattedDates);
  setSlot(modal, 'struck', ''); // DORMANT: always hidden (no priceBefore)
  setSlot(modal, 'hero', euro(offer.price));
  setSlot(modal, 'save', ''); // DORMANT: always hidden (no savings data)
  // Deal line — Type 2 nights-free or Type 1 discount framing. Shared helper
  // with the card (offers.js offerDealLine) so the two never drift.
  setSlot(modal, 'nights', offerDealLine(offer, offersDs));
  setSlot(modal, 'message', ''); // DORMANT: no message field in the new shape

  // Fixed-dates callout: show only when the offer has displayable dates. The
  // boilerplate prefix (<span>) is already localized; we set the <strong>.
  const callout = modal.querySelector('[data-offer-slot="callout"]');
  if (callout) {
    if (formattedDates) {
      const strong = modal.querySelector('[data-offer-slot="callout-dates"]');
      if (strong) strong.textContent = formattedDates;
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
