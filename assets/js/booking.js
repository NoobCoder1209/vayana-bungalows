import flatpickr from 'flatpickr';

// Where bookings.json lives once Vite has applied the production base path.
// In dev: /assets/data/bookings.json
// In prod: /vayana-bungalows/assets/data/bookings.json
// The `?v=<build-id>` query is set at build time from VITE_BUILD_ID and
// rotates every deploy so Fastly's edge cache picks up the new file
// immediately instead of serving the previous deploy's bookings.json
// for up to its TTL.
const BUILD_ID = import.meta.env.VITE_BUILD_ID || 'dev';
const BOOKINGS_URL = `${import.meta.env.BASE_URL}assets/data/bookings.json?v=${BUILD_ID}`;

// Cache the bookings load so multiple calls in one page reuse the same fetch.
let bookingsPromise = null;

function loadBookings() {
  if (!bookingsPromise) {
    bookingsPromise = fetch(BOOKINGS_URL, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch((err) => {
        // Don't break the page if the file is missing or malformed — flatpickr
        // will simply mark no dates as disabled and the user falls back to
        // submitting a request that we'll cross-check manually.
        console.warn('[booking] could not load bookings.json:', err.message);
        return null;
      });
  }
  return bookingsPromise;
}

// Local-time YYYY-MM-DD. Using `.toISOString()` would shift the date back
// for UTC+ users (the bulk of our likely audience): a Date constructed at
// local midnight serialises as 22:00 UTC the previous day, so the slice(0,10)
// would produce the wrong key. Reservations in bookings.json are also keyed
// by local calendar date, so this stays in sync.
const toIso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Convert a YYYY-MM-DD ISO string to a Date at local midnight. We pass these
// to flatpickr's `disable` array because flatpickr's string parsing depends
// on the picker's `dateFormat` (here 'M j, Y'), and it can silently fail to
// match an ISO string against that format — leaving the disable list empty
// and letting users select booked dates. Date objects are unambiguous.
const parseIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function initBooking() {
  const checkin = document.getElementById('bk-checkin');
  const checkout = document.getElementById('bk-checkout');
  const form = document.getElementById('booking-form');
  const modal = document.getElementById('booking-modal');

  if (!checkin || !checkout || !form || !modal) return;

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

  const fpIn = flatpickr(checkin, {
    minDate: 'today',
    dateFormat: 'M j, Y',
    disable: [],
    // Force the flatpickr calendar grid even on mobile UAs. Without this,
    // flatpickr falls back to a native <input type="date"> which doesn't
    // honour our disable list, never fires onDayCreate (so .is-booked never
    // lands), and makes the legend underneath misleading.
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

  const fpOut = flatpickr(checkout, {
    minDate: tomorrow,
    dateFormat: 'M j, Y',
    disable: [],
    disableMobile: true,
    onDayCreate: tagBookedDay('out'),
  });

  // Pull the per-page bungalow key (B1 / B2 / B3) and patch in the
  // unavailable dates for that bungalow once they arrive.
  const bungalowKey = form.dataset.bungalowKey;
  if (bungalowKey) {
    loadBookings().then((bookings) => {
      const entry = bookings?.bungalows?.[bungalowKey];
      // Defensive: if bookings.json is the OLD array shape (cached from a
      // previous deploy by a stale worker, or because somebody downgraded
      // fetch-bookings.mjs), treat it as empty. ?v=BUILD_ID + cache:no-cache
      // already cover this in practice, but a console.warn surfaces any
      // schema regression that does slip through.
      if (Array.isArray(entry)) {
        console.warn(
          `[booking] ${bungalowKey}: bookings.json is in the legacy array shape; treating as empty.`,
        );
      }
      const unavailable = entry?.unavailable ?? [];
      const checkInDays = entry?.checkIn ?? [];

      if (bookings && unavailable.length === 0) {
        console.info(`[booking] no unavailable dates listed for ${bungalowKey}`);
      }

      unavailableSet = new Set(unavailable);
      checkInSet = new Set(checkInDays);

      // Check-out is allowed on a check-in day (turnover day), so subtract
      // the check-in days from fpOut's disable list.
      const checkoutDisable = unavailable.filter((d) => !checkInSet.has(d));

      // Pass Date objects rather than ISO strings: flatpickr's string parser
      // is bound to the picker's dateFormat ('M j, Y'), and an ISO string
      // can silently fail to match — leaving the disable list effectively
      // empty. Date objects are unambiguous.
      fpIn.set('disable', unavailable.map(parseIso));
      fpOut.set('disable', checkoutDisable.map(parseIso));

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
  const modalBody = modal.querySelector('#modal-body');
  const modalTitle = modal.querySelector('#modal-title');

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
    if (bungalow && modalBody) {
      modalBody.textContent =
        `A reservations specialist will follow up within twenty-four hours to confirm availability for ${bungalow} and tailor your stay.`;
    }
    if (bungalow && modalTitle) {
      modalTitle.textContent = `Thank you — your ${bungalow} request is in.`;
    }
    openModal(modal);
  });

  // Close modal handlers
  modal.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(modal));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal(modal);
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
