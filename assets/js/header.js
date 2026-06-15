// Sticky header — toggle .is-scrolled when the sentinel leaves the viewport.
// The hamburger drawer (panel + click handler + aria-expanded wiring) ships
// in #3 — this file only owns the transparent->solid background flip.
export function initHeader() {
  const header = document.getElementById('site-header');
  const sentinel = document.getElementById('header-sentinel');
  if (!header || !sentinel) return;

  const io = new IntersectionObserver(
    ([entry]) => {
      header.classList.toggle('is-scrolled', !entry.isIntersecting);
    },
    { threshold: 0 }
  );
  io.observe(sentinel);
}
