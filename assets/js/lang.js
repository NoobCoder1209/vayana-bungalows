// Runtime language pill wiring (issue #47).
//
// What this module owns:
//   1. Reading the emit locale from <html lang> (plugin stamps it) with the
//      inline <script data-locale> block as a fallback.
//   2. Setting per-segment aria-labels from the four orphan-by-design keys
//      (lang_<code>_current_aria for the active segment, lang_switch_to_<other>_aria
//      for the inactive one). The plugin bakes both strings onto each segment
//      via data-aria-current + data-aria-switch — this module just picks
//      which one to promote to aria-label based on the segment's is-active state.
//   3. Click handlers: active segment is a no-op (already here), inactive
//      segment persists localStorage['vb.lang'] then lets the browser follow
//      the href to the mirror page. The boot-redirect script (emitted by the
//      plugin) reads that same key on future visits to auto-jump.
//   4. Warning when the pill is missing on pages that should have one — a
//      silent regression on a page that dropped the marker is the exact class
//      of bug an i18n rollout leaks.
//
// What this module does NOT own:
//   - Client-side dictionary swaps. This is a build-time i18n stack: EN lives
//     at root, BG at /bg/. There is no in-page string swap — a language change
//     is a navigation.
//   - localStorage read-and-redirect on load. That's the plugin's inline
//     <script data-locale> block, which runs BEFORE this module (before parse
//     of the main JS bundle) so it can location.replace() without a flash.
//     lang.js only WRITES the key; the inline script READS it next visit.
//   - Bailing when data-i18n-redirecting="1" is set on <html>. That attribute
//     is set by the boot script while location.replace() is in flight; if
//     we're running at all, the redirect already resolved and the current
//     page IS the destination, so wiring the pill is correct.

const STORAGE_KEY = 'vb.lang';
const LOCALES = ['en', 'bg'];

export function initLang() {
  // Idempotency — future HMR / re-init must not stack listeners.
  if (document.documentElement.dataset.langInit === '1') return;
  document.documentElement.dataset.langInit = '1';

  const pill = document.querySelector('.site-header__lang');
  if (!pill) {
    // A page that dropped the pill by accident is a real regression: BG
    // navigation becomes unreachable on that page. Warn once so an author
    // running the dev build sees it in the console. Not throwing — a
    // legitimately no-pill page (a legal iframe embed, a partial preview)
    // shouldn't break the rest of the JS bundle.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[lang] .site-header__lang not found on this page.');
    }
    return;
  }

  const segments = pill.querySelectorAll('.site-header__lang-seg');
  if (segments.length === 0) return;

  // ── Aria wiring ────────────────────────────────────────────────────────
  // Each segment carries BOTH a "current" and a "switch" aria string. The
  // active one gets the "current" text, the inactive one gets "switch". We
  // read the pre-baked data-aria-* attributes (populated by the i18n plugin
  // from the four lang_*_aria orphan keys) and promote whichever fits the
  // segment's is-active state to aria-label. Falling back to existing
  // aria-label if either data-* is missing keeps a partial-marker page
  // from going silent.
  segments.forEach((seg) => {
    const isActive = seg.classList.contains('is-active')
      || seg.getAttribute('aria-current') === 'true';
    const current = seg.dataset.ariaCurrent;
    const switchTo = seg.dataset.ariaSwitch;
    const label = isActive ? current : switchTo;
    if (label) seg.setAttribute('aria-label', label);
  });

  // ── Click handlers ─────────────────────────────────────────────────────
  segments.forEach((seg) => {
    seg.addEventListener('click', (e) => {
      // Modifier / non-primary-button clicks open in a new tab. Don't
      // prevent, don't persist — the user's current tab hasn't switched.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== undefined && e.button !== 0) return;

      const targetLang = seg.dataset.lang;
      const isActive = seg.classList.contains('is-active')
        || seg.getAttribute('aria-current') === 'true';

      if (isActive) {
        // Clicking the already-active segment is a no-op — don't reload
        // the current page just to end up in the same place.
        e.preventDefault();
        return;
      }

      // Persist the chosen locale BEFORE navigation so the destination page's
      // boot-redirect script (if it runs before the URL resolves — cached
      // redirect chains) sees the correct value. Best-effort: private-mode
      // storage exceptions are swallowed by the try/catch. The href points
      // at the correct mirror, so the navigation succeeds either way.
      if (targetLang && LOCALES.indexOf(targetLang) !== -1) {
        try {
          localStorage.setItem(STORAGE_KEY, targetLang);
        } catch (err) {
          // localStorage denied (Safari private mode, quota, disabled
          // cookies). Navigation still proceeds — the boot script's own
          // storage read is also try/wrapped.
        }
      }
      // Let default navigation run.
    });
  });
}
