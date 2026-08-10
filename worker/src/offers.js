// Google Sheets read — offers table on the 'Offers' tab.
//
// Reads A3:M8 (up to 6 offers) under valueRenderOption=UNFORMATTED_VALUE so
// real dates come back as numeric serials and prices/nights as numbers, then
// returns only the ELIGIBLE offers (see parseOffers eligibility gate below).
// Reuses getAccessToken() from sheets.js (same JWT service-account flow, same
// module-scoped token cache). Like sheets.js, every catch logs ONLY a generic
// string — never err.message — because a stack trace could carry
// service-account private-key fragments.

import { getAccessToken } from './sheets.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column layout of the A3:M8 range, as row-array indices (A is index 0).
const COL = {
  label: 0,          // A "Offer 1" (display/debug)
  startDate: 1,      // B real date serial | free text | blank
  endDate: 2,        // C real date serial | blank
  highPrice: 3,      // D per-night High tier
  midPrice: 4,       // E per-night Mid tier
  lowPrice: 5,       // F per-night Low tier
  priceTier: 6,      // G "High" | "Mid" | "Low"
  minimumToBook: 7,  // H number
  paidNights: 8,     // I number
  freeNights: 9,     // J number (= H − I)
  v1: 10,            // K TRUE/FALSE
  v2: 11,            // L TRUE/FALSE
  enabled: 12,       // M only literal true enables
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

// A TRUE/FALSE cell → boolean. Accepts real booleans (UNFORMATTED_VALUE) and
// string forms ('TRUE'/'true'). Anything else → false.
function toBool(raw) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
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
 * Map + filter the raw Sheets `values` 2-D array into Offer objects.
 * An offer is returned ONLY if ALL eligibility rules hold; else it is
 * silently dropped (never throws). See task brief for the exact rules:
 *  1. Enabled (M) trimmed+lowercased === 'true'.
 *  2. Real Start (B) AND End (C) dates (both parse to real serials).
 *  3. Price Tier (G) ∈ {High,Mid,Low} AND matching D/E/F price > 0 → rate.
 *  4. Exactly one method: K→V1, L→V2, both→V1, neither→drop.
 *  5. minimumToBook ≥ 1 AND paidNights ≥ 1.
 * Order preserved.
 */
export function parseOffers(rows) {
  if (!Array.isArray(rows)) return [];
  const offers = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    // 1. Enabled — accept a real boolean TRUE (checkbox / UNFORMATTED_VALUE)
    //    OR the string 'true'. Uses the same toBool() as the V1/V2 flags so a
    //    checkbox-typed Enabled cell isn't silently rejected (it arrives as a
    //    JS boolean under valueRenderOption=UNFORMATTED_VALUE, not "TRUE").
    if (!toBool(row[COL.enabled])) {
      continue;
    }

    // 2. Real Start AND End dates
    const startDate = serialToISO(row[COL.startDate]);
    const endDate = serialToISO(row[COL.endDate]);
    if (startDate === null || endDate === null) continue;

    // 3. Price tier → rate
    const resolved = resolveTier(row[COL.priceTier]);
    if (!resolved) continue;
    const rate = toNumber(row[resolved.col]);
    if (rate === null || rate <= 0) continue;

    // 4. Exactly one method (both → V1)
    const v1 = toBool(row[COL.v1]);
    const v2 = toBool(row[COL.v2]);
    let method;
    if (v1) method = 'V1';
    else if (v2) method = 'V2';
    else continue;

    // 5. minimumToBook ≥ 1 AND paidNights ≥ 1
    const minimumToBook = toNumber(row[COL.minimumToBook]);
    const paidNights = toNumber(row[COL.paidNights]);
    if (minimumToBook === null || minimumToBook < 1) continue;
    if (paidNights === null || paidNights < 1) continue;

    const freeNights = toNumber(row[COL.freeNights]);
    const label = typeof row[COL.label] === 'string' ? row[COL.label] : String(row[COL.label] ?? '');

    offers.push({
      label,
      startDate,
      endDate,
      // For eligible offers B/C are real dates, so raw mirrors the formatted
      // ISO source. The field stays for the frontend's free-text display path
      // (free-text offers are dropped, so raw is always the ISO here).
      startRaw: startDate,
      endRaw: endDate,
      rate,
      tier: resolved.tier,
      minimumToBook,
      paidNights,
      freeNights,
      method,
    });
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
    `'${env.GSHEETS_OFFERS_TAB.replace(/'/g, "''")}'!A3:M8`,
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
