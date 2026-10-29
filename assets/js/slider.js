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

// Pure helper for the native-scroll infinite loop. The native track carries a
// buffer of CLONES on each side (last-N prepended, first-N appended); the user
// rests on the first REAL item. When a swipe (or scrollBy) carries scrollLeft
// into a clone zone, we silently jump by exactly one real block so the clone
// the user is looking at is replaced by the pixel-identical real item — the
// loop is invisible and feels like a normal "next".
//
// Given the current scrollLeft, the resting offset of the first real item
// (`firstRealLeft`, which already folds in the leading clones + any side
// padding) and the width of one real block (`realBlockWidth` = sum of the real
// items + gaps), return how far to jump:
//   - scrolled BEFORE the first real item (into the leading clones) → +block
//     (hop forward one block so we're on the real copy of that card);
//   - scrolled a full block PAST the first real item (into the trailing clones)
//     → −block;
//   - anywhere inside the real strip → null (no jump).
// `tol` is a half-card tolerance so snap-settling right on a boundary doesn't
// trigger a spurious recenter. Exported for unit testing.
export function recenterTarget(scrollLeft, firstRealLeft, realBlockWidth, tol = 0) {
  if (!(realBlockWidth > 0)) return null;
  if (scrollLeft < firstRealLeft - tol) return realBlockWidth;
  if (scrollLeft > firstRealLeft + realBlockWidth - tol) return -realBlockWidth;
  return null;
}

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

    // Live edge tolerance (half a card) + behaviour, shared by the native
    // scroll stepping and the clone-buffer recenter below.
    const edgeTol = () => Math.max(2, stepDistance() / 2);
    const scrollBehavior = () => (reduced() ? 'auto' : 'smooth');

    // ---- Native-scroll infinite loop (clone buffer + silent recenter) --------
    //
    // Only the native-scroll buckets (touch / touch-laptop) use this. The
    // stepper (pure-mouse) path already loops via DOM rotation and must NEVER
    // see clones (it rotates track.children directly), so clones are added only
    // while in native mode and torn down on the way into stepper mode — see
    // sync() below. The `cloned` flag keeps add/remove idempotent.
    let cloned = false;
    let lastBlockWidth = 0; // baseline for the resize no-op check
    const realItems = () => Array.from(track.children).filter((el) => !el.hasAttribute('data-clone'));

    // How many cards to clone on each side: enough to cover the viewport plus
    // one, capped at the real count so a short gallery can't over-clone.
    const cloneCount = () => {
      const d = stepDistance();
      const reals = realItems().length;
      if (!d || !reals) return 0;
      return Math.min(reals, Math.ceil(track.clientWidth / d) + 1);
    };

    // Width of one full real block: first real item's left edge is the start,
    // so the block spans up to the FIRST trailing clone (which sits one block
    // to the right of the first real item). Measured live from offsetLeft so a
    // clamp()-driven resize is always reflected.
    const realBlockWidth = () => {
      const reals = realItems();
      if (reals.length < 2) return 0;
      const first = reals[0];
      const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 16;
      const last = reals[reals.length - 1];
      return (last.offsetLeft + last.getBoundingClientRect().width + gap) - first.offsetLeft;
    };

    // Which real card the user is currently resting on (0-based), derived from
    // scrollLeft relative to the first real item. Used to preserve position
    // across a resize rebuild so the gallery doesn't snap back to photo 1.
    const currentRealIndex = () => {
      const reals = realItems();
      if (reals.length < 2) return 0;
      const d = stepDistance();
      if (!d) return 0;
      const rel = track.scrollLeft - reals[0].offsetLeft;
      return Math.min(reals.length - 1, Math.max(0, Math.round(rel / d)));
    };

    const makeClone = (el) => {
      const c = el.cloneNode(true);
      c.setAttribute('data-clone', '');
      c.setAttribute('aria-hidden', 'true');
      c.setAttribute('tabindex', '-1');
      // A clone can scroll into view at the far edge before a lazy <img> would
      // normally load; force it eager and carry over the already-resolved src.
      // Note: the gallery imgs sit inside <picture> whose WebP <source> is what
      // actually renders — this <img src> rewrite is the fallback/eager-load
      // hint, not the pixels on screen. Keep it: it eager-loads the fallback.
      c.querySelectorAll('img').forEach((im, i) => {
        im.setAttribute('loading', 'eager');
        const srcOrig = el.querySelectorAll('img')[i];
        if (srcOrig && srcOrig.currentSrc) im.setAttribute('src', srcOrig.currentSrc);
      });
      return c;
    };

    const addClones = (restoreIndex = 0) => {
      if (cloned) return;
      const reals = realItems();
      const n = cloneCount();
      if (n < 1 || reals.length < 2) return;
      // Trailing clones: copies of the FIRST n reals, appended in order.
      for (let i = 0; i < n; i += 1) track.appendChild(makeClone(reals[i]));
      // Leading clones: copies of the LAST n reals, prepended so order reads
      // real[... n-2, n-1] | real[0 ...]. Insert each before the current first.
      for (let i = 0; i < n; i += 1) {
        track.insertBefore(makeClone(reals[reals.length - 1 - i]), track.firstChild);
      }
      cloned = true;
      // Rest on the real item at restoreIndex (the first one by default; a
      // resize rebuild passes the index the user was on so the gallery doesn't
      // jump back to photo 1). Re-apply in a frame so a lazy-image/font layout
      // shift after insert doesn't leave us parked on a leading clone.
      const settle = () => {
        if (!cloned) return; // a mode flip may have torn the buffer down meanwhile
        const target = realItems()[restoreIndex] || realItems()[0];
        track.scrollLeft = target ? target.offsetLeft : 0;
      };
      settle();
      window.requestAnimationFrame(settle);
    };

    const removeClones = () => {
      if (!cloned) return;
      track.querySelectorAll('[data-clone]').forEach((el) => el.remove());
      cloned = false;
    };

    // Silent recenter: when a swipe carries scrollLeft into a clone zone, jump
    // one real block with snap + smooth behaviour momentarily disabled so the
    // move is instant and invisible. rAF-throttled so a fast flick fires once
    // per frame, not per scroll event.
    let recenterQueued = false;
    const recenter = () => {
      recenterQueued = false;
      if (!cloned) return;
      const reals = realItems();
      if (reals.length < 2) return;
      const firstRealLeft = reals[0].offsetLeft;
      const jump = recenterTarget(track.scrollLeft, firstRealLeft, realBlockWidth(), edgeTol());
      if (jump == null) return;
      const prevSnap = track.style.scrollSnapType;
      const prevBeh = track.style.scrollBehavior;
      track.style.scrollSnapType = 'none';
      track.style.scrollBehavior = 'auto';
      track.scrollLeft += jump;
      // Force the instant offset to commit, then restore snap/behaviour.
      void track.offsetWidth;
      track.style.scrollSnapType = prevSnap;
      track.style.scrollBehavior = prevBeh;
    };
    const onScroll = () => {
      if (recenterQueued || mq.matches) return; // stepper mode: not a scroller
      recenterQueued = true;
      window.requestAnimationFrame(recenter);
    };

    // Native-scroll arrow handlers (buckets B & C). The track is a real
    // scroll-snap container here, so scrollBy by one card lands on a snapped
    // slide automatically. There is no edge-wrap branch any more: the clone
    // buffer + onScroll recenter make the ends seamless, so a step off the last
    // real card scrolls into a trailing clone and silently recenters to the
    // first real card — same as every other step, no visible jump.
    const scrollNext = () => {
      track.scrollBy({ left: stepDistance(), behavior: scrollBehavior() });
    };
    const scrollPrev = () => {
      track.scrollBy({ left: -stepDistance(), behavior: scrollBehavior() });
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
    //   - Entering stepper ← native: tear down the clone buffer (the stepper
    //     rotates track.children directly and must only ever see real items),
    //     then reset scrollLeft so the stepper starts at translateX(0).
    //   - Leaving stepper → native: strip the inline transform/transition the
    //     stepper left, then build the clone buffer so swipe loops endlessly.
    const sync = () => {
      if (mq.matches) {
        removeClones();
        track.scrollLeft = 0;
      } else {
        track.style.transition = '';
        track.style.transform = '';
        animating = false;
        addClones();
        lastBlockWidth = realBlockWidth();
      }
    };

    // The recenter listener is always attached; it no-ops in stepper mode
    // (guarded in onScroll) and when there are no clones.
    track.addEventListener('scroll', onScroll, { passive: true });

    // Rebuild the clone buffer on resize (native mode only): item width is a
    // clamp() of the viewport, so the block width can change. We only rebuild
    // when the block width ACTUALLY changed — skipping the no-op case means the
    // common phone `resize` (browser-chrome collapse on scroll, which doesn't
    // change layout width) no longer snaps the gallery back to photo 1. When we
    // do rebuild, the user's current card index is preserved. rAF-throttled.
    let resizeQueued = false;
    window.addEventListener('resize', () => {
      if (resizeQueued) return;
      resizeQueued = true;
      window.requestAnimationFrame(() => {
        resizeQueued = false;
        if (mq.matches) return;
        const bw = realBlockWidth();
        if (bw === lastBlockWidth) return; // width unchanged — nothing to rebuild
        const idx = currentRealIndex();
        removeClones();
        addClones(idx);
        lastBlockWidth = realBlockWidth();
      });
    });

    wire();
    sync();
    mq.addEventListener('change', sync);
  });
}
