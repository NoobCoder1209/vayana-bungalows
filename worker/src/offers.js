// Google Sheets read — offers table on the 'Offers' tab.
//
// Reads B3:H8 (up to 6 offers) and returns the ENABLED, NON-EMPTY ones.
// Reuses getAccessToken() from sheets.js (same JWT service-account flow,
// same module-scoped token cache). Like sheets.js, every catch logs ONLY
// a generic string — never err.message — because a stack trace could
// carry service-account private-key fragments.

import { getAccessToken } from './sheets.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column layout of the B3:H8 range, as row-array indices (B is index 0).
// dates (Column B, index 0): expected to be a machine-readable ISO range
// `YYYY-MM-DD/YYYY-MM-DD`, parsed client-side (assets/js/util/offer-dates.js)
// for enquiry date prefill. Freehand/legacy cells still render verbatim and
// simply don't prefill — the Worker returns the raw string either way.
const COL = { dates: 0, discountPct: 1, priceBefore: 2, priceAfter: 3, nights: 4, message: 5, enable: 6 };

// A cell → trimmed string, or null when blank/whitespace-only.
function cell(row, idx) {
  const raw = row[idx];
  if (typeof raw !== 'string') return null; // Sheets values.get returns strings; anything else (missing/short row) → blank
  const t = raw.trim();
  return t === '' ? null : t;
}

/**
 * Map + filter the raw Sheets `values` 2-D array into Offer objects.
 * - Enabled only: H (index 6), trimmed + lower-cased, must equal 'true'.
 * - Non-empty only: at least one of B–G (indices 0–5) is non-blank.
 * - Order preserved; offer position/number is irrelevant.
 */
export function parseOffers(rows) {
  if (!Array.isArray(rows)) return [];
  const offers = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const enableRaw = row[COL.enable];
    const enabled = typeof enableRaw === 'string' && enableRaw.trim().toLowerCase() === 'true';
    if (!enabled) continue;
    const offer = {
      dates: cell(row, COL.dates),
      discountPct: cell(row, COL.discountPct),
      priceBefore: cell(row, COL.priceBefore),
      priceAfter: cell(row, COL.priceAfter),
      nights: cell(row, COL.nights),
      message: cell(row, COL.message),
    };
    const hasContent = Object.values(offer).some(v => v !== null);
    if (!hasContent) continue;
    offers.push(offer);
  }
  return offers;
}

/**
 * Read the offers range from the sheet and return parsed offers.
 * Throws a generic Error on any failure (config missing, token, fetch,
 * parse) — the route handler turns that into a 502 without leaking detail.
 */
export async function fetchOffers(env) {
  if (!env.GSHEETS_SHEET_ID || !env.GSHEETS_OFFERS_TAB) {
    throw new Error('offers-config-missing');
  }
  const token = await getAccessToken(env);
  const range = encodeURIComponent(
    `'${env.GSHEETS_OFFERS_TAB.replace(/'/g, "''")}'!B3:H8`,
  );
  const url =
    `${SHEETS_BASE}/${encodeURIComponent(env.GSHEETS_SHEET_ID)}` +
    `/values/${range}?majorDimension=ROWS`;

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
