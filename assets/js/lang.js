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
//   3. Warning ONCE when the pill is EXPECTED but missing on this page. The
//      plugin stamps <html data-lang-pill-expected="1"> only when the source
//      has a .site-header__lang, so we can distinguish "real regression on a
//      page that should have a pill" from "legit no-pill page". Warns are
//      suppressed after the first invocation so React-strict-mode / HMR /
//      dynamic-mount retries don't flood the console.
//   4. Bailing when the boot-redirect is still in flight — the plugin sets
//      <html data-i18n-redirecting="1"> before location.replace(). We CLEAR
//      the sentinel on entry: if the boot script stamped it but the redirect
//      failed silently (offline, CSP nav block, popup interference, user
//      hit Stop), we would otherwise be stuck with a dead pill forever. By
//      the time this module runs (DOMContentLoaded), the destination page
//      has committed and lang.js on THIS page owns the flag.
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
const REDIRECT_FLAG = 'data-i18n-redirecting';
const PILL_EXPECTED_FLAG = 'data-lang-pill-expected';
const INIT_FLAG = 'data-lang-init';

// One-shot warn dedup keyed on the specific message string. Suppresses noisy
// re-warn on React-strict-mode double invocation, HMR retries, and dynamic
// mounts — the sentinel-not-stamped-on-early-return design (Round 1 F3)
// intentionally lets initLang() retry, but the operator only needs to see
// the diagnostic once per session.
const warnedOnce = new Set();
function warnOnce(msg) {
  if (warnedOnce.has(msg)) return;
  warnedOnce.add(msg);
  if (console && console.warn) console.warn(msg);
}

// Test-only reset — the runtime module exposes this so unit tests can
// exercise repeat-warn behavior without cross-contaminating between cases.
// No production code path calls it.
export function __resetWarnOnceForTests() {
  warnedOnce.clear();
}

export function initLang() {
  const html = document.documentElement;

  // Idempotency — future HMR / re-init must not stack listeners. Guard is
  // stamped LATE (after successful wiring) so an early-return path can be
  // retried by a legitimate re-init. Stamping early would poison the guard.
  if (html.getAttribute(INIT_FLAG) === '1') return;

  // Redirect-in-flight guard.
  //
  // The plugin's inline boot script sets data-i18n-redirecting="1" before
  // location.replace(). If lang.js runs before the browser has committed
  // the redirect, wiring click handlers would let a tap-during-flight
  // enqueue a second navigation. But we ALSO have to guard against a
  // stuck-in-flight state — location.replace() can fail silently (offline
  // + no cache, CSP navigation block, user hits Stop, popup-blocker
  // interference). If we bailed on every subsequent init we'd ship a dead
  // pill on those pages forever.
  //
  // Trade-off: we CLEAR the flag on entry. If the redirect succeeded,
  // this module is running on the DESTINATION page (its own <html> has
  // the flag only because the source-page HTML was cached and served
  // stale — vanishingly rare). If the redirect failed, this module is
  // running on the SOURCE page and clearing the flag restores the pill.
  // In both cases, clearing is correct: the boot script only reads the
  // flag through document.currentScript context which no longer exists
  // by the time we run.
  if (html.getAttribute(REDIRECT_FLAG) === '1') {
    html.removeAttribute(REDIRECT_FLAG);
    // Continue with wiring — the redirect is either resolved (destination
    // page) or dead (source page with a failed replace()).
  }

  const pill = document.querySelector(PILL_SELECTOR);
  if (!pill) {
    // The plugin stamps data-lang-pill-expected="1" ONLY on pages whose
    // source contains a .site-header__lang. Warn only when the marker
    // said the pill should be here — a legit no-pill page (currently every
    // sub-page except home) must stay silent to avoid drowning the signal
    // in noise.
    if (html.getAttribute(PILL_EXPECTED_FLAG) === '1') {
      warnOnce('[lang] data-lang-pill-expected="1" but .site-header__lang not found.');
    }
    return;
  }

  const segments = pill.querySelectorAll(SEG_SELECTOR);
  if (segments.length === 0) {
    // Same class of regression as a missing pill container — an author
    // edited the pill markup and shipped an empty role="group". Warn once
    // per session so the dev sees it in HMR/strict-mode too.
    warnOnce('[lang] .site-header__lang has no .site-header__lang-seg children.');
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
  html.setAttribute(INIT_FLAG, '1');
}

// A segment is active if EITHER signal says so. Two-source-of-truth is
// belt-and-braces: the plugin's applyHead sets both atomically at build
// time; the OR keeps us robust to any partial-marker edit at runtime.
function isActiveSeg(seg) {
  return seg.classList.contains('is-active')
    || seg.getAttribute('aria-current') === 'true';
}
