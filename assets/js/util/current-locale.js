// Read the emit-locale for this page from <html lang>, which the i18n
// plugin stamps at build time (see scripts/i18n-plugin.js applyHead —
// <html lang="en"> on the default emit, <html lang="bg"> on the mirror).
//
// Falls back to a default when the attribute is missing, invalid, or
// something has stripped it — module callers should treat the return
// as a best-effort locale key, not a source-of-truth.
//
// Used by:
//   - assets/js/booking.js — flatpickr locale swap
//   - assets/js/enquiry.js — flatpickr locale swap + Turnstile language + Worker locale param
//
// The DEFAULT_LOCALE constant here is a bare literal to keep this file
// dependency-free (loaded by the earliest JS on the page). If the site's
// default locale ever changes, update this file AND the plugin's
// contextByLocale / defaultLocale config in vite.config.js.
const DEFAULT_LOCALE = 'en';
const KNOWN_LOCALES = new Set(['en', 'bg']);

export function currentLocale() {
  const htmlLang = (document.documentElement.getAttribute('lang') || '').trim();
  // Accept only known locales — a stray `lang="fr"` (mis-copied template,
  // browser extension mutation, future in-progress translation) should
  // not silently downgrade later locale-aware behavior. Fall back to the
  // default and let the caller decide whether to warn.
  if (KNOWN_LOCALES.has(htmlLang)) return htmlLang;
  return DEFAULT_LOCALE;
}

// Whether the current page is the DEFAULT locale (EN in production).
// Useful for the "should we prefix the URL with /bg/?" decision.
export function isDefaultLocale() {
  return currentLocale() === DEFAULT_LOCALE;
}
