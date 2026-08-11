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
//     range shows the gold pill. On selection the pill appears in a LOADING
//     state — a spinner + "Pricing your stay…", non-clickable — while the
//     Worker's POST /price (the SINGLE price source; no client-side per-night
//     fallback) computes the total. It then resolves to "Stay with us for only
//     X€" (clickable, href carries ?price), or, if /price fails or a safety
//     timeout elapses, falls back to a clickable "Continue to enquire" with no
//     price (so a slow/failed lookup never traps the guest). See
//     pillPresentation / applyPillState / fetchPrice.
//   - ONE selection at a time across all three bungalows: starting/among one
//     clears any selection on the others, so only one pill is ever visible.
//
// The renderer owns the DOM. We register a (key, iso) -> state lookup with it
// and ask it to repaint after each click; we never mutate day cells directly.
// That keeps the selection visuals correct across month paging (which fully
// re-renders every calendar).

import { loadBookings, toIso, parseIso, availabilityFor } from './bookings-data.js';
import { isOffSeason } from './season.js';
import { setSelectionLookup, rerenderCalendars, goToMonth } from './availability-calendar.js';
import { SITE_CONFIG } from './site-config.js';

// ── Constants (net-new to this feature) ──────────────────────────────────────
export const MIN_NIGHTS = 5;

// Debounce window before firing POST /price on a fresh valid selection. Rapid
// re-selections coalesce; the race guard (request id) is the correctness
// backstop that discards any stale response.
const PRICE_DEBOUNCE_MS = 250;

// Safety cap on the loading state: if POST /price neither resolves nor rejects
// within this window (network stall, hung request), fall the pill back to the
// clickable no-price state so the guest is never trapped behind a spinner that
// never stops. On a healthy request the fetch resolves well under this.
const PRICE_TIMEOUT_MS = 12000;

