// Shared bookings-data access + date helpers.
//
// Both the (legacy) per-bungalow booking widget (booking.js) and the
// read-only availability calendars on /stay/ (availability-calendar.js)
// read the same bookings.json. Keeping the fetch + cache here means the
// page issues ONE network request no matter how many consumers there are,
// and the two date helpers live in a single place.

// Where bookings.json lives once Vite has applied the production base path.
// In dev: /assets/data/bookings.json
// In prod: /vayana-bungalows/assets/data/bookings.json
// The `?v=<build-id>` query is set at build time from VITE_BUILD_ID and
// rotates every deploy so Fastly's edge cache picks up the new file
// immediately instead of serving the previous deploy's bookings.json
// for up to its TTL.
const BUILD_ID = import.meta.env.VITE_BUILD_ID || 'dev';
const BOOKINGS_URL = `${import.meta.env.BASE_URL}assets/data/bookings.json?v=${BUILD_ID}`;

// Cache the bookings load so multiple calls in one page reuse the same fetch.
let bookingsPromise = null;

/**
 * Fetch bookings.json once and cache the promise. Every caller on the page
 * shares the same in-flight (or resolved) request. Resolves to the parsed
 * JSON, or `null` if the file is missing/malformed — callers must treat
 * null as "no availability data" and degrade gracefully rather than throw.
 */
export function loadBookings() {
  if (!bookingsPromise) {
    bookingsPromise = fetch(BOOKINGS_URL, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch((err) => {
        // Don't break the page if the file is missing or malformed — the
        // booking widget simply marks no dates as disabled, and the
        // availability calendars render every day as available. The user
        // falls back to submitting a request that we'll cross-check manually.
        console.warn('[bookings] could not load bookings.json:', err.message);
        return null;
      });
  }
  return bookingsPromise;
}

// Local-time YYYY-MM-DD. Using `.toISOString()` would shift the date back
// for UTC+ users (the bulk of our likely audience): a Date constructed at
// local midnight serialises as 22:00 UTC the previous day, so the slice(0,10)
// would produce the wrong key. Reservations in bookings.json are also keyed
// by local calendar date, so this stays in sync.
export const toIso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Convert a YYYY-MM-DD ISO string to a Date at local midnight. The booking
// widget passes these to flatpickr's `disable` array (flatpickr's string
// parsing is bound to the picker's dateFormat and can silently fail to match
// an ISO string); the availability calendar uses them for day comparisons.
// Date objects are unambiguous.
export const parseIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// Extract one bungalow's availability from the loaded bookings payload.
// Returns { unavailable:Set<iso>, checkIn:Set<iso> } — empty sets when the
// entry is missing or malformed, so consumers FAIL SAFE (booking widget marks
// nothing disabled; availability calendar renders everything available). The
// legacy array shape (a schema regression) is warned once and treated as
// empty. Both the booking widget (uses both sets) and the read-only calendar
// (uses `unavailable` only) call this — one parse + guard, one place.
export function availabilityFor(bookings, key) {
  const entry = bookings?.bungalows?.[key];
  if (Array.isArray(entry)) {
    console.warn(
      `[bookings] ${key}: bookings.json is in the legacy array shape; treating as empty.`,
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
