// Tiny scroll-snap slider — wires prev/next buttons to scrollBy(), with
// wrap-around at the ends: pressing next on the last item smooth-scrolls back
// to the first, and prev on the first smooth-scrolls to the last. The wrap
// uses the same behavior:'smooth' as a normal step, so it reads as one
// continuous slide rather than a jump.
export function initSliders() {
  const tracks = document.querySelectorAll('[data-slider]');
  tracks.forEach((track) => {
    const name = track.dataset.slider;
    const prev = document.querySelector(`[data-slider-prev="${name}"]`);
    const next = document.querySelector(`[data-slider-next="${name}"]`);

    const step = () => {
      const item = track.querySelector('.gallery__item, .room-card');
      if (!item) return track.clientWidth * 0.8;
      const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 16;
      return item.getBoundingClientRect().width + gap;
    };

    // Max scrollLeft. The "at an edge" test uses a generous tolerance —
    // half a card — because the track has horizontal padding
    // (padding: 0 var(--container-pad)), so the resting scrollLeft at the
    // first item is ~the padding (not 0), and snap/rounding leaves the last
    // item a little shy of the raw max. Half a step is comfortably larger
    // than any padding/rounding slop yet smaller than one card, so it can't
    // misfire mid-track.
    const maxScroll = () => track.scrollWidth - track.clientWidth;
    const edgeTolerance = () => Math.max(step() / 2, 40);

    prev?.addEventListener('click', () => {
      if (track.scrollLeft <= edgeTolerance()) {
        // At the first item — wrap to the last.
        track.scrollTo({ left: maxScroll(), behavior: 'smooth' });
      } else {
        track.scrollBy({ left: -step(), behavior: 'smooth' });
      }
    });

    next?.addEventListener('click', () => {
      if (track.scrollLeft >= maxScroll() - edgeTolerance()) {
        // At the last item — wrap back to the first.
        track.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        track.scrollBy({ left: step(), behavior: 'smooth' });
      }
    });
  });
}
