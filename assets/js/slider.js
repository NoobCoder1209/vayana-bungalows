// Gallery slider.
//
// Two modes, split by INPUT CAPABILITY (not screen width — width was the old
// proxy for "desktop = mouse", which wrongly put wide tablets in arrows-only
// mode). The split matches the CSS in sections.css exactly so layout and JS
// never desync:
//   - Pure-mouse (bucket A: hover + fine pointer, no touch digitizer):
//     the track is a transform-driven stepper. prev/next move exactly one card
//     with the same animation every time, and the ends wrap SEAMLESSLY by
//     rotating DOM items through the track so there is no first/last edge.
//   - Touch-capable (buckets B & C: tablets, phones, touch-laptops): the track
//     is a native scroll-snap container (see sections.css) — touch-swipe scrolls
//     it at any width. Where arrows are also shown (touch-laptops), they drive
//     native scrollBy-by-one-card (scrollNext/scrollPrev) instead of the
//     transform stepper — the two are mutually exclusive on one track. Arrows
//     are hidden on pure-touch (phones/tablets) via CSS; there swipe is the only
//     control.
//
// Rooms and any arrowless [data-slider] are untouched (no prev/next → skipped).

// "Pure mouse" — the ONLY case that gets the transform stepper. Everything else
// (any touch digitizer present) uses native scroll so swipe works. Kept
// byte-identical to the stepper @media condition in sections.css.
const STEPPER_MQ = '(hover: hover) and (pointer: fine) and (not (any-pointer: coarse))';
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

    // Read prefers-reduced-motion LIVE on each use (not cached at init) so a
    // mid-session OS toggle is honoured — the module has no separate listener
    // for the reduced-motion query.
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      if (reduced()) {
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
      if (reduced()) {
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

    // Native-scroll arrow handlers (buckets B & C). The track is a real
    // scroll-snap container here, so scrollBy by one card lands on a snapped
    // slide automatically. We only WRAP (jump to the other extreme) once the
    // track is ALREADY pinned at an edge and a further step would reveal
    // nothing new — never mid-strip.
    //
    // Padding matters: the home gallery track has side padding
    // (`padding: 0 var(--container-pad)`), so the resting scrollLeft at the
    // FIRST card is the first child's offsetLeft (~32px), NOT 0 — and the
    // bungalow tracks (padding:0) rest at 0. So the start edge is
    // `firstChild.offsetLeft`, not a hardcoded 0, and the wrap-to-start target
    // is that same value. maxScroll (scrollWidth - clientWidth) is the true
    // right-most position and already accounts for how many cards are visible,
    // so multi-card galleries don't wrap early. Tolerance is half a card so
    // snap-settling near an edge is still detected.
    const minScroll = () => track.children[0]?.offsetLeft || 0;
    const maxScroll = () => track.scrollWidth - track.clientWidth;
    const edgeTol = () => Math.max(2, stepDistance() / 2);
    const scrollBehavior = () => (reduced() ? 'auto' : 'smooth');
    const scrollNext = () => {
      if (track.scrollLeft >= maxScroll() - edgeTol()) {
        track.scrollTo({ left: minScroll(), behavior: scrollBehavior() }); // wrap to start
      } else {
        track.scrollBy({ left: stepDistance(), behavior: scrollBehavior() });
      }
    };
    const scrollPrev = () => {
      if (track.scrollLeft <= minScroll() + edgeTol()) {
        track.scrollTo({ left: maxScroll(), behavior: scrollBehavior() }); // wrap to end
      } else {
        track.scrollBy({ left: -stepDistance(), behavior: scrollBehavior() });
      }
    };

    // The arrow handlers are wired ONCE and self-branch on the live mode: in
    // pure-mouse (stepper) mode they run the transform stepper; otherwise they
    // drive native scroll. Reading mq.matches per click keeps them correct
    // across mode changes (plugging a mouse, DevTools device emulation) with no
    // rebinding. Arrows may be hidden by CSS (bucket B) — then they simply never
    // fire.
    const mq = window.matchMedia(STEPPER_MQ);
    let wired = false;
    const onPrev = () => (mq.matches ? goPrev() : scrollPrev());
    const onNext = () => (mq.matches ? goNext() : scrollNext());

    const wire = () => {
      if (wired) return;
      prev?.addEventListener('click', onPrev);
      next?.addEventListener('click', onNext);
      wired = true;
    };

    // Keep the two modes' residue from bleeding into each other on a live mode
    // flip (DevTools emulation, plugging/unplugging a mouse):
    //   - Leaving stepper → native: strip the inline transform/transition the
    //     stepper left so the native scroll container starts pristine.
    //   - Entering stepper ← native: the stepper assumes the track sits at
    //     scrollLeft 0 / translateX(0). A leftover native scroll offset would
    //     shift every stepper frame, so reset scrollLeft.
    const sync = () => {
      if (mq.matches) {
        track.scrollLeft = 0;
      } else {
        track.style.transition = '';
        track.style.transform = '';
        animating = false;
      }
    };

    wire();
    sync();
    mq.addEventListener('change', sync);
  });
}
