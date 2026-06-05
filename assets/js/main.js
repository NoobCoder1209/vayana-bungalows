import { initHeader } from './header.js';
import { initReveal } from './reveal.js';
import { initParallax } from './parallax.js';
import { initSliders } from './slider.js';
import { initBooking } from './booking.js';
import { initVideo } from './video.js';

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
