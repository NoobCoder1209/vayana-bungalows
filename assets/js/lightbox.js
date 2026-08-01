// Gallery lightbox — click any .gallery__item photo to view it enlarged,
// uncropped at its natural ratio, on a dark full-screen overlay with a Close
// button, an "n / total" counter, and prev/next navigation (arrows + keyboard
// + backdrop, infinite loop). One shared overlay (#lightbox) serves every
// gallery on the page; on open we snapshot the CURRENT photo list of the
// clicked gallery (the gallery strip rotates its DOM order via slider.js, so
// we read it live) and cycle within that.
//
// No share / favourite chrome by design.

export function initLightbox() {
  const box = document.getElementById('lightbox');
  if (!box) return;

  const img = box.querySelector('[data-lightbox-img]');
  const indexEl = box.querySelector('[data-lightbox-index]');
  const totalEl = box.querySelector('[data-lightbox-total]');
  const prevBtn = box.querySelector('[data-lightbox-prev]');
  const nextBtn = box.querySelector('[data-lightbox-next]');
  const closers = box.querySelectorAll('[data-lightbox-close]');
  const closeBtn = box.querySelector('.lightbox__close');
  if (!img) return;

  // Only wire galleries (tracks that hold .gallery__item). Rooms etc. have no
  // gallery items, so they're skipped.
  const tracks = Array.from(document.querySelectorAll('[data-slider]')).filter((t) =>
    t.querySelector('.gallery__item'),
  );
  if (!tracks.length) return;

  let photos = []; // [{src, alt}] snapshot for the open gallery
  let current = 0;
  let lastFocus = null;
  let lockedGutter = 0;
  let lockedScrollY = 0;

  const render = () => {
    const p = photos[current];
    if (!p) return;
    img.setAttribute('src', p.src);
    img.setAttribute('alt', p.alt || '');
    if (indexEl) indexEl.textContent = String(current + 1);
    if (totalEl) totalEl.textContent = String(photos.length);
  };

  const go = (delta) => {
    if (!photos.length) return;
    current = (current + delta + photos.length) % photos.length; // wrap
    render();
  };

  // Touch-swipe navigation on the overlay: a horizontal drag flips photos the
  // same way the arrows do (swipe left → next, swipe right → prev), wrapping at
  // the ends. Only a clearly-horizontal gesture counts, so a vertical drag
  // (e.g. flicking to dismiss / scroll) is ignored. Passive listeners — we
  // never preventDefault, so the browser keeps normal gesture handling.
  const SWIPE_MIN = 45;   // px of horizontal travel to count as a swipe
  let touchX = 0;
  let touchY = 0;
  const onTouchStart = (e) => {
    const t = e.changedTouches[0];
    touchX = t.clientX;
    touchY = t.clientY;
  };
  const onTouchEnd = (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    // Horizontal intent: enough X travel AND more horizontal than vertical.
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return;
    go(dx < 0 ? 1 : -1);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'Tab') { trapFocus(e); }
  };

  // Lightweight focus trap — the overlay has only close/prev/next as
  // focusables; keep Tab inside them while open.
  const trapFocus = (e) => {
    const focusables = [closeBtn, prevBtn, nextBtn].filter(Boolean);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const open = (track, startIndex) => {
    photos = Array.from(track.querySelectorAll('.gallery__item img')).map((el) => ({
      src: el.currentSrc || el.getAttribute('src'),
      alt: el.getAttribute('alt') || '',
    }));
    if (!photos.length) return;
    current = Math.max(0, Math.min(startIndex, photos.length - 1));
    lastFocus = document.activeElement;
    render();

    // Body scroll-lock — reuse the drawer's class + the scrollbar-gutter pad
    // so the page behind doesn't shift or jump.
    lockedGutter = window.innerWidth - document.documentElement.clientWidth;
    if (lockedGutter > 0) document.body.style.paddingRight = `${lockedGutter}px`;
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.classList.add('body--scroll-locked');

    box.hidden = false;
    document.addEventListener('keydown', onKeyDown);
    box.addEventListener('touchstart', onTouchStart, { passive: true });
    box.addEventListener('touchend', onTouchEnd, { passive: true });
    // Focus the close button so keyboard users land inside the dialog.
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  };

  const close = () => {
    if (box.hidden) return;
    box.hidden = true;
    document.removeEventListener('keydown', onKeyDown);
    box.removeEventListener('touchstart', onTouchStart);
    box.removeEventListener('touchend', onTouchEnd);

    document.body.classList.remove('body--scroll-locked');
    document.body.style.top = '';
    if (lockedGutter > 0) document.body.style.paddingRight = '';
    window.scrollTo(0, lockedScrollY);

    // Clear the src so a stale image doesn't flash on the next open.
    img.removeAttribute('src');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus({ preventScroll: true });
    }
  };

  // Delegate clicks on each gallery: open the lightbox at the clicked photo.
  tracks.forEach((track) => {
    track.addEventListener('click', (e) => {
      const item = e.target.closest('.gallery__item');
      if (!item || !track.contains(item)) return;
      e.preventDefault(); // the anchors are href="#"
      const list = Array.from(track.querySelectorAll('.gallery__item'));
      open(track, list.indexOf(item));
    });
  });

  prevBtn?.addEventListener('click', () => go(-1));
  nextBtn?.addEventListener('click', () => go(1));
  closers.forEach((el) => el.addEventListener('click', close));
}
