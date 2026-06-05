// Sticky header — toggle .is-scrolled when sentinel leaves the viewport
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

  // Mobile menu toggle
  const toggle = header.querySelector('.primary-nav__toggle');
  const list = header.querySelector('#primary-nav-list');
  if (toggle && list) {
    toggle.addEventListener('click', () => {
      const open = list.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
  }
}
