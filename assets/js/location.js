// Location section — map iframe load detection (#10).
//
// The HTML ships the iframe with opacity:0 and a fallback paragraph
// rendered behind it. This module:
//   1. Hydrates the iframe src from SITE_CONFIG. The src needs a tighter
//      allowlist than the generic site-config-inject helper (which accepts
//      any https URL via SAFE_HREF), so we run a maps.google.com /
//      www.google.com hostname check here before assigning. Plus code +
//      directions URL hydrate via the generic helper in HTML — they
//      already fit the existing data-site-config / data-site-config-href
//      contracts.
//   2. Listens for the iframe's `load` event and adds .is-loaded to the
//      .location__map wrapper. CSS fades the iframe in at that point and
//      enables pointer events; until then the fallback is what the user
//      sees and clicks land on the fallback paragraph (not on a hidden
//      iframe). If the load never fires (extension-blocked, network drop,
//      etc.), .is-loaded never flips and the fallback stays the only
//      thing visible — that's negative test #4.
//
// Note on the load event: the iframe's `load` event fires for cross-origin
// frames as long as the response was received and a document was committed,
// even if the document body itself is empty or 4xx/5xx. The
// "blocked by extension" path (request fully aborted) reliably leaves the
// iframe blank → fallback visible. The "DNS / connection refused / 5xx"
// path may fire `load` against a browser-rendered error page in some
// browsers — in those cases the user sees the browser's chrome instead
// of our fallback. That's a known limitation of cross-origin iframes;
// short of a heartbeat probe to maps.google.com first (which has its own
// privacy implications), we accept it.

import { SITE_CONFIG } from './site-config.js';

// Allowlist for iframe src — must be HTTPS and host must be one of the
// Google Maps embed hosts. This is a defense-in-depth check on top of
// SITE_CONFIG being dev-controlled: if a future config edit fat-fingers
// the URL, we don't end up loading e.g. a `javascript:` or `data:` URL,
// and we don't load any *other* google.com subdomain (script.google.com,
// docs.google.com, etc. — which can serve user-controlled HTML via Apps
// Script and would run in google.com-cookie context inside the iframe's
// sandboxed-but-allow-same-origin scope).
//
// Hostname check is leading-dot suffix-safe: 'maps.google.com.evil.com'
// is correctly rejected (host is the whole thing, not a suffix match).
const SAFE_MAP_EMBED_HOSTS = new Set(['maps.google.com', 'www.google.com']);

// Allowlist for the "Get directions" external link. `maps.app.goo.gl` is
// Google's own URL shortener for sharing Maps links — that's where the
// share-link in the issue spec lives. `maps.google.com` is the canonical
// Maps host. We could lean on the generic SAFE_HREF allowlist in
// site-config-inject.js, but that accepts any https:// URL — too loose
// for a customer-visible CTA that lands users off-site. Tighter local
// allowlist gives defense-in-depth against a future config typo.
const SAFE_DIRECTIONS_HOSTS = new Set([
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
]);

function isAllowedHost(value, allowlist) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return allowlist.has(url.hostname);
}

function isSafeMapEmbed(value) {
  return isAllowedHost(value, SAFE_MAP_EMBED_HOSTS);
}

function isSafeDirectionsUrl(value) {
  return isAllowedHost(value, SAFE_DIRECTIONS_HOSTS);
}

export function initLocation() {
  const wrap = document.querySelector('.location__map');
  if (!wrap) return;
  const iframe = wrap.querySelector('iframe');
  if (!iframe) return;

  // SSOT hydrate: if SITE_CONFIG.address.mapEmbed differs from the inline
  // iframe src, override (so `site-config.js` is the single edit point).
  // The HTML still ships a canonical inline src so the page works without
  // JS. Compare against the raw attribute (not the resolved property)
  // because `iframe.src` getter normalizes the URL — case-folds the
  // scheme, decodes percent-escapes, etc. — and a logically-identical
  // config string can string-mismatch the resolved property and trigger
  // an unnecessary reload (which would re-fire the load event and reset
  // any pan/zoom state the user had).
  const cfgSrc = SITE_CONFIG?.address?.mapEmbed;
  if (typeof cfgSrc === 'string' && isSafeMapEmbed(cfgSrc)
      && iframe.getAttribute('src') !== cfgSrc) {
    iframe.src = cfgSrc;
  } else if (typeof cfgSrc === 'string' && !isSafeMapEmbed(cfgSrc)) {
    console.warn('[location] SITE_CONFIG.address.mapEmbed rejected: not an https://maps.google.com or https://www.google.com URL');
  }

  // Add .is-loaded once the iframe successfully fires `load`. The fallback
  // stays visible (and pointer-events on the iframe stay disabled by CSS)
  // until then. There's intentionally no setTimeout fallback here: the
  // iframe is `loading="lazy"`, so it only starts fetching when scrolled
  // near the viewport — well after this init runs at DOMContentLoaded.
  // Any timer started here would fire before the first byte is even
  // requested, making the timeout meaningless. The "absent .is-loaded"
  // state IS the failure-detection mechanism.
  iframe.addEventListener('load', () => {
    wrap.classList.add('is-loaded');
  }, { once: true });

  // Hydrate the directions link from SITE_CONFIG with the tight Maps-only
  // host allowlist defined above. We can't use the generic
  // data-site-config-href because SAFE_HREF in site-config-inject.js
  // accepts any https:// URL, which is too loose for an outbound CTA.
  const dirEl = document.querySelector('[data-location-directions]');
  const cfgDir = SITE_CONFIG?.address?.directionsUrl;
  if (dirEl && typeof cfgDir === 'string') {
    if (isSafeDirectionsUrl(cfgDir)) {
      if (dirEl.getAttribute('href') !== cfgDir) {
        dirEl.setAttribute('href', cfgDir);
      }
    } else {
      console.warn('[location] SITE_CONFIG.address.directionsUrl rejected: not an https://maps.google.com / maps.app.goo.gl / goo.gl URL');
    }
  }
}
