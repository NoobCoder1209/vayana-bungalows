import flatpickr from 'flatpickr';

export function initBooking() {
  const checkin = document.getElementById('bk-checkin');
  const checkout = document.getElementById('bk-checkout');
  const form = document.getElementById('booking-form');
  const modal = document.getElementById('booking-modal');

  if (!checkin || !checkout || !form || !modal) return;

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const fpIn = flatpickr(checkin, {
    minDate: 'today',
    dateFormat: 'M j, Y',
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
  });

  // Hidden bungalow tag — set on per-bungalow pages so the modal copy can
  // mention which bungalow the request is for. Falls back to the generic copy.
  const bungalow = form.querySelector('input[name="bungalow"]')?.value?.trim();
  const modalBody = modal.querySelector('#modal-body');
  const modalTitle = modal.querySelector('#modal-title');

  // Open modal on submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
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
  const focusable = modal.querySelector('.btn, [data-modal-close]');
  focusable?.focus();
}

function closeModal(modal) {
  modal.hidden = true;
  document.body.style.overflow = '';
}
