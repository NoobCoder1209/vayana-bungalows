import { Bulgarian } from 'flatpickr/dist/l10n/bg.js';
import { isOffSeason } from './season.js';
import { currentLocale } from './util/current-locale.js';
import { loadBookings, toIso, parseIso, availabilityFor } from './bookings-data.js';
import { makeSeasonPicker } from './season-picker.js';

// flatpickr locale objects keyed by our locale codes. `default` is the
// baseline (English) — no import needed. Bulgarian is imported above.
// Add a new entry per locale when locales/<code>.json lands.
const FLATPICKR_LOCALES = {
  en: 'default',
  bg: Bulgarian,
};

// Pick the flatpickr locale object for the current emit-locale. Falls back
// to `'default'` (English) for locales we haven't onboarded — matches the
// currentLocale() DEFAULT_LOCALE fallback so nothing throws when we later
// ship a new locale without a matching flatpickr bundle.
function fpLocale() {
  return FLATPICKR_LOCALES[currentLocale()] || 'default';
}

// Locale-aware date format. EN keeps the source `M j, Y` (e.g. "Jul 15, 2027")
// per the historical booking-page style. BG uses `d/m/Y` (e.g. "15/07/2027")
// per the same reasoning that drove enquiry.js's choice — Bulgarian
// audience reads day-first numeric. Falls back to the EN format for
// unknown locales; the underlying flatpickr locale swap handles
// month/weekday names in Cyrillic when locale='bg' is loaded.
const DATE_FORMATS = {
  en: 'M j, Y',
  bg: 'd/m/Y',
};
function fpDateFormat() {
  return DATE_FORMATS[currentLocale()] || DATE_FORMATS.en;
}

// Wire up every booking widget on the page. Two kinds of widget exist:
//
//   1. Live-availability widgets — `<form data-bungalow-key="B1|B2|B3">`.
//      The (legacy) bungalow detail pages carry one. These block booked
//      dates from bookings.json and open the shared `#booking-modal` on
//      submit. All such widgets share ONE bookings.json fetch (cached in
//      bookings-data.js) and ONE modal.
//
//   2. Enquiry-link bar — `<form data-booking-mode="enquiry-link">`. The
//      /stay/ page carries one at the top. It does NOT read bookings.json
//      and does NOT block dates; on submit it navigates to /enquiries/ with
//      the chosen dates as query params (no modal). See setupEnquiryLinkForm.
export function initBooking() {
  // Link-mode booking bars (may exist independently of any live widget/modal):
  //   - enquiry-link      → navigates to /enquiries/ (legacy detail pages)
  //   - availability-link → navigates to /stay/ (the home floating dock)
  // Both build the target URL from the Vite base + carry the chosen dates as
  // ?checkin=&checkout=; only the destination path differs.
  document
    .querySelectorAll('form[data-booking-mode="enquiry-link"]')
    .forEach((form) => setupLinkForm(form, 'enquiries/'));
  document
    .querySelectorAll('form[data-booking-mode="availability-link"]')
    .forEach((form) => setupLinkForm(form, 'stay/'));

  const liveForms = document.querySelectorAll('form[data-bungalow-key]');
  if (!liveForms.length) return;

  // Live widgets need the shared modal. Modal-level wiring is done ONCE here
  // (not per form): the modal is shared by every live widget on the page, so
  // its close handlers and the document-level Escape listener must not be
  // registered once per form — that would stack N identical listeners on a
  // single shared modal.
  const modal = document.getElementById('booking-modal');
  if (!modal) return;

  modal.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(modal));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal(modal);
  });

  liveForms.forEach((form) => setupBookingForm(form, modal));
}

