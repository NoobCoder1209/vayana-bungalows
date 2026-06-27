// Enquiry form — /enquiries/ (#11, #15).
//
// Behaviour: validate name + dates + adults/children/infants + email
// + phone + consent + honeypot, render a Cloudflare Turnstile captcha,
// then POST a JSON payload to the Cloudflare Worker defined in
// site-config.js endpoints.enquiry. On 200 success the "Thank you"
// .modal opens; on any error a generic message is surfaced in the
// existing aria-live error pill.
//
// Closing #15 (Worker + Sheets) and #20 (captcha = Turnstile, decided
// during planning) — the previous v1 stub had NO network request; the
// fetch call below is the missing half. Honeypot trip still routes
// silently to successPath() WITHOUT touching the Worker — same UX
// as the original stub, no signal to bots.
//
// Same shape as assets/js/newsletter.js — error handling, idempotency
// guard, honeypot-mimics-success, generic email error, focus restore,
// JS-disabled fallback (submit button ships disabled in HTML, enabled
// here on init; the <noscript> mailto block is the no-JS path — the
// Worker requires Turnstile, which itself requires JS, so no-JS users
// genuinely cannot post the form).

import flatpickr from 'flatpickr';
import { SITE_CONFIG } from './site-config.js';

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
// The consent label on /enquiries/ links to /privacy/ (shipped in #16)
// and reads "I accept the Privacy Policy and consent to being contacted
// by Vayana Bungalows regarding my enquiry." The error string therefore
// MUST reference the same concept the user sees on screen — round-2
// review finding I-R2-1 is bidirectional. If the visible label
// wording changes, this string changes in the same commit.
const CONSENT_ERROR_MSG = 'Please accept the Privacy Policy to continue.';

// Adults required ('1'..'4'). Empty value comes from the placeholder
// option ("ADULTS*"). Children / Infants are intentionally OPTIONAL
// — they're not checked client-side; the Worker normalises empty/'-'
// to 0 (see worker/src/validation.js).
const ALLOWED_ADULTS = new Set(['1', '2', '3', '4']);
const ADULTS_ERROR_MSG = 'Please choose how many adults are travelling.';

