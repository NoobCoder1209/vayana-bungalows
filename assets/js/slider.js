// Gallery slider.
//
// Two modes, split at the 769px breakpoint (matching the CSS + the arrow
// visibility):
//   - Mobile (<=768px): arrows are hidden and the track is a native
//     scroll-snap container (see sections.css) — touch-swipe scrolls it.
//     This module does nothing there.
//   - Desktop (>=769px): the track is a transform-driven stepper. prev/next
//     move exactly one card with the same animation every time, and the ends
//     wrap SEAMLESSLY: stepping past the last card slides the first in from
//     the right (and vice-versa) as a normal one-card slide — achieved by
//     rotating DOM items through the track so there is no first/last edge.
//
// Rooms and any arrowless [data-slider] are untouched (no prev/next → skipped).

const DESKTOP_MQ = '(min-width: 769px)';
const SLIDE_MS = 500; // must match the inline transition duration below

export function initSliders() {
  const tracks = document.querySelectorAll('[data-slider]');
  tracks.forEach((track) => {
    const name = track.dataset.slider;
    const prev = document.querySelector(`[data-slider-prev="${name}"]`);
    const next = document.querySelector(`[data-slider-next="${name}"]`);
    // Only arrow-driven sliders get stepper behaviour. Arrowless tracks
    // (e.g. the centered rooms row) are left entirely to CSS.
    if (!prev && !next) return;

    const items = () => Array.from(track.children);
    if (items().length < 2) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animating = false;

    // One card's advance distance: item width + the flex gap.
    const stepDistance = () => {
      const first = track.children[0];
      if (!first) return 0;
      const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 16;
      return first.getBoundingClientRect().width + gap;
    };

    const clearTransition = () => {
      track.style.transition = 'none';
      track.style.transform = 'translateX(0)';
      // Force a reflow so the instant reset commits before the next paint.
      void track.offsetWidth;
    };

    // next: slide the strip left by one card, then move the (now off-screen
    // left) first item to the end and snap transform back to 0 — visually
    // identical, runway refilled.
    const goNext = () => {
      if (animating) return;
      const d = stepDistance();
      if (reduced) {
        track.appendChild(track.children[0]);
        return;
      }
      animating = true;
      track.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      track.style.transform = `translateX(${-d}px)`;
      const done = () => {
        track.removeEventListener('transitionend', done);
        track.appendChild(track.children[0]);
        clearTransition();
        animating = false;
      };
      track.addEventListener('transitionend', done);
      window.setTimeout(() => { if (animating) done(); }, SLIDE_MS + 80);
    };

    // prev: mirror — move the last item to the front, jump the strip left by
    // one card instantly, then animate back to 0 so the new first card slides
    // in from the left.
    const goPrev = () => {
      if (animating) return;
      const d = stepDistance();
      if (reduced) {
        track.insertBefore(track.children[track.children.length - 1], track.children[0]);
        return;
      }
      animating = true;
      track.insertBefore(track.children[track.children.length - 1], track.children[0]);
      track.style.transition = 'none';
      track.style.transform = `translateX(${-d}px)`;
      void track.offsetWidth; // commit the instant offset
      track.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      track.style.transform = 'translateX(0)';
      const done = () => {
        track.removeEventListener('transitionend', done);
        track.style.transition = 'none';
        animating = false;
      };
      track.addEventListener('transitionend', done);
      window.setTimeout(() => { if (animating) done(); }, SLIDE_MS + 80);
    };

    // Enable/disable the stepper with the desktop media query. On mobile we
    // remove any inline transform so the native scroll container is clean.
    const mq = window.matchMedia(DESKTOP_MQ);
    let wired = false;
    const onPrev = () => goPrev();
    const onNext = () => goNext();

    const enable = () => {
      if (wired) return;
      prev?.addEventListener('click', onPrev);
      next?.addEventListener('click', onNext);
      wired = true;
    };
    const disable = () => {
      if (!wired) return;
      prev?.removeEventListener('click', onPrev);
      next?.removeEventListener('click', onNext);
      // Reset any inline transform/transition so the native-scroll mobile
      // layout is pristine.
      track.style.transition = '';
      track.style.transform = '';
      animating = false;
      wired = false;
    };

    const sync = () => (mq.matches ? enable() : disable());
    sync();
    mq.addEventListener('change', sync);
  });
}
