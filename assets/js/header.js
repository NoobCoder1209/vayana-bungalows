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

  // Hamburger menu toggle. The drawer panel itself lands in #3; this just
  // mirrors aria-expanded so AT users get a meaningful state until then.
  const toggle = header.querySelector('.site-header__menu');
  const list = header.querySelector('#primary-nav-list');
  if (toggle && list) {
    toggle.addEventListener('click', () => {
      const open = list.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
  }
}
