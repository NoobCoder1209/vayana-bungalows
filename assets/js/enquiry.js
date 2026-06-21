// Enquiry form — v1 stub for /enquiries/ (#11).
//
// v1 behaviour: validate name + dates + adults/children/infants + email
// + phone + consent + honeypot, then open the "Thank you" .modal.
// NO network request goes anywhere.
//
// TODO: wire to Cloudflare Worker — see follow-up issues
//   https://github.com/NoobCoder1209/arapq-website/issues/15 (Worker + Sheets)
//   https://github.com/NoobCoder1209/arapq-website/issues/20 (captcha decision)
//
// Same shape as assets/js/newsletter.js — error handling, idempotency
// guard, honeypot-mimics-success, generic email error, focus restore,
// JS-disabled fallback (submit button ships disabled in HTML, enabled
// here on init; the <noscript> mailto block is the no-JS path).

import flatpickr from 'flatpickr';

// Stricter than HTML5's `type=email` (which accepts "a@b" with no TLD).
// The form ships with `novalidate` so HTML5 enforcement is disabled by
// design — this regex IS the validation, not belt-and-braces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// RFC 5321's hard limit on a deliverable email address. Anything longer
// is either pasted nonsense or an attack — reject before regex evaluation.
const MAX_EMAIL_LEN = 254;

// Loose phone validation per user spec: allow leading `+`, digits, spaces,
// dashes, and parens; require at least 7 characters total AND at least one
// digit (the lookahead). Without the digit requirement, "-------" or
// "+      " would pass — round-1 review finding MED-3. The Worker (#15)
// will do strict E.164 normalisation server-side; here we only filter
// out the obvious junk so we don't burn server cycles on "asdfasdf"
// submissions. The lookahead is one-shot and the rest of the pattern
// has disjoint character classes — no backtracking risk.
const PHONE_RE = /^\+?(?=[\d\s\-()]*\d)[\d\s\-()]{7,}$/;

// 40 chars is generous for an international number (E.164 caps at 15
// digits + a few separators; longest plausible formatted display is
// ~25 chars). Higher cap lets users paste with country names attached
// e.g. "Bulgaria +359 88 888 8888"; the Worker will strip and reformat.
const MAX_PHONE_LEN = 40;

// 120 chars covers the longest realistic full-name (compound surnames,
// honorifics) without inviting payload-sized inputs. Cross-checked
// against IATA passenger-name limits (which are typically 35 per
// component) — 120 is roughly 3× that, enough for any composition.
const MAX_NAME_LEN = 120;

// Per spec — issue #11 §"Fields" item 9. The Worker (#15) will
// re-enforce this cap before persistence; the client cap stops obvious
// payload abuse and gives the user immediate feedback.
const MAX_MESSAGE_LEN = 2000;

// One generic message for any email-shape failure — empty / too long /
// regex-failed all share this. Gives an attacker no signal about
// thresholds. Same pattern as the newsletter form.
const EMAIL_ERROR_MSG = 'Please enter a valid email address.';
const PHONE_ERROR_MSG = 'Please enter a valid phone number.';
const NAME_ERROR_MSG = 'Please enter your full name.';
const DATE_ERROR_MSG = 'Please pick check-in and check-out dates.';
const DATE_ORDER_ERROR_MSG = 'Check-out must be after check-in.';
const PAST_DATE_ERROR_MSG = 'Check-in cannot be in the past.';
const MESSAGE_TOO_LONG_MSG = 'Your message is too long (max 2000 characters).';
// "Privacy Policy" wording is intentional even though /privacy/ 404s
// today (page itself ships in #16). The consent label points at the
// same URL — when the policy lands, no wording change here is needed.
const CONSENT_ERROR_MSG = 'Please accept the Privacy Policy to continue.';

// Bungalow allowlist for `?villa=<slug>` pre-fill. Anything not in this
// set is silently ignored so an attacker can't craft a link that injects
// arbitrary text into the message field via the URL. The display name
// comes from this lookup, NOT from the raw query string — so even if
// somebody figures out a slug that bypasses the URL check, the message
// text is still pinned to one of these three values.
const BUNGALOW_SLUGS = {
  'premier-oceanview-villa': 'Premier Oceanview Villa',
  'deluxe-hilltop-residence': 'Deluxe Hilltop Residence',
  'premier-beachfront-suite': 'Premier Beachfront Suite',
};

