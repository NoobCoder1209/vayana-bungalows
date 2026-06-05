// Reveal-on-scroll — IntersectionObserver adds .is-visible
export function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    els.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  // Reveal anything that's already in view immediately (above-the-fold)
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) {
      el.classList.add('is-visible');
    }
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  );
  els.forEach((el) => {
    if (!el.classList.contains('is-visible')) io.observe(el);
  });
}
