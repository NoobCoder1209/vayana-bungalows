// Runtime language pill wiring (issue #47).
//
// What this module owns:
//   1. Setting per-segment aria-labels from the four orphan-by-design keys
//      (lang_<code>_current_aria for the active segment, lang_switch_to_<other>_aria
//      for the inactive one). The plugin bakes both strings onto each segment
//      via data-aria-current + data-aria-switch — this module just picks
//      which one to promote to aria-label based on the segment's is-active state.
//   2. Click handlers: active segment is a no-op (preventDefault, don't reload),
//      inactive segment persists localStorage['vb.lang'] then lets the browser
//      follow the href to the mirror page. The boot-redirect script (emitted
//      by the plugin) reads that same key on future visits to auto-jump.
//   3. Warning when the pill is EXPECTED but missing on this page. The plugin
//      stamps <html data-lang-pill-expected="1"> only when the source has a
//      .site-header__lang, so we can distinguish "real regression on a page
//      that should have a pill" from "legit no-pill page that just doesn't
//      have one" (currently only the home page has the pill).
//   4. Bailing when the boot-redirect is still in flight — the plugin sets
//      <html data-i18n-redirecting="1"> before location.replace(). Between
//      that write and the navigation actually committing, DOMContentLoaded
//      can fire; if the user click lands during that window we would stack
//      a second navigation. Skip wiring so the browser finishes the redirect.
//
// What this module does NOT own:
//   - Client-side dictionary swaps. This is a build-time i18n stack: EN lives
//     at root, BG at /bg/. A language change is a navigation, not a string swap.
//   - localStorage read-and-redirect on load. That's the plugin's inline
//     <script data-locale> block, which runs at <head> parse (BEFORE this
//     module) so it can location.replace() without a flash. lang.js only
//     WRITES the key on click; the inline script READS it next visit.

import { isPrimaryClick } from './util/is-primary-click.js';

const STORAGE_KEY = 'vb.lang';
const PILL_SELECTOR = '.site-header__lang';
const SEG_SELECTOR = '.site-header__lang-seg';

export function initLang() {
  const html = document.documentElement;

  // Idempotency — future HMR / re-init must not stack listeners. Guard is
  // stamped LATE (after successful wiring) so an early-return path can be
  // retried by a legitimate re-init. Stamping early would poison the guard.
  if (html.dataset.langInit === '1') return;

  // Bail if the boot-redirect is still in flight. The plugin's inline script
  // sets this before location.replace(); wiring click handlers now would let
  // a user tap-during-flight enqueue a second navigation and toggle the
  // stored preference between the boot's write and ours.
  if (html.getAttribute('data-i18n-redirecting') === '1') return;

  const pill = document.querySelector(PILL_SELECTOR);
  if (!pill) {
    // The plugin stamps data-lang-pill-expected="1" ONLY on pages whose
    // source contains a .site-header__lang. Warn only when the marker
    // said the pill should be here — a legit no-pill page (currently every
    // sub-page except home) must stay silent to avoid drowning the signal
    // in noise.
    if (html.getAttribute('data-lang-pill-expected') === '1' && console && console.warn) {
      console.warn('[lang] data-lang-pill-expected="1" but .site-header__lang not found.');
    }
    return;
  }

  const segments = pill.querySelectorAll(SEG_SELECTOR);
  if (segments.length === 0) {
    // Same class of regression as a missing pill container — an author
    // edited the pill markup and shipped an empty role="group". Warn so
    // the dev sees it; HTML validity alone won't catch this.
    if (console && console.warn) {
      console.warn('[lang] .site-header__lang has no .site-header__lang-seg children.');
    }
    return;
  }

  // Derive the valid-locale set from the segments themselves so adding a
  // third locale (a future locales/de.json + a third <a data-lang="de">)
  // works without touching this file. Filter falsy so a segment missing
  // data-lang doesn't add empty-string to the allowlist.
  const knownLangs = new Set(
    Array.from(segments)
      .map((seg) => seg.dataset.lang)
      .filter(Boolean),
  );

  // ── Aria wiring ────────────────────────────────────────────────────────
  // Each segment carries BOTH a "current" and a "switch" aria string. The
  // active one gets the "current" text, the inactive one gets "switch". We
  // read the pre-baked data-aria-* attributes (populated by the i18n plugin
  // from the four lang_*_aria orphan keys) and promote whichever fits the
  // segment's is-active state to aria-label. Falling back to existing
  // aria-label if either data-* is missing keeps a partial-marker page
  // from going silent (test in lang.test.mjs pins this behavior).
  segments.forEach((seg) => {
    const isActive = isActiveSeg(seg);
    const label = isActive ? seg.dataset.ariaCurrent : seg.dataset.ariaSwitch;
    if (label) seg.setAttribute('aria-label', label);
  });

  // ── Click handlers ─────────────────────────────────────────────────────
  segments.forEach((seg) => {
    seg.addEventListener('click', (e) => {
      // Active segment always wins over modifier-click semantics: a plain OR
      // cmd-click on the currently-active segment is a no-op. This
      // prevents cmd-clicking the active pill from opening a duplicate tab
      // of the current-locale page (a minor UX wart that reordering the
      // checks fixes).
      if (isActiveSeg(seg)) {
        e.preventDefault();
        return;
      }
      // Modifier / non-primary-button clicks open the target in a new tab.
      // Don't persist — the user's current tab hasn't switched locale.
      if (!isPrimaryClick(e)) return;

      const targetLang = seg.dataset.lang;
      // Persist the chosen locale BEFORE navigation so the destination
      // page's boot-redirect script sees the correct value. Best-effort:
      // private-mode storage exceptions are swallowed; navigation
      // proceeds either way.
      if (knownLangs.has(targetLang)) {
        try {
          localStorage.setItem(STORAGE_KEY, targetLang);
        } catch (err) {
          // localStorage denied (Safari private mode, quota, disabled
          // cookies). The boot script's own storage read is also try/wrapped.
        }
      }
      // Let default navigation run.
    });
  });

  // Stamp the guard AFTER successful wiring so a call that early-returned
  // can be retried by a re-init (HMR, dynamic mount) without silent no-op.
  html.dataset.langInit = '1';
}

// A segment is active if EITHER signal says so. Two-source-of-truth is
// belt-and-braces: the plugin's applyHead sets both atomically at build
// time; the OR keeps us robust to any partial-marker edit at runtime.
function isActiveSeg(seg) {
  return seg.classList.contains('is-active')
    || seg.getAttribute('aria-current') === 'true';
}
