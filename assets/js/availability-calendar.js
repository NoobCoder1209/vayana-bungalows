// Read-only, month-synced availability calendars for /stay/.
//
// Each `[data-avail-cal][data-bungalow-key="B1|B2|B3"]` node renders a
// one-month grid that DISPLAYS (never lets you pick) that bungalow's
// availability, coloured from bookings.json. Day states are binary:
//   - .is-booked     — an occupied night (in `unavailable`)
//   - .is-available  — a free, future, in-season night
//   - .is-past       — before today (muted, no pill)
//
// All calendars on the page share ONE visible month. Paging any calendar's
// prev/next arrow moves EVERY calendar to the same month (owner request:
// "if on B1 I change the month, all three switch"). Month navigation is
// clamped to the open season — you can't page into a fully off-season month.
//
// Bookings come from the shared bookings-data.js cache, so this reuses the
// SAME fetch as the (legacy) booking widget — one network request per page.

import { loadBookings, toIso, availabilityFor } from './bookings-data.js';
import { isOffSeason, seasonMaxDate } from './season.js';
import { currentLocale } from './util/current-locale.js';
import { observeReveal } from './reveal.js';

// Monday-first weekday order (EU convention; matches the site's audience and
// flatpickr's BG locale). Index 0 = Monday .. 6 = Sunday.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// The single shared "first of the visible month" Date, and the set of live
// calendar instances to re-render when it changes.
let currentMonth = null;
const instances = [];

