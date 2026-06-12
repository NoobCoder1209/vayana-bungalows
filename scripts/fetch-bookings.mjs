// scripts/fetch-bookings.mjs
//
// Reads the B1 2026 / B2 2026 / B3 2026 tabs of the bookings spreadsheet,
// parses month blocks, and writes assets/data/bookings.json — a JSON map
// from bungalow tab key → array of unavailable ISO dates (YYYY-MM-DD).
//
// Marker semantics (confirmed with the user):
//   I = arrival night       → unavailable
//   X = booked night        → unavailable
//   O = checkout day        → AVAILABLE (next guest can arrive)
//   empty                   → available
//
// Tab layout (per https://docs.google.com/spreadsheets/d/.../B1+2026):
//   Each month is a vertical block. Within a block:
//     - row N + 0:  month header ("May 2026", "June 2026", ...)
//     - row N + 1:  weekday row (Mon Tue Wed ...) — variable; we don't depend on it
//     - row N + ?:  date-number row (1..31)
//     - row N + ?:  K1, K2, or K3 marker row(s)
//
// We do not assume fixed row offsets — instead, we scan the tab top-to-bottom
// looking for "<MonthName> 2026" headers, then for each header find the
// nearest following row whose first ~25 numeric cells form an increasing
// sequence ending at 28..31 (= the date-number row), then read the next
// row that starts with K1/K2/K3 (= the marker row).
//
// Robustness: the script HARD-FAILS on any unexpected input and writes a
// last-known-good file ONLY if the workflow chooses to do so. The script
// itself never falls back silently.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_JSON = process.env.GOOGLE_SHEETS_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const RECON = process.argv.includes('--recon');
const OUT_PATH = path.join(process.cwd(), 'public/assets/data/bookings.json');

