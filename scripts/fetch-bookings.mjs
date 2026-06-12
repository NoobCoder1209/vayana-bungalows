// scripts/fetch-bookings.mjs
//
// Reads the reservation table on the right side of the B1 2026 / B2 2026 /
// B3 2026 tabs and writes public/assets/data/bookings.json — a JSON map
// from bungalow tab key → array of unavailable ISO dates (YYYY-MM-DD).
//
// Source columns on each tab (1-based letters / 0-based indices):
//   AG (32)  №                 reservation id (e.g. 26B-101)
//   AH (33)  Агент             agent (ignored)
//   AI (34)  Дата              booking date (ignored)
//   AJ (35)  Статус            status: Confirmed / Ongoing / Upcoming / Completed
//   AK (36)  CHECK IN          arrival date — DD-MM-YYYY
//   AL (37)  CHECK OUT         departure date — DD-MM-YYYY
//   ...      Име, Фамилия, Телефон, Нощувки  (ignored)
//
// Header row is r10. Reservation rows start at r11. A row with no № or
// no CHECK IN is skipped (placeholder rows).
//
// Availability rule:
//   - For each row whose status is Confirmed / Ongoing / Upcoming, mark
//     the dates [CHECK IN .. CHECK OUT - 1] as unavailable.
//   - The CHECK OUT day itself is AVAILABLE (next guest can arrive).
//   - Rows with status "Completed" or empty status are ignored.
//   - Past dates (before today) are filtered out — flatpickr already
//     blocks them via minDate, no point shipping them.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_JSON = process.env.GOOGLE_SHEETS_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const OUT_PATH = path.join(process.cwd(), 'public/assets/data/bookings.json');

// Tab names use the current year, e.g. "B1 2026". Around year-end we also
// look for next-year tabs (e.g. "B1 2027") so the rollover works without
// manual intervention. If the current-year tab is missing the script fails
// loudly — we never silently fall back to stale data.
const CURRENT_YEAR = new Date().getUTCFullYear();
const TAB_KEYS = ['B1', 'B2', 'B3'];

function tabsForYear(y) {
  return TAB_KEYS.map((key) => ({ key, tab: `${key} ${y}` }));
}

// Reservation table column indices (0-based)
const COL_ID = 32;        // AG — №
const COL_STATUS = 35;    // AJ — Статус
const COL_CHECKIN = 36;   // AK — CHECK IN
const COL_CHECKOUT = 37;  // AL — CHECK OUT

// Statuses that block availability. Anything else (Completed, empty, unknown) is ignored.
const BLOCKING_STATUSES = new Set(['confirmed', 'ongoing', 'upcoming']);

const HEADER_ROW = 10;        // 1-based row that contains "№ ... CHECK IN | CHECK OUT"
const FIRST_DATA_ROW = 11;    // 1-based first reservation row

const pad2 = (n) => String(n).padStart(2, '0');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const info = (msg) => console.log(msg);

if (!SPREADSHEET_ID) fail('SPREADSHEET_ID env var is required');
if (!KEY_JSON) fail('GOOGLE_SHEETS_KEY env var is required (service-account JSON)');

let credentials;
try {
  credentials = JSON.parse(KEY_JSON);
} catch {
  // Don't echo e.message — Node may include offending input substrings
  // ("Unexpected token X in JSON at position Y") which could leak private
  // key fragments into the public Actions log if the secret is corrupted.
  fail('GOOGLE_SHEETS_KEY is not valid JSON (rotate the secret and re-paste)');
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function readTab(tabName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return res.data.values || [];
}

// List the tab names in the spreadsheet so we can probe for next-year tabs
// without triggering a 400 if they don't exist yet.
async function listTabs() {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(title))',
  });
  return (res.data.sheets || []).map((s) => s.properties?.title).filter(Boolean);
}

// Parse "DD-MM-YYYY" → { y, m (0-based), d } or throw with a useful message.
function parseDmy(s, ctx) {
  const text = String(s ?? '').trim();
  const m = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) throw new Error(`${ctx}: cannot parse date "${text}" (expected DD-MM-YYYY)`);
  const d = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const y = Number(m[3]);
  if (mo < 0 || mo > 11) throw new Error(`${ctx}: month out of range in "${text}"`);
  // Construct, then verify the components round-trip (catches things like 31-02-2026)
  const dt = new Date(Date.UTC(y, mo, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) {
    throw new Error(`${ctx}: date "${text}" is not a real calendar date`);
  }
  return { y, m: mo, d, dt };
}

const isoDate = ({ y, m, d }) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

