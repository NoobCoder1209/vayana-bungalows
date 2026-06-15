import { initHeader } from './header.js';
import { initReveal } from './reveal.js';
import { initParallax } from './parallax.js';
import { initSliders } from './slider.js';
import { initBooking } from './booking.js';
import { initVideo } from './video.js';

// The JS-on / JS-off CSS gate is set by an inline <head> script before any
// stylesheet loads (each HTML page renders class="no-js" on <html> and the
// inline script swaps it to "js-on"). Don't repeat the swap here — by the
// time this module runs, it's already done.

// Publish the viewport's true width-without-scrollbar as a CSS variable so
// the drawer's width formula can subtract container-max correctly without
// drifting by the scrollbar gutter (Firefox's 100vw INCLUDES the gutter,
// which throws the drawer-aligns-to-hamburger-right-edge math off by
// ~8px on desktop). Updated on resize so cross-breakpoint resizes stay
// aligned.
function publishViewportWidth() {
  const w = document.documentElement.clientWidth;
  document.documentElement.style.setProperty('--vw-no-scrollbar', `${w}px`);
}
publishViewportWidth();
window.addEventListener('resize', publishViewportWidth);

const run = () => {
  initHeader();
  initReveal();
  initParallax();
  initSliders();
  initBooking();
  initVideo();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run);
} else {
  run();
}
