import { initHeader } from './header.js';
import { initLang } from './lang.js';
import { initReveal } from './reveal.js';
import { initParallax } from './parallax.js';
import { initSliders } from './slider.js';
import { initBooking } from './booking.js';
import { initVideo } from './video.js';
import { initSiteConfig } from './site-config-inject.js';
import { initNewsletter } from './newsletter.js';
import { initLocation } from './location.js';
import { initEnquiry } from './enquiry.js';

// The JS-on / JS-off CSS gate is set by an inline <head> script before any
// stylesheet loads (each HTML page renders class="no-js" on <html> and the
// inline script swaps it to "js-on"). Don't repeat the swap here — by the
// time this module runs, it's already done.

const run = () => {
  initSiteConfig();
  initHeader();
  initLang();
  initReveal();
  initParallax();
  initSliders();
  initBooking();
  initVideo();
  initNewsletter();
  initLocation();
  initEnquiry();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run);
} else {
  run();
}
