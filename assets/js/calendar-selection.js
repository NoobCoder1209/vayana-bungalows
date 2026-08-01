// Interactive date-range selection layer for the /stay/ availability calendars.
//
// The calendars themselves (availability-calendar.js) are a read-only DISPLAY:
// they draw each bungalow's two-month grid coloured from bookings.json. This
// module makes AVAILABLE days on them selectable, turning the passive display
// into the page's primary booking action.
//
// Behaviour (all locked with the owner during brainstorming):
//   - Click model: 1st click = check-in, 2nd = check-out, 3rd = new check-in.
//   - Only `.is-available` days respond. Clicking a past / booked / off-season
//     day does nothing (no handler fires — those cells carry aria-disabled and
//     we bail on them), so an in-progress check-in stays lit.
//   - Range must be CONTIGUOUS: if any night between check-in and check-out is
//     unavailable (booked / past / off-season) the second click is treated as
//     invalid and does not form a range — it becomes a fresh check-in instead.
//   - Minimum 5 nights. Nights use the hotel convention:
//     nights = (checkOut - checkIn) / 1 day. A valid <5-night range shows a red
//     dock ("At least 5 nights required for a reservation"); a valid >=5-night
//     range shows the gold "Stay with us only for X€" pill (X = nights * 100).
//   - ONE selection at a time across all three bungalows: starting/among one
//     clears any selection on the others, so only one pill is ever visible.
//
// The renderer owns the DOM. We register a (key, iso) -> state lookup with it
// and ask it to repaint after each click; we never mutate day cells directly.
// That keeps the selection visuals correct across month paging (which fully
// re-renders every calendar).

import { loadBookings, toIso, parseIso, availabilityFor } from './bookings-data.js';
import { isOffSeason } from './season.js';
import { setSelectionLookup, rerenderCalendars } from './availability-calendar.js';

// ── Constants (net-new to this feature) ──────────────────────────────────────
export const PRICE_PER_NIGHT = 100; // euros
export const MIN_NIGHTS = 5;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ── Pure logic (DOM-free, exported for unit tests) ───────────────────────────

/**
 * Hotel-convention night count between two ISO dates (check-out − check-in in
 * whole days). Returns 0 or a negative number if the order is wrong; callers
 * treat anything < 1 as "not a range yet". Uses parseIso (local midnight) so
 * DST never shifts the count.
 */
export function nightsBetween(checkInIso, checkOutIso) {
  const a = parseIso(checkInIso);
  const b = parseIso(checkOutIso);
  return Math.round((b - a) / ONE_DAY_MS);
}

/** Price for a stay of `nights` nights, in whole euros. */
export function priceForNights(nights) {
  return nights * PRICE_PER_NIGHT;
}

/**
 * Is every night of the range [checkIn, checkOut) available for this bungalow?
 * Walks each night from check-in up to (but not including) check-out — the
 * check-out day itself is a departure, not an occupied night — and rejects if
 * any night is in the `unavailable` set, in the past, or off-season. Mirrors
 * the interior-night walk the legacy booking widget uses.
 *
 * @param {string} checkInIso  YYYY-MM-DD
 * @param {string} checkOutIso YYYY-MM-DD (must be after check-in)
 * @param {Set<string>} unavailable  booked-night ISO keys for the bungalow
 * @param {Date} today  local-midnight "today" for the past-night guard
 * @returns {boolean}
 */
export function isRangeContiguous(checkInIso, checkOutIso, unavailable, today) {
  if (nightsBetween(checkInIso, checkOutIso) < 1) return false;
  const cursor = parseIso(checkInIso);
  const end = parseIso(checkOutIso);
  while (cursor < end) {
    const iso = toIso(cursor);
    if (cursor < today) return false;
    if (isOffSeason(cursor)) return false;
    if (unavailable.has(iso)) return false;
    cursor.setDate(cursor.getDate() + 1);
  }
  return true;
}

/**
 * Resolve a completed selection into a UI verdict. Pure so tests can assert the
 * full decision table without a DOM.
 *   - no check-out yet            → { kind: 'incomplete' }
 *   - range crosses a gap         → { kind: 'invalid' }  (2nd click is void)
 *   - contiguous but < MIN_NIGHTS → { kind: 'tooShort', nights }
 *   - contiguous and >= MIN_NIGHTS→ { kind: 'valid', nights, price }
 */