// Locale-aware month + weekday names via Intl (no extra dep). Falls back to
// the browser default if the locale is unknown.
function monthLabel(date) {
  return new Intl.DateTimeFormat(currentLocale(), {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function weekdayShortNames() {
  // A known Monday (2024-01-01) → walk 7 days to get localized short names in
  // Monday-first order.
  const base = new Date(2024, 0, 1); // Monday
  return WEEKDAY_ORDER.map((_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return new Intl.DateTimeFormat(currentLocale(), { weekday: 'short' }).format(d);
  });
}

// First day (00:00) of the given date's month.
function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Local-midnight today, for past-day comparison.
function todayMidnight() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

// Advance a month-anchored Date by whole months in `delta` direction until it
// lands on an in-season (May–Sep) month. Shared by the floor/ceil derivation
// and the month stepper — one place for the "skip off-season months" walk.
// (Caller applies any range clamping; this only skips off-season.)
function stepUntilInSeason(month, delta) {
  let m = month;
  while (isOffSeason(m)) {
    m = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  }
  return m;
}

// The earliest month a calendar may show: the first open-season month that is
// not entirely in the past. If today is in-season, that's this month;
// otherwise it's the next May at/after today.
function seasonFloorMonth() {
  return stepUntilInSeason(firstOfMonth(todayMidnight()), 1);
}

// The latest month a calendar may show: the open-season month containing the
// season ceiling (seasonMaxDate is Dec 31 of currentYear+5; step back to the
// last in-season month at/onbefore it).
function seasonCeilMonth() {
  return stepUntilInSeason(firstOfMonth(seasonMaxDate()), -1);
}

// Compare two month-anchored Dates (ignoring day).
function monthCmp(a, b) {
  return a.getFullYear() * 12 + a.getMonth() - (b.getFullYear() * 12 + b.getMonth());
}

// Memoized season bounds. floor/ceil are constant for a page session (they
// derive from today's month + the fixed season ceiling), so compute the two
// off-season-walk loops ONCE rather than on every render and every step.
// initAvailabilityCalendars() resets this so a re-init re-derives them.
let _seasonBounds = null;
function seasonBounds() {
  if (!_seasonBounds) {
    _seasonBounds = { floor: seasonFloorMonth(), ceil: seasonCeilMonth() };
  }
  return _seasonBounds;
}

// Step currentMonth by whole months, skipping fully off-season months, and
// clamp to [floor, ceil]. Returns true if the month actually changed.
function stepMonth(delta) {
  const { floor, ceil } = seasonBounds();
  // One step in the travel direction, then skip any off-season months the
  // same way the bounds are derived. `stepUntilInSeason` won't run past the
  // range because ceil/floor are themselves in-season, and the range check
  // below rejects anything that overshoots.
  const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
  const m = stepUntilInSeason(first, delta);
  if (monthCmp(m, floor) < 0 || monthCmp(m, ceil) > 0) return false; // out of range
  currentMonth = m;
  return true;
}

// Render one calendar instance for the shared currentMonth.
function renderInstance(inst) {
  const { root, avail } = inst;
  const today = todayMidnight();
  const monthStart = firstOfMonth(currentMonth);
  const daysInMonth = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0,
  ).getDate();
  // Leading blanks: how many cells before day 1 (Monday-first).
  // JS getDay(): 0=Sun..6=Sat. Map to Monday-first index 0..6.
  const firstWeekdayMon = (monthStart.getDay() + 6) % 7;

  // Season floor/ceil are constant for the page session — read the memoized
  // values instead of re-walking the off-season loops on every render.
  const { floor, ceil } = seasonBounds();
  const atFloor = monthCmp(currentMonth, floor) <= 0;
  const atCeil = monthCmp(currentMonth, ceil) >= 0;

  const weekdays = weekdayShortNames();

  // One date formatter (and one locale read) per render, reused for every day
  // cell's aria-label — not a fresh Intl.DateTimeFormat per cell.
  const dayFormatter = new Intl.DateTimeFormat(currentLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Build the day cells, grouped into week rows. The grid uses real ARIA grid
  // semantics (grid → row → gridcell) so the per-cell aria-label (which carries
  // the booked/available/past state) is actually announced — an aria-label on
  // a roleless <div> is ignored by most screen readers.
  const cellHtml = [];
  for (let i = 0; i < firstWeekdayMon; i += 1) {
    cellHtml.push('<div class="avail-cal__day avail-cal__day--blank" role="gridcell" aria-hidden="true"></div>');
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    const iso = toIso(date);
    const classes = ['avail-cal__day'];
    let stateLabel = 'available';

    if (date < today) {
      classes.push('is-past');
      stateLabel = 'past';
    } else if (avail.unavailable.has(iso)) {
      // Simple binary: any unavailable night is "booked" (red). We no longer
      // distinguish turnover / check-out-only days — a booked date is booked.
      classes.push('is-booked');
      stateLabel = 'already booked';
    } else {
      // Future, in-season (the shown month is always in-season — navigation
      // is clamped), and not booked → available (green).
      classes.push('is-available');
    }

    const label = `${dayFormatter.format(date)} — ${stateLabel}`;

    cellHtml.push(
      `<div class="${classes.join(' ')}" role="gridcell" aria-label="${label}"`
        + `${stateLabel === 'available' ? '' : ' aria-disabled="true"'}>`
        + `<span aria-hidden="true">${day}</span></div>`,
    );
  }

  // Chunk the flat cell list into 7-cell week rows for role="row".
  const rows = [];
  for (let i = 0; i < cellHtml.length; i += 7) {
    rows.push(`<div class="avail-cal__week" role="row">${cellHtml.slice(i, i + 7).join('')}</div>`);
  }
  const daysMarkup = rows.join('');

  const weekdayRow = weekdays
    .map((w) => `<div class="avail-cal__weekday" role="columnheader">${w}</div>`)
    .join('');

  const monthName = monthLabel(currentMonth);

  root.innerHTML = `
    <div class="avail-cal__header">
      <span class="avail-cal__title">
        <span class="avail-cal__eyebrow">Availability</span>
        <span class="avail-cal__month" aria-live="polite">${monthName}</span>
      </span>
      <span class="avail-cal__nav-group">
        <button class="avail-cal__nav avail-cal__nav--prev" type="button"
                aria-label="Previous month"${atFloor ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button class="avail-cal__nav avail-cal__nav--next" type="button"
                aria-label="Next month"${atCeil ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </span>
    </div>
    <!-- Read-only availability display using ARIA grid semantics so each day
         cell's aria-label ("15 August 2026 — already booked") is announced:
         grid → row → gridcell. The visible day number and weekday letters are
         decorative (the gridcell's aria-label carries the full date + state). -->
    <div class="avail-cal__grid" role="grid" aria-label="${monthName} availability">
      <div class="avail-cal__weekdays" role="row">${weekdayRow}</div>
      <div class="avail-cal__days">${daysMarkup}</div>
    </div>
    <div class="avail-cal__key" aria-hidden="true">
      <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--free"></span>Available</span>
      <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--booked"></span>Booked</span>
      <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--past"></span>Past</span>
    </div>
  `;

  // Wire this instance's arrows. Every arrow moves ALL calendars together.
  const prev = root.querySelector('.avail-cal__nav--prev');
  const next = root.querySelector('.avail-cal__nav--next');
  prev?.addEventListener('click', () => {
    if (stepMonth(-1)) renderAll();
  });
  next?.addEventListener('click', () => {
    if (stepMonth(1)) renderAll();
  });
}

function renderAll() {
  instances.forEach(renderInstance);
}

/**
 * Find every read-only availability calendar on the page, load the shared
 * bookings data once, and render them all on a synced month. No-op if the
 * page has no such calendars (every non-/stay/ page).
 */
export function initAvailabilityCalendars() {
  const roots = document.querySelectorAll('[data-avail-cal][data-bungalow-key]');
  if (!roots.length) return;

  // Reset module state so a second call (SPA soft-nav, hot-reload, or a
  // future re-init) rebuilds cleanly instead of stacking duplicate instances
  // on the same roots (which would double-bind arrow handlers → double-step).
  instances.length = 0;
  _seasonBounds = null; // re-derive floor/ceil (e.g. across a midnight/season rollover)
  currentMonth = seasonBounds().floor;

  // Placeholder render (before data arrives) so the month grid is visible
  // immediately; availability classes get painted once bookings resolve.
  const emptyAvail = { unavailable: new Set() };
  roots.forEach((root) => {
    instances.push({ root, key: root.dataset.bungalowKey, avail: emptyAvail });
  });
  renderAll();

  // Register the (now-populated, real-height) `.reveal` containers with the
  // reveal observer. We render FIRST so observeReveal measures the inflated
  // box — registering while the container was an empty 0-height div is exactly
  // what would leave it stuck invisible (see reveal.js:observeReveal).
  roots.forEach((root) => observeReveal(root));

  loadBookings().then((bookings) => {
    instances.forEach((inst) => {
      inst.avail = availabilityFor(bookings, inst.key);
    });
    renderAll();
  });
}
