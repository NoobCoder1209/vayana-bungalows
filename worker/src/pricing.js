// Pure offer-pricing engine — no I/O, no DOM, no network. Unit-tested in
// isolation (worker/__tests__/pricing.test.mjs). All money math lives here so
// the Worker route (index.js /price) stays thin and the formulas never ship to
// the browser.
//
// Night convention: a "night" is a date slept. A stay checkin..checkout covers
// the nights checkin, checkin+1, …, checkout-1 (checkout day is not a night).
// An offer window winStart..winEnd is the same: nights winStart..winEnd-1.
//
// The four discount mechanisms (all gated identically on "≥ minimumToBook nights
// fall inside the window"; when eligible, ALL in-window nights are discounted and
// nights outside the window are always charged at the plain rate):
//   Type 2  (pay X get Y free): (W − free)·rate            + X·rate
//   Type 1 %  (Discount%):      W·rate·(1 − pct/100)       + X·rate
//   Type 1 /day (Discount/Day): W·(rate − perDay)          + X·rate
//   Type 1 total (DiscountTotal): (W·rate − total)         + X·rate   (no clamp)
// where W = in-window nights booked, X = outside nights booked.

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parse an ISO 'YYYY-MM-DD' to a UTC day-count (ms/day since epoch), or null.
// UTC-based so night counting is DST-immune. Round-trip validated so an
// impossible date like 2026-02-30 (which Date would roll over) is rejected.
function isoToDayNumber(iso) {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  if (d.toISOString().slice(0, 10) !== iso) return null; // reject rolled-over dates
  return Math.round(ms / 86400000);
}

// Round a money amount to whole cents, killing binary-float dust like
// 669.9999999999999 → 670. Applied to every mechanism's final total so the
// value that reaches display/compare/enquiry is clean. (Orthogonal to the
// DiscountTotal "no clamp" rule — this only fixes float hygiene, not sign.)
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Parse a booking's two ISO dates into UTC day-numbers, requiring a positive
 * night span (checkout strictly after checkin). Shared by the functions that
 * price/count a whole stay so the "parse + reject non-positive" contract lives
 * in one place. @returns {{ci:number, co:number} | null}
 */
function parseNightSpan(checkin, checkout) {
  const ci = isoToDayNumber(checkin);
  const co = isoToDayNumber(checkout);
  if (ci === null || co === null || co <= ci) return null;
  return { ci, co };
}

/**
 * Split a booking (checkin..checkout) into nights inside vs outside an offer
 * window (winStart..winEnd). All args are ISO 'YYYY-MM-DD'. End dates are the
 * checkout day (exclusive), so a night N counts as in-window when
 * winStartDay <= N < winEndDay.
 * @returns {{inWindow:number, outside:number} | null} null on any bad/unparseable input.
 */
export function nightsInWindow(checkin, checkout, winStart, winEnd) {
  const ci = isoToDayNumber(checkin);
  const co = isoToDayNumber(checkout);
  const ws = isoToDayNumber(winStart);
  const we = isoToDayNumber(winEnd);
  if (ci === null || co === null || ws === null || we === null) return null;
  const booked = co - ci;          // total nights booked
  if (booked <= 0) return null;    // non-positive stay is not a valid booking
  // Overlap of [ci, co) with [ws, we) in whole nights.
  const overlapStart = Math.max(ci, ws);
  const overlapEnd = Math.min(co, we);
  const inWindow = Math.max(0, overlapEnd - overlapStart);
  return { inWindow, outside: booked - inWindow };
}

/**
 * The booking's nights that fall OUTSIDE a contiguous offer window, as an array
 * of [checkinISO, checkoutISO) sub-ranges (0, 1, or 2 of them):
 *   before: [checkin, min(checkout, winStart))
 *   after:  [max(checkin, winEnd), checkout)
 * Only non-empty sub-ranges (start < end) are returned. ISO 'YYYY-MM-DD' strings
 * compare lexicographically in date order, so min/max are plain string compares;
 * standardPrice re-parses each boundary. Returns null if any date is unparseable.
 * @returns {Array<[string,string]> | null}
 */
