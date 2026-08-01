// Read-only, month-synced availability calendars for /stay/.
//
// Each `[data-avail-cal][data-bungalow-key="B1|B2|B3"]` node renders TWO
// months side by side (the visible month + the next) that DISPLAY (never let
// you pick) that bungalow's availability, coloured from bookings.json. Day
// states:
//   - .is-booked     — an occupied night (in `unavailable`), red circle
//   - .is-available  — a free, future, in-season night, green circle
//   - .is-past       — before today (muted, no circle)
//   - .is-offseason  — a future date outside the open May–Sep season
//                      (greyed, non-bookable)
//
// All calendars on the page share ONE visible (left) month. Paging any
// calendar's prev/next arrow moves EVERY calendar to the same month (owner
// request: "if on B1 I change the month, all three switch"). Navigation spans
// ALL 12 months — it is NOT clamped to the open season; off-season days simply
// render greyed. It's bounded to [this month, month-of-seasonMaxDate], with
// next disabled once the right-hand month reaches the ceiling.
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

// Compare two month-anchored Dates (ignoring day).
function monthCmp(a, b) {
  return a.getFullYear() * 12 + a.getMonth() - (b.getFullYear() * 12 + b.getMonth());
}

// Navigation bounds for the two-month view. Unlike the old single-month
// calendar, paging is NOT clamped to the open season — every month Jan–Dec is
// reachable; off-season days just render greyed (see buildMonthGrid). The
// FLOOR is this month (don't page into fully-past months); the CEIL is the
// month containing seasonMaxDate (Dec of currentYear+5), and since two months
// show at once we stop paging when the SECOND month would pass it.
// Memoized for the page session; reset on init.
let _navBounds = null;
function navBounds() {
  if (!_navBounds) {
    _navBounds = {
      floor: firstOfMonth(todayMidnight()),
      ceil: firstOfMonth(seasonMaxDate()),
    };
  }
  return _navBounds;
}

// Step currentMonth (the LEFT of the two shown months) by whole months,
// clamped so prev never goes before floor and next never lets the RIGHT month
// pass the ceil. Returns true if the month actually changed.
function stepMonth(delta) {
  const { floor, ceil } = navBounds();
  const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
  // The right-hand month is first + 1; keep it within the ceiling.
  const right = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  if (monthCmp(first, floor) < 0) return false; // before this month
  if (monthCmp(right, ceil) > 0) return false; // 2nd month would pass the ceiling
  currentMonth = first;
  return true;
}

// Build ONE month's grid markup (weekday header row + day cells in week rows)
// for the given month + availability. Returns { label, gridHtml }. Off-season
// days (outside the open May–Sep season) render greyed/non-selectable; past
// days muted; booked red; available green.
function buildMonthGrid(monthStart, avail, today, dayFormatter, weekdays) {
  const daysInMonth = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0,
  ).getDate();
  // Leading blanks before day 1 (Monday-first): JS getDay 0=Sun..6=Sat → 0..6.
  const firstWeekdayMon = (monthStart.getDay() + 6) % 7;

  const cellHtml = [];
  for (let i = 0; i < firstWeekdayMon; i += 1) {
    cellHtml.push('<div class="avail-cal__day avail-cal__day--blank" role="gridcell" aria-hidden="true"></div>');
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    const iso = toIso(date);
    const classes = ['avail-cal__day'];
    let stateLabel = 'available';

    // Precedence: past → off-season → booked → available. Off-season is a
    // greyed, non-bookable state now that navigation spans all 12 months
    // (the open season is May–Sep; isOffSeason() covers Oct–Apr).
    if (date < today) {
      classes.push('is-past');
      stateLabel = 'past';
    } else if (isOffSeason(date)) {
      classes.push('is-offseason');
      stateLabel = 'closed (off-season)';
    } else if (avail.unavailable.has(iso)) {
      // Simple binary: any unavailable night is "booked" (red).
      classes.push('is-booked');
      stateLabel = 'already booked';
    } else {
      classes.push('is-available');
    }

    const label = `${dayFormatter.format(date)} — ${stateLabel}`;
    cellHtml.push(
      `<div class="${classes.join(' ')}" role="gridcell" aria-label="${label}"`
        + `${stateLabel === 'available' ? '' : ' aria-disabled="true"'}>`
        + `<span aria-hidden="true">${day}</span></div>`,
    );
  }

  const rows = [];
  for (let i = 0; i < cellHtml.length; i += 7) {
    rows.push(`<div class="avail-cal__week" role="row">${cellHtml.slice(i, i + 7).join('')}</div>`);
  }
  const weekdayRow = weekdays
    .map((w) => `<div class="avail-cal__weekday" role="columnheader">${w}</div>`)
    .join('');
  const label = monthLabel(monthStart);

  const gridHtml = `
    <div class="avail-cal__month-grid">
      <span class="avail-cal__month" aria-live="polite">${label}</span>
      <div class="avail-cal__grid" role="grid" aria-label="${label} availability">
        <div class="avail-cal__weekdays" role="row">${weekdayRow}</div>
        <div class="avail-cal__days">${rows.join('')}</div>
      </div>
    </div>`;
  return { label, gridHtml };
}

// Render one calendar instance: TWO months side by side (currentMonth and the
// next month), on the shared currentMonth. Nav steps both by one month and
// spans all 12 months (off-season days grey, not skipped).
function renderInstance(inst) {
  const { root, avail } = inst;
  const today = todayMidnight();
  const left = firstOfMonth(currentMonth);
  const right = new Date(left.getFullYear(), left.getMonth() + 1, 1);

  const { floor, ceil } = navBounds();
  const atFloor = monthCmp(left, floor) <= 0;
  // next is disabled when the RIGHT month is already at the ceiling (stepping
  // would push the right month past it).
  const atCeil = monthCmp(right, ceil) >= 0;

  const weekdays = weekdayShortNames();
  const dayFormatter = new Intl.DateTimeFormat(currentLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const g1 = buildMonthGrid(left, avail, today, dayFormatter, weekdays);
  const g2 = buildMonthGrid(right, avail, today, dayFormatter, weekdays);

  root.innerHTML = `
    <div class="avail-cal__header">
      <span class="avail-cal__eyebrow">Availability</span>
      <span class="avail-cal__nav-group">
        <button class="avail-cal__today" type="button"
                aria-label="Jump to the current month"${atFloor ? ' disabled' : ''}>Today</button>
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
    <!-- Two month grids side by side. Each uses ARIA grid semantics
         (grid → row → gridcell) so each day cell's aria-label
         ("15 August 2026 — already booked") is announced. -->
    <div class="avail-cal__months">
      ${g1.gridHtml}
      ${g2.gridHtml}
    </div>
    <div class="avail-cal__key" aria-hidden="true">
      <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--free"></span>Available</span>
      <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--booked"></span>Booked</span>
      <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--past"></span>Past</span>
    </div>
  `;

  // Wire this instance's arrows. Every control moves ALL calendars together.
  const today_ = root.querySelector('.avail-cal__today');
  const prev = root.querySelector('.avail-cal__nav--prev');
  const next = root.querySelector('.avail-cal__nav--next');
  today_?.addEventListener('click', () => {
    // Jump back to the current month (+ next), i.e. the navigation floor.
    const { floor } = navBounds();
    if (monthCmp(currentMonth, floor) !== 0) {
      currentMonth = floor;
      renderAll();
    }
  });
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
  _navBounds = null; // re-derive floor/ceil (e.g. across a midnight rollover)
  currentMonth = navBounds().floor;

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
