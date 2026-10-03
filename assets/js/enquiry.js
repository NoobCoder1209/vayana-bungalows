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

import { Bulgarian } from 'flatpickr/dist/l10n/bg.js';
import { currentLocale } from './util/current-locale.js';

// flatpickr locale objects keyed by our locale codes. `default` is EN
// (baseline, needs no import). Mirror of assets/js/booking.js's map —
// if the site adds a third locale, add the flatpickr l10n import in
// both files (or extract to a shared util if the pattern grows).
const FLATPICKR_LOCALES = {
  en: 'default',
  bg: Bulgarian,
};
function fpLocale() {
  return FLATPICKR_LOCALES[currentLocale()] || 'default';
}
import { SITE_CONFIG } from './site-config.js';
import { isOffSeason } from './season.js';
import { parseIso, toIso } from './bookings-data.js';
import { makeSeasonPicker } from './season-picker.js';

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
let EMAIL_ERROR_MSG = 'Please enter a valid email address.';
let PHONE_ERROR_MSG = 'Please enter a valid phone number.';
let NAME_ERROR_MSG = 'Please enter your full name.';
let DATE_ERROR_MSG = 'Please pick check-in and check-out dates.';
let DATE_ORDER_ERROR_MSG = 'Check-out must be after check-in.';
let PAST_DATE_ERROR_MSG = 'Check-in cannot be in the past.';
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

// Guest stepper bounds. adults+children share a combined cap of 4
// (COMBINED_MAX); infants and pets are independent 0..2. adults has a
// floor of 1 (required); the others floor at 0. Mirrored server-side in
// worker/src/validation.js (pets added there; adults/children/infants
// already bounded).
const GUEST_MIN = { adults: 1, children: 0, infants: 0, pets: 0 };
const GUEST_MAX = { adults: 4, children: 4, infants: 2, pets: 2 };
const COMBINED_MAX = 4; // adults + children

// Pure derivation for the Guests stepper: given raw counts (any shape)
// and the localized summary templates, return the clamped counts, the
// summary string ("3 Guests / 1 Pet"), and per-category button-disabled
// flags. No DOM — unit-tested directly (enquiry-guests.test.mjs). The
// combined adults+children cap is enforced by trimming CHILDREN (adults
// keeps priority as the required category). %N% is the count placeholder.
export function computeGuestsState(raw, T) {
  const num = (v, floor) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : floor;
  };
  const counts = {};
  for (const k of Object.keys(GUEST_MIN)) {
    counts[k] = Math.max(GUEST_MIN[k], Math.min(GUEST_MAX[k], num(raw[k], GUEST_MIN[k])));
  }
  if (counts.adults + counts.children > COMBINED_MAX) {
    counts.children = Math.max(0, COMBINED_MAX - counts.adults);
  }
  const fill = (tpl, n) => String(tpl).replaceAll('%N%', n);
  const guests = counts.adults + counts.children + counts.infants;
  let summary = fill(guests === 1 ? T.guest : T.guests, guests);
  if (counts.pets >= 1) summary += T.join + fill(counts.pets === 1 ? T.pet : T.pets, counts.pets);
  const sum = counts.adults + counts.children;
  const buttons = {};
  for (const k of Object.keys(GUEST_MIN)) {
    const atMax = (k === 'adults' || k === 'children') ? sum >= COMBINED_MAX : counts[k] >= GUEST_MAX[k];
    buttons[k] = { dec: counts[k] <= GUEST_MIN[k], inc: atMax };
  }
  return { counts, summary, buttons };
}

