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

// Resolve the per-window-night discounted rate for a Type-1 offer from whichever
// single discount field is present. Returns a per-night price, or the special
// value {flat} for the DiscountTotal mechanism (a lump sum off the whole window).
// Returns null when the offer isn't a priceable Type-1 config.

/**
 * Compute the total price for a stay under an offer.
 * @param {object} offer - { type:'Type 1'|'Type 2', rate:number, minimumToBook:number,
 *   freeNights?, paidNights?, discountPct?, discountPerDay?, discountTotal?,
 *   startDate, endDate } (ISO window dates).
 * @param {string} checkin  ISO 'YYYY-MM-DD'
 * @param {string} checkout ISO 'YYYY-MM-DD'
 * @returns {{ total: number|null, applied: boolean }}
 *   total=null when it can't be priced at all (bad dates / missing rate); never throws.
 *   applied=false with a plain (rate·nights) total when the offer's eligibility fails.
 */
export function computeOfferPrice(offer, checkin, checkout) {
  const fail = { total: null, applied: false };
  if (!offer || typeof offer !== 'object') return fail;

  const rate = offer.rate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return fail;

  const split = nightsInWindow(checkin, checkout, offer.startDate, offer.endDate);
  if (!split) return fail;
  const { inWindow: W, outside: X } = split;
  const bookedNights = W + X;
  const plainTotal = bookedNights * rate;

  const minToBook = offer.minimumToBook;
  const eligible =
    typeof minToBook === 'number' && minToBook >= 1 && W >= minToBook;

  if (!eligible) {
    // Offer doesn't apply — the whole stay is plain rate.
    return { total: plainTotal, applied: false };
  }

  const extras = X * rate;

  if (offer.type === 'Type 2') {
    const free = offer.freeNights;
    const paid = offer.paidNights;
    if (typeof free !== 'number' || typeof paid !== 'number'
        || paid < 1 || paid + free !== minToBook) {
      return { total: plainTotal, applied: false }; // misconfigured → plain
    }
    return { total: (W - free) * rate + extras, applied: true };
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
      if (!(p > 0 && p < 100)) return { total: plainTotal, applied: false };
      return { total: W * rate * (1 - p / 100) + extras, applied: true };
    }
    if (hasPerDay) {
      const d = offer.discountPerDay;
      if (!(d > 0)) return { total: plainTotal, applied: false };
      return { total: W * (rate - d) + extras, applied: true };
    }
    // hasTotal — flat sum off the in-window portion (no clamp, per spec).
    const t = offer.discountTotal;
    if (!(t > 0)) return { total: plainTotal, applied: false };
    return { total: (W * rate - t) + extras, applied: true };
  }

  // Unknown type → not an offer.
  return { total: plainTotal, applied: false };
}
