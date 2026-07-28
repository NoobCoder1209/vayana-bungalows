// Reveal-on-scroll — IntersectionObserver adds .is-visible.
//
// Two entry points:
//   - initReveal(): called once from main.js. Reveals above-the-fold `.reveal`
//     elements immediately and observes the rest. Honours reduced-motion.
//   - observeReveal(el): register a `.reveal` element that was added or
//     populated by JS AFTER initReveal ran (e.g. the availability calendars,
//     which start as empty 0-height containers). Without this, such a
//     container could be observed while collapsed, never reach the
//     intersection threshold once its content inflates the height, and stay
//     stuck invisible — so JS populators call observeReveal(el) after they
//     have content instead of hand-forcing `.is-visible`.

// Reduced-motion is resolved once: when true, reveal is a no-op (elements are
// shown immediately with no transition).
const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Lazily-created shared observer so initReveal() and observeReveal() register
// against the same instance regardless of call order.
let io = null;
function getObserver() {
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
  }
  return io;
}

// Show `el` now if it's already in the viewport, else observe it. Safe to call
// on an element that's already visible (no-op). Exported so JS-rendered
// content can opt in after it has real height.
export function observeReveal(el) {
  if (!el || el.classList.contains('is-visible')) return;
  if (prefersReduced()) {
    el.classList.add('is-visible');
    return;
  }
  const r = el.getBoundingClientRect();
  if (r.top < window.innerHeight && r.bottom > 0) {
    el.classList.add('is-visible');
  } else {
    getObserver().observe(el);
  }
}

export function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  if (prefersReduced()) {
    els.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  els.forEach((el) => observeReveal(el));
}
