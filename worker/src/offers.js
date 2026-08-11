// Google Sheets read — the 'Offers' tab.
//
// A single values.batchGet reads BOTH the offers block (A3:N8) and the seasonal
// rate-band table (A16:C25) under valueRenderOption=UNFORMATTED_VALUE, so real
// dates come back as numeric serials and prices/nights as numbers. parseOffers
// returns only the ELIGIBLE offers (see its gate); parseRateBands returns the
// seasonal per-night bands (see standardPrice in pricing.js). Reuses
// getAccessToken() from sheets.js (same JWT service-account flow, same
// module-scoped token cache). Like sheets.js, every catch logs ONLY a generic
// string — never err.message — because a stack trace could carry
// service-account private-key fragments.
//
// The offer objects parseOffers returns are the INTERNAL shape (they carry the
// raw tier rate + discount parameters + type, which the /price engine needs).
// The /offers route projects each via toPublicOffer before sending to the
// browser, exposing only a generic per-night `price` and hiding the tier NAME
// and the High/Mid/Low structure.

import { getAccessToken } from './sheets.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column layout of the A3:N8 range, as row-array indices (A is index 0).
const COL = {
  label: 0,          // A "Offer 1" (display/debug)
  startDate: 1,      // B real date serial | free text | blank
  endDate: 2,        // C real date serial | blank
  highPrice: 3,      // D per-night High tier
  midPrice: 4,       // E per-night Mid tier
  lowPrice: 5,       // F per-night Low tier
  priceTier: 6,      // G "High" | "Mid" | "Low"
  discountPct: 7,    // H Type-1: whole-number % (20 = 20% off)
  discountPerDay: 8, // I Type-1: fixed € off per in-window night
  discountTotal: 9,  // J Type-1: flat € off the in-window portion
  minimumToBook: 10, // K number
  paidNights: 11,    // L number
  freeNights: 12,    // M number (= K − L)
  type: 13,          // N "Type 1" | "Type 2" | empty(hide)
};

// Google Sheets serial epoch is 1899-12-30 (UTC). day 1 = 1899-12-31.
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Convert a Google Sheets date serial to an ISO 'YYYY-MM-DD' string.
 * Only finite numbers are treated as dates; anything else (free text,
 * blank, NaN, Infinity) → null. Round-trip validated to a real date.
 * @param {*} serial
 * @returns {string|null}
 */
export function serialToISO(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
  const ms = SHEETS_EPOCH_MS + serial * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD
  // Round-trip guard: re-parse the formatted date and confirm it matches.
  if (Number.isNaN(Date.parse(iso))) return null;
  return iso;
}

// Coerce a cell to a finite number, or null. Numbers pass through; strings
// (e.g. a formatted "100.00€" that leaked past UNFORMATTED_VALUE) have their
// non-numeric characters stripped before parsing.
function toNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// The Type 1/2 cell (column N) → 'Type 1' | 'Type 2' | null. Case/space
// insensitive; anything else (blank, junk) → null, which hides the offer.
function resolveType(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (t === 'type 1') return 'Type 1';
  if (t === 'type 2') return 'Type 2';
  return null;
}

// Map a Price Tier label to its canonical form + the price-column index that
// holds the rate for that tier. Case-insensitive. Returns null for unknown.
const TIERS = {
  high: { tier: 'High', col: COL.highPrice },
  mid: { tier: 'Mid', col: COL.midPrice },
  low: { tier: 'Low', col: COL.lowPrice },
};
function resolveTier(raw) {
  if (typeof raw !== 'string') return null;
  return TIERS[raw.trim().toLowerCase()] || null;
}

/**
 * Map + filter the raw Sheets `values` 2-D array into internal Offer objects.
 * An offer is returned ONLY if ALL eligibility rules hold; else it is silently
 * dropped (never throws). Rules:
 *  1. Type 1/2 (N) resolves to 'Type 1' or 'Type 2' (blank/junk → drop).
 *  2. Real Start (B) AND End (C) dates (both parse to real serials).
 *  3. Price Tier (G) ∈ {High,Mid,Low} AND matching D/E/F price > 0 → rate.
 *  4. minimumToBook (K) ≥ 1.
 *  5a. Type 1 → EXACTLY ONE of Discount% (H) / per-day (I) / total (J) present,
 *      and valid (%: whole 1..99; per-day/total: > 0).
 *  5b. Type 2 → paidNights (L) ≥ 1 AND paid + free === minimumToBook.
 * Order preserved. The returned object is the INTERNAL shape (carries rate +
 * the discount param + type); the /offers route projects it to a public shape
 * that omits rate/tier/discount params.
 */
