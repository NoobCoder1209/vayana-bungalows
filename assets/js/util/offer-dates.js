// Format + prefill helpers for the two-column Offers `Dates` schema.
//
// Task 1 split the single `Dates` cell into two machine + two raw fields on the
// offer object:
//   - offer.startDate / offer.endDate : ISO "YYYY-MM-DD" when the sheet cell is
//     a real calendar date, else null (the machine-readable contract that lets
//     "Take the offer" prefill the enquiry date pickers).
//   - offer.startRaw / offer.endRaw   : the raw cell string, kept for verbatim
//     display of free text ("The whole July"), else null.
//
// Two consumers (Task 3):
//   - offerPrefillDates → the ?checkin/?checkout link params (offer-modal.js)
//   - formatOfferDates  → the pretty display on the card / modal / ?offer= prose
//
// SOFT contract: only real calendar ISO dates are formatted/prefilled. When
// neither side is a real ISO date, formatOfferDates falls back to the first
// non-empty raw string (verbatim) so freehand cells keep rendering as-is;
// offerPrefillDates simply omits any side that is not a real ISO date. A
// missing/null/non-object offer fails safe ("" and {}). Never throws.
// Dependency-free (Intl is built-in).

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real-calendar-date check via UTC round-trip: rejects 2027-02-30 (which a
// naive `new Date(2027, 1, 30)` would silently roll to Mar 2). Returns a UTC
// Date on success, or null.
function toRealDate(iso) {
  if (typeof iso !== 'string') return null;
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

// Locale → Intl locale tag. Unknown locales fall back to English.
// en-GB is used (not en-US) because en-US renders "Jun 15, 2027" — the
// desired format is day-first: "15 Jun 2027".
const INTL_LOCALE = { en: 'en-GB', bg: 'bg-BG' };

// bg-BG `month: 'short'` returns a numeric value ("06") on some ICU builds;
// use `long` for BG to reliably get the month name ("юни").
const MONTH_WIDTH = { bg: 'long' };

// Format one UTC ISO date as "15 Jun 2027" (EN) / "15 юни 2027" (BG, no era).
function formatOne(iso, locale) {
  const dt = toRealDate(iso);
  if (!dt) return '';
  const tag = INTL_LOCALE[locale] || INTL_LOCALE.en;
  const monthWidth = MONTH_WIDTH[locale] || 'short';
  const parts = new Intl.DateTimeFormat(tag, {
    day: 'numeric',
    month: monthWidth,
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(dt);
  // Build from parts so we control the exact glue and drop any BG era/literal
  // artifacts ("г."): keep only day, month, year, in that order, space-joined.
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return `${day} ${month} ${year}`;
}

// First non-empty trimmed string among the candidates, else ''.
function firstNonEmptyRaw(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim();
      if (t) return t;
    }
  }
  return '';
}

/**
 * Localized display string for an offer's dates.
 *   both ISO valid  → "1 Jul 2026 – 15 Jul 2026" (EN en-dash) /
 *                      "1 юли 2026 - 15 юли 2026" (BG plain hyphen, no "г.")
 *   one ISO valid   → that single date bare (no separator, no "from"/"until")
 *   neither ISO     → the first non-empty of startRaw/endRaw (trimmed) verbatim
 *   nothing usable  → "" (empty string)
 * A missing/null/non-object offer returns "". Never throws.
 */
export function formatOfferDates(offer, locale) {
  if (!offer || typeof offer !== 'object') return '';
  const start = toRealDate(offer.startDate);
  const end = toRealDate(offer.endDate);
  if (start && end) {
    const sep = locale === 'bg' ? ' - ' : ' – ';
    return `${formatOne(offer.startDate, locale)}${sep}${formatOne(offer.endDate, locale)}`;
  }
  if (start) return formatOne(offer.startDate, locale);
  if (end) return formatOne(offer.endDate, locale);
  return firstNonEmptyRaw(offer.startRaw, offer.endRaw);
}

/**
 * Enquiry-prefill params for "Take the offer". Emits only sides that are real
 * ISO dates: `checkin` from startDate, `checkout` from endDate. Free text or a
 * missing side is omitted; may return an empty {}. Order (checkout>checkin),
 * not-past and in-season checks are left to the downstream enquiry.js reader —
 * this util just forwards the valid ISO sides. A missing/null/non-object offer
 * returns {}. Never throws.
 */
export function offerPrefillDates(offer) {
  const out = {};
  if (!offer || typeof offer !== 'object') return out;
  if (toRealDate(offer.startDate)) out.checkin = offer.startDate;
  if (toRealDate(offer.endDate)) out.checkout = offer.endDate;
  return out;
}