function outsideSubRanges(checkin, checkout, winStart, winEnd) {
  if ([checkin, checkout, winStart, winEnd].some((d) => isoToDayNumber(d) === null)) {
    return null;
  }
  const ranges = [];
  const beforeEnd = checkout < winStart ? checkout : winStart; // min(checkout, winStart)
  if (checkin < beforeEnd) ranges.push([checkin, beforeEnd]);
  const afterStart = checkin > winEnd ? checkin : winEnd;       // max(checkin, winEnd)
  if (afterStart < checkout) ranges.push([afterStart, checkout]);
  return ranges;
}

/**
 * Compute the total price for a stay under an offer.
 * @param {object} offer - { type:'Type 1'|'Type 2', rate:number, minimumToBook:number,
 *   freeNights?, paidNights?, discountPct?, discountPerDay?, discountTotal?,
 *   startDate, endDate } (ISO window dates).
 * @param {string} checkin  ISO 'YYYY-MM-DD'
 * @param {string} checkout ISO 'YYYY-MM-DD'
 * @param {Array<{startISO,endISO,rate}>} bands - the seasonal rate table, used to
 *   price the nights of the stay that fall OUTSIDE the offer window (those nights
 *   are NOT part of the promo, so they cost the normal seasonal rate — never the
 *   offer's tier rate). Same array standardPrice() consumes.
 * @returns {{ total: number|null, applied: boolean }}
 *   total=null when it can't be priced at all (bad dates / missing rate / an
 *   outside night falls outside every seasonal band); never throws.
 *   applied=false with a plain (rate·nights) total when the offer's eligibility fails.
 */
export function computeOfferPrice(offer, checkin, checkout, bands) {
  const fail = { total: null, applied: false };
  if (!offer || typeof offer !== 'object') return fail;

  const rate = offer.rate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return fail;

  const split = nightsInWindow(checkin, checkout, offer.startDate, offer.endDate);
  if (!split) return fail;
  const { inWindow: W, outside: X } = split;
  const bookedNights = W + X;
  const plainTotal = round2(bookedNights * rate);

  const minToBook = offer.minimumToBook;
  const eligible =
    typeof minToBook === 'number' && minToBook >= 1 && W >= minToBook;

  if (!eligible) {
    // Offer doesn't apply — the whole stay is plain rate.
    return { total: plainTotal, applied: false };
  }

  // Price the nights OUTSIDE the offer window at the SEASONAL rate (not the
  // offer's tier). The window is contiguous, so a straddling stay has at most
  // two outside sub-ranges: before the window [checkin, min(checkout,winStart))
  // and after it [max(checkin,winEnd), checkout). Each is priced with the same
  // standardPrice() the no-offer path uses. If an outside night falls outside
  // every seasonal band, standardPrice returns null and we propagate null (the
  // caller then 400s bad-dates, or 502s if the band table is empty — either way
  // we never guess, and never fall back to the offer rate).
  // Note: extras sums per-segment totals that standardPrice already round2'd,
  // then the final offer total is round2'd again. Bands are whole-euro rates so
  // there is no drift; if bands ever gain sub-cent rates, round once at the end.
  let extras = 0;
  if (X > 0) {
    const outsideRanges = outsideSubRanges(checkin, checkout, offer.startDate, offer.endDate);
    if (outsideRanges === null) return fail; // unparseable window/booking
    for (const [subIn, subOut] of outsideRanges) {
      const seg = standardPrice(subIn, subOut, bands);
      if (seg === null) return fail; // an outside night has no seasonal band → can't price
      extras += seg.total;
    }
  }

  if (offer.type === 'Type 2') {
    const free = offer.freeNights;
    const paid = offer.paidNights;
    if (!Number.isFinite(free) || !Number.isFinite(paid)
        || paid < 1 || paid + free !== minToBook) {
      return { total: plainTotal, applied: false }; // misconfigured → plain
    }
    return { total: round2((W - free) * rate + extras), applied: true };
  }

  if (offer.type === 'Type 1') {
    // Exactly one discount mechanism should be present; pick the one that is.
    const hasPct = typeof offer.discountPct === 'number';
    const hasPerDay = typeof offer.discountPerDay === 'number';
    const hasTotal = typeof offer.discountTotal === 'number';
    const count = [hasPct, hasPerDay, hasTotal].filter(Boolean).length;
    if (count !== 1) return { total: plainTotal, applied: false };

    if (hasPct) {
      const p = offer.discountPct;
      // Whole number 1..99 (e.g. 20 = 20% off). A fraction (0.2) or out-of-range
      // value is a misconfigured cell → fall back to plain rate.
      if (!(Number.isInteger(p) && p >= 1 && p <= 99)) {
        return { total: plainTotal, applied: false };
      }
      return { total: round2(W * rate * (1 - p / 100) + extras), applied: true };
    }
    if (hasPerDay) {
      const d = offer.discountPerDay;
      if (!(Number.isFinite(d) && d > 0)) return { total: plainTotal, applied: false };
      return { total: round2(W * (rate - d) + extras), applied: true };
    }
    // hasTotal — flat sum off the in-window portion (no clamp on sign, per spec).
    const t = offer.discountTotal;
    if (!(Number.isFinite(t) && t > 0)) return { total: plainTotal, applied: false };
    return { total: round2((W * rate - t) + extras), applied: true };
  }

  // Unknown type → not an offer.
  return { total: plainTotal, applied: false };
}

