// Sticky header — toggle .is-scrolled when the sentinel leaves the viewport.
// Also owns the mobile two-tap dance for the Call-me-back link (#7): on a
// touch device, the first tap reveals the number (matches the desktop hover
// state) and the second tap dials. Keeps the markup as a real <a href="tel:...">
// so JS-disabled / right-click / keyboard all keep working — we only intercept
// the FIRST tap on coarse pointers.
//
// The hamburger drawer (panel + click handler + aria-expanded wiring) ships
// in #3 — this file does not own it yet.
export function initHeader() {
  const header = document.getElementById('site-header');
  const sentinel = document.getElementById('header-sentinel');
  if (header && sentinel) {
    const io = new IntersectionObserver(
      ([entry]) => {
        header.classList.toggle('is-scrolled', !entry.isIntersecting);
      },
      { threshold: 0 }
    );
    io.observe(sentinel);
  }

  initCallTwoTap();
}

// Two-tap state machine for .site-header__call on touch devices.
// Window between taps: 5s (resets on outside-tap or timeout — `blur` doesn't
// reliably fire on `<a>` taps in mobile Safari, so we don't lean on it).
function initCallTwoTap() {
  const call = document.querySelector('[data-call-cta]');
  if (!call) return;
  // Idempotency guard — a second initHeader() (HMR, re-init, future SPA-style
  // route change) must not stack a second click handler / document listener.
  if (call.dataset.twoTapInit === '1') return;
  call.dataset.twoTapInit = '1';

  // Hover-capable pointers (desktop mouse) get the CSS :hover reveal — no JS
  // intercept. We gate on the PRIMARY pointer being coarse + non-hovering so
  // that hybrid devices (iPad with trackpad, Surface, a Windows laptop with a
  // touchscreen) keep the desktop CSS-hover path: their primary pointer is
  // fine, the first mouse-click dials directly, and CSS :hover handles the
  // reveal. The trade-off is that on those hybrids, if the user reaches up
  // and taps the screen, the very first tap will dial (no two-tap gate).
  // That's a minor wart on a niche platform; preventing the regression on
  // mouse-driven hybrids matters more.
  const isTouch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!isTouch) return;

  const REVEAL_TIMEOUT_MS = 5000;
  let resetTimer = null;

  const reset = () => {
    call.classList.remove('is-revealed');
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  };

  call.addEventListener('click', (e) => {
    // Treat keyboard activation (Enter / Space on a focused link, which the
    // browser also dispatches as a click) as a direct dial — the user can
    // already see the number via :focus-visible's reveal, so the "first
    // press shows the number" half of the two-tap gate would just be an
    // extra keystroke they don't need.
    if (call.matches(':focus-visible')) {
      reset();
      return;
    }
    if (call.classList.contains('is-revealed')) {
      // Second tap — let the browser follow the tel: href.
      reset();
      return;
    }
    // First tap — reveal the number, don't dial.
    e.preventDefault();
    call.classList.add('is-revealed');
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(reset, REVEAL_TIMEOUT_MS);
  });

  // Tap anywhere else → collapse.
  document.addEventListener('click', (e) => {
    if (!call.classList.contains('is-revealed')) return;
    if (call.contains(e.target)) return;
    reset();
  });
}
