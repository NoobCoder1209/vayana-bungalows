// Hero photo carousel — auto-rotates the .hero__slide images.
//
// Layout contract (assets/css/sections.css):
//   - .hero__slide default rest state: translateX(100% + gap) (offscreen right)
//   - .hero__slide.is-active:  translateX(0)           (on screen)
//   - .hero__slide.is-leaving: translateX(-100% - gap) (exiting left)
//
// Every HOLD_MS the current slide gets .is-leaving (slides out left) while the
// next gets .is-active (slides in from the right) — both animate together for
// SLIDE_MS, a filmstrip move with a thin white seam between them. After the
// slide settles, the outgoing slide drops .is-leaving so it snaps back to the
// default offscreen-right rest position, ready for its next turn. Loops
// infinitely over all slides.
//
// Guards: no-op when there's no [data-hero-carousel] (every page but home) or
// fewer than 2 slides. Honours prefers-reduced-motion (instant swap, no slide)
// and pauses while the tab is hidden so we don't churn offscreen work.

const HOLD_MS = 3000; // rest time each photo is fully shown
const SLIDE_MS = 800; // must match the transform transition in sections.css

export function initHeroCarousel() {
  const carousel = document.querySelector('[data-hero-carousel]');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('.hero__slide'));
  if (slides.length < 2) return; // nothing to rotate

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let current = slides.findIndex((s) => s.classList.contains('is-active'));
  if (current < 0) {
    current = 0;
    slides[0].classList.add('is-active');
  }

  let timer = null;

  const advance = () => {
    const outgoing = slides[current];
    const nextIndex = (current + 1) % slides.length;
    const incoming = slides[nextIndex];

    if (reduced) {
      // Instant swap — no filmstrip motion.
      outgoing.classList.remove('is-active');
      incoming.classList.add('is-active');
      current = nextIndex;
      return;
    }

    // Slide the outgoing photo out to the left and the incoming in from the
    // right. Both carry a transform transition, so they travel together.
    outgoing.classList.remove('is-active');
    outgoing.classList.add('is-leaving');
    incoming.classList.add('is-active');

    // Once the slide finishes leaving, snap it back to its offscreen-right
    // rest position WITHOUT animating (is-resetting kills the transition for
    // one frame), then drop that class next frame so its transition is live
    // again for its next turn. Doing the reset with the transition still on
    // would slide it left→right across the viewport — a stray motion most
    // visible at the 8→1 wrap. Timeout keyed to SLIDE_MS so a missed
    // transitionend can't strand it mid-screen.
    window.setTimeout(() => {
      outgoing.classList.add('is-resetting');
      outgoing.classList.remove('is-leaving');
      // Force a reflow so the no-transition reset is committed before we
      // re-enable transitions, then clear the reset flag next frame.
      void outgoing.offsetWidth;
      requestAnimationFrame(() => outgoing.classList.remove('is-resetting'));
    }, SLIDE_MS + 50);

    current = nextIndex;
  };

  const start = () => {
    if (timer) return;
    timer = window.setInterval(advance, HOLD_MS + (reduced ? 0 : SLIDE_MS));
  };
  const stop = () => {
    if (!timer) return;
    window.clearInterval(timer);
    timer = null;
  };

  // Pause the rotation while the tab is backgrounded; resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  start();
}