export function parseOffers(rows) {
  if (!Array.isArray(rows)) return [];
  const offers = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    // 1. Type 1/2 (N) — the enable + method selector in one dropdown.
    const type = resolveType(row[COL.type]);
    if (!type) continue;

    // 2. Real Start AND End dates
    const startDate = serialToISO(row[COL.startDate]);
    const endDate = serialToISO(row[COL.endDate]);
    if (startDate === null || endDate === null) continue;

    // 3. Price tier → rate
    const resolved = resolveTier(row[COL.priceTier]);
    if (!resolved) continue;
    const rate = toNumber(row[resolved.col]);
    if (rate === null || rate <= 0) continue;

    // 4. minimumToBook ≥ 1
    const minimumToBook = toNumber(row[COL.minimumToBook]);
    if (minimumToBook === null || minimumToBook < 1) continue;

    // Common numeric fields
    const paidNights = toNumber(row[COL.paidNights]);
    const freeNights = toNumber(row[COL.freeNights]);
    const label = typeof row[COL.label] === 'string'
      ? row[COL.label] : String(row[COL.label] ?? '');

    const base = {
      label,
      startDate,
      endDate,
      // For eligible offers B/C are real dates, so raw mirrors the ISO source.
      startRaw: startDate,
      endRaw: endDate,
      rate,
      tier: resolved.tier,
      minimumToBook,
      type,
    };

    if (type === 'Type 2') {
      // 5b. pay-X-get-Y-free: paid ≥ 1 and paid + free === minimumToBook.
      if (paidNights === null || paidNights < 1) continue;
      if (freeNights === null || paidNights + freeNights !== minimumToBook) continue;
      offers.push({ ...base, paidNights, freeNights });
      continue;
    }

    // type === 'Type 1' — 5a. exactly one discount mechanism, valid.
    const pct = toNumber(row[COL.discountPct]);
    const perDay = toNumber(row[COL.discountPerDay]);
    const total = toNumber(row[COL.discountTotal]);
    const present = [pct, perDay, total].filter((v) => v !== null);
    if (present.length !== 1) continue;
    if (pct !== null) {
      if (!(Number.isInteger(pct) && pct >= 1 && pct <= 99)) continue;
      offers.push({ ...base, discountPct: pct });
    } else if (perDay !== null) {
      if (!(perDay > 0)) continue;
      offers.push({ ...base, discountPerDay: perDay });
    } else {
      if (!(total > 0)) continue;
      offers.push({ ...base, discountTotal: total });
    }
  }
  return offers;
}

/**
 * Parse the seasonal rate-band table (Offers tab A16:C25) into
 * `[{ startISO, endISO, rate }]`. Each row is `Start Date | End Date | Night
 * Price`. Under UNFORMATTED_VALUE the dates are serials and the price a number.
 * A row is DROPPED (never throws) unless both dates parse to real dates AND the
 * price is a positive number. Order preserved (first-match-wins downstream).
 *
 * NOTE on semantics (handled downstream in pricing.standardPrice): the End date
 * here is INCLUSIVE — the last night charged at this rate — unlike offer windows
 * where End is the exclusive checkout day. And matching is by month/day only
 * (year-agnostic), so the sheet's 2026 dates act as a template for any year.
 */
export function parseRateBands(rows) {
  if (!Array.isArray(rows)) return [];
  const bands = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const startISO = serialToISO(row[0]);
    const endISO = serialToISO(row[1]);
    if (startISO === null || endISO === null) continue;
    const rate = toNumber(row[2]);
    if (rate === null || rate <= 0) continue;
    bands.push({ startISO, endISO, rate });
  }
  return bands;
}

/**
 * Project an INTERNAL offer object to the PUBLIC shape sent to the browser via
 * /offers. Hides the tier STRUCTURE — the tier name ('Mid') and the fact that
 * three tiers (High/Mid/Low) exist and how they're derived. The resolved
 * per-night value is exposed as a generic `price` (owner wants the selected
 * price shown, just not which tier it is or the alternatives).
 *
 * Kept: label, dates, generic `price`, type, minimumToBook, and the deal
 * framing — Type 2 → paid/free night COUNTS ('stay N get M free'); Type 1 →
 * the single discount param for '20% off' / '€10/night' / '€50 off' framing.
 * Dropped: `rate` (renamed to `price`), `tier`.
 */
export function toPublicOffer(offer) {
  const pub = {
    label: offer.label,
    startDate: offer.startDate,
    endDate: offer.endDate,
    startRaw: offer.startRaw,
    endRaw: offer.endRaw,
    price: offer.rate,           // generic per-night price (tier value; tier NAME hidden)
    minimumToBook: offer.minimumToBook,
    type: offer.type,
  };
  if (offer.type === 'Type 2') {
    pub.paidNights = offer.paidNights;
    pub.freeNights = offer.freeNights;
  } else if (offer.type === 'Type 1') {
    // Carry whichever single discount param is present, for card framing.
    if (offer.discountPct !== undefined) pub.discountPct = offer.discountPct;
    if (offer.discountPerDay !== undefined) pub.discountPerDay = offer.discountPerDay;
    if (offer.discountTotal !== undefined) pub.discountTotal = offer.discountTotal;
  }
  return pub;
}