export function evaluateSelection(sel, unavailable, today) {
  if (!sel || !sel.checkIn || !sel.checkOut) return { kind: 'incomplete' };
  if (!isRangeContiguous(sel.checkIn, sel.checkOut, unavailable, today)) {
    return { kind: 'invalid' };
  }
  const nights = nightsBetween(sel.checkIn, sel.checkOut);
  if (nights < MIN_NIGHTS) return { kind: 'tooShort', nights };
  return { kind: 'valid', nights, price: priceForNights(nights) };
}

/**
 * Per-day selection state for the renderer's lookup: given the active selection
 * and a day ISO, return '' | 'start' | 'end' | 'mid'. Middle days are only
 * highlighted once BOTH endpoints are chosen and strictly between them.
 */
export function dayState(sel, iso) {
  if (!sel) return '';
  if (sel.checkIn && iso === sel.checkIn) return 'start';
  if (sel.checkOut && iso === sel.checkOut) return 'end';
  if (sel.checkIn && sel.checkOut) {
    const d = parseIso(iso);
    if (d > parseIso(sel.checkIn) && d < parseIso(sel.checkOut)) return 'mid';
  }
  return '';
}

// ── DOM wiring ────────────────────────────────────────────────────────────────

// Local-midnight today, for the past-night guard.
function todayMidnight() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/**
 * Wire click-to-select on every /stay/ availability calendar. No-op when the
 * page has no `[data-avail-cal]` calendars (every non-/stay/ page), so it is
 * safe to call unconditionally from main.js.
 */