// Worker error → user-facing pill copy. Keys match the `error` strings
// the Worker returns in worker/src/index.js — keep in lockstep when
// either side adds a new bucket. The pill is the only surface the user
// sees, so messages are deliberately generic (no debug detail leaks).
const ERROR_MSGS = {
  validation: 'Please check the highlighted fields and try again.',
  captcha:    'The anti-spam check failed. Please tick the box if shown, or refresh the page.',
  'rate-limit': 'Too many enquiries from this connection. Please try again in a few minutes.',
  'content-type': 'Sorry, something went wrong sending your enquiry. Please refresh and try again.',
  'too-large': 'Your message is too long. Please shorten it and try again.',
  method:     'Sorry, something went wrong sending your enquiry. Please refresh and try again.',
  downstream: 'Sorry, we couldn’t save your enquiry. Please try again, or email us at the address in the footer.',
  network:    'Network error — please check your connection and try again.',
  default:    'Sorry, something went wrong. Please try again or email us directly.',
};
const SUBMIT_BUSY_TEXT = 'Sending…';

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
  const turnstileContainer = form.querySelector('[data-enquiry-turnstile]');
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
  if (!turnstileContainer) missing.push('[data-enquiry-turnstile]');
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

  // Cloudflare Turnstile widget — rendered programmatically (not
  // declaratively via class="cf-turnstile") so the site-key stays in
  // site-config.js and never duplicates into HTML. The Turnstile
  // api.js loader in /enquiries/index.html appends ?onload=onTurnstileLoad,
  // which fires once api.js is ready — we install the callback below.
  //
  // Race handling: if Turnstile loads BEFORE this module (unlikely with
  // async/defer + ESM, but possible from bfcache), window.turnstile
  // is already defined and we render immediately. If Turnstile loads
  // AFTER (the common case), the callback below fires later and renders
  // then. Either way the widget ends up rendered exactly once.
  let turnstileWidgetId = null;
  const renderTurnstile = () => {
    if (turnstileWidgetId !== null || !window.turnstile) return;
    try {
      turnstileWidgetId = window.turnstile.render(turnstileContainer, {
        sitekey: SITE_CONFIG.endpoints.turnstileSiteKey,
        theme: 'light',
        action: 'enquiry',
        // No callback — we read the token explicitly on submit via
        // turnstile.getResponse(widgetId). Avoids race between
        // callback-set state and the form's own submit handler.
      });
    } catch (e) {
      // Don't block the form if Turnstile fails to render — the user
      // can still try to submit, and the Worker will reject server-side
      // (better UX: log + carry on rather than freeze the page).
      console.warn('[enquiry] turnstile render failed:', e?.message || e);
    }
  };
  // Install the global callback. If api.js already loaded and fired,
  // window.turnstile is set — call renderTurnstile() directly below.
  window.onTurnstileLoad = renderTurnstile;
  if (window.turnstile) renderTurnstile();

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
  //
  // Round-2 review N-R2-5: collapsed the separate `today` constant —
  // `tomorrow.setDate(tomorrow.getDate() + 1)` handles month/year
  // rollover the same way, so the extra binding wasn't earning its
  // keep.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

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
  // I3 — without aria-invalid, AT users only hear the live region but
  // get no per-field cue. clearError() below clears both the message
  // and every aria-invalid marker, so the form returns to a clean
  // state as soon as the user starts fixing things.
  //
  // The 3 select fields (adults / children / infants) are intentionally
  // omitted from `allFields` — they have defaults (2/0/0), every option
  // is valid, and there is no validation branch that could fail on them.
  // Round-2 review finding N-R2-2 (explicit comment requested).
  //
  // POST-#41 / placeholder-pattern update: Adults is now REQUIRED with
  // no numeric default — the select starts on a disabled placeholder
  // option ("ADULTS*"). It joins allFields so submit-time validation
  // failures get the aria-invalid marker like the other required
  // inputs. Children and Infants remain optional (placeholder or "-"
  // are both legal) so they stay out of allFields.
  const allFields = [name, checkinEl, checkoutEl, adults, email, phone, message, consentInput];
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
    // Clear the bfcache snapshot too — after a successful submit, the
    // form is intentionally blank, and a subsequent Back navigation
    // should land on a blank form, not on the previous user's pick.
    try {
      sessionStorage.removeItem(SELECT_SNAPSHOT_KEY);
    } catch {
      // ignore — same private-mode/quota story as pagehide above.
    }
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

  // bfcache restore: re-apply select values that the browser snapshot
  // forgot. Firefox in particular loses the user's pick on
  // disabled+selected+hidden first-option placeholder selects when
  // the page is restored from bfcache (the HTML-attribute `selected`
  // on the disabled first option wins on restore, snapping the field
  // back to "ADULTS*" even though the user had picked e.g. 3).
  //
  // Strategy: snapshot the three select values to sessionStorage on
  // pagehide (which fires before bfcache stash AND before a normal
  // navigation), and on pageshow.persisted (bfcache restore signal),
  // read them back and re-apply via setAttribute('selected') plus
  // .value = ... so both the DOM-attribute state and the property
  // state agree.
  //
  // We only act on event.persisted=true so a fresh navigation (no
  // bfcache) doesn't pick up stale values from a previous session.
  // sessionStorage is per-tab, so this doesn't leak across tabs.
  //
  // Scoped to the three guest-count selects only — the inputs
  // (name/email/phone/dates/message) and the textarea all survive
  // bfcache cleanly because their .value lives in the snapshot.
  const SELECT_SNAPSHOT_KEY = 'vayana.enquiry.guests';
  const guestSelects = [adults, children, infants].filter(Boolean);
  window.addEventListener('pagehide', () => {
    try {
      const snap = guestSelects.reduce((acc, el) => {
        acc[el.id] = el.value;
        return acc;
      }, {});
      sessionStorage.setItem(SELECT_SNAPSHOT_KEY, JSON.stringify(snap));
    } catch {
      // sessionStorage may throw in private-mode Safari or with
      // exhausted quota. Silent fallback — the user just sees the
      // placeholder reset, same as before this handler existed.
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    let snap;
    try {
      snap = JSON.parse(sessionStorage.getItem(SELECT_SNAPSHOT_KEY) || '{}');
    } catch {
      return;
    }
    guestSelects.forEach((el) => {
      const saved = snap[el.id];
      if (saved && saved !== el.value) {
        el.value = saved;
      }
    });
  });

  form.addEventListener('submit', async (e) => {
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

    // Adults — required. The select's default state is a disabled+
    // selected first <option> with empty value (placeholder pattern),
    // so an untouched form submits adults.value === ''. Reject that
    // before sending to the Worker (the Worker rejects too — server
    // is authoritative, this is just for instant UX feedback). The
    // ALLOWED_ADULTS check also rejects DevTools-injected values
    // outside 1..4. Children / Infants stay optional ('-', empty,
    // 0..4 all accepted); the Worker normalises empty/'-' to 0.
    const adultsVal = (adults.value || '').trim();
    if (!ALLOWED_ADULTS.has(adultsVal)) {
      showError(ADULTS_ERROR_MSG, adults);
      adults.focus();
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
      // CRITICAL: NO Worker fetch. The trip is invisible to the bot
      // (same modal opens, same form-reset, same generated ref-free
      // success UX) but the sheet stays clean.
      successPath();
      return;
    }

    // Read the Turnstile token. window.turnstile may be undefined if
    // api.js failed to load (offline, CSP block) — in that case the
    // token is empty and the Worker will reject with 403. Better UX
    // than freezing the form: surface the failure and let the user
    // retry. The Worker is the ground truth on captcha success.
    const captchaToken = (window.turnstile && turnstileWidgetId !== null)
      ? (window.turnstile.getResponse(turnstileWidgetId) || '')
      : '';

    // Build the JSON payload. Field names mirror the Worker's
    // validation.js (worker/src/validation.js) — keep them in lockstep.
    // Dates: enquiry.js holds them as Date objects; serialise to
    // YYYY-MM-DD which is the canonical format the Worker accepts.
    // IMPORTANT: we use the LOCAL-TIME getters (getFullYear/getMonth/getDate)
    // NOT Date.toISOString().slice(0,10). flatpickr stores the selected
    // date as the user's local midnight; the local getters return the
    // day the user actually clicked. Using toISOString() would convert
    // that local midnight to UTC and shift the day for any user east
    // of UTC by 1 day backwards (and west of UTC midnight-by-clock to
    // the "next" day). Local getters preserve user intent.
    const toISO = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    const payload = {
      name: nameVal,
      email: emailVal,
      phone: phoneVal,
      checkin: toISO(checkinDate),
      checkout: toISO(checkoutDate),
      adults: adults.value,
      children: children.value,
      infants: infants.value,
      message: messageVal,
      consent: consentInput.checked ? 'true' : 'false',
      'cf-turnstile-response': captchaToken,
    };

    // Loading state — disable submit, swap label, announce via
    // aria-busy. The error pill (aria-live=assertive) doesn't double
    // as a busy indicator, so the label change is the user's only cue
    // that something is happening. Restore in finally so any branch
    // (success / error / network failure) lands cleanly.
    const originalSubmitText = submit.textContent;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = SUBMIT_BUSY_TEXT;

    try {
      const res = await fetch(SITE_CONFIG.endpoints.enquiry, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Even on a 4xx/5xx the Worker returns a JSON body — parse it.
      // On a hard network error the fetch() throws and we land in
      // the catch below.
      const data = await res.json().catch(() => ({}));
      if (res.status === 200 && data.ok) {
        successPath();
        return;
      }
      // Worker returned an error envelope — map to user-facing copy.
      const msg = ERROR_MSGS[data.error] || ERROR_MSGS.default;
      showError(msg);
    } catch (err) {
      // Network failure, CORS block, fetch abort, etc.
      showError(ERROR_MSGS.network);
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      submit.textContent = originalSubmitText;
      // Reset Turnstile so a next attempt issues a fresh token —
      // managed-mode tokens are single-use, so reusing would 403 again.
      if (window.turnstile && turnstileWidgetId !== null) {
        try { window.turnstile.reset(turnstileWidgetId); } catch (_) {}
      }
    }
  });

  // Modal close wiring — same pattern as booking.js / newsletter.js.
  modal.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(modal, lastFocusBeforeModal));
  });
  // Escape handler — scoped to the modal subtree (not document) so a
  // re-init against fresh markup (e.g. jsdom unit tests, bfcache
  // restore) doesn't leak listeners pointing at detached modals.
  // Round-2 review finding B-R2-3 — was previously `document.addEventListener`
  // which leaked across page lifecycles. Focus during modal-open is
  // inside the panel (close button), so the keydown bubbles to the
  // modal element and the listener fires from there.
  modal.addEventListener('keydown', (e) => {
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
  //
  // Round-2 review finding B-R2-2: if `focusables` is ever empty (no
  // tabbable elements rendered — could happen if a future Worker-state
  // spinner briefly replaces the close button), the trap MUST NOT
  // silently disengage and let Tab escape the modal. Fall back to
  // focusing the panel itself; the markup gives `.modal__panel` a
  // `tabindex="-1"` so it can accept programmatic focus.
  const panel = modal.querySelector('.modal__panel');
  if (panel) {
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || modal.hidden) return;
      const focusables = panel.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) {
        // No focusables inside — keep focus on the panel so Tab can't
        // escape (round-2 B-R2-2).
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
