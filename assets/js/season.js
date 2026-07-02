// Season constraints for the enquiry form and per-bungalow booking widget.
//
// Both consumers wire flatpickr with `minDate: 'today'` (past dates blocked)
// and an ad-hoc booked-day `disable[]` list on the booking widget side. This
// module layers TWO extra constraints on top:
//
//   1. Off-season block — Vayana Bungalows only operates May..September;
//      Oct..Apr days should render greyed out and be non-clickable. Soft
//      block (visible in the grid, unselectable) matches the existing
//      "past dates" and ".is-booked" visual treatment so users understand
//      why the day is there but greyed.
//
//   2. Year ceiling — a naive `<input type="number">` for the year field
//      lets a user type e.g. `11111` and drop the calendar into year AD
//      11111. Cap at current-year + 5 so the picker never shows a
//      nonsense year. Floor is `minDate: 'today'` which already prevents
//      picking any year before this one.
//
// The month/year ceiling is passed to flatpickr as `maxDate`; the
// off-season block is passed as a function entry inside `disable[]`
// (flatpickr accepts array entries that are Date strings, Date objects,
// {from,to} ranges, OR predicate functions returning true = disable).
//
// Server-side validation.js does NOT mirror this yet — this module is
// UX-only. Enforcing seasons on the Worker is a follow-up: for now the
// operator can still see any Oct..Apr enquiry that manages to slip past
// (DevTools bypass, JS disabled) as a normal sheet row, and decide
// manually whether to accept.

// Months are 0-indexed in JavaScript's Date API. May..Sep inclusive is
// months 4..8. Anything outside that range is off-season.
const OPEN_SEASON_MONTHS = new Set([4, 5, 6, 7, 8]);

/**
 * True if this date falls outside the May..September open season.
 * Flatpickr calls disable[] predicates with a Date argument; returning
 * true from any predicate marks the day as disabled.
 */
export function isOffSeason(date) {
  return !OPEN_SEASON_MONTHS.has(date.getMonth());
}

/**
 * Latest selectable date across the whole picker: Dec 31 of currentYear+5.
 *
 * Return a fresh Date on every call so callers can't accidentally mutate
 * a shared instance. Also lets us stay honest at midnight rollovers on
 * Dec 31 — the ceiling shifts up one year the moment the year changes,
 * without a page reload.
 */
export function seasonMaxDate() {
  const now = new Date();
  return new Date(now.getFullYear() + 5, 11, 31);
}

/**
 * Swap flatpickr's default year <input type="number"> for a <select> that
 * lists exactly the six valid years (currentYear .. currentYear+5). The
 * input lets a user type nonsense like "11111" and only clamps on blur;
 * a <select> makes the ceiling structural — the wrong years can't be
 * chosen at all.
 *
 * Wire via flatpickr's `onReady` hook. Traced through flatpickr 4.6.13's
 * build() → buildMonthNav() sequence: currentYearElement is assigned
 * before triggerEvent("onReady") fires, so it's live at that point.
 *
 * DOM-swap cleanup: replacing the <input> with a <select> is not enough
 * — flatpickr keeps a reference to the original input in
 * fp.currentYearElement and fp.yearElements[0]. Multiple internal code
 * paths (minMaxDateSetter, updateNavigationCurrentMonth) later write
 * .value / .min / .max / .disabled on that reference. If the reference
 * still points at the detached input, those writes silently no-op.
 * Today the onYearChange sync below saves us in practice, but that's
 * fragile. Rebinding both references to our <select> future-proofs
 * against any downstream .set('minDate', ...) / .set('maxDate', ...)
 * call the caller may add later.
 *
 * Idempotency: onReady only fires once per instance, but we still guard
 * with fp._yearDropdownAttached in case a future caller adds `onOpen`
 * as a belt-and-braces trigger. Cheap insurance.
 *
 * Cross-picker consistency: the built-in monthDropdown is a real
 * <select> with class .flatpickr-monthDropdown-months. We clone its
 * classes onto our year <select> so CSS overrides (typography, colours)
 * apply to both automatically — no separate rule needed. .cur-year is
 * carried over too because the existing header layout keys off it.
 *
 * @param {Array}  _selectedDates — flatpickr hook signature (unused here)
 * @param {string} _dateStr       — flatpickr hook signature (unused here)
 * @param {object} fp             — the flatpickr instance
 */
export function attachYearDropdown(_selectedDates, _dateStr, fp) {
  if (fp._yearDropdownAttached) return;
  const yearInput = fp.currentYearElement;
  if (!yearInput) return;
  fp._yearDropdownAttached = true;

  const now = new Date();
  const minYear = now.getFullYear();
  const maxYear = minYear + 5;

  const select = document.createElement('select');
  select.className = 'flatpickr-monthDropdown-months cur-year';
  select.setAttribute('aria-label', 'Year');
  for (let y = minYear; y <= maxYear; y += 1) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    select.appendChild(opt);
  }
  // Reflect the year flatpickr currently shows — usually today's year on
  // first open, or the previously-selected date's year on subsequent
  // opens.
  select.value = String(fp.currentYear);

  // Selecting a year drives flatpickr forward/backward. changeYear() is
  // the public API for programmatic year changes — it fires the same
  // internal hooks as the built-in year input, so onYearChange listeners
  // and the picker grid stay in sync.
  select.addEventListener('change', (e) => {
    fp.changeYear(Number(e.target.value));
  });

  // Keep our <select> in sync when the picker's year changes via other
  // paths — e.g. picking a date in the next-month view rolls forward,
  // and the arrow buttons call changeYear() directly. onYearChange fires
  // after fp.currentYear updates, so reading it here is safe.
  fp.config.onYearChange.push(() => {
    select.value = String(fp.currentYear);
  });

  // Replace, don't hide-and-append: leaving the <input> in the DOM lets
  // JS bots that key off input[type=number] still find it and inject
  // values. Removing it makes the year genuinely inaccessible outside
  // our <select>.
  yearInput.parentNode.replaceChild(select, yearInput);

  // Rebind flatpickr's internal references to our <select> so any later
  // .set('minDate', ...) / .set('maxDate', ...) / keyboard-nav /
  // updateNavigationCurrentMonth call operates on the live element
  // instead of silently writing to a detached input. Setting .min /
  // .max on a <select> is a no-op (not valid attrs), so writes there
  // remain harmless; .disabled and .value writes now land on the
  // visible element as flatpickr expects.
  fp.currentYearElement = select;
  fp.yearElements[0] = select;

  // Flatpickr also injects .arrowUp / .arrowDown <span> siblings next
  // to the year input inside .numInputWrapper. They spin the year up
  // or down by 1 on click and stay visible on hover of the wrapper.
  // With a <select> in place they're redundant AND misleading (users
  // could click arrows past our maxYear cap since the arrow handlers
  // bypass the select's value list). Remove them.
  const wrapper = select.parentNode;
  if (wrapper) {
    wrapper.querySelectorAll('.arrowUp, .arrowDown').forEach((el) => el.remove());
  }
}