// Iterate all dates in [start, end) — half-open. CHECK OUT is excluded.
function* datesInRange(start, end) {
  const cur = new Date(Date.UTC(start.y, start.m, start.d));
  const stop = new Date(Date.UTC(end.y, end.m, end.d));
  while (cur < stop) {
    yield {
      y: cur.getUTCFullYear(),
      m: cur.getUTCMonth(),
      d: cur.getUTCDate(),
    };
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

// Sanity-check the header row. Tolerates whitespace and case.
function validateHeader(grid, tabLabel) {
  const headerRow = grid[HEADER_ROW - 1] || [];
  const checkIn = String(headerRow[COL_CHECKIN] ?? '').trim().toUpperCase();
  const checkOut = String(headerRow[COL_CHECKOUT] ?? '').trim().toUpperCase();
  if (checkIn !== 'CHECK IN' || checkOut !== 'CHECK OUT') {
    throw new Error(
      `[${tabLabel}] Header row ${HEADER_ROW} columns AK/AL are ` +
      `"${headerRow[COL_CHECKIN] ?? ''}" / "${headerRow[COL_CHECKOUT] ?? ''}", ` +
      `expected "CHECK IN" / "CHECK OUT". The reservation table layout has changed.`,
    );
  }
}

function parseReservationTable(grid, tabLabel) {
  validateHeader(grid, tabLabel);

  // Today (UTC) — drop reservations that ended before today
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const unavailable = new Set();
  let scanned = 0;
  let blocked = 0;
  let skippedCompleted = 0;
  let skippedEmpty = 0;

  for (let r = FIRST_DATA_ROW - 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const id = String(row[COL_ID] ?? '').trim();
    const status = String(row[COL_STATUS] ?? '').trim().toLowerCase();
    const checkInRaw = String(row[COL_CHECKIN] ?? '').trim();
    const checkOutRaw = String(row[COL_CHECKOUT] ?? '').trim();

    // Skip blank rows (placeholder №s with no dates)
    if (!checkInRaw && !checkOutRaw) {
      skippedEmpty++;
      continue;
    }
    scanned++;

    if (!BLOCKING_STATUSES.has(status)) {
      if (status === 'completed') skippedCompleted++;
      continue;
    }

    if (!checkInRaw || !checkOutRaw) {
      throw new Error(
        `[${tabLabel}] Row ${r + 1} (id=${id || '?'}, status=${status}) has missing CHECK IN or CHECK OUT date.`,
      );
    }

    const ctx = `[${tabLabel}] row ${r + 1} (id=${id || '?'})`;
    const start = parseDmy(checkInRaw, ctx + ' CHECK IN');
    const end = parseDmy(checkOutRaw, ctx + ' CHECK OUT');
    if (end.dt <= start.dt) {
      throw new Error(`${ctx}: CHECK OUT (${checkOutRaw}) is not after CHECK IN (${checkInRaw}).`);
    }

    // If the reservation has fully ended, no point including it.
    if (end.dt <= todayUtc) continue;

    blocked++;
    for (const day of datesInRange(start, end)) {
      const iso = isoDate(day);
      // Drop past dates within an in-progress reservation
      if (new Date(Date.UTC(day.y, day.m, day.d)) >= todayUtc) {
        unavailable.add(iso);
      }
    }
  }

  return {
    unavailable: [...unavailable].sort(),
    scanned,
    blocked,
    skippedCompleted,
    skippedEmpty,
  };
}

async function main() {
  info(`▶ Reading spreadsheet ${SPREADSHEET_ID} as ${credentials.client_email}`);
  info(`  current year is ${CURRENT_YEAR}`);

  const allTabsList = await listTabs();
  if (allTabsList.length === 0) {
    fail(
      `spreadsheets.get returned zero tabs for ${SPREADSHEET_ID}. ` +
      `Likely causes: (a) wrong SPREADSHEET_ID, (b) the service account ` +
      `lacks at least Viewer access on the spreadsheet, (c) the spreadsheet ` +
      `was deleted. Service account: ${credentials.client_email}`,
    );
  }
  const allTabs = new Set(allTabsList);

  // Always read current-year tabs. Read next-year tabs too if they exist,
  // so December → January rolls over without operator intervention.
  const yearsToRead = [CURRENT_YEAR];
  if (TAB_KEYS.every((k) => allTabs.has(`${k} ${CURRENT_YEAR + 1}`))) {
    yearsToRead.push(CURRENT_YEAR + 1);
    info(`  found next-year tabs (${CURRENT_YEAR + 1}), will read both`);
  }

  const merged = Object.fromEntries(TAB_KEYS.map((k) => [k, new Set()]));
  const out = {
    generatedAt: new Date().toISOString(),
    bungalows: {},
  };

  for (const year of yearsToRead) {
    for (const { key, tab } of tabsForYear(year)) {
      if (!allTabs.has(tab)) {
        throw new Error(
          `Tab '${tab}' is missing from the spreadsheet. ` +
          `Available tabs: ${[...allTabs].slice(0, 20).join(', ')}${allTabs.size > 20 ? ', ...' : ''}`,
        );
      }
      info(`  – fetching '${tab}'`);
      const grid = await readTab(tab);
      info(`    grid is ${grid.length} rows × ${Math.max(0, ...grid.map((r) => r.length))} cols`);
      const r = parseReservationTable(grid, tab);
      for (const d of r.unavailable) merged[key].add(d);
      info(
        `    parsed ${r.scanned} reservation(s), ${r.blocked} blocking, ` +
        `${r.skippedCompleted} completed, ${r.skippedEmpty} empty — ` +
        `${r.unavailable.length} unavailable date(s)`,
      );
    }
  }

  for (const k of TAB_KEYS) out.bungalows[k] = [...merged[k]].sort();

  const summary = Object.entries(out.bungalows).map(([k, v]) => `${k}=${v.length}`).join(', ');
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
