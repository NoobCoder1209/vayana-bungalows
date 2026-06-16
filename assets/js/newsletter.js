// Newsletter — "Stay with us" stub handler (#10).
//
// v1 behaviour: validate email + consent + honeypot, then open the
// "Thank you" .modal. NO network request goes anywhere.
//
// TODO: wire to real ESP — see follow-up issue
//   https://github.com/NoobCoder1209/arapq-website/issues/19
//
// The submit button is rendered `disabled` in HTML and only enabled by
// this module on init. That's the JS-disabled fallback (negative test #7):
// without JS, the button stays disabled and the <noscript> mailto block
// below the form is the call-to-action instead. With JS, the button
// enables and full validation runs.

// Stricter than HTML5's `type=email` (which accepts "a@b" with no TLD).
// The form ships with `novalidate` so HTML5 enforcement is disabled by
// design — this regex IS the validation, not belt-and-braces. The 254-char
// length cap below runs first and short-circuits before regex evaluation,
// which keeps catastrophic-input cost bounded even though the regex itself
// is non-backtracking (no nested quantifiers, no overlapping alternations).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// RFC 5321's hard limit on a deliverable address. Anything longer is either
// pasted nonsense or an attack — reject before regex evaluation.
const MAX_EMAIL_LEN = 254;

// Generic error to show on any email-shape problem. Same message regardless
// of whether the input was empty / too long / regex-failed — gives an
// attacker no signal about thresholds, and matches the typical sign-up
// form pattern users already recognize.
const EMAIL_ERROR_MSG = 'Please enter a valid email address.';
const CONSENT_ERROR_MSG = 'Please accept the Privacy Policy to subscribe.';

