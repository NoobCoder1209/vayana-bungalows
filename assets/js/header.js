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
// Window between taps: 5s (resets on blur, outside-tap, or timeout).
function initCallTwoTap() {
  const call = document.querySelector('[data-call-cta]');
  if (!call) return;

  // Hover-capable pointers (desktop mouse) get the CSS :hover reveal — no JS
  // intercept. Coarse pointers (touch) need the two-tap gate.
  // matchMedia covers iPad-with-mouse / Surface where coarse may also be true;
  // we treat "any-hover: none" + "any-pointer: coarse" as the touch case.
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

  // Tap anywhere else, or focus moves away → collapse.
  document.addEventListener('click', (e) => {
    if (!call.classList.contains('is-revealed')) return;
    if (call.contains(e.target)) return;
    reset();
  });

  call.addEventListener('blur', reset);
}