// Month/day ordinal (MM*100 + DD) of an ISO date, or null. Used to match a
// booked night against a rate band IGNORING the year — the sheet's bands are a
// per-season template (Apr–Sep) that applies to any booking year. All bands sit
// within one calendar year (no band wraps Dec→Jan), so a plain numeric compare
// on the ordinal is a correct "is this day within [start,end]" test.
function isoMonthDay(iso) {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return null;
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return m * 100 + d;
}

/**
 * Standard (no-offer) price for a stay: each booked night (checkin..checkout-1)
 * is charged at the seasonal band whose date range covers that night's
 * month/day. Band End is INCLUSIVE (the last night charged). Matching ignores
 * the year (bands are a template), first matching band wins. The total is the
 * sum across all nights, rounded to cents.
 * @param {string} checkin  ISO 'YYYY-MM-DD'
 * @param {string} checkout ISO 'YYYY-MM-DD'
 * @param {Array<{startISO,endISO,rate}>} bands
 * @returns {{ total:number } | null}  null if dates are bad/non-positive OR any
 *   booked night falls in no band (caller should 400 — never guess a price).
 */
export function standardPrice(checkin, checkout, bands) {
  const span = parseNightSpan(checkin, checkout);
  if (!span) return null;
  const { ci, co } = span;
  if (!Array.isArray(bands) || bands.length === 0) return null;

  // Precompute each band's month/day ordinal range once.
  const ranges = [];
  for (const b of bands) {
    const s = isoMonthDay(b.startISO);
    const e = isoMonthDay(b.endISO);
    if (s === null || e === null || typeof b.rate !== 'number' || !Number.isFinite(b.rate)) {
      continue; // skip a malformed band defensively (parseRateBands already filters)
    }
    ranges.push({ s, e, rate: b.rate });
  }

  let total = 0;
  // Walk each night by its UTC day-number, deriving that day's month/day.
  for (let day = ci; day < co; day += 1) {
    const iso = new Date(day * 86400000).toISOString().slice(0, 10);
    const md = isoMonthDay(iso);
    const band = ranges.find((r) => r.s <= md && md <= r.e);
    if (!band) return null; // an uncovered night → cannot price the stay
    total += band.rate;
  }
  return { total: round2(total) };
}
