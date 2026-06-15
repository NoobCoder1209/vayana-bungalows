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