// Tabs we read. The bungalow key matches the slug used on the front-end
// (premier-oceanview-villa → B1, deluxe-hilltop-residence → B2, etc.).
const TABS = [
  { key: 'B1', tab: 'B1 2026' },
  { key: 'B2', tab: 'B2 2026' },
  { key: 'B3', tab: 'B3 2026' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const monthIndex = (name) => {
  const i = MONTHS.indexOf(name);
  if (i < 0) throw new Error(`Unknown month name: ${JSON.stringify(name)}`);
  return i;
};

const pad2 = (n) => String(n).padStart(2, '0');
const isoDate = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(msg);
}

if (!SPREADSHEET_ID) fail('SPREADSHEET_ID env var is required');
if (!KEY_JSON) fail('GOOGLE_SHEETS_KEY env var is required (service-account JSON)');

let credentials;
try {
  credentials = JSON.parse(KEY_JSON);
} catch (e) {
  fail(`GOOGLE_SHEETS_KEY is not valid JSON: ${e.message}`);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

// Read one tab as a 2-D array of cell text values (formattedValue).
async function readTab(tabName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'`,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return res.data.values || [];
}

// Look for "<Month> 2026" anywhere in the row. Tolerates surrounding cells.
function detectMonthHeader(row, year) {
  for (const cell of row) {
    if (!cell) continue;
    const text = String(cell).trim();
    const m = text.match(/^([A-Z][a-z]+)\s+(\d{4})$/);
    if (m && Number(m[2]) === year && MONTHS.includes(m[1])) {
      return monthIndex(m[1]);
    }
  }
  return -1;
}

// Detect a date-number row: starts in column B (or later) with numeric values
// 1..N where N is the last day of the month. We accept short tail variation
// (29/30/31 depending on month) and require:
//   - at least 28 numeric cells in a row
//   - the first numeric cell is "1"
//   - cells are strictly increasing by 1
function detectDateRow(row, monthLastDay) {
  // Find the first numeric cell
  let startCol = -1;
  for (let c = 0; c < row.length; c++) {
    if (String(row[c]).trim() === '1') {
      startCol = c;
      break;
    }
  }
  if (startCol < 0) return null;

  // Verify the next monthLastDay-1 cells are 2, 3, 4, ..., monthLastDay
  for (let d = 1; d < monthLastDay; d++) {
    const cell = row[startCol + d];
    if (!cell || String(cell).trim() !== String(d + 1)) {
      // Not a date row — too much drift means we have the wrong row
      if (d < 27) return null;
      // Tolerate end-of-month truncation (some sheets only render up to day 28
      // for February; not relevant for 2026, but defensive)
      return { startCol, days: d };
    }
  }
  return { startCol, days: monthLastDay };
}

// Read the marker row that follows the date-number row. The first cell of
// the marker row should be "K1", "K2", or "K3" — confirm and return the
// markers aligned to the date-number columns.
function extractMarkerRow(row, startCol, days, expectedKey) {
  if (!row || !row.length) return null;

  // Some tabs label the marker row in column A (e.g. "K1" or "B1"); we don't
  // strictly require it — just confirm via *any* of the first 2 cells.
  const labels = [String(row[0] ?? '').trim().toUpperCase(), String(row[1] ?? '').trim().toUpperCase()];
  // Accept either Kn (Calendar 2026 style) or Bn (per-bungalow tab style).
  const validLabels = new Set([expectedKey, expectedKey.replace('B', 'K')]);
  if (!labels.some((l) => validLabels.has(l))) {
    return null;
  }

  const markers = [];
  for (let d = 0; d < days; d++) {
    const cell = row[startCol + d];
    markers.push(cell == null ? '' : String(cell).trim().toUpperCase());
  }
  return markers;
}

// Days in a given (year, monthIndex 0..11)
function daysInMonth(year, m) {
  return new Date(year, m + 1, 0).getDate();
}

// Parse one tab's grid into a list of unavailable ISO dates.
// `grid` is a 2-D array; `expectedKey` is "B1" / "B2" / "B3" (informational).
function parseTab(grid, year, expectedKey, tabLabel) {
  const unavailable = [];
  let monthsFound = 0;

  for (let r = 0; r < grid.length; r++) {
    const monthIdx = detectMonthHeader(grid[r], year);
    if (monthIdx < 0) continue;

    const monthLastDay = daysInMonth(year, monthIdx);

    // Search the next ~6 rows for a date-number row
    let dateRowIdx = -1;
    let dateRowInfo = null;
    for (let off = 1; off <= 6 && r + off < grid.length; off++) {
      const info = detectDateRow(grid[r + off], monthLastDay);
      if (info) {
        dateRowIdx = r + off;
        dateRowInfo = info;
        break;
      }
    }
    if (dateRowIdx < 0) {
      throw new Error(
        `[${tabLabel}] Found month header "${MONTHS[monthIdx]} ${year}" at row ${r + 1} ` +
        `but no date-number row in the following 6 rows. ` +
        `Likely the month block layout changed.`,
      );
    }

    // Search the next ~6 rows for a marker row matching expectedKey (or its K-equivalent)
    let markerRow = null;
    for (let off = 1; off <= 6 && dateRowIdx + off < grid.length; off++) {
      const m = extractMarkerRow(grid[dateRowIdx + off], dateRowInfo.startCol, dateRowInfo.days, expectedKey);
      if (m) { markerRow = m; break; }
    }
    if (!markerRow) {
      throw new Error(
        `[${tabLabel}] Found "${MONTHS[monthIdx]} ${year}" date-number row at row ${dateRowIdx + 1} ` +
        `but no marker row for ${expectedKey} in the following 6 rows. ` +
        `Make sure the row label is "${expectedKey}" (or its "K"-equivalent).`,
      );
    }

    for (let d = 0; d < dateRowInfo.days; d++) {
      const marker = markerRow[d];
      if (marker === 'I' || marker === 'X') {
        unavailable.push(isoDate(year, monthIdx, d + 1));
      } else if (marker !== '' && marker !== 'O') {
        // Unknown marker — warn in log, don't fail (could be a free-form note)
        console.warn(
          `[${tabLabel}] Unknown marker "${marker}" at ${MONTHS[monthIdx]} ${d + 1}, ${year}; treating as available`,
        );
      }
    }

    monthsFound++;
    // Skip past this block — next iteration starts after the marker row
    r = dateRowIdx;
  }

  if (monthsFound === 0) {
    throw new Error(
      `[${tabLabel}] No month blocks for ${year} found. ` +
      `The tab may be empty, renamed, or the headers no longer match "Month YYYY".`,
    );
  }

  return { unavailable, monthsFound };
}

async function main() {
  info(`▶ Reading spreadsheet ${SPREADSHEET_ID} as ${credentials.client_email}`);
  const out = {
    generatedAt: new Date().toISOString(),
    year: 2026,
    bungalows: {},
  };

  for (const { key, tab } of TABS) {
    info(`  – fetching '${tab}'`);
    let grid;
    try {
      grid = await readTab(tab);
    } catch (e) {
      throw new Error(`Failed to read tab '${tab}': ${e.message}`);
    }
    info(`    grid is ${grid.length} rows × ${Math.max(0, ...grid.map((r) => r.length))} cols`);

    if (RECON) {
      // Two parts: (1) first 30 rows × first 35 cols (the visual calendar)
      //            (2) all rows × cols 30..50 (the AK/AL reservation table)
      info(`    --- recon dump for '${tab}' (first 30 rows, first 35 cols) ---`);
      for (let r = 0; r < Math.min(30, grid.length); r++) {
        const row = grid[r] || [];
        const cells = [];
        for (let c = 0; c < Math.min(35, row.length); c++) {
          const v = row[c];
          cells.push(v == null || v === '' ? '·' : String(v).slice(0, 6));
        }
        info(`    r${String(r + 1).padStart(2, '0')}: ${cells.join('|')}`);
      }
      info(`    --- recon: cols AE..AT (30..45) full height ---`);
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r] || [];
        const cells = [];
        for (let c = 30; c < Math.min(46, Math.max(46, row.length)); c++) {
          const v = row[c];
          cells.push(v == null || v === '' ? '·' : String(v).slice(0, 12));
        }
        // Skip rows where every cell is empty
        if (cells.every((c) => c === '·')) continue;
        info(`    r${String(r + 1).padStart(2, '0')}: ${cells.join('|')}`);
      }
      info(`    --- end recon ---`);
      continue;
    }

    const { unavailable, monthsFound } = parseTab(grid, 2026, key, tab);
    out.bungalows[key] = unavailable;
    info(`    parsed ${monthsFound} month blocks → ${unavailable.length} unavailable date(s)`);
  }

  const summary = Object.entries(out.bungalows)
    .map(([k, v]) => `${k}=${v.length}`)
    .join(', ');
  info(`✓ Loaded unavailable dates: ${summary}`);

  if (DRY_RUN) {
    info('— DRY RUN — first 8 dates per bungalow:');
    for (const [k, v] of Object.entries(out.bungalows)) {
      info(`  ${k}: ${v.slice(0, 8).join(', ')}${v.length > 8 ? ', ...' : ''}`);
    }
    info('— DRY RUN — would write ' + OUT_PATH);
    return;
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  info(`✓ Wrote ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
