// Google Sheets read — offers table on the 'Offers' tab.
//
// Reads A3:N8 (up to 6 offers) under valueRenderOption=UNFORMATTED_VALUE so
// real dates come back as numeric serials and prices/nights as numbers, then
// returns only the ELIGIBLE offers (see parseOffers eligibility gate below).
// Reuses getAccessToken() from sheets.js (same JWT service-account flow, same
// module-scoped token cache). Like sheets.js, every catch logs ONLY a generic
// string — never err.message — because a stack trace could carry
// service-account private-key fragments.
//
// The offer objects returned here are the INTERNAL shape (they carry the raw
// tier rate + discount parameters + type, which the /price engine needs). A
// later task (Task 3) will add a public projection that hides the tier rates
// and discount params before they reach the browser via /offers; until that
// lands, the /offers route returns this internal shape unchanged.

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
 * Read the offers range from the sheet and return parsed offers.
 * Requests valueRenderOption=UNFORMATTED_VALUE so dates arrive as numeric
 * serials and prices/nights as numbers. Throws a generic Error on any
 * failure (config missing, token, fetch, parse) — the route handler turns
 * that into a 502 without leaking detail.
 */
export async function fetchOffers(env) {
  if (!env.GSHEETS_SHEET_ID || !env.GSHEETS_OFFERS_TAB) {
    throw new Error('offers-config-missing');
  }
  const token = await getAccessToken(env);
  const range = encodeURIComponent(
    `'${env.GSHEETS_OFFERS_TAB.replace(/'/g, "''")}'!A3:N8`,
  );
  const url =
    `${SHEETS_BASE}/${encodeURIComponent(env.GSHEETS_SHEET_ID)}` +
    `/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;

  let res;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('offers-fetch-failed');
  }
  if (!res.ok) {
    throw new Error(`offers-read-failed:${res.status}`);
  }
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error('offers-parse-failed');
  }
  if (!payload || !Array.isArray(payload.values)) {
    // A 200 with no values[] is either a legitimately empty range OR a
    // shaped-differently response. The Sheets API omits `values` entirely
    // for a fully-empty range, so treat missing values as empty (not error).
    return parseOffers([]);
  }
  return parseOffers(payload.values);
}
