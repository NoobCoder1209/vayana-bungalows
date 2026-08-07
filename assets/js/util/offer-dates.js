// Parse + format the Offers-sheet `Dates` cell (Column B).
//
// The cell is a strict single-cell ISO range: `YYYY-MM-DD/YYYY-MM-DD`
// (e.g. "2027-06-15/2027-06-20"). This is the machine-readable contract that
// lets "Take the offer" prefill the enquiry date pickers. Two consumers:
//   - parseOfferDates → the ?checkin/?checkout link params (offer-modal.js)
//   - formatOfferDates → the pretty display on the card / modal / ?offer= prose
//
// SOFT contract: anything that is not a valid strictly-increasing range of two
// real calendar dates fails safe — parseOfferDates returns null (no prefill)
// and formatOfferDates returns the raw input unchanged (old freehand cells
// keep rendering verbatim). Never throws. Dependency-free (Intl is built-in).

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real-calendar-date check via UTC round-trip: rejects 2027-02-30 (which a
// naive `new Date(2027, 1, 30)` would silently roll to Mar 2). Returns a UTC
// Date on success, or null.
function toRealDate(iso) {
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

/**
 * Split a raw `Dates` cell into { checkin, checkout } ISO strings, or null.
 * Requires exactly two `/`-separated ISO halves, both real dates, checkout
 * strictly after checkin.
 */
export function parseOfferDates(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('/');
  if (parts.length !== 2) return null;
  const a = parts[0].trim();
  const b = parts[1].trim();
  const da = toRealDate(a);
  const db = toRealDate(b);
  if (!da || !db) return null;
  if (db.getTime() <= da.getTime()) return null;
  return { checkin: a, checkout: b };
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

/**
 * Localized display string for a valid range, else the raw input unchanged.
 * EN joins with an en-dash " – "; BG joins with a plain hyphen " - ".
 * Non-string inputs (null/undefined/number) return '' rather than the raw
 * value, preserving the string return-type contract.
 */
export function formatOfferDates(raw, locale) {
  const range = parseOfferDates(raw);
  if (!range) return typeof raw === 'string' ? raw : '';
  const sep = locale === 'bg' ? ' - ' : ' – ';
  return `${formatOne(range.checkin, locale)}${sep}${formatOne(range.checkout, locale)}`;
}