// Pure presentation resolver for the /stay/ pill: given a state and (for the
// priced state) a total, return the label, whether the pill is `disabled`
// (non-clickable while pricing), and whether it's `priced` (carries a real
// total → the href should append ?price). Split out so ALL of the copy /
// clickability / price-ness logic lives in one testable place; applyPillState
// (the DOM writer) drives its branches purely off these fields — it does not
// re-derive the state itself.
//   'loading'  → spinner + "Pricing your stay…", disabled, not priced
//   'priced'   → "Stay with us for only X€",     enabled,  priced
//   'fallback' → "Continue to enquire",          enabled,  not priced
// A 'priced' state whose total isn't a finite number degrades to the neutral
// fallback (enabled, not priced) — never renders "…for €NaN".
export function pillPresentation(state, total) {
  if (state === 'priced' && typeof total === 'number' && Number.isFinite(total)) {
    return { label: `Stay with us for only ${total}€`, disabled: false, priced: true };
  }
  if (state === 'loading') {
    return { label: 'Pricing your stay…', disabled: true, priced: false };
  }
  // 'fallback' (and any unexpected state) → the neutral, always-clickable copy.
  return { label: 'Continue to enquire', disabled: false, priced: false };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Bungalow preference order for the home-dock deep link: when the picked range
// is free for more than one bungalow, land on the lowest-numbered one (owner
// request). This is also the on-page (DOM) order of the three sections.
export const KEY_ORDER = ['B1', 'B2', 'B3'];

// Bungalow key → the compact number the /stay/ pill passes to /enquiries/ as
// ?bungalow=. enquiry.js validates it (/^[123]$/) into a hidden field and the
// Worker maps it to a human label ("Bungalow 1") for the sheet. Kept as a small
// allowlist so an unknown key just yields no param (blank Column B), never junk.
export const KEY_TO_NUM = { B1: '1', B2: '2', B3: '3' };

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

/**
 * Two selections are the "same" when key + both ISO endpoints match. Used by
 * the async /price flow to tell whether a response still belongs to the live
 * selection. Null-safe.
 */
export function sameSelection(a, b) {
  return !!a && !!b && a.key === b.key
    && a.checkIn === b.checkIn && a.checkOut === b.checkOut;
}

/**
 * The staleness gate for an async /price response: discard it when a newer
 * request has since fired (reqId !== currentReqId) OR the live selection no
 * longer matches the one this request was fired for. Pure so the race guard is
 * unit-testable without the DOM/flatpickr wiring.
 * @returns {boolean} true → the response is stale and must NOT paint the pill.
 */
export function priceResponseIsStale(currentSelection, snapshot, reqId, currentReqId) {
  if (reqId !== currentReqId) return true;
  if (!sameSelection(currentSelection, snapshot)) return true;
  return false;
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
 *   - contiguous and >= MIN_NIGHTS→ { kind: 'valid', nights }
 *
 * The valid verdict carries NO price: the total now comes from the Worker's
 * POST /price (fetched asynchronously by the UI layer), never from a client
 * computation.
 */
export function evaluateSelection(sel, unavailable, today) {
  if (!sel || !sel.checkIn || !sel.checkOut) return { kind: 'incomplete' };
  if (!isRangeContiguous(sel.checkIn, sel.checkOut, unavailable, today)) {
    return { kind: 'invalid' };
  }
  const nights = nightsBetween(sel.checkIn, sel.checkOut);
  if (nights < MIN_NIGHTS) return { kind: 'tooShort', nights };
  return { kind: 'valid', nights };
}

// Shape-only ISO gate (YYYY-MM-DD). Shape does NOT imply validity — see
// isBookableDockDate for why a round-trip check is still needed.
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is `iso` a date the home dock may deep-link into a stay? Pure (DOM-free) so
 * the acceptance rule is unit-testable and lives in ONE place rather than a
 * hand-rolled copy inside the DOM handler.
 *
 * Accepts only a REAL calendar date that is today-or-later AND in the open
 * season. Rejections (→ caller lands the guest at the top of /stay/):
 *   - wrong shape (regex)
 *   - a rolled-over / non-existent date: parseIso('2026-08-32') does NOT throw
 *     or return NaN — JS Date rolls it to 2026-09-01. So a NaN check never
 *     fires; instead we require toIso(parseIso(iso)) === iso, which fails for
 *     any out-of-range day/month (the rolled date serialises to a different
 *     string) — junk is rejected, not silently turned into a wrong real date.
 *   - a past date
 *   - an off-season date. Applied to BOTH endpoints, incl. the checkout: the
 *     checkout is the departure day, and the latest legal departure is Sep 30
 *     because Oct is off-season — a guest cannot leave on Oct 1.
 *
 * @param {string} iso    candidate YYYY-MM-DD
 * @param {Date}   today  local-midnight "today" for the past guard
 * @returns {Date|null}   the parsed local-midnight Date, or null if unusable
 */
export function isBookableDockDate(iso, today) {
  if (!ISO_RE.test(iso || '')) return null;
  const d = parseIso(iso);
  if (Number.isNaN(d.getTime())) return null; // belt-and-braces
  if (toIso(d) !== iso) return null; // rolled-over / non-existent calendar date
  if (d < today) return null;
  if (isOffSeason(d)) return null;
  return d;
}

/**
 * Home-dock deep link resolver: given every bungalow's unavailable-night set,
 * a candidate [checkInIso, checkOutIso) range, and today, return the FIRST
 * bungalow key (in `keyOrder`) that could actually host this stay, or null.
 *
 * "Could host" = the range is contiguous for that bungalow (no booked / past /
 * off-season night inside it) AND is at least MIN_NIGHTS long. The night-count
 * gate is what makes a sub-5-night dock selection resolve to null → the caller
 * lands the guest at the top of /stay/ rather than auto-selecting an
 * un-bookable range (the /stay/ calendars enforce the 5-night minimum; the home
 * dock does not, so we fold the same rule in here).
 *
 * Pure (no DOM) so the decision table is unit-testable. Reuses the same
 * isRangeContiguous walk a manual selection uses, so a hit is guaranteed to
 * produce the same 'valid' verdict evaluateSelection would.
 *
 * @param {Map<string, Set<string>>} unavailableByKey  key → booked-night ISO set
 * @param {string} checkInIso   YYYY-MM-DD
 * @param {string} checkOutIso  YYYY-MM-DD (must be after check-in)
 * @param {Date}   today        local-midnight "today" for the past-night guard
 * @param {string[]} keyOrder   preference order (default KEY_ORDER: B1→B2→B3)
 * @returns {string|null} the first hosting bungalow key, or null if none
 */
export function firstAvailableBungalow(
  unavailableByKey,
  checkInIso,
  checkOutIso,
  today,
  keyOrder = KEY_ORDER,
) {
  if (nightsBetween(checkInIso, checkOutIso) < MIN_NIGHTS) return null;
  for (const key of keyOrder) {
    const unavailable = unavailableByKey.get(key) || new Set();
    if (isRangeContiguous(checkInIso, checkOutIso, unavailable, today)) {
      return key;
    }
  }
  return null;
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
    // Belt-and-suspenders click guard: while the pill is in the disabled
    // (loading) state we clear its href AND set aria-disabled, and CSS sets
    // pointer-events:none — but a stray click (stale href, focus+Enter before
    // the style applies) must still not navigate. Registered once per pill.
    pill.addEventListener('click', (ev) => {
      if (pill.getAttribute('aria-disabled') === 'true') ev.preventDefault();
    });
    root.insertAdjacentElement('afterend', pill);
    pillByKey.set(key, pill);
    return pill;
  };
  const hideAllPills = () => pillByKey.forEach((p) => { p.hidden = true; });

  // Apply a pill state (see pillPresentation) to the DOM: label, the spinner
  // element (loading only), the href (priced carries ?price; loading has none),
  // and the aria/class flags that make it non-clickable while pricing.
  //   loading  → spinner + "Pricing your stay…", NO href, aria-disabled/busy
  //   priced   → "Stay with us for only X€", href with ?price, enabled
  //   fallback → "Continue to enquire", href without price, enabled
  const applyPillState = (pill, state, snapshot, total) => {
    const { label, disabled, priced } = pillPresentation(state, total);
    if (disabled) {
      // Loading: spinner + label, non-clickable (no href, aria-disabled/busy;
      // CSS adds pointer-events:none via --loading).
      pill.classList.add('stay-select__pill--loading');
      pill.setAttribute('aria-disabled', 'true');
      pill.setAttribute('aria-busy', 'true');
      pill.removeAttribute('href'); // a hrefless <a> is not an activatable link
      // Spinner span (aria-hidden — the live region announces the wait) + label.
      pill.innerHTML = '';
      const spinner = document.createElement('span');
      spinner.className = 'stay-select__spinner';
      spinner.setAttribute('aria-hidden', 'true');
      pill.appendChild(spinner);
      pill.appendChild(document.createTextNode(label));
    } else {
      // Enabled (priced or fallback): plain label + href. Only a priced result
      // appends ?price (enquiryHref re-guards the number regardless).
      pill.classList.remove('stay-select__pill--loading');
      pill.removeAttribute('aria-disabled');
      pill.removeAttribute('aria-busy');
      pill.textContent = label;
      pill.href = priced ? enquiryHref(snapshot, total) : enquiryHref(snapshot);
    }
  };

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

  // Build the enquiry link the pill points at. Dates plus the bungalow the pill
  // belongs to (?bungalow=1|2|3) — each pill's href is set for its OWN bungalow,
  // so the clicked pill inherently carries the right one. The stay's total price
  // (?price=<euros>) is OPTIONAL and appended only once the Worker's POST /price
  // resolves for the current selection: the price is no longer computed on the
  // client, so the pre-/price href carries no price and the post-/price href
  // carries the Worker's total. enquiry.js reads & validates ?checkin/?checkout
  // and the hidden bungalow/price fields; the Worker maps the bungalow number to
  // a "Bungalow N" label and records the price in the sheet's Price column. No
  // villa param (owner's choice for the free-text message; bungalow + price
  // travel structured instead).
  const enquiryHref = (sel, price) => {
    const num = KEY_TO_NUM[sel.key] || '';
    const hasPrice = typeof price === 'number' && Number.isFinite(price) && price > 0;
    const q = `checkin=${sel.checkIn}&checkout=${sel.checkOut}`
      + (num ? `&bungalow=${num}` : '')
      + (hasPrice ? `&price=${price}` : '');
    return `../enquiries/?${q}`;
  };

  // ── Async price fetch (POST /price), race-guarded + debounced ──────────────
  // The pill's number now comes from the Worker, not the client. Two safety
  // rails per the brief:
  //   - Race guard: every fetch is stamped with a monotonically increasing
  //     request id (and the selection's checkIn/checkOut/key it was fired for).
  //     When a response resolves we only touch the pill if BOTH the id is still
  //     the latest AND the live selection still matches — a slow earlier
  //     response can never overwrite a newer selection's price.
  //   - Debounce: rapid re-selections coalesce into one fetch after
  //     PRICE_DEBOUNCE_MS; the race guard remains the correctness backstop.
  // On ANY failure (network error, non-2xx, bad shape) we leave the pill in its
  // no-price state — neutral label + href without ?price — and never invent a
  // number, never throw (log a console.warn like offers.js).
  // priceReqId is a monotonic staleness token, NOT a request count — it is
  // bumped both when a fetch is scheduled and when it fires (so it can advance
  // by more than one per selection). Only its monotonicity matters: any
  // response whose captured reqId !== the current priceReqId is stale → discarded.
  let priceReqId = 0;
  let priceTimer = null;

  const fetchPrice = (sel) => {
    const reqId = ++priceReqId;
    const snapshot = { key: sel.key, checkIn: sel.checkIn, checkOut: sel.checkOut };
    const num = KEY_TO_NUM[sel.key] || '';
    const body = { checkin: sel.checkIn, checkout: sel.checkOut };
    if (num) body.bungalow = num;

    // Settle-once guard shared by resolve / reject / timeout: only the FIRST
    // outcome for this fetch touches the pill, and only if this fetch is still
    // the current one and its pill is still shown for the same selection.
    let settled = false;
    const settle = (apply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (priceResponseIsStale(selection, snapshot, reqId, priceReqId)) return;
      const pill = pillByKey.get(snapshot.key);
      if (!pill || pill.hidden) return; // pill was hidden (selection cleared)
      apply(pill);
    };

    // Fallback used by BOTH a failed fetch and the safety timeout: leave the
    // pill clickable with the neutral no-price label so a slow/failed /price
    // never traps the guest behind a permanent spinner.
    const toFallback = () => settle((pill) => {
      applyPillState(pill, 'fallback', snapshot);
      announce('');
      announce('Continue to enquire.');
    });

    // Safety timeout: a request that never resolves or rejects still clears the
    // spinner. The fetch's own outcome (settle) will no-op afterwards.
    const timeoutId = setTimeout(toFallback, PRICE_TIMEOUT_MS);

    fetch(SITE_CONFIG.endpoints.price, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data || data.ok !== true || typeof data.total !== 'number'
          || !Number.isFinite(data.total)) {
          throw new Error('bad-shape');
        }
        const total = data.total;
        settle((pill) => {
          applyPillState(pill, 'priced', snapshot, total);
          // Reset the live region before re-announcing so screen readers still
          // read an identical euro total when the guest re-selects the same range.
          announce('');
          announce(`Stay with us for ${total} euros.`);
        });
      })
      .catch((err) => {
        // No fallback number: neutral clickable pill. Never throw.
        console.warn('[stay] could not price selection:', err.message);
        toFallback();
      });
  };

  // Debounced entry point: schedule a priced fetch for the current selection.
  const schedulePrice = (sel) => {
    if (priceTimer) clearTimeout(priceTimer);
    // Bump the id NOW so any in-flight response fired before this reschedule is
    // discarded even if it resolves during the debounce window.
    priceReqId++;
    const snapshot = { key: sel.key, checkIn: sel.checkIn, checkOut: sel.checkOut };
    priceTimer = setTimeout(() => {
      priceTimer = null;
      // Only fire if the selection is still the one we scheduled for.
      if (sameSelection(selection, snapshot)) fetchPrice(snapshot);
    }, PRICE_DEBOUNCE_MS);
  };

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
      // Show the pill IMMEDIATELY in the LOADING state — spinner + "Pricing
      // your stay…", non-clickable — so the guest sees that a price is being
      // fetched and waits for it. POST /price then resolves this to the priced
      // state ("…for X€", clickable) or, on failure/timeout, to the neutral
      // clickable "Continue to enquire" fallback (see fetchPrice). The loading
      // pill carries NO href.
      applyPillState(pill, 'loading', selection);
      pill.hidden = false;
      // Italic "Selected X nights" caption, to the left of the pill.
      const count = countFor(root, selection.key, pill);
      count.textContent = `Selected ${verdict.nights} ${verdict.nights === 1 ? 'night' : 'nights'}`;
      count.hidden = false;
      // Announce the selection + that pricing is underway; the price (or the
      // fallback) announcement follows when /price settles.
      announce(`Selected ${verdict.nights} nights. Pricing your stay…`);
      // Fetch the real total (async, debounced, race-guarded).
      schedulePrice(selection);
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

  // ── Home-dock deep link (?checkin=&checkout=) ──────────────────────────────
  // The home floating dock (booking.js) navigates here as stay/?checkin=&
  // checkout= with the ISO dates the visitor picked. Unlike the /stay/
  // calendars, the dock does NOT enforce the 5-night minimum. On arrival we:
  //   - find the FIRST bungalow (B1→B2→B3) that is free for the whole range AND
  //     the range is >=5 nights → auto-select it (same visuals as a manual
  //     pick: gold circles, "Selected N nights", price pill), scroll to that
  //     bungalow, and focus its check-in cell; then strip the params.
  //   - otherwise (no bungalow free, range <5 nights, or junk params) → leave
  //     the page at the top so the guest can scroll and browse.
  // Runs ONCE, inside the loadBookings().then below, so availability is judged
  // against real data — never the empty fail-safe sets. Only fires when no
  // manual selection has been made yet (an early click before data loaded wins).
  const applyDeepLink = () => {
    if (selection) return; // a manual pick before data loaded wins
    const params = new URLSearchParams(window.location.search);
    const ciRaw = params.get('checkin');
    const coRaw = params.get('checkout');
    if (!ciRaw && !coRaw) return; // no deep link present

    const today = todayMidnight();
    const ci = isBookableDockDate(ciRaw, today);
    const co = isBookableDockDate(coRaw, today);

    // Strip the params regardless of outcome so a refresh / shared link doesn't
    // re-scroll or re-select on every load. Replace (not push) — no history
    // entry, no reload; keeps the address bar clean.
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState(null, '', cleanUrl);

    // Both endpoints must be valid and ordered; else land at the top.
    if (!ci || !co || co <= ci) return;
    const checkInIso = toIso(ci);
    const checkOutIso = toIso(co);

    const key = firstAvailableBungalow(
      unavailableByKey, checkInIso, checkOutIso, today, KEY_ORDER,
    );
    if (!key) return; // none free, or <5 nights → top of page

    // Resolve the target calendar's root BEFORE committing any state. firstAvailable
    // Bungalow works off KEY_ORDER + the unavailable map, which could in principle
    // name a key that has no rendered calendar (e.g. a future refactor hides a
    // bungalow while bookings.json still lists it). Guard first so we never leave a
    // committed-but-invisible selection painted with no calendar to scroll to.
    const root = roots.find((r) => r.dataset.bungalowKey === key);
    if (!root) return;

    // Drive the exact same path a completing manual click produces.
    selection = { key, checkIn: checkInIso, checkOut: checkOutIso };
    // The calendars only render two months at a time; page the check-in's month
    // into view FIRST, or the selection highlight would paint into an off-screen
    // month and the check-in cell wouldn't exist to focus. goToMonth clamps to
    // the same nav bounds the arrows use and re-renders if the month moved;
    // refreshUI's own rerenderCalendars() then repaints the selection on top.
    goToMonth(parseIso(checkInIso));
    refreshUI();

    // Scroll to the bungalow section (the calendar's nearest .bungalow-split,
    // whose heading is the stable anchor). Respect reduced-motion.
    const section = root.closest('.bungalow-split') || root;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    // Land keyboard focus inside the selection (the check-in cell), after the
    // repaint replaced the old cell. preventScroll so it doesn't fight the
    // smooth scroll above. Mirrors selectDay's refocus pattern.
    const cell = root.querySelector(`.avail-cal__day[data-iso="${checkInIso}"]`);
    if (cell && cell.classList.contains('is-available')) {
      cell.focus({ preventScroll: true });
    }
  };

  // Populate the real unavailable sets from the shared (cached) fetch, then
  // re-evaluate any selection made before data arrived, and finally apply any
  // home-dock deep link against the now-real availability.
  loadBookings().then((bookings) => {
    roots.forEach((root) => {
      const key = root.dataset.bungalowKey;
      unavailableByKey.set(key, availabilityFor(bookings, key).unavailable);
    });
    if (selection) refreshUI();
    applyDeepLink();
  });
}