// Guests stepper popover. Replaces the former three <select>s. Writes the
// four hidden inputs (the submit handler's source of truth) and keeps a
// localized summary ("3 Guests / 1 Pet") on the toggle. All derivation is
// in computeGuestsState (pure, tested); this is the DOM glue. Pluralisation
// + summary join come from data-* strings the i18n plugin bakes onto the
// form (English literals are the test/unbuilt fallback). Returns { reset }.
export function setupGuests(form) {
  const wrap = form.querySelector('[data-enquiry-guests]');
  if (!wrap) return null;
  const inputs = {
    adults: form.querySelector('[data-enquiry-adults]'),
    children: form.querySelector('[data-enquiry-children]'),
    infants: form.querySelector('[data-enquiry-infants]'),
    pets: form.querySelector('[data-enquiry-pets]'),
  };
  const toggle = wrap.querySelector('[data-enquiry-guests-toggle]');
  const popover = wrap.querySelector('[data-enquiry-guests-popover]');
  const summaryEl = wrap.querySelector('[data-enquiry-guests-summary]');
  const liveEl = wrap.querySelector('[data-enquiry-guests-live]');

  const d = form.dataset;
  const T = {
    guest: d.guestsSummaryGuest || '%N% Guest',
    guests: d.guestsSummaryGuests || '%N% Guests',
    pet: d.guestsSummaryPet || '%N% Pet',
    pets: d.guestsSummaryPets || '%N% Pets',
    join: d.guestsSummaryJoin || ' / ',
  };
  const LIVE_TPL = d.guestsLive || '%LABEL%, %N%';

  const readRaw = () => ({
    adults: inputs.adults.value, children: inputs.children.value,
    infants: inputs.infants.value, pets: inputs.pets.value,
  });
  const render = () => {
    const state = computeGuestsState(readRaw(), T);
    // Write clamped values back so the payload + bfcache snapshot agree.
    for (const k of Object.keys(state.counts)) inputs[k].value = String(state.counts[k]);
    if (summaryEl) summaryEl.textContent = state.summary;
    if (toggle) toggle.setAttribute('aria-label', state.summary);
    wrap.querySelectorAll('[data-guest-row]').forEach((row) => {
      const k = row.getAttribute('data-guest-row');
      const dec = row.querySelector('[data-guest-dec]');
      const inc = row.querySelector('[data-guest-inc]');
      const out = row.querySelector('[data-guest-count]');
      if (dec) { dec.disabled = state.buttons[k].dec; dec.setAttribute('aria-disabled', String(dec.disabled)); }
      if (inc) { inc.disabled = state.buttons[k].inc; inc.setAttribute('aria-disabled', String(inc.disabled)); }
      if (out) out.textContent = String(state.counts[k]);
    });
    return state;
  };
  const step = (k, delta) => {
    const cur = parseInt(inputs[k].value, 10);
    const base = Number.isFinite(cur) ? cur : GUEST_MIN[k];
    inputs[k].value = String(base + delta); // computeGuestsState clamps
    const state = render();
    const label = k[0].toUpperCase() + k.slice(1);
    if (liveEl) liveEl.textContent = LIVE_TPL.replaceAll('%LABEL%', label).replaceAll('%N%', state.counts[k]);
  };

  wrap.querySelectorAll('[data-guest-row]').forEach((row) => {
    const k = row.getAttribute('data-guest-row');
    row.querySelector('[data-guest-dec]')?.addEventListener('click', () => step(k, -1));
    row.querySelector('[data-guest-inc]')?.addEventListener('click', () => step(k, +1));
  });

  const open = () => {
    popover.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    wrap.querySelector('[data-guest-inc]:not([disabled]), [data-guest-dec]:not([disabled])')?.focus();
  };
  const close = (returnFocus) => {
    if (popover.hidden) return;
    popover.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus();
  };
  toggle?.addEventListener('click', () => (popover.hidden ? open() : close(false)));
  // Outside-click close. This is the one document-level listener in the
  // module (an inside-click test can't be done from the subtree). The
  // enquiryInit guard prevents double-binding on the same form; the
  // isConnected check makes the handler a no-op if `wrap` is ever detached
  // (bfcache/future client-nav edge), so it can't act on a stale popover —
  // matching the subtree-scoping discipline used elsewhere in this file.
  document.addEventListener('pointerdown', (e) => {
    if (!wrap.isConnected) return;
    if (!popover.hidden && !wrap.contains(e.target)) close(false);
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) { e.stopPropagation(); close(true); }
  });

  render();
  return {
    reset() {
      inputs.adults.value = '1';
      inputs.children.value = '0';
      inputs.infants.value = '0';
      inputs.pets.value = '0';
      render();
      close(false);
    },
  };
}

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
// Submit button's "busy" state text. Populated from a data-busy-label
// attribute on the button itself, which the i18n plugin bakes at build
// time from the enquiries.form.submit_busy_label key. Fallback to the
// English literal so a page that hasn't been keyed still renders
// something readable. Assigned at init (reads the current DOM value)
// rather than at module scope.
let SUBMIT_BUSY_TEXT = 'Sending…';

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
  const pets = form.querySelector('[data-enquiry-pets]');
  const guestsToggle = form.querySelector('[data-enquiry-guests-toggle]');
  const email = form.querySelector('[data-enquiry-email]');
  const phone = form.querySelector('[data-enquiry-phone]');
  const message = form.querySelector('[data-enquiry-message]');
  const honeypot = form.querySelector('[data-enquiry-honeypot]');
  const submit = form.querySelector('[data-enquiry-submit]');
  const errorEl = form.querySelector('[data-enquiry-error]');
  const consentInput = form.querySelector('[data-enquiry-consent]');
  const consentLabel = consentInput?.closest('.enquiry-form__consent');
  const turnstileContainer = form.querySelector('[data-enquiry-turnstile]');
  // Optional hidden field — the /stay/ pill's ?bungalow=1|2|3 lands here so the
  // enquiry records which bungalow it came from. Absent on direct visits; not a
  // hard requirement, so it's excluded from the missing-element bail below.
  const bungalowInput = form.querySelector('[data-enquiry-bungalow]');
  // Optional hidden field — the /stay/ pill and the Offers modal append a
  // ?price= that lands here so the enquiry records the end price. Absent on
  // direct visits; like bungalow, excluded from the missing-element bail below.
  const priceInput = form.querySelector('[data-enquiry-price]');
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
  if (!pets) missing.push('[data-enquiry-pets]');
  if (!guestsToggle) missing.push('[data-enquiry-guests-toggle]');
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

  // Populate the hidden locale input from <html lang> so a no-JS form
  // submission (if this form ever gains action=/method=) carries the
  // emit-locale to the Worker, activating the locale-aware redirect
  // (Task #167). JS-mode: the JSON payload builder below sends the
  // same value directly from currentLocale(), so this line is
  // defense-in-depth belt-and-braces — both paths agree.
  const localeInput = form.querySelector('[data-enquiry-locale]');
  if (localeInput) localeInput.value = currentLocale();

  // Read the localized busy-state text off the submit button's
  // data-busy-label attribute (baked at build time by the i18n plugin
  // from enquiries.form.submit_busy_label). Falls back to the module-
  // scope default when the attribute is missing (page not built with
  // the plugin, or test fixture). Assigned at init (reads the DOM value).
  const baked = submit.dataset.busyLabel;
  if (baked) SUBMIT_BUSY_TEXT = baked;

  // Read the localized error strings baked onto the form element's
  // data-err-* attributes (populated at build time by the i18n plugin
  // from enquiries.errors.* / enquiries.field_errors.*). Same pattern as
  // SUBMIT_BUSY_TEXT above — fall back to the module-scope English
  // defaults when an attribute is missing (page not built with the
  // plugin, or a test fixture). Assigned at init (reads the DOM value).
  const d = form.dataset;
  if (d.errValidation) ERROR_MSGS.validation = d.errValidation;
  if (d.errCaptcha) ERROR_MSGS.captcha = d.errCaptcha;
  if (d.errRateLimit) ERROR_MSGS['rate-limit'] = d.errRateLimit;
  if (d.errContentType) ERROR_MSGS['content-type'] = d.errContentType;
  if (d.errTooLarge) ERROR_MSGS['too-large'] = d.errTooLarge;
  if (d.errMethod) ERROR_MSGS.method = d.errMethod;
  if (d.errDownstream) ERROR_MSGS.downstream = d.errDownstream;
  if (d.errNetwork) ERROR_MSGS.network = d.errNetwork;
  if (d.errDefault) ERROR_MSGS.default = d.errDefault;
  if (d.errName) NAME_ERROR_MSG = d.errName;
  if (d.errDate) DATE_ERROR_MSG = d.errDate;
  if (d.errDateOrder) DATE_ORDER_ERROR_MSG = d.errDateOrder;
  if (d.errPastDate) PAST_DATE_ERROR_MSG = d.errPastDate;
  if (d.errEmail) EMAIL_ERROR_MSG = d.errEmail;
  if (d.errPhone) PHONE_ERROR_MSG = d.errPhone;

  // Enable the submit button only once JS has wired up validation.
  // The HTML ships it disabled (JS-disabled fallback: button stays
  // greyed, <noscript> mailto block is the call-to-action).
  submit.disabled = false;

  // Wire the Guests stepper popover (writes the four hidden inputs above).
  // Returns a controller whose reset() restores defaults + closes the
  // popover; called from successPath() after a successful submit.
  const guests = setupGuests(form);

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
        // Localise the widget's own UI copy ("I am human", verifying
        // status, error messages) to match the emit locale. Turnstile
        // accepts 'auto' (browser language) or an explicit code — we
        // pass the emit locale so the widget matches the page's chosen
        // language, not the browser's, which may differ (e.g. a BG-first
        // user viewing the EN page still sees English widget copy).
        // Turnstile's supported languages include 'en' and 'bg'; an
        // unknown code falls back to English internally.
        language: currentLocale(),
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

  const fpCheckin = makeSeasonPicker(checkinEl, {
    minDate: 'today',
    dateFormat: 'd/m/Y',
    locale: fpLocale(),
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

  const fpCheckout = makeSeasonPicker(checkoutEl, {
    minDate: tomorrow,
    dateFormat: 'd/m/Y',
    locale: fpLocale(),
  });

  const params = new URLSearchParams(window.location.search);

  // URL-param pre-fill: `?offer=<text>` populates the message textarea when a
  // visitor clicks "Take the offer" in the home-page offer modal. This IS free
  // text composed from OUR OWN offers sheet, so we accept the value — but
  // defensively: assigning to textarea.value is XSS-safe (it becomes a text
  // node, never parsed as HTML), and we still (a) strip control chars,
  // (b) cap length at MAX_MESSAGE_LEN so
  // a tampered/overlong URL can't blow past the server guard, and (c)
  // empty-only-fill (never clobber text the guest already typed). URLSearchParams.get already percent-decodes.
  const offerParam = params.get('offer');
  if (offerParam && !message.value.trim()) {
    message.value = offerParam
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .slice(0, MAX_MESSAGE_LEN);
  }

  // URL-param pre-fill: `?bungalow=1|2|3` populates the invisible hidden field
  // when the visitor arrives from a specific bungalow's /stay/ pill. We accept
  // only the compact keys 1/2/3 (client-side hygiene; the Worker re-validates
  // and maps to a "Bungalow N" label). Anything else — junk, missing, or the
  // field itself absent — leaves the value blank, so a non-bungalow enquiry
  // records no bungalow (blank Column B). This value is structured, NOT prose:
  // it never touches the message textarea.
  const bungalowParam = params.get('bungalow');
  if (bungalowInput && /^[123]$/.test(bungalowParam || '')) {
    bungalowInput.value = bungalowParam;
  }

  // URL-param pre-fill: `?price=<bare number>` populates the invisible price
  // field from the /stay/ pill (computed stay price) or the Offers modal (offer
  // after-price). Accept a plain integer only (client-side hygiene; the Worker
  // re-sanitises to digits). Junk, missing, or the field itself absent leaves it
  // blank, so a non-priced enquiry records no price (blank Column L). Structured,
  // NOT prose — never touches the message textarea.
  const priceParam = params.get('price');
  if (priceInput && /^\d{1,7}$/.test(priceParam || '')) {
    priceInput.value = priceParam;
  }

  // URL-param pre-fill: `?checkin=&checkout=` (ISO YYYY-MM-DD) pre-populate
  // the date pickers. The /stay/ top booking bar links here carrying the
  // dates the visitor chose there. We validate defensively — a value only
  // pre-fills if it parses to a real date that also passes the SAME guards
  // the pickers enforce (not in the past, in the open season). Junk, past,
  // or off-season values are silently ignored (fail-safe posture). Check-out additionally must be after
  // check-in. Dates are set as Date objects (not strings) so flatpickr's
  // format parser isn't involved, and with triggerChange=false so we drive
  // fpCheckout's minDate explicitly rather than via the onChange cascade.
  const isValidPrefill = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const checkinParam = params.get('checkin');
  let prefilledCheckin = null;
  if (isValidPrefill(checkinParam)) {
    const d = parseIso(checkinParam);
    if (!Number.isNaN(d.getTime()) && d >= today && !isOffSeason(d)) {
      fpCheckin.setDate(d, false);
      prefilledCheckin = d;
      // Keep fpCheckout's floor consistent with the chosen check-in + 1.
      const min = new Date(d);
      min.setDate(min.getDate() + 1);
      fpCheckout.set('minDate', min);
    }
  }

  const checkoutParam = params.get('checkout');
  if (isValidPrefill(checkoutParam)) {
    const d = parseIso(checkoutParam);
    const afterCheckin = prefilledCheckin ? d > prefilledCheckin : d >= today;
    if (!Number.isNaN(d.getTime()) && afterCheckin && !isOffSeason(d)) {
      fpCheckout.setDate(d, false);
    }
  }

  // Show an inline error and (optionally) mark a specific field as
  // aria-invalid so screen readers announce it. Round-1 review finding
  // I3 — without aria-invalid, AT users only hear the live region but
  // get no per-field cue. clearError() below clears both the message
  // and every aria-invalid marker, so the form returns to a clean
  // state as soon as the user starts fixing things.
  const allFields = [name, checkinEl, checkoutEl, guestsToggle, email, phone, message, consentInput];
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
    // Re-sync the Guests stepper: form.reset() restores the hidden inputs
    // to their HTML defaults (adults=1, rest=0), but the rendered summary,
    // counts and button-disabled states need a re-render — and the popover
    // should close. guests.reset() does all of that. (Hidden inputs survive
    // bfcache natively, so there's no snapshot to clear — unlike the old
    // <select> trio this replaced.)
    guests?.reset();
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

    // Guests — adults required (1..4), and the party must satisfy the same
    // bounds the stepper enforces: adults+children ≤ 4, infants 0..2,
    // pets 0..2. The stepper writes clamped values to the hidden inputs, so
    // a legitimate submission is always in range; this re-check is the
    // belt-and-braces gate against a DevTools-poked hidden value (the Worker
    // is authoritative server-side, this is instant UX feedback). An error
    // lands on the visible toggle (hidden inputs can't take focus/aria).
    //
    // STRICT parse (review finding I1): the Worker matches each count against
    // an exact-string allowlist, so " 1 ", "1.9", "1abc" are server-rejects.
    // parseInt would launder those to 1 and let the client PASS a body the
    // Worker then 400s. intOrNull returns the integer only when the trimmed
    // string is its own canonical decimal form — so the two gates agree.
    const intOrNull = (v) => {
      const t = String(v ?? '').trim();
      const n = Number(t);
      return (t !== '' && Number.isInteger(n) && String(n) === t) ? n : null;
    };
    const adultsVal = (adults.value || '').trim();
    const childrenN = intOrNull(children.value);
    const infantsN = intOrNull(infants.value);
    const petsN = intOrNull(pets.value);
    if (!ALLOWED_ADULTS.has(adultsVal)
        || childrenN === null || childrenN < 0 || childrenN > 4
        || parseInt(adultsVal, 10) + childrenN > COMBINED_MAX
        || infantsN === null || infantsN < 0 || infantsN > 2
        || petsN === null || petsN < 0 || petsN > 2) {
      showError(ADULTS_ERROR_MSG, guestsToggle);
      guestsToggle.focus();
      return;
    }

    // Message — OPTIONAL. Empty is allowed; only enforce the length cap
    // when the guest actually typed something. The textarea has
    // maxlength=2000 in HTML, but DevTools can drop that attribute, so we
    // re-check length at submit time.
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
    // the "next" day). Local getters preserve user intent. Shared
    // `toIso` (bookings-data.js) does exactly this.
    const payload = {
      name: nameVal,
      email: emailVal,
      phone: phoneVal,
      checkin: toIso(checkinDate),
      checkout: toIso(checkoutDate),
      adults: adults.value,
      children: children.value,
      infants: infants.value,
      pets: pets.value,
      message: messageVal,
      consent: consentInput.checked ? 'true' : 'false',
      // Which bungalow this enquiry came from, as a compact key ('1'|'2'|'3'),
      // or '' when it didn't originate from a /stay/ bungalow pill. The Worker
      // maps it to a "Bungalow N" label for Column B; a blank value is fine.
      bungalow: bungalowInput ? bungalowInput.value : '',
      // The end price the guest is enquiring about (bare number as a string),
      // or '' when the enquiry didn't come from a /stay/ pill or Offers modal.
      // The Worker sanitises it to digits for Column L; a blank value is fine.
      price: priceInput ? priceInput.value : '',
      // Emit-locale of the page the user submitted from. The Worker uses
      // this to build a locale-aware redirect back (no-JS form path) AND
      // to write a locale column on the Sheet so the reply-back operator
      // knows which language to answer in.
      locale: currentLocale(),
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