/**
 * Read BOTH the offers block (A3:N8) and the seasonal rate-band table
 * (A16:C25) in a single Sheets values.batchGet round-trip, and return
 * `{ offers, bands }` (internal offer shape + parsed rate bands). One request
 * keeps the /price hot path cheap. Throws a generic Error on any failure
 * (config/token/fetch/parse) — the route turns that into a 502 without leaking.
 */
export async function fetchSheetData(env) {
  if (!env.GSHEETS_SHEET_ID || !env.GSHEETS_OFFERS_TAB) {
    throw new Error('sheet-config-missing');
  }
  const token = await getAccessToken(env);
  const tab = env.GSHEETS_OFFERS_TAB.replace(/'/g, "''");
  const ranges = [`'${tab}'!A3:N8`, `'${tab}'!A16:C25`];
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const url =
    `${SHEETS_BASE}/${encodeURIComponent(env.GSHEETS_SHEET_ID)}` +
    `/values:batchGet?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&${qs}`;

  let res;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('sheet-fetch-failed');
  }
  if (!res.ok) {
    throw new Error(`sheet-read-failed:${res.status}`);
  }
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error('sheet-parse-failed');
  }
  // batchGet → { valueRanges: [ { values }, { values } ] } in REQUEST order:
  // valueRanges[0] = offers (A3:N8), valueRanges[1] = rate bands (A16:C25).
  //
  // We requested TWO ranges, so a well-formed response MUST carry two
  // valueRanges entries. Fewer than two is a malformed/partial read — treat
  // it as a hard failure (throw → route 502s, nothing is cached) rather than
  // defaulting the missing range to []. That default was a cache-poisoning
  // trap: an anomalous response that omitted the band range would silently
  // cache `bands: []` for 60s, and every no-offer /price in that window would
  // 400 (`bad-dates`) — dropping the enquiry price. An entry that is PRESENT
  // but has no `values` is a legitimately empty range (Sheets omits `values`
  // for an empty block) and stays a benign [].
  const vr = (payload && Array.isArray(payload.valueRanges)) ? payload.valueRanges : [];
  if (vr.length < 2) {
    throw new Error('sheet-read-incomplete');
  }
  const offerRows = Array.isArray(vr[0].values) ? vr[0].values : [];
  const bandRows = Array.isArray(vr[1].values) ? vr[1].values : [];
  return { offers: parseOffers(offerRows), bands: parseRateBands(bandRows) };
}

// Module-scoped 60s cache of the parsed offers + rate bands, shared by the
// /offers and /price routes so repeated /price calls (one per date toggle)
// mostly hit cache instead of round-tripping to Google Sheets. Mirrors the
// token-cache pattern in sheets.js. New Worker isolates start cold; that's fine.
const OFFERS_CACHE_TTL_MS = 60 * 1000;
let cachedData = null;      // { offers, bands }
let cachedExpiry = 0;

async function getCachedData(env) {
  const now = Date.now();
  if (cachedData !== null && now < cachedExpiry) {
    return cachedData;
  }
  const data = await fetchSheetData(env);
  // Don't cache a result with ZERO rate bands. The seasonal rate table is a
  // permanent fixture (it always has rows), so an empty `bands` here is never
  // the real state — it's a transient bad read (a structurally-valid batchGet
  // whose band range came back empty). Caching it would serve empty bands for
  // the full TTL, and every no-offer /price in that window would fail to price
  // (→ 502) — the intermittent blank-price bug. Returning WITHOUT caching lets
  // the very next request re-read and self-heal. Offers CAN legitimately be
  // empty (all promotions expired), so only `bands` gates caching.
  if (Array.isArray(data.bands) && data.bands.length > 0) {
    cachedData = data;
    cachedExpiry = now + OFFERS_CACHE_TTL_MS;
  }
  return data;
}

/**
 * Return the parsed INTERNAL offers, served from the 60s module cache when warm.
 * Throws (like fetchSheetData) on a cold-cache read failure so the route 502s.
 */
export async function getCachedOffers(env) {
  return (await getCachedData(env)).offers;
}

/**
 * Return BOTH parsed offers and rate bands from the single 60s cache entry in
 * ONE call. This is the accessor /price uses: reading offers and bands through
 * two separate getCachedData calls would trigger a redundant second Sheets
 * read within the same request on any not-cached state (cold cache, or the
 * empty-bands case that deliberately isn't cached). This reads once. Throws on
 * a read failure (route → 502), same as getCachedOffers.
 */
export async function getCachedSheetData(env) {
  const { offers, bands } = await getCachedData(env);
  return { offers, bands };
}

// For tests only — wipe the cache so a fresh isolate is simulated.
export function _resetOffersCacheForTests() {
  cachedData = null;
  cachedExpiry = 0;
}