export function initNewsletter() {
  const form = document.querySelector('[data-newsletter-form]');
  if (!form) return;

  // Idempotency guard: re-running initNewsletter() (HMR, future SPA nav,
  // double-import) would stack a second `keydown` listener on document.
  // The mark is set AFTER the missing-elements check below — otherwise a
  // partial first-init (against incomplete markup) would set the flag,
  // and a subsequent call against complete markup would short-circuit
  // here and never wire the form.
  if (form.dataset.newsletterInit === '1') return;

  const email = form.querySelector('[data-newsletter-email]');
  const honeypot = form.querySelector('[data-newsletter-honeypot]');
  const submit = form.querySelector('[data-newsletter-submit]');
  const errorEl = form.querySelector('[data-newsletter-error]');
  // Consent input lives outside the <form> in the markup (sits below as a
  // separate <label class="newsletter__consent">). Use the data attribute
  // hook rather than the visual class — the class is more likely to be
  // renamed in a redesign.
  const consentInput = document.querySelector('[data-newsletter-consent]');
  const consentLabel = consentInput?.closest('.newsletter__consent');
  const modal = document.getElementById('newsletter-modal');

  // Hard requirements: bail and warn on any missing element so future pages
  // that try to reuse this module without the full markup get a clear hint
  // in the console (rather than a half-wired form that silently misbehaves).
  // Bail BEFORE setting the idempotency flag — a partial first init must
  // not poison a future complete-markup re-init.
  const missing = [];
  if (!email) missing.push('[data-newsletter-email]');
  if (!submit) missing.push('[data-newsletter-submit]');
  if (!errorEl) missing.push('[data-newsletter-error]');
  if (!consentInput) missing.push('[data-newsletter-consent]');
  if (!modal) missing.push('#newsletter-modal');
  if (!honeypot) missing.push('[data-newsletter-honeypot]');
  if (missing.length) {
    console.warn('[newsletter] missing required elements:', missing.join(', '));
    return;
  }

  // Markup check passed — claim the form so a re-init bails out early.
  form.dataset.newsletterInit = '1';

  // Enable the submit button only once JS has wired up validation.
  // The HTML ships it disabled (negative test #7 fallback).
  submit.disabled = false;

  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };
  const clearError = () => {
    errorEl.textContent = '';
    errorEl.hidden = true;
  };
  const flagConsent = (flag) => {
    consentLabel?.classList.toggle('is-error', flag);
  };

  // Clear errors as soon as the user starts fixing things, so the form
  // doesn't keep yelling after the problem's gone.
  email.addEventListener('input', clearError);
  consentInput.addEventListener('change', () => {
    if (consentInput.checked) flagConsent(false);
  });

  // Track the element that had focus before the modal opened so we can
  // restore it on close (a11y: prevents the screen-reader's reading
  // position from snapping back to <body>).
  let lastFocusBeforeModal = null;

  const successPath = () => {
    openModal(modal, () => lastFocusBeforeModal);
    // form.reset() only resets fields INSIDE the <form> element. The
    // consent checkbox sits outside (deliberately), so reset it manually.
    // Without this, the next user on the same machine inherits the
    // previous user's consent state.
    form.reset();
    consentInput.checked = false;
    flagConsent(false);
    clearError();
  };

  form.addEventListener('submit', (e) => {
    // ALWAYS preventDefault first — even on bot/honeypot trips. Default
    // submit would attempt a same-origin GET to the page URL with the
    // email in the query string, which a) leaks the email into the URL
    // bar / referer chain on GitHub Pages and b) navigates the page
    // away. We never want either, regardless of which validation branch
    // we end up in.
    e.preventDefault();

    // Capture the trigger BEFORE any DOM mutation that might steal focus.
    lastFocusBeforeModal = document.activeElement;

    // Honeypot: any non-empty value = bot. SIMULATE the success path so
    // a bot DOM-diffing the page can't tell honeypot-trip from a valid
    // submit. No ESP request goes out either way in v1; in v2 (#14) the
    // success path will fire the request, and the honeypot path won't —
    // that's the only divergence, invisible from the bot's vantage.
    if (honeypot.value.trim() !== '') {
      successPath();
      return;
    }

    const value = (email.value || '').trim();

    if (value.length === 0) {
      showError(EMAIL_ERROR_MSG);
      email.focus();
      return;
    }
    // Length cap runs before regex — bounds worst-case input even though
    // the regex itself is non-backtracking. Same generic error message
    // as the regex branch (gives no implementation detail away).
    if (value.length > MAX_EMAIL_LEN || !EMAIL_RE.test(value)) {
      showError(EMAIL_ERROR_MSG);
      email.focus();
      return;
    }
    if (!consentInput.checked) {
      showError(CONSENT_ERROR_MSG);
      flagConsent(true);
      consentInput.focus();
      return;
    }

    // All good — open the modal. NO fetch, NO XHR, NO sendBeacon.
    // (Confirmed by negative test #5 — DevTools network tab must show no
    // outgoing request after submit in v1.)
    successPath();
  });

  // Modal close wiring — same pattern as booking.js (.modal__backdrop,
  // .modal__close, .btn[data-modal-close]).
  modal.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(modal, lastFocusBeforeModal));
  });
  // Single document-level Escape handler — guarded by the idempotency
  // check at the top of initNewsletter(), so we never stack two of them.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal(modal, lastFocusBeforeModal);
  });
}

function openModal(modal, getReturnFocusEl) {
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  // Focus the close button — same convention as the booking modal: the
  // first [data-modal-close] is the .modal__backdrop <div> (not focusable),
  // so prefer the explicit .modal__close button.
  const focusable = modal.querySelector('.modal__close')
    || modal.querySelector('button[data-modal-close]')
    || modal.querySelector('.btn');
  focusable?.focus();
}

function closeModal(modal, returnFocusTo) {
  modal.hidden = true;
  document.body.style.overflow = '';
  // Restore focus to whatever the user was on before the modal opened.
  // Guard against the element having been removed from the DOM, or being
  // a non-focusable node (e.g. <body>).
  if (returnFocusTo && typeof returnFocusTo.focus === 'function'
      && document.contains(returnFocusTo)) {
    returnFocusTo.focus();
  }
}
