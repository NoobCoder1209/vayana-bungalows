import flatpickr from 'flatpickr';

// Where bookings.json lives once Vite has applied the production base path.
// In dev: /assets/data/bookings.json
// In prod: /arapq-website/assets/data/bookings.json
// import.meta.env.BASE_URL resolves to whichever applies.
const BOOKINGS_URL = `${import.meta.env.BASE_URL}assets/data/bookings.json`;

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
  // are interactive from first paint. The disable list gets patched in
  // asynchronously once bookings.json arrives.
  const fpIn = flatpickr(checkin, {
    minDate: 'today',
    dateFormat: 'M j, Y',
    disable: [],
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
  });

  // Pull the per-page bungalow key (B1 / B2 / B3) and patch in the
  // unavailable dates for that bungalow once they arrive.
  const bungalowKey = form.dataset.bungalowKey;
  if (bungalowKey) {
    loadBookings().then((bookings) => {
      const dates = bookings?.bungalows?.[bungalowKey] ?? [];
      if (bookings && dates.length === 0) {
        console.info(`[booking] no unavailable dates listed for ${bungalowKey}`);
      }
      fpIn.set('disable', dates);
      fpOut.set('disable', dates);
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
    const bungalow = form.querySelector('input[name="bungalow"]')?.value?.trim();
    if (bungalow && modalBody) {
      modalBody.textContent =
        `A reservations specialist will follow up within twenty-four hours to confirm availability for the ${bungalow} and tailor your stay.`;
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
