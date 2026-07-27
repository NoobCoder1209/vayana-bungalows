// Read-only, month-synced availability calendars for /stay/.
//
// Each `[data-avail-cal][data-bungalow-key="B1|B2|B3"]` node renders a
// one-month grid that DISPLAYS (never lets you pick) that bungalow's
// availability, coloured from bookings.json:
//   - .is-booked        — an occupied night (in `unavailable`, not a check-in day)
//   - .is-checkout-only  — a turnover day (in `unavailable` AND a check-in day):
//                          the outgoing guest leaves, so it reads as "check-out only"
//   - .is-past           — before today
//   - .is-offseason      — outside the May..Sep open season
//
// All calendars on the page share ONE visible month. Paging any calendar's
// prev/next arrow moves EVERY calendar to the same month (owner request:
// "if on B1 I change the month, all three switch"). Month navigation is
// clamped to the open season — you can't page into a fully off-season month.
//
// Bookings come from the shared bookings-data.js cache, so this reuses the
// SAME fetch as the (legacy) booking widget — one network request per page.

import { loadBookings, toIso, parseIso } from './bookings-data.js';
import { isOffSeason, seasonMaxDate } from './season.js';
import { currentLocale } from './util/current-locale.js';

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

// The earliest month a calendar may show: the first open-season month that is
// not entirely in the past. If today is in-season, that's this month;
// otherwise it's the next May at/after today.
function seasonFloorMonth() {
  let m = firstOfMonth(todayMidnight());
  // Advance until the month is in the open season (isOffSeason checks a Date;
  // day-1 of the month is representative since seasons are month-granular).
  while (isOffSeason(m)) {
    m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  }
  return m;
}

// The latest month a calendar may show: the open-season month containing the
// season ceiling (seasonMaxDate is Dec 31 of currentYear+5; step back to the
// last in-season month at/onbefore it).
function seasonCeilMonth() {
  let m = firstOfMonth(seasonMaxDate());
  while (isOffSeason(m)) {
    m = new Date(m.getFullYear(), m.getMonth() - 1, 1);
  }
  return m;
}

// Compare two month-anchored Dates (ignoring day).
function monthCmp(a, b) {
  return a.getFullYear() * 12 + a.getMonth() - (b.getFullYear() * 12 + b.getMonth());
}

// Step currentMonth by whole months, skipping fully off-season months, and
// clamp to [floor, ceil]. Returns true if the month actually changed.
function stepMonth(delta) {
  const floor = seasonFloorMonth();
  const ceil = seasonCeilMonth();
  let m = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
  // Skip off-season months in the direction of travel.
  while (isOffSeason(m) && monthCmp(m, floor) >= 0 && monthCmp(m, ceil) <= 0) {
    m = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  }
  if (monthCmp(m, floor) < 0 || monthCmp(m, ceil) > 0) return false; // out of range
  currentMonth = m;
  return true;
}

// Build the availability lookup for one bungalow from the loaded bookings.
// Returns { unavailable:Set<iso>, checkIn:Set<iso> } — empty sets when data
// is missing/malformed so the calendar renders everything as available.
function availabilityFor(bookings, key) {
  const entry = bookings?.bungalows?.[key];
  if (Array.isArray(entry)) {
    // Legacy array shape (a schema regression, e.g. a downgraded
    // fetch-bookings.mjs or a stale cached file). Fail SAFE for a booking
    // site — treat as fully available — but warn so the drift is diagnosable
    // rather than silently showing an all-open calendar. Mirrors booking.js.
    console.warn(
      `[avail-cal] ${key}: bookings.json is in the legacy array shape; treating as empty.`,
    );
    return { unavailable: new Set(), checkIn: new Set() };
  }
  if (!entry) {
    return { unavailable: new Set(), checkIn: new Set() };
  }
  return {
    unavailable: new Set(entry.unavailable ?? []),
    checkIn: new Set(entry.checkIn ?? []),
  };
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

  const floor = seasonFloorMonth();
  const ceil = seasonCeilMonth();
  const atFloor = monthCmp(currentMonth, floor) <= 0;
  const atCeil = monthCmp(currentMonth, ceil) >= 0;

  const weekdays = weekdayShortNames();

  const cells = [];
  for (let i = 0; i < firstWeekdayMon; i += 1) {
    cells.push('<div class="avail-cal__day avail-cal__day--blank" aria-hidden="true"></div>');
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
      if (avail.checkIn.has(iso)) {
        classes.push('is-checkout-only');
        stateLabel = 'turnover, check-out only';
      } else {
        classes.push('is-booked');
        stateLabel = 'already booked';
      }
    } else {
      // Future, in-season (the shown month is always in-season — navigation
      // is clamped), and not booked → genuinely available.
      classes.push('is-available');
    }

    const label = `${new Intl.DateTimeFormat(currentLocale(), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date)} — ${stateLabel}`;

    cells.push(
      `<div class="${classes.join(' ')}" aria-label="${label}"`
        + `${stateLabel === 'available' ? '' : ' aria-disabled="true"'}>`
        + `<span aria-hidden="true">${day}</span></div>`,
    );
  }

  const weekdayRow = weekdays
    .map((w) => `<div class="avail-cal__weekday" aria-hidden="true">${w}</div>`)
    .join('');

  root.innerHTML = `
    <div class="avail-cal__header">
      <button class="avail-cal__nav avail-cal__nav--prev" type="button"
              aria-label="Previous month"${atFloor ? ' disabled' : ''}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <span class="avail-cal__month" aria-live="polite">${monthLabel(currentMonth)}</span>
      <button class="avail-cal__nav avail-cal__nav--next" type="button"
              aria-label="Next month"${atCeil ? ' disabled' : ''}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>
    <!-- Read-only display, not an interactive grid: we deliberately do NOT use
         role="grid"/gridcell (which would require full row/cell navigation
         semantics). Each day cell carries a descriptive aria-label
         ("15 August 2026 — already booked"), and the weekday header letters
         are aria-hidden decoration. Screen readers read the cells as a plain
         labelled list of days, which is the right model for a display. -->
    <div class="avail-cal__grid">
      <div class="avail-cal__weekdays">${weekdayRow}</div>
      <div class="avail-cal__days">${cells.join('')}</div>
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
  currentMonth = seasonFloorMonth();

  // The calendar containers carry `.reveal` (opacity:0 until the
  // IntersectionObserver adds `.is-visible`). Because we populate them with
  // JS *after* initReveal() has already observed the empty boxes, the observer
  // can settle its decision against a collapsed 0-height container and never
  // re-fire once content inflates the height — leaving the calendar stuck
  // invisible. Force them visible here: they're always meant to show, and
  // the fade-in isn't worth risking a permanently blank calendar.
  roots.forEach((root) => root.classList.add('is-visible'));

  // Placeholder render (before data arrives) so the month grid is visible
  // immediately; availability classes get painted once bookings resolve.
  const emptyAvail = { unavailable: new Set(), checkIn: new Set() };
  roots.forEach((root) => {
    instances.push({ root, key: root.dataset.bungalowKey, avail: emptyAvail });
  });
  renderAll();

  loadBookings().then((bookings) => {
    instances.forEach((inst) => {
      inst.avail = availabilityFor(bookings, inst.key);
    });
    renderAll();
  });
}