// Wire a link-mode booking bar: plain season-aware date pickers (no
// bookings.json blocking), and on submit navigate to `targetPath` (relative to
// the Vite base) carrying the chosen check-in/check-out as ?checkin=&checkout=.
// Used by the /enquiries/ bar (legacy detail pages) and the home floating dock
// (→ /stay/). The Rooms/Guests selects are decorative here — only the dates
// are forwarded.
function setupLinkForm(form, targetPath) {
  const checkin = form.querySelector('[name="checkin"]');
  const checkout = form.querySelector('[name="checkout"]');
  if (!checkin || !checkout) return;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Season-only pickers (shared factory) — isOffSeason greys Oct..Apr, minDate
  // blocks the past, maxDate caps the year, disableMobile forces the grid. NO
  // per-bungalow booked-day disabling: this bar is an enquiry entry point, not
  // an availability check.
  const fpIn = makeSeasonPicker(checkin, {
    minDate: 'today',
    dateFormat: fpDateFormat(),
    locale: fpLocale(),
    disableMobile: true,
    onChange: (selected) => {
      if (selected[0]) {
        const d = new Date(selected[0]);
        d.setDate(d.getDate() + 1);
        fpOut.set('minDate', d);
        // If a check-out was already picked and now sits on/before the new
        // check-in, clear it — set('minDate') moves the picker floor but does
        // NOT drop an out-of-range selection, so without this the bar would
        // still display (and forward to /enquiries/) a reversed date pair.
        const out = fpOut.selectedDates[0];
        if (out && out <= selected[0]) {
          fpOut.clear();
        }
      }
    },
  });

  const fpOut = makeSeasonPicker(checkout, {
    minDate: tomorrow,
    dateFormat: fpDateFormat(),
    locale: fpLocale(),
    disableMobile: true,
  });

  // Resolve the target (enquiries/ or stay/) via the Vite base path so it
  // works from ANY page depth — the home page and /stay/ alike — under the
  // GitHub Pages base (/vayana-bungalows/) and in dev (/).
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = new URL(`${import.meta.env.BASE_URL}${targetPath}`, window.location.origin);
    // Pass dates as unambiguous ISO (YYYY-MM-DD) regardless of the picker's
    // locale display format; enquiry.js parses them back with parseIso.
    if (fpIn.selectedDates[0]) url.searchParams.set('checkin', toIso(fpIn.selectedDates[0]));
    if (fpOut.selectedDates[0]) url.searchParams.set('checkout', toIso(fpOut.selectedDates[0]));
    window.location.assign(url.toString());
  });
}

