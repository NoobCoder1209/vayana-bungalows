// Unit tests for the /stay/ calendar-selection PURE logic: night counting,
// the MIN_NIGHTS gate, the contiguity walk, and the completed-range verdict
// table. The DOM wiring (click delegation, pill/dock, the async POST /price
// fetch) is not exercised here — these lock the decision logic that would
// silently regress. The price is now sourced from the Worker's /price endpoint,
// so there is no client-side price function to slice.
//
// calendar-selection.js can't be plain-imported in Node: it pulls in
// availability-calendar.js (DOM/flatpickr chain) and bookings-data.js (reads
// import.meta.env at module top). So — matching availability-calendar.test.mjs
// — we SOURCE-SLICE the pure functions and eval them via `new Function`,
// injecting the small deps they close over (parseIso / toIso, and the real
// isOffSeason from season.js, which is import-clean).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEL_SRC = readFileSync(join(__dirname, '..', 'calendar-selection.js'), 'utf8');

// Real season primitive (season.js has no imports of its own).
const { isOffSeason } = await import(
  pathToFileURL(join(__dirname, '..', 'season.js')).href
);

// Slice a named `export function NAME(` ... matching column-0 `}` out of the
// module text (repo formats one top-level decl per closing brace at col 0).
function sliceFn(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const end = src.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`end of ${name} not found`);
  // Drop the `export ` prefix so it's a plain decl inside our Function scope.
  return src.slice(start, end + 2).replace(/^export /, '');
}

// Build all the pure helpers into one scope with the deps they reference
// injected. parseIso / toIso are re-implemented here identically to
// bookings-data.js (local-midnight, local YYYY-MM-DD) so the sliced code's
// free references resolve without importing that env-coupled module.
function loadLogic() {
  const deps = `
    const MIN_NIGHTS = 5;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const KEY_ORDER = ['B1', 'B2', 'B3'];
    const ISO_RE = /^\\d{4}-\\d{2}-\\d{2}$/;
    const parseIso = (iso) => { const [y,m,d] = iso.split('-').map(Number); return new Date(y, m-1, d); };
    const toIso = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return y+'-'+m+'-'+day;
    };
  `;
  const body = [
    deps,
    sliceFn(SEL_SRC, 'nightsBetween'),
    sliceFn(SEL_SRC, 'sameSelection'),
    sliceFn(SEL_SRC, 'priceResponseIsStale'),
    sliceFn(SEL_SRC, 'isRangeContiguous'),
    sliceFn(SEL_SRC, 'evaluateSelection'),
    sliceFn(SEL_SRC, 'isBookableDockDate'),
    sliceFn(SEL_SRC, 'firstAvailableBungalow'),
    sliceFn(SEL_SRC, 'dayState'),
    sliceFn(SEL_SRC, 'reduceClick'),
    sliceFn(SEL_SRC, 'pillPresentation'),
    sliceFn(SEL_SRC, 'applyPillState'),
    sliceFn(SEL_SRC, 'isRetryablePriceStatus'),
    sliceFn(SEL_SRC, 'shouldRetryAttempt'),
    'return { nightsBetween, sameSelection, priceResponseIsStale, isRangeContiguous, evaluateSelection, isBookableDockDate, firstAvailableBungalow, dayState, reduceClick, pillPresentation, applyPillState, isRetryablePriceStatus, shouldRetryAttempt, MIN_NIGHTS, KEY_ORDER };',
  ].join('\n\n');
  return new Function('isOffSeason', body)(isOffSeason);
}

const L = loadLogic();
// A "today" comfortably in the past so past-night guards don't trip the
// in-season August dates used below.
const TODAY = new Date(2026, 0, 1); // Jan 1 2026

// ── nights ──────────────────────────────────────────────────────────────────

test('nightsBetween: hotel convention (Aug 10 → Aug 15 = 5 nights)', () => {
  assert.equal(L.nightsBetween('2026-08-10', '2026-08-15'), 5);
});

test('nightsBetween: 6 and 10 nights', () => {
  assert.equal(L.nightsBetween('2026-08-10', '2026-08-16'), 6);
  assert.equal(L.nightsBetween('2026-08-10', '2026-08-20'), 10);
});

test('nightsBetween: reversed order is non-positive', () => {
  assert.ok(L.nightsBetween('2026-08-15', '2026-08-10') <= 0);
});

