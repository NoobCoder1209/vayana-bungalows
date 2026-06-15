import { SITE_CONFIG } from './site-config.js';

// Hydrate elements that opt in via data-site-config="<dotted.path>" with a
// value from SITE_CONFIG. The HTML must already render canonical text
// inline so the page is readable without JS — this only OVERWRITES the
// inline value if the config has drifted (e.g. someone changed phone in
// site-config.js but forgot to sweep the HTML), keeping a single source
// of truth without breaking the no-JS path.
//
// Supported targets:
//   <span data-site-config="phone.display">…</span>     -> textContent
//   <a data-site-config-href="phone.href">…</a>          -> href attribute
//
// "<path>" is dot-separated (phone.display, address.line1, social.facebook).

function readPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function hydrate(root = document) {
  // Text content
  for (const el of root.querySelectorAll('[data-site-config]')) {
    const path = el.getAttribute('data-site-config');
    const value = readPath(SITE_CONFIG, path);
    if (typeof value === 'string' && el.textContent !== value) {
      el.textContent = value;
    }
  }
  // href / src
  for (const el of root.querySelectorAll('[data-site-config-href]')) {
    const path = el.getAttribute('data-site-config-href');
    const value = readPath(SITE_CONFIG, path);
    if (typeof value === 'string' && el.getAttribute('href') !== value) {
      el.setAttribute('href', value);
    }
  }
}

export function initSiteConfig() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => hydrate());
  } else {
    hydrate();
  }
}