// Set up a single booking widget: its two flatpickr pickers, the per-bungalow
// availability patch, and the submit handler. Called once per form so multiple
// widgets can coexist on one page, each keyed to its own bungalow's dates.
function setupBookingForm(form, modal) {
  // Inputs are resolved scoped to THIS form (not by global ID) so the three
  // widgets on /stay/ don't collide. IDs in markup stay unique for valid
  // <label for> a11y, but the JS no longer depends on them being unique.
  const checkin = form.querySelector('[name="checkin"]');
  const checkout = form.querySelector('[name="checkout"]');

  if (!checkin || !checkout) return;

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  // Initialise flatpickr immediately with no disabled dates so the inputs
  // are interactive from first paint. The disable lists get patched in
  // asynchronously once bookings.json arrives. Two separate sets:
  //   - unavailableSet: anywhere a guest is in residence overnight; blocks
  //                     the check-in picker entirely and is also used for
  //                     submit-time validation
  //   - checkInSet:     days when a *new* guest arrives. The check-out
  //                     picker treats these as available (the previous
  //                     guest checks out at 11am, the new guest arrives
  //                     at 3pm), so they're subtracted from fpOut's
  //                     disable list.
  let unavailableSet = new Set();
  let checkInSet = new Set();

  // onDayCreate fires per-cell when flatpickr draws the calendar grid.
  // We tag dates that are visually "booked" so the CSS can distinguish
  // them from `minDate`-blocked past days. Two factory variants:
  //   - 'in':  every unavailable date gets `.is-booked` (cream + strike,
  //            cursor: not-allowed; matches the legend's "Already booked")
  //   - 'out': unavailable AND not a check-in day → `.is-booked`. A check-in
  //            day is selectable as a turnover checkout, so it gets a
  //            different class `.is-checkout-only` with its own styling
  //            (selectable, distinct visual) and its own aria label so
  //            screen readers don't claim the cell is unavailable.
  const tagBookedDay = (picker) => (_, __, ___, dayElem) => {
    if (!dayElem?.dateObj) return;
    const iso = toIso(dayElem.dateObj);
    if (!unavailableSet.has(iso)) return;

    if (picker === 'out' && checkInSet.has(iso)) {
      if (dayElem.classList.contains('is-checkout-only')) return;
      dayElem.classList.add('is-checkout-only');
      const base = dayElem.getAttribute('aria-label') || iso;
      dayElem.setAttribute(
        'aria-label',
        `${base} — turnover day, available as a check-out`,
      );
      return;
    }

    if (dayElem.classList.contains('is-booked')) return;
    dayElem.classList.add('is-booked');
    const base = dayElem.getAttribute('aria-label') || iso;
    dayElem.setAttribute('aria-label', `${base} — already booked`);
  };

  const fpIn = makeSeasonPicker(checkin, {
    minDate: 'today',
    dateFormat: fpDateFormat(),
    locale: fpLocale(),
    // isOffSeason (added by the factory) greys out Oct..Apr; per-bungalow
    // booked dates get pushed in later via .set('disable', ...) once
    // bookings.json resolves (see loadBookings().then below). First paint is
    // already season-aware — booked-day decoration comes second.
    // disableMobile forces the flatpickr grid even on mobile UAs — without it
    // flatpickr falls back to a native <input type="date"> that ignores our
    // disable list, never fires onDayCreate (so .is-booked never lands), and
    // makes the legend underneath misleading.
    disableMobile: true,
    onDayCreate: tagBookedDay('in'),
    onChange: (selected) => {
      if (selected[0]) {
        const d = new Date(selected[0]);
        d.setDate(d.getDate() + 1);
        fpOut.set('minDate', d);
      }
    },
  });

  const fpOut = makeSeasonPicker(checkout, {
    minDate: tomorrow,
    dateFormat: fpDateFormat(),
    locale: fpLocale(),
    disableMobile: true,
    onDayCreate: tagBookedDay('out'),
  });

  // Pull the per-page bungalow key (B1 / B2 / B3) and patch in the
  // unavailable dates for that bungalow once they arrive.
  const bungalowKey = form.dataset.bungalowKey;
  if (bungalowKey) {
    loadBookings().then((bookings) => {
      // Shared parse + legacy-array guard (bookings-data.js). Returns Sets.
      const entry = availabilityFor(bookings, bungalowKey);
      unavailableSet = entry.unavailable;
      checkInSet = entry.checkIn;
      const unavailable = [...unavailableSet];

      if (bookings && unavailable.length === 0) {
        console.info(`[booking] no unavailable dates listed for ${bungalowKey}`);
      }

      // Check-out is allowed on a check-in day (turnover day), so subtract
      // the check-in days from fpOut's disable list.
      const checkoutDisable = unavailable.filter((d) => !checkInSet.has(d));

      // Pass Date objects rather than ISO strings: flatpickr's string parser
      // is bound to the picker's dateFormat ('M j, Y'), and an ISO string
      // can silently fail to match — leaving the disable list effectively
      // empty. Date objects are unambiguous.
      //
      // Prepend the isOffSeason predicate to both lists — .set('disable',
      // ...) REPLACES the array, so without re-adding the predicate here
      // the season block would silently disappear once bookings.json
      // resolves, right when the user first sees the calendar.
      fpIn.set('disable', [isOffSeason, ...unavailable.map(parseIso)]);
      fpOut.set('disable', [isOffSeason, ...checkoutDisable.map(parseIso)]);

      // If the user managed to pick a date in the brief window before
      // bookings.json loaded, and that date is now known-blocked, clear
      // the selection rather than letting them submit a request for it.
      // flatpickr's `set('disable', ...)` updates the picker UI but does
      // NOT clear the already-selected date itself.
      if (fpIn.selectedDates[0] && unavailableSet.has(toIso(fpIn.selectedDates[0]))) {
        fpIn.clear();
        console.info('[booking] cleared check-in: date became unavailable');
      }
      if (fpOut.selectedDates[0]) {
        const out = toIso(fpOut.selectedDates[0]);
        // A picked check-out is invalid if it's unavailable AND not a check-in
        // day (since check-in days are valid as previous-guest checkouts).
        if (unavailableSet.has(out) && !checkInSet.has(out)) {
          fpOut.clear();
          console.info('[booking] cleared check-out: date became unavailable');
        }
      }
    });
  }

  // Hidden bungalow tag — set on per-bungalow pages so the modal copy can
  // mention which bungalow the request is for. Read at submit time so the
  // modal reflects the current value if a future flow ever changes it.
  // The modal is SHARED across all widgets on the page, so we capture its
  // authored default copy once and always reassign on submit — either the
  // per-bungalow copy (when the hidden input is present) or the default
  // (otherwise) — so a widget without a bungalow name can never inherit the
  // previous submission's stale bungalow copy from another widget.
  const modalBody = modal.querySelector('#modal-body');
  const modalTitle = modal.querySelector('#modal-title');
  const defaultBody = modalBody?.textContent ?? '';
  const defaultTitle = modalTitle?.textContent ?? '';

  // Open modal on submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // Re-validate against the latest disable lists. Catches the rare case
    // where bookings.json refreshed (or a date-of-arrival booking was
    // committed elsewhere) between picker open and submit.
    const checkinDate = fpIn.selectedDates[0];
    const checkoutDate = fpOut.selectedDates[0];

    if (checkinDate && unavailableSet.has(toIso(checkinDate))) {
      fpIn.clear();
      checkin.focus();
      return;
    }
    if (checkoutDate) {
      const out = toIso(checkoutDate);
      if (unavailableSet.has(out) && !checkInSet.has(out)) {
        fpOut.clear();
        checkout.focus();
        return;
      }
    }

    // Interior-range validation: even if both endpoints are valid, the
    // chosen interval might cross another reservation's nights. Walk the
    // strict interior (checkin+1 .. checkout-1) and reject if any of
    // those days is unavailable. Cheap: typical stay length is < 30 days.
    if (checkinDate && checkoutDate) {
      const cursor = new Date(checkinDate);
      cursor.setDate(cursor.getDate() + 1);
      const stop = new Date(checkoutDate);
      while (cursor < stop) {
        if (unavailableSet.has(toIso(cursor))) {
          fpOut.clear();
          checkout.focus();
          return;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const bungalow = form.querySelector('input[name="bungalow"]')?.value?.trim();
    if (modalBody) {
      modalBody.textContent = bungalow
        ? `A reservations specialist will follow up within twenty-four hours to confirm availability for ${bungalow} and tailor your stay.`
        : defaultBody;
    }
    if (modalTitle) {
      modalTitle.textContent = bungalow
        ? `Thank you — your ${bungalow} request is in.`
        : defaultTitle;
    }
    openModal(modal);
  });
}

function openModal(modal) {
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  // Focus the explicit close button (a real <button>); the first
  // [data-modal-close] is the .modal__backdrop <div>, which is not focusable.
  const focusable = modal.querySelector('.modal__close')
    || modal.querySelector('button[data-modal-close]')
    || modal.querySelector('.btn');
  focusable?.focus();
}

function closeModal(modal) {
  modal.hidden = true;
  document.body.style.overflow = '';
}
