// Tiny scroll-snap slider — wires prev/next buttons to scrollBy()
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

    prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
  });
}