// ── async /price race guard (pure decision) ──────────────────────────────────

const SNAP = { key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-15' };

test('sameSelection: matches on key + both endpoints; null-safe', () => {
  assert.equal(L.sameSelection(SNAP, { ...SNAP }), true);
  assert.equal(L.sameSelection(SNAP, { ...SNAP, checkOut: '2026-08-16' }), false);
  assert.equal(L.sameSelection(SNAP, { ...SNAP, key: 'B2' }), false);
  assert.equal(L.sameSelection(null, SNAP), false);
  assert.equal(L.sameSelection(SNAP, null), false);
});

test('priceResponseIsStale: fresh response for the current selection is NOT stale', () => {
  // reqId matches current, live selection === snapshot → paint it.
  assert.equal(L.priceResponseIsStale(SNAP, { ...SNAP }, 3, 3), false);
});

test('priceResponseIsStale: a newer request having fired makes an older one stale', () => {
  // Response captured reqId 2, but priceReqId has advanced to 3 → discard.
  assert.equal(L.priceResponseIsStale(SNAP, { ...SNAP }, 2, 3), true);
});

test('priceResponseIsStale: selection changed since the request → stale (cross-bungalow)', () => {
  // Same reqId, but the guest moved to B2 / a different range before it resolved.
  const live = { key: 'B2', checkIn: '2026-09-01', checkOut: '2026-09-06' };
  assert.equal(L.priceResponseIsStale(live, SNAP, 5, 5), true);
});

test('priceResponseIsStale: selection cleared (deselect) → stale', () => {
  assert.equal(L.priceResponseIsStale(null, SNAP, 4, 4), true);
});

// ── contiguity walk ─────────────────────────────────────────────────────────

test('isRangeContiguous: all-free range is contiguous', () => {
  const unavailable = new Set();
  assert.equal(L.isRangeContiguous('2026-08-10', '2026-08-15', unavailable, TODAY), true);
});

test('isRangeContiguous: a booked interior night breaks it', () => {
  // Jun 4–9 booked; Jun 1 → Jun 11 spans the gap → rejected.
  const unavailable = new Set(['2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09']);
  assert.equal(L.isRangeContiguous('2026-06-01', '2026-06-11', unavailable, TODAY), false);
});

test('isRangeContiguous: checkout day itself may be booked (departure, not a night)', () => {
  // Nights Aug 10..14 are free; Aug 15 (checkout) being booked must NOT reject.
  const unavailable = new Set(['2026-08-15']);
  assert.equal(L.isRangeContiguous('2026-08-10', '2026-08-15', unavailable, TODAY), true);
});

test('isRangeContiguous: an off-season night breaks it', () => {
  // Sep 28 → Oct 3 crosses into off-season (Oct) nights.
  const unavailable = new Set();
  assert.equal(L.isRangeContiguous('2026-09-28', '2026-10-03', unavailable, TODAY), false);
});

test('isRangeContiguous: a past night breaks it', () => {
  const today = new Date(2026, 7, 12); // Aug 12
  assert.equal(L.isRangeContiguous('2026-08-10', '2026-08-16', new Set(), today), false);
});

// ── verdict table ────────────────────────────────────────────────────────────

test('evaluateSelection: incomplete when no check-out', () => {
  const v = L.evaluateSelection({ key: 'B1', checkIn: '2026-08-10', checkOut: null }, new Set(), TODAY);
  assert.equal(v.kind, 'incomplete');
});

test('evaluateSelection: valid ≥5-night contiguous range → nights, NO price', () => {
  const v = L.evaluateSelection({ key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-15' }, new Set(), TODAY);
  assert.equal(v.kind, 'valid');
  assert.equal(v.nights, 5);
  // The price is now fetched from the Worker's /price endpoint; the pure
  // verdict must NOT carry a client-computed price.
  assert.equal('price' in v, false);
});

test('evaluateSelection: 4-night range → tooShort (no price)', () => {
  const v = L.evaluateSelection({ key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-14' }, new Set(), TODAY);
  assert.equal(v.kind, 'tooShort');
  assert.equal(v.nights, 4);
});

test('evaluateSelection: gap-crossing range → invalid', () => {
  const unavailable = new Set(['2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09']);
  const v = L.evaluateSelection({ key: 'B1', checkIn: '2026-06-01', checkOut: '2026-06-11' }, unavailable, TODAY);
  assert.equal(v.kind, 'invalid');
});

// ── firstAvailableBungalow (home-dock deep-link resolver) ────────────────────
// Given the three bungalows' booked-night sets + a candidate range, return the
// first hosting bungalow (B1→B2→B3) or null. Folds in the 5-night minimum that
// the /stay/ calendars enforce but the home dock does not.

const KO = ['B1', 'B2', 'B3'];
const boarded = (b1 = [], b2 = [], b3 = []) =>
  new Map([['B1', new Set(b1)], ['B2', new Set(b2)], ['B3', new Set(b3)]]);

test('firstAvailableBungalow: all three free → B1 (numeric order)', () => {
  const key = L.firstAvailableBungalow(boarded(), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, 'B1');
});

test('firstAvailableBungalow: B1+B3 free, B2 booked mid-range → B1 (order)', () => {
  const b2 = ['2026-08-12']; // a night inside the range
  const key = L.firstAvailableBungalow(boarded([], b2, []), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, 'B1');
});

test('firstAvailableBungalow: only B2 free (B1+B3 booked mid-range) → B2', () => {
  const booked = ['2026-08-12'];
  const key = L.firstAvailableBungalow(boarded(booked, [], booked), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, 'B2');
});

test('firstAvailableBungalow: none free (all booked mid-range) → null', () => {
  const booked = ['2026-08-12'];
  const key = L.firstAvailableBungalow(boarded(booked, booked, booked), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, null);
});

test('firstAvailableBungalow: contiguous but <5 nights → null even when all free', () => {
  // Aug 10 → Aug 13 = 3 nights; every bungalow free, but under the minimum.
  const key = L.firstAvailableBungalow(boarded(), '2026-08-10', '2026-08-13', TODAY, KO);
  assert.equal(key, null);
});

test('firstAvailableBungalow: gap-crossing for B1, clean for B2 → B2', () => {
  // B1 has Aug 4–9 booked; range Aug 1 → Aug 11 spans the gap (invalid for B1),
  // B2 is free → B2.
  const b1 = ['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
  const key = L.firstAvailableBungalow(boarded(b1, [], []), '2026-08-01', '2026-08-11', TODAY, KO);
  assert.equal(key, 'B2');
});

test('firstAvailableBungalow: checkout day booked is fine (departure, not a night)', () => {
  // Aug 15 (the checkout) booked for B1, nights Aug 10..14 free → still B1.
  const key = L.firstAvailableBungalow(boarded(['2026-08-15'], [], []), '2026-08-10', '2026-08-15', TODAY, KO);
  assert.equal(key, 'B1');
});

test('firstAvailableBungalow: default keyOrder resolves B1→B2→B3', () => {
  // Omit the explicit keyOrder → uses the exported KEY_ORDER default.
  const key = L.firstAvailableBungalow(boarded(['2026-08-12'], [], []), '2026-08-10', '2026-08-15', TODAY);
  assert.equal(key, 'B2');
});

// ── isBookableDockDate (home-dock ?checkin/?checkout gate) ───────────────────
// Pure date-acceptance rule extracted from the DOM handler. TODAY here is Jan 1
// 2026, so the August/September dates below are all comfortably in the future.

test('isBookableDockDate: a real, future, in-season date is accepted', () => {
  const d = L.isBookableDockDate('2026-08-10', TODAY);
  assert.ok(d instanceof Date);
  assert.equal(d.getMonth(), 7); // August (0-indexed)
  assert.equal(d.getDate(), 10);
});

test('isBookableDockDate: wrong shape → null', () => {
  assert.equal(L.isBookableDockDate('nope', TODAY), null);
  assert.equal(L.isBookableDockDate('2026-8-10', TODAY), null); // not zero-padded
  assert.equal(L.isBookableDockDate('', TODAY), null);
  assert.equal(L.isBookableDockDate(null, TODAY), null);
});

test('isBookableDockDate: rolled-over calendar date → null (the 2026-08-32 bug)', () => {
  // parseIso('2026-08-32') rolls to Sep 1 (not NaN). The toIso round-trip must
  // reject it so we never auto-select a date the guest never picked.
  assert.equal(L.isBookableDockDate('2026-08-32', TODAY), null);
  assert.equal(L.isBookableDockDate('2026-13-01', TODAY), null); // month 13 → next year
  assert.equal(L.isBookableDockDate('2026-02-30', TODAY), null); // Feb 30 → March
});

test('isBookableDockDate: past date → null', () => {
  const today = new Date(2026, 7, 15); // Aug 15 2026
  assert.equal(L.isBookableDockDate('2026-08-10', today), null); // before today
  assert.ok(L.isBookableDockDate('2026-08-20', today)); // after today is fine
});

test('isBookableDockDate: off-season date → null', () => {
  assert.equal(L.isBookableDockDate('2026-10-15', TODAY), null); // October = off-season
  assert.equal(L.isBookableDockDate('2026-01-15', TODAY), null); // January = off-season
});

test('isBookableDockDate: checkout on Sep 30 accepted, Oct 1 rejected (season departure rule)', () => {
  // The latest legal departure is Sep 30 — a guest cannot leave on Oct 1 (Oct is
  // off-season). Applied to the checkout endpoint too, by design.
  assert.ok(L.isBookableDockDate('2026-09-30', TODAY)); // last in-season day
  assert.equal(L.isBookableDockDate('2026-10-01', TODAY), null); // first off-season day
});

// ── per-day paint state ───────────────────────────────────────────────────────

test('dayState: endpoints and middle', () => {
  const sel = { key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-15' };
  assert.equal(L.dayState(sel, '2026-08-10'), 'start');
  assert.equal(L.dayState(sel, '2026-08-15'), 'end');
  assert.equal(L.dayState(sel, '2026-08-12'), 'mid');
  assert.equal(L.dayState(sel, '2026-08-09'), '');
  assert.equal(L.dayState(sel, '2026-08-20'), '');
});

test('dayState: no middle highlight before check-out is chosen', () => {
  const sel = { key: 'B1', checkIn: '2026-08-10', checkOut: null };
  assert.equal(L.dayState(sel, '2026-08-10'), 'start');
  assert.equal(L.dayState(sel, '2026-08-12'), '');
});

// ── gap-crossing 2nd click promotes to a new check-in ────────────────────────
// The click reducer is now an exported pure function — test its transitions
// directly (the previous version could only assert the guard in isolation).

const click = (key, iso, unavailable = new Set(), today = TODAY) => ({ key, iso, unavailable, today });

test('reduceClick: first click → fresh check-in', () => {
  const next = L.reduceClick(null, click('B1', '2026-08-10'));
  assert.deepEqual(next, { key: 'B1', checkIn: '2026-08-10', checkOut: null });
});

test('reduceClick: second later contiguous click → completes range', () => {
  const s1 = L.reduceClick(null, click('B1', '2026-08-10'));
  const s2 = L.reduceClick(s1, click('B1', '2026-08-16'));
  assert.deepEqual(s2, { key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-16' });
});

test('reduceClick: third click (both set) → resets to a fresh check-in', () => {
  const s2 = { key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-16' };
  const s3 = L.reduceClick(s2, click('B1', '2026-08-20'));
  assert.deepEqual(s3, { key: 'B1', checkIn: '2026-08-20', checkOut: null });
});

test('reduceClick: clicking a different bungalow clears and re-seeds there', () => {
  const s1 = { key: 'B1', checkIn: '2026-08-10', checkOut: null };
  const s2 = L.reduceClick(s1, click('B2', '2026-08-06'));
  assert.deepEqual(s2, { key: 'B2', checkIn: '2026-08-06', checkOut: null });
});

test('reduceClick: same day re-clicked → re-seed (no zero-night range)', () => {
  const s1 = { key: 'B1', checkIn: '2026-08-10', checkOut: null };
  const s2 = L.reduceClick(s1, click('B1', '2026-08-10'));
  assert.deepEqual(s2, { key: 'B1', checkIn: '2026-08-10', checkOut: null });
});

test('reduceClick: clicking earlier than check-in → that becomes the new check-in', () => {
  const s1 = { key: 'B1', checkIn: '2026-08-10', checkOut: null };
  const s2 = L.reduceClick(s1, click('B1', '2026-08-07'));
  assert.deepEqual(s2, { key: 'B1', checkIn: '2026-08-07', checkOut: null });
});

test('reduceClick: gap-crossing 2nd click → clicked date becomes new check-in', () => {
  // Aug 4–9 booked. Check-in Aug 1, then click Aug 11 → spans the gap → re-seed.
  const unavailable = new Set(['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
  const s1 = { key: 'B1', checkIn: '2026-08-01', checkOut: null };
  const s2 = L.reduceClick(s1, click('B1', '2026-08-11', unavailable));
  assert.deepEqual(s2, { key: 'B1', checkIn: '2026-08-11', checkOut: null });
});

// ── G2: a range valid at click time, invalidated once real bookings load ─────
// Guests can select before bookings.json resolves (empty unavailable = all
// contiguous). Once data lands, evaluateSelection must report 'invalid' so the
// UI layer promotes check-out → new check-in and warns (rather than silently
// keeping a now-illegal range).

test('post-load invalidation: contiguous-at-click range → invalid once bookings arrive', () => {
  // At click time the set was empty → range formed.
  const sel = { key: 'B1', checkIn: '2026-08-01', checkOut: '2026-08-11' };
  assert.equal(L.evaluateSelection(sel, new Set(), TODAY).kind, 'valid');
  // Bookings arrive: Aug 4–9 now booked → same range is invalid.
  const loaded = new Set(['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
  assert.equal(L.evaluateSelection(sel, loaded, TODAY).kind, 'invalid');
});

// ── pillPresentation: the pill's copy + disabled flag per state ──────────────
// Pure resolver used by the DOM writer (applyPillState) to decide the /stay/
// pill's label and whether it's clickable while POST /price is in flight.

test('pillPresentation: loading → spinner label, disabled (guest waits)', () => {
  assert.deepEqual(L.pillPresentation('loading'), {
    label: 'Pricing your stay…', disabled: true, priced: false,
  });
});

test('pillPresentation: priced → "…for X€", enabled, priced', () => {
  assert.deepEqual(L.pillPresentation('priced', 375), {
    label: 'Stay with us only for 375€', disabled: false, priced: true,
  });
});

test('pillPresentation: fallback → neutral clickable label, not priced', () => {
  assert.deepEqual(L.pillPresentation('fallback'), {
    label: 'Continue to enquire', disabled: false, priced: false,
  });
});

test('pillPresentation: priced with a non-finite/absent total degrades to fallback copy', () => {
  // A "priced" state that somehow lacks a real number must NOT render "…for X€"
  // with a blank/NaN — it falls through to the neutral clickable label, and is
  // NOT marked priced (so the href won't append ?price).
  for (const bad of [undefined, NaN, Infinity, '375', null]) {
    assert.deepEqual(L.pillPresentation('priced', bad), {
      label: 'Continue to enquire', disabled: false, priced: false,
    });
  }
});

test('pillPresentation: unknown state → safe clickable fallback', () => {
  assert.deepEqual(L.pillPresentation('bogus'), {
    label: 'Continue to enquire', disabled: false, priced: false,
  });
});

// ── applyPillState: the DOM writer (class / aria / spinner / href contract) ──
// applyPillState is sliced as a plain function; it uses `document.createElement`
// + `document.createTextNode` (loading branch only) and an injected enquiryHref.
// We give it a minimal fake pill + a tiny globalThis.document stub — no jsdom,
// matching the repo's zero-dependency test convention. This locks the exact
// class/aria/href contract the CSS (.stay-select__pill--loading / .stay-select__
// spinner) depends on, which the pure pillPresentation test can't cover.

function makePill() {
  const attrs = {};
  const classes = new Set();
  const children = [];
  return {
    _attrs: attrs, _children: children,
    href: undefined,
    textContent: '',
    set innerHTML(v) { if (v === '') children.length = 0; },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    appendChild: (n) => children.push(n),
    hasClass: (c) => classes.has(c),
  };
}

// Minimal document stub for the spinner span + text node the loading branch
// builds. Installed per-test (not at module scope) so it's present when the
// test BODY runs, and torn down after — Node runs test bodies after full module
// evaluation, so a module-level install+restore would restore before any body.
function withDocumentStub(run) {
  const orig = globalThis.document;
  globalThis.document = {
    createElement: () => {
      const a = {};
      return { className: '', setAttribute: (k, v) => { a[k] = v; }, getAttribute: (k) => a[k] ?? null };
    },
    createTextNode: (t) => ({ _text: t }),
  };
  try { run(); } finally { globalThis.document = orig; }
}

// A stub enquiryHref matching the real one's shape: appends &price only when a
// finite positive number is passed.
const stubHref = (snap, price) => {
  const base = `../enquiries/?checkin=${snap.checkIn}&checkout=${snap.checkOut}`;
  return (typeof price === 'number' && Number.isFinite(price) && price > 0)
    ? `${base}&price=${price}` : base;
};
const SNAPSHOT = { key: 'B1', checkIn: '2026-08-10', checkOut: '2026-08-15' };

test('applyPillState loading: --loading class, aria-disabled/busy, spinner span, NO href', () => {
  withDocumentStub(() => {
    const pill = makePill();
    pill.href = '../enquiries/?stale'; // ensure a prior href is cleared
    L.applyPillState(pill, 'loading', SNAPSHOT, undefined, stubHref);
    assert.equal(pill.hasClass('stay-select__pill--loading'), true);
    assert.equal(pill.getAttribute('aria-disabled'), 'true');
    assert.equal(pill.getAttribute('aria-busy'), 'true');
    assert.equal('href' in pill._attrs, false); // href attribute removed
    // One spinner span + one text node child.
    const spinner = pill._children.find((c) => c.className === 'stay-select__spinner');
    assert.ok(spinner, 'spinner span appended');
    assert.equal(spinner.getAttribute('aria-hidden'), 'true');
    assert.ok(pill._children.some((c) => c._text === 'Pricing your stay…'), 'label text node appended');
  });
});

test('applyPillState priced: enabled, "…only for X€", href carries ?price', () => {
  const pill = makePill();
  // Pre-set the loading flags to confirm they get cleared.
  pill.classList.add('stay-select__pill--loading');
  pill.setAttribute('aria-disabled', 'true');
  pill.setAttribute('aria-busy', 'true');
  L.applyPillState(pill, 'priced', SNAPSHOT, 375, stubHref);
  assert.equal(pill.hasClass('stay-select__pill--loading'), false);
  assert.equal(pill.getAttribute('aria-disabled'), null);
  assert.equal(pill.getAttribute('aria-busy'), null);
  assert.equal(pill.textContent, 'Stay with us only for 375€');
  assert.match(pill.href, /&price=375\b/);
});

test('applyPillState fallback: enabled, "Continue to enquire", href WITHOUT ?price', () => {
  const pill = makePill();
  L.applyPillState(pill, 'fallback', SNAPSHOT, undefined, stubHref);
  assert.equal(pill.hasClass('stay-select__pill--loading'), false);
  assert.equal(pill.getAttribute('aria-disabled'), null);
  assert.equal(pill.textContent, 'Continue to enquire');
  assert.ok(pill.href && !/price=/.test(pill.href), `href has no price: ${pill.href}`);
});

test('applyPillState priced with a non-finite total: degrades to fallback, no ?price', () => {
  const pill = makePill();
  L.applyPillState(pill, 'priced', SNAPSHOT, NaN, stubHref);
  assert.equal(pill.textContent, 'Continue to enquire');
  assert.ok(!/price=/.test(pill.href), `no NaN price leaked: ${pill.href}`);
});

// ── isRetryablePriceStatus: only 5xx is a transient /price failure ───────────

test('isRetryablePriceStatus: 5xx → retryable', () => {
  for (const s of [500, 502, 503, 599]) {
    assert.equal(L.isRetryablePriceStatus(s), true, `${s} should retry`);
  }
});

test('isRetryablePriceStatus: 4xx / 2xx / bogus → NOT retryable', () => {
  for (const s of [200, 400, 404, 415, 429, 300, 600, 0, undefined, null, '502']) {
    assert.equal(L.isRetryablePriceStatus(s), false, `${s} should NOT retry`);
  }
});

// ── shouldRetryAttempt: the 1-based attempt-count / give-up decision ─────────

test('shouldRetryAttempt: with max 3, retries after attempts 1 and 2, gives up at 3', () => {
  assert.equal(L.shouldRetryAttempt(1, 3), true);  // → schedule attempt 2
  assert.equal(L.shouldRetryAttempt(2, 3), true);  // → schedule attempt 3
  assert.equal(L.shouldRetryAttempt(3, 3), false); // 3 fetches done → give up, no 4th
});

test('shouldRetryAttempt: max 1 = no retries at all (single attempt)', () => {
  assert.equal(L.shouldRetryAttempt(1, 1), false);
});