export function initEnquiry() {
  const form = document.querySelector('[data-enquiry-form]');
  if (!form) return;

  // Idempotency guard. The missing-elements check below happens AFTER
  // this short-circuit, so a re-init against the same form bails out
  // here without retrying. The flag is set further down (line ~131)
  // only AFTER the missing-elements check passes — that way a partial
  // first init (against incomplete markup) doesn't claim the form and
  // block a later complete-markup re-init from wiring it.
  if (form.dataset.enquiryInit === '1') return;

  const name = form.querySelector('[data-enquiry-name]');
  const checkinEl = form.querySelector('[data-enquiry-checkin]');
  const checkoutEl = form.querySelector('[data-enquiry-checkout]');
  const adults = form.querySelector('[data-enquiry-adults]');
  const children = form.querySelector('[data-enquiry-children]');
  const infants = form.querySelector('[data-enquiry-infants]');
  const email = form.querySelector('[data-enquiry-email]');
  const phone = form.querySelector('[data-enquiry-phone]');
  const message = form.querySelector('[data-enquiry-message]');
  const honeypot = form.querySelector('[data-enquiry-honeypot]');
  const submit = form.querySelector('[data-enquiry-submit]');
  const errorEl = form.querySelector('[data-enquiry-error]');
  const consentInput = form.querySelector('[data-enquiry-consent]');
  const consentLabel = consentInput?.closest('.enquiry-form__consent');
  const modal = document.getElementById('enquiry-modal');

  // Hard requirements: bail and warn on any missing element so future
  // pages that try to reuse this module without the full markup get a
  // clear hint in the console (rather than a half-wired form that
  // silently misbehaves). Bail BEFORE setting the idempotency flag.
  const missing = [];
  if (!name) missing.push('[data-enquiry-name]');
  if (!checkinEl) missing.push('[data-enquiry-checkin]');
  if (!checkoutEl) missing.push('[data-enquiry-checkout]');
  if (!adults) missing.push('[data-enquiry-adults]');
  if (!children) missing.push('[data-enquiry-children]');
  if (!infants) missing.push('[data-enquiry-infants]');
  if (!email) missing.push('[data-enquiry-email]');
  if (!phone) missing.push('[data-enquiry-phone]');
  if (!message) missing.push('[data-enquiry-message]');
  if (!honeypot) missing.push('[data-enquiry-honeypot]');
  if (!submit) missing.push('[data-enquiry-submit]');
  if (!errorEl) missing.push('[data-enquiry-error]');
  if (!consentInput) missing.push('[data-enquiry-consent]');
  if (!modal) missing.push('#enquiry-modal');
  if (missing.length) {
    console.warn('[enquiry] missing required elements:', missing.join(', '));
    return;
  }

  // Markup check passed — claim the form so a re-init bails out early.
  form.dataset.enquiryInit = '1';

  // Enable the submit button only once JS has wired up validation.
  // The HTML ships it disabled (JS-disabled fallback: button stays
  // greyed, <noscript> mailto block is the call-to-action).
  submit.disabled = false;

  // Wire flatpickr on both date inputs. Same pattern as booking.js but
  // with d/m/Y format per user decision (Bulgarian audience reads it
  // faster than the US M j, Y default).
  //
  // We INTENTIONALLY do NOT pass `disableMobile: true` here (booking.js
  // does, but for a different reason — booking has booked-day disable
  // lists that the native iOS/Android picker can't honour). On the
  // enquiry form there's no booked-day list; the native mobile date
  // wheel is faster and more familiar than flatpickr's JS calendar.
  // Round-1 review finding I6.
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const fpCheckin = flatpickr(checkinEl, {
    minDate: 'today',
    dateFormat: 'd/m/Y',
    onChange: (selected) => {
      if (selected[0]) {
        const d = new Date(selected[0]);
        d.setDate(d.getDate() + 1);
        fpCheckout.set('minDate', d);
        // If check-out is now before the new check-in + 1, clear it so
        // the user has to repick — avoids an invalid pair persisting.
        const out = fpCheckout.selectedDates[0];
        if (out && out <= selected[0]) {
          fpCheckout.clear();
        }
      }
    },
  });

  const fpCheckout = flatpickr(checkoutEl, {
    minDate: tomorrow,
    dateFormat: 'd/m/Y',
  });

  // URL-param pre-fill: `?villa=<slug>` populates the message textarea
  // with a friendly opener that names the villa. The slug is validated
  // against an allowlist; anything else is silently ignored. We use the
  // looked-up display name (NOT the raw query value) so an attacker
  // who manages to slip a value past the allowlist still can't inject
  // text. We also leave the textarea blank if the user has already
  // typed something into it (e.g. opened the URL twice, then typed).
  // URLSearchParams + window.location are universally supported; no
  // try/catch needed here (round-1 review finding N4).
  // TODO i18n: when Bulgarian copy lands, source the opener template
  // from site-config.js / an i18n table rather than inline English
  // (round-1 review finding N1).
  const params = new URLSearchParams(window.location.search);
  const villaSlug = params.get('villa');
  if (villaSlug && Object.prototype.hasOwnProperty.call(BUNGALOW_SLUGS, villaSlug)) {
    const villaName = BUNGALOW_SLUGS[villaSlug];
    if (!message.value.trim()) {
      message.value = `Hello, I'd like to enquire about the ${villaName}.`;
    }
  }

  // Show an inline error and (optionally) mark a specific field as
  // aria-invalid so screen readers announce it. Round-1 review finding
  // I3 — without aria-invalid, AT users only hear the polite live
  // region but get no per-field cue. clearError() below clears both
  // the message and every aria-invalid marker, so the form returns to
  // a clean state as soon as the user starts fixing things.
  const allFields = [name, checkinEl, checkoutEl, email, phone, message, consentInput];
  const showError = (msg, field) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    if (field) field.setAttribute('aria-invalid', 'true');
  };
  const clearError = () => {
    errorEl.textContent = '';
    errorEl.hidden = true;
    allFields.forEach((el) => el && el.removeAttribute('aria-invalid'));
  };
  const flagConsent = (flag) => {
    consentLabel?.classList.toggle('is-error', flag);
  };

  // Clear errors as soon as the user starts fixing things. Bound to
  // every editable input so the form doesn't keep yelling after the
  // problem's gone. (clearError also removes aria-invalid on all
  // fields — round-1 review finding I3.)
  [name, email, phone, message].forEach((el) => {
    el.addEventListener('input', clearError);
  });
  [checkinEl, checkoutEl].forEach((el) => {
    el.addEventListener('change', clearError);
  });
  consentInput.addEventListener('change', () => {
    if (consentInput.checked) flagConsent(false);
    clearError();
  });

  // Track the element that had focus before the modal opened so we can
  // restore it on close (a11y: prevents the screen-reader's reading
  // position from snapping back to <body>).
  let lastFocusBeforeModal = null;

  const successPath = () => {
    openModal(modal);
    // form.reset() resets fields INSIDE the <form> element. The consent
    // checkbox IS inside this form (unlike newsletter), but reset
    // doesn't always update the .is-error class — call flagConsent(false)
    // explicitly so the UI is fully clean.
    form.reset();
    flagConsent(false);
    clearError();
    // Reset flatpickr's internal state too — form.reset() clears the
    // <input> value, but the picker still thinks a date is selected
    // and the next open shows it highlighted. Calling .clear() syncs
    // the picker with the cleared input.
    fpCheckin.clear();
    fpCheckout.clear();
    // After flatpickr.clear(), the check-out minDate is still anchored
    // to whatever check-in WAS — reset it back to tomorrow for a clean
    // next-user-on-same-device experience.
    const tNow = new Date();
    const tTomorrow = new Date();
    tTomorrow.setDate(tNow.getDate() + 1);
    fpCheckout.set('minDate', tTomorrow);
  };

  form.addEventListener('submit', (e) => {
    // ALWAYS preventDefault first. Default submit would attempt a
    // same-origin GET with the form values in the query string, leaking
    // the email/phone into the URL bar / referer chain on GitHub Pages
    // and navigating the page away. We never want either, regardless
    // of which validation branch we end up in. Same reasoning as
    // newsletter.js — do not remove when wiring #15's fetch.
    e.preventDefault();

    // Run the full validation gauntlet BEFORE checking the honeypot.
    // The honeypot field is the LAST validation step on a successful
    // submit (round-1 review findings B1/B2). The original ordering
    // (honeypot first) leaked a signal: a bot could submit
    // honeypot=X + invalid email, observe modal-opens-with-no-error,
    // and conclude the honeypot fired (vs a legitimate user with the
    // same invalid email who'd see the error pill). With this
    // ordering, a bot has to submit a fully valid form to reach the
    // honeypot trip — at which point the trip is indistinguishable
    // from a normal success.

    // Name — required, must not be empty, length-capped.
    const nameVal = (name.value || '').trim();
    if (nameVal.length === 0 || nameVal.length > MAX_NAME_LEN) {
      showError(NAME_ERROR_MSG, name);
      name.focus();
      return;
    }

    // Dates — both required. Re-check at submit time even though the
    // pickers enforce minDate, because DevTools can mutate the input
    // value directly (negative test #6: "remove required attribute").
    const checkinDate = fpCheckin.selectedDates[0];
    const checkoutDate = fpCheckout.selectedDates[0];
    if (!checkinDate || !checkoutDate) {
      const target = checkinDate ? checkoutEl : checkinEl;
      showError(DATE_ERROR_MSG, target);
      target.focus();
      return;
    }
    // Check-in not in the past. minDate: 'today' already enforces this
    // in the picker UI, but DevTools could null fpCheckin or set the
    // input value via JS. Compare at the day boundary (zero out hours)
    // because flatpickr returns Date at local midnight already, and
    // `new Date()` here carries the current time of day.
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    if (checkinDate < todayMidnight) {
      showError(PAST_DATE_ERROR_MSG, checkinEl);
      checkinEl.focus();
      return;
    }
    if (checkoutDate <= checkinDate) {
      showError(DATE_ORDER_ERROR_MSG, checkoutEl);
      checkoutEl.focus();
      return;
    }

    // Email — generic error for empty / too long / regex fail.
    const emailVal = (email.value || '').trim();
    if (emailVal.length === 0
        || emailVal.length > MAX_EMAIL_LEN
        || !EMAIL_RE.test(emailVal)) {
      showError(EMAIL_ERROR_MSG, email);
      email.focus();
      return;
    }

    // Phone — loose regex (digits + symbols, 7+ chars, ≥1 digit).
    // Worker (#15) will strictly normalise to E.164 server-side; this
    // only filters out obvious junk like "abcdef" or "-------".
    const phoneVal = (phone.value || '').trim();
    if (phoneVal.length === 0
        || phoneVal.length > MAX_PHONE_LEN
        || !PHONE_RE.test(phoneVal)) {
      showError(PHONE_ERROR_MSG, phone);
      phone.focus();
      return;
    }

    // Message — optional, but if present must be under the length cap.
    // The textarea has maxlength=2000 in HTML, but DevTools can drop
    // that attribute, so we re-check at submit time.
    const messageVal = (message.value || '');
    if (messageVal.length > MAX_MESSAGE_LEN) {
      showError(MESSAGE_TOO_LONG_MSG, message);
      message.focus();
      return;
    }

    // Consent — required.
    if (!consentInput.checked) {
      showError(CONSENT_ERROR_MSG, consentInput);
      flagConsent(true);
      consentInput.focus();
      return;
    }

    // All fields valid — NOW check the honeypot. Trip silently routes
    // to the same success path (modal open + form reset). In v1 there's
    // no network call, so the trip is fully indistinguishable from a
    // valid submit. In v2 (#15) the success path will fire the Worker
    // fetch and the honeypot trip won't — that's the only divergence.
    // Capture lastFocusBeforeModal to the submit button (round-1 review
    // finding I1) so on modal close, focus returns to a stable anchor,
    // not the empty last-typed field.
    lastFocusBeforeModal = submit;

    if (honeypot.value.trim() !== '') {
      // Silent bot trip — do exactly what a valid submit does.
      successPath();
      return;
    }

    // All good — open the modal. NO fetch, NO XHR, NO sendBeacon.
    // (Real Worker submission is #15; until then this is a stub.)
    successPath();
  });

  // Modal close wiring — same pattern as booking.js / newsletter.js.
  modal.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(modal, lastFocusBeforeModal));
  });
  // Single document-level Escape handler — guarded by the idempotency
  // check at the top of initEnquiry(), so we never stack two of them.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal(modal, lastFocusBeforeModal);
  });

  // Focus trap for the modal (round-1 review finding I4). Without this,
  // Tab from the close button would walk focus to elements behind the
  // modal (which are visually obscured by the backdrop) — a violation
  // of the role="dialog" contract. The trap is light: intercept Tab /
  // Shift-Tab inside the panel and loop between the first and last
  // focusable elements. We add the listener at the panel level (not
  // the document) so it only fires when focus is genuinely inside the
  // modal — no global keyboard cost when the modal is closed.
  const panel = modal.querySelector('.modal__panel');
  if (panel) {
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || modal.hidden) return;
      const focusables = panel.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
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

function openModal(modal) {
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
  // Restore focus to whatever was captured before the modal opened
  // (the submit button on success path). Guard against the element
  // having been removed from the DOM, or being a non-focusable node.
  if (returnFocusTo && typeof returnFocusTo.focus === 'function'
      && document.contains(returnFocusTo)) {
    returnFocusTo.focus();
  }
}
