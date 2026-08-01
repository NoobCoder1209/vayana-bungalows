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

/**
 * Pure click reducer: given the current selection and a click (bungalow key +
 * available-day ISO + that bungalow's unavailable set + today), return the NEXT
 * selection. Extracted so the click state machine is testable without a DOM and
 * the transitions live in one place.
 *
 * Invariant: a selection ALWAYS has a non-null `checkIn` (every branch that
 * creates one sets it). So there is no "selection with no check-in" state — the
 * only question on a same-bungalow second click is whether it completes,
 * re-seeds, or is void.
 *
 * Transitions:
 *   - no selection / different bungalow / both endpoints already set (3rd click)
 *       → fresh check-in on this bungalow
 *   - same day re-clicked, or clicked earlier than check-in
 *       → re-seed check-in (clears check-out)
 *   - clicked later but the range crosses a booked/blocked gap
 *       → re-seed check-in to the clicked date (owner rule; not a rejection)
 *   - clicked later and contiguous
 *       → record check-out (completes the range)
 */
export function reduceClick(selection, { key, iso, unavailable, today }) {
  const fresh = { key, checkIn: iso, checkOut: null };

  // First click, switching bungalows, or a 3rd click (both endpoints set).
  if (!selection || selection.key !== key || (selection.checkIn && selection.checkOut)) {
    return fresh;
  }
  // Same-bungalow second click. (checkIn is always set — see invariant.)
  if (iso === selection.checkIn) return fresh; // re-pick the same start
  if (parseIso(iso) < parseIso(selection.checkIn)) return fresh; // earlier → new start
  if (!isRangeContiguous(selection.checkIn, iso, unavailable, today)) {
    return fresh; // crosses a gap → clicked date becomes the new check-in
  }
  return { key, checkIn: selection.checkIn, checkOut: iso }; // contiguous → complete
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

  // Idempotency guard, mirroring initAvailabilityCalendars' own re-init reset.
  // A second call (SPA soft-nav, Vite HMR, future re-init) would otherwise
  // stack a second click/keydown listener per root, register a duplicate
  // selection lookup, and append another dock to <main>. Mark the roots on
  // first run and bail on any subsequent call.
  if (roots.some((r) => r.dataset.selectionWired === '1')) return;
  roots.forEach((r) => { r.dataset.selectionWired = '1'; });

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
  // Visual only (aria-hidden): announcements go through the dedicated polite
  // live region below, so we never toggle `hidden` on a live region (which can
  // double-announce or announce on hide across browsers — review M5).
  const host = document.querySelector('main') || document.body;
  const dock = document.createElement('div');
  dock.className = 'stay-select__dock';
  dock.setAttribute('aria-hidden', 'true');
  dock.hidden = true;
  dock.textContent = 'At least 5 nights required for a reservation';
  host.appendChild(dock);

  // One polite live region announces BOTH outcomes — the too-short error and
  // the valid-range success (price) — so screen-reader users hear either, not
  // just the failure. Visually hidden; updated by refreshUI.
  const announcer = document.createElement('div');
  announcer.className = 'stay-select__sr';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  host.appendChild(announcer);
  const announce = (msg) => { announcer.textContent = msg; };

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

    if (!selection) { announce(''); return; }
    const unavailable = unavailableByKey.get(selection.key) || new Set();
    let verdict = evaluateSelection(selection, unavailable, today);

    if (verdict.kind === 'invalid') {
      // A range that was contiguous when clicked can become gap-crossing once
      // real bookings load (selection made before the fetch resolved — the
      // reducer never produces an invalid range at click time, it re-seeds).
      // Promote the check-out to a fresh check-in, tell the guest why (so the
      // selection doesn't just silently vanish — review H2), then re-evaluate.
      selection = { key: selection.key, checkIn: selection.checkOut, checkOut: null };
      rerenderCalendars();
      showDock();
      dock.textContent = 'Those dates just became unavailable — please pick again';
      announce('Those dates are no longer available. Please choose your dates again.');
      return;
    }

    // Reset the dock text to the default min-nights message (it may have been
    // overwritten by the invalidation branch on a previous refresh).
    dock.textContent = 'At least 5 nights required for a reservation';

    if (verdict.kind === 'tooShort') {
      showDock();
      announce('At least 5 nights required for a reservation.');
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
      // Announce the success outcome too (not just failures — review M5).
      announce(`Selected ${verdict.nights} nights. Stay with us for ${verdict.price} euros.`);
    } else {
      // incomplete (only a check-in) — no dock, no pill, clear any prior status.
      announce('');
    }
  };

  // Core: apply a day selection for (root, iso) and refresh. `refocusIso`, when
  // set, moves keyboard focus back to that day cell after refreshUI's re-render
  // wipes the old node (keyboard users would otherwise lose their place).
  const selectDay = (root, iso, refocusIso) => {
    const key = root.dataset.bungalowKey;
    selection = reduceClick(selection, {
      key,
      iso,
      unavailable: unavailableByKey.get(key) || new Set(),
      today: todayMidnight(),
    });
    refreshUI();
    if (refocusIso) {
      const next = root.querySelector(`.avail-cal__day[data-iso="${refocusIso}"]`);
      if (next && next.classList.contains('is-available')) next.focus();
    }
  };

  // Resolve an event target to a selectable available-day cell in this root.
  const availableCell = (root, target) => {
    const cell = target.closest && target.closest('.avail-cal__day');
    if (!cell || !root.contains(cell)) return null;
    if (!cell.classList.contains('is-available')) return null; // blocked days
    return cell.dataset.iso ? cell : null;
  };

  // One click handler per calendar (delegation). Ignores non-available cells.
  const onCalendarClick = (root, ev) => {
    const cell = availableCell(root, ev.target);
    if (!cell) return;
    selectDay(root, cell.dataset.iso);
  };

  // Keyboard: Enter/Space on a focused available cell selects it, mirroring a
  // click. Re-focus the same day after the grid repaints so keyboard nav keeps
  // its place (review M4).
  const onCalendarKeydown = (root, ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    const cell = availableCell(root, ev.target);
    if (!cell) return;
    ev.preventDefault(); // stop Space from scrolling the page
    selectDay(root, cell.dataset.iso, cell.dataset.iso);
  };

  roots.forEach((root) => {
    root.addEventListener('click', (ev) => onCalendarClick(root, ev));
    root.addEventListener('keydown', (ev) => onCalendarKeydown(root, ev));
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