export function initCalendarSelection() {
  const roots = Array.from(document.querySelectorAll('[data-avail-cal][data-bungalow-key]'));
  if (!roots.length) return;

  // Active selection: which bungalow, and its chosen check-in/out ISO days.
  // Only ever one at a time (owner request).
  let selection = null; // { key, checkIn, checkOut }
  // Per-bungalow unavailable-night sets, populated from the shared bookings
  // cache. Empty until the fetch resolves — until then every range validates
  // as contiguous, matching the calendar's "render everything available"
  // fail-safe posture.
  const unavailableByKey = new Map();
  roots.forEach((r) => unavailableByKey.set(r.dataset.bungalowKey, new Set()));

  // Register the per-day state lookup the renderer consults while painting.
  setSelectionLookup((key, iso) => {
    if (!selection || selection.key !== key) return '';
    return dayState(selection, iso);
  });

  // ── Shared bottom error dock (created once, appended to <main>) ────────────
  const host = document.querySelector('main') || document.body;
  const dock = document.createElement('div');
  dock.className = 'stay-select__dock';
  dock.setAttribute('role', 'status');
  dock.hidden = true;
  dock.textContent = 'At least 5 nights required for a reservation';
  host.appendChild(dock);

  const showDock = () => { dock.hidden = false; };
  const hideDock = () => { dock.hidden = true; };

  // ── Per-bungalow gold pill (created once per calendar) ─────────────────────
  // Mounted as a SIBLING immediately after the calendar root — NOT inside it.
  // The renderer rewrites root.innerHTML on every repaint, so a pill placed
  // inside would be destroyed each refresh; a sibling survives. It still lands
  // directly below the calendar (and thus below the legend, which is the last
  // thing the renderer draws). Built lazily on first valid range.
  const pillByKey = new Map();
  const pillFor = (root, key) => {
    let pill = pillByKey.get(key);
    if (pill && pill.isConnected) return pill;
    pill = document.createElement('a');
    pill.className = 'stay-select__pill';
    pill.hidden = true;
    root.insertAdjacentElement('afterend', pill);
    pillByKey.set(key, pill);
    return pill;
  };
  const hideAllPills = () => pillByKey.forEach((p) => { p.hidden = true; });

  // ── Per-bungalow "Selected X nights" caption ───────────────────────────────
  // A plain italic text line (no pill/button styling), shown to the LEFT,
  // alongside the pill and under the same conditions (valid >=5-night range).
  // Also a sibling of the calendar root so the renderer's innerHTML rewrite
  // can't destroy it. Inserted BEFORE the pill so it reads left-of it.
  const countByKey = new Map();
  const countFor = (root, key, pill) => {
    let el = countByKey.get(key);
    if (el && el.isConnected) return el;
    el = document.createElement('span');
    el.className = 'stay-select__count';
    el.hidden = true;
    // Place it right BEFORE the pill so DOM/visual order is
    // calendar → count → pill (caption on the left, pill on the right).
    // Falls back to after-root if the pill isn't mounted yet.
    if (pill && pill.isConnected) {
      pill.insertAdjacentElement('beforebegin', el);
    } else {
      root.insertAdjacentElement('afterend', el);
    }
    countByKey.set(key, el);
    return el;
  };
  const hideAllCounts = () => countByKey.forEach((el) => { el.hidden = true; });

  // Build the enquiry link the pill points at. Dates only, no villa param
  // (owner's choice); enquiry.js already reads & validates ?checkin/?checkout.
  const enquiryHref = (sel) => `../enquiries/?checkin=${sel.checkIn}&checkout=${sel.checkOut}`;

  // Repaint the pill/dock for the current selection + repaint calendars so the
  // day circles reflect the range. One place → the two never drift. Calendars
  // are repainted FIRST (the renderer rewrites each root's innerHTML); the pill
  // is a sibling of the root, so it survives that repaint and is (re)shown after.
  const refreshUI = () => {
    const today = todayMidnight();
    hideDock();
    hideAllPills();
    hideAllCounts();
    rerenderCalendars();

    if (!selection) return;
    const unavailable = unavailableByKey.get(selection.key) || new Set();
    let verdict = evaluateSelection(selection, unavailable, today);

    if (verdict.kind === 'invalid') {
      // Defensive: a range that was valid at click time can become
      // gap-crossing once real bookings load (selection made pre-fetch).
      // Promote the check-out to a fresh check-in — same rule as the click
      // path — so we never leave a stale invalid range lit, then re-evaluate
      // (a lone check-in is 'incomplete': no pill, no dock).
      selection = { key: selection.key, checkIn: selection.checkOut, checkOut: null };
      rerenderCalendars();
      verdict = evaluateSelection(selection, unavailable, today);
    }

    if (verdict.kind === 'tooShort') {
      showDock();
    } else if (verdict.kind === 'valid') {
      const root = roots.find((r) => r.dataset.bungalowKey === selection.key);
      const pill = pillFor(root, selection.key);
      pill.textContent = `Stay with us only for ${verdict.price}€`;
      pill.href = enquiryHref(selection);
      pill.hidden = false;
      // Italic "Selected X nights" caption, to the left of the pill.
      const count = countFor(root, selection.key, pill);
      count.textContent = `Selected ${verdict.nights} ${verdict.nights === 1 ? 'night' : 'nights'}`;
      count.hidden = false;
    }
  };

  // One click handler per calendar (delegation). Ignores non-available cells.
  const onCalendarClick = (root, ev) => {
    const cell = ev.target.closest('.avail-cal__day');
    if (!cell || !root.contains(cell)) return;
    // Only available days are selectable — blocked days carry aria-disabled.
    if (!cell.classList.contains('is-available')) return;
    const iso = cell.dataset.iso;
    if (!iso) return;

    const key = root.dataset.bungalowKey;

    // Switching bungalows (or first ever click) clears any other selection and
    // starts a fresh check-in here.
    if (!selection || selection.key !== key || (selection.checkIn && selection.checkOut)) {
      // 3rd click (both set) → reset to a new check-in; also covers switching.
      selection = { key, checkIn: iso, checkOut: null };
      refreshUI();
      return;
    }

    // Second click on the same bungalow.
    if (!selection.checkIn) {
      selection.checkIn = iso;
    } else if (iso === selection.checkIn) {
      // Clicking the same day again — treat as a re-pick of check-in (no-op
      // range), keep it as the start.
      selection = { key, checkIn: iso, checkOut: null };
    } else if (parseIso(iso) < parseIso(selection.checkIn)) {
      // Clicked earlier than the current check-in → make THAT the new check-in.
      selection = { key, checkIn: iso, checkOut: null };
    } else if (!isRangeContiguous(
      selection.checkIn, iso, unavailableByKey.get(key) || new Set(), todayMidnight(),
    )) {
      // The range check-in → this click crosses a booked/blocked gap. Rather
      // than reject and leave the old check-in lit, treat the clicked date as
      // a fresh check-in (owner request): the guest restarts the range from
      // the day they just clicked.
      selection = { key, checkIn: iso, checkOut: null };
    } else {
      selection.checkOut = iso;
    }
    refreshUI();
  };

  roots.forEach((root) => {
    root.addEventListener('click', (ev) => onCalendarClick(root, ev));
  });

  // Populate the real unavailable sets from the shared (cached) fetch, then
  // re-evaluate any selection made before data arrived.
  loadBookings().then((bookings) => {
    roots.forEach((root) => {
      const key = root.dataset.bungalowKey;
      unavailableByKey.set(key, availabilityFor(bookings, key).unavailable);
    });
    if (selection) refreshUI();
  });
}
