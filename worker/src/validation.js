// Server-side validation that mirrors `assets/js/enquiry.js` on the
// frontend. Deliberate duplication: the Worker NEVER trusts the client,
// and the client copy is for instant UX feedback only.
//
// Every accepted field is also SANITISED before going into the sheet:
// trim, length-cap, formula-injection neutraliser (prepend "'" if first
// char is one of `= + - @`). The cleaned values are returned in
// `result.cleaned` keyed by column name in the Enquires tab.

// Mirrors enquiry.js:21
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Mirrors enquiry.js:35
const PHONE_RE = /^\+?(?=[\d\s\-()]*\d)[\d\s\-()]{7,}$/;
// Mirrors enquiry.js:25,41,47,52
const MAX_NAME_LEN = 120;
const MAX_EMAIL_LEN = 254;
const MAX_PHONE_LEN = 40;
const MAX_MESSAGE_LEN = 2000;

const ALLOWED_ADULTS = new Set(['1', '2', '3', '4']);
// Children and Infants are OPTIONAL. The form's default state shows a
// label-style placeholder ("CHILDREN" / "INFANTS") whose <option> has
// an empty value, and includes "-" as a real selectable option meaning
// "none". Both translate to "0" on the wire (see normaliseOptionalCount
// below). The historical sheet schema is numeric — keeping it numeric
// avoids breaking the existing pivot/sort behaviour in the spreadsheet.
//
// API-contract note: ALL THREE of these are accepted and normalised
// to "0" by normaliseOptionalCount —
//   - the literal "-"
//   - the empty string (placeholder option selected)
//   - the key omitted entirely from the JSON body (String(undefined ?? '')
//     coerces to '' which is in the allowlist)
// Pre-#41 polish, omitting the key was a 400 validation error. First-
// party callers (assets/js/enquiry.js) always send the key because the
// <select>.value reads as '' rather than undefined, so no real client is
// affected. Documented here so future tests / third-party integrations
// don't get tripped up by the silent acceptance.
const ALLOWED_OPTIONAL_COUNT = new Set(['', '-', '0', '1', '2', '3', '4']);

function normaliseOptionalCount(raw) {
  if (raw === '' || raw === '-') return '0';
  return raw;
}

// Date — YYYY-MM-DD (what enquiry.js sends in JS mode) OR dd/mm/yyyy
// (what flatpickr renders into the no-JS submitted input value).
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

// Formula-injection neutraliser.
//
// Sheets / Excel / any spreadsheet tool treat a cell value whose FIRST
// character is one of `= + - @` as a formula. We force-text such values
// by prepending an apostrophe — Sheets honours `'` as a text marker.
//
// We also catch a few sneakier paths:
//   - Tab (\t) as a leading char (some imports split on tab, leaving
//     the post-tab content as the cell value with the formula prefix
//     intact).
//   - Unicode lookalikes for the ASCII triggers: fullwidth equals (U+FF1D),
//     minus (U+2212), hyphen (U+2010/U+2011), fullwidth plus (U+FF0B),
//     fullwidth at (U+FF20). Some export/normalisation tools convert
//     these to ASCII at write time, re-enabling the attack.
//   - A newline followed by a formula trigger — multi-line message
//     fields render as a single cell in Sheets, but downstream tools
//     (some CSV-to-Excel re-import paths) split on newline and treat
//     each line as a separate cell. We break the post-newline trigger
//     with a zero-width space.
//
// Defence-in-depth, paranoid for a hobby site, but cheap.

const LEADING_FORMULA_RE = /^[=+\-@\t＝−‐‑＋＠]/;
const NEWLINE_FORMULA_RE = /([\r\n])([=+\-@\t＝−‐‑＋＠])/g;
const ZWSP = '​';

function neutraliseFormula(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  let out = LEADING_FORMULA_RE.test(s) ? `'${s}` : s;
  out = out.replace(NEWLINE_FORMULA_RE, `$1${ZWSP}$2`);
  return out;
}

// Parse YYYY-MM-DD / dd/mm/yyyy → { iso, date } or null.
function parseDate(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  let y, m, d;
  let match = trimmed.match(ISO_DATE_RE);
  if (match) {
    [, y, m, d] = match;
  } else {
    match = trimmed.match(DMY_DATE_RE);
    if (!match) return null;
    [, d, m, y] = match;
  }
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  if (year < 2024 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Round-trip via UTC to catch invalid combos (e.g. Feb 30).
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return null;
  }
  const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso, date: utc };
}

export function validateBody(body) {
  const invalid = [];
  const cleaned = {};

  const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
  if (nameRaw.length === 0 || nameRaw.length > MAX_NAME_LEN) {
    invalid.push('name');
  } else {
    cleaned.name = neutraliseFormula(nameRaw);
  }

  const emailRaw = typeof body.email === 'string' ? body.email.trim() : '';
  if (emailRaw.length === 0 || emailRaw.length > MAX_EMAIL_LEN || !EMAIL_RE.test(emailRaw)) {
    invalid.push('email');
  } else {
    cleaned.email = neutraliseFormula(emailRaw);
  }

  const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (phoneRaw.length === 0 || phoneRaw.length > MAX_PHONE_LEN || !PHONE_RE.test(phoneRaw)) {
    invalid.push('phone');
  } else {
    cleaned.phone = neutraliseFormula(phoneRaw);
  }

  const checkin = parseDate(body.checkin);
  const checkout = parseDate(body.checkout);
  if (!checkin) invalid.push('checkin');
  if (!checkout) invalid.push('checkout');
  if (checkin && checkout) {
    // Check-in must be today or later; check-out must be strictly after check-in.
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    if (checkin.date < todayUTC) invalid.push('checkin');
    if (checkout.date <= checkin.date) invalid.push('checkout');
    cleaned.checkin = checkin.iso;
    cleaned.checkout = checkout.iso;
  }

  const adultsRaw = typeof body.adults === 'string' ? body.adults : String(body.adults ?? '');
  if (!ALLOWED_ADULTS.has(adultsRaw)) {
    invalid.push('adults');
  } else {
    cleaned.adults = adultsRaw;
  }

  const childrenRaw = typeof body.children === 'string' ? body.children : String(body.children ?? '');
  if (!ALLOWED_OPTIONAL_COUNT.has(childrenRaw)) {
    invalid.push('children');
  } else {
    cleaned.children = normaliseOptionalCount(childrenRaw);
  }

  const infantsRaw = typeof body.infants === 'string' ? body.infants : String(body.infants ?? '');
  if (!ALLOWED_OPTIONAL_COUNT.has(infantsRaw)) {
    invalid.push('infants');
  } else {
    cleaned.infants = normaliseOptionalCount(infantsRaw);
  }

  // Message — optional, length-capped.
  const messageRaw = typeof body.message === 'string' ? body.message : '';
  if (messageRaw.length > MAX_MESSAGE_LEN) {
    invalid.push('message');
  } else {
    cleaned.message = neutraliseFormula(messageRaw.trim());
  }

  // Consent — required, must be truthy ("true" / "on" / true).
  const consent = body.consent;
  const consentOk = consent === true || consent === 'true' || consent === 'on' || consent === '1';
  if (!consentOk) {
    invalid.push('consent');
  } else {
    cleaned.consent = 'true';
  }

  return invalid.length === 0
    ? { ok: true, cleaned }
    : { ok: false, invalidFields: invalid };
}
