// Single source of truth for brand + contact strings used across the site.
// Footer + header / drawer phone link read from here via the
// site-config-inject helper, which hydrates [data-site-config="<path>"]
// nodes on page load. The HTML still ships canonical text inline so the
// site degrades gracefully with JS disabled (#9 acceptance test, Negative
// case 7) — JS just keeps things in sync if these values ever change.
//
// Placeholder values: phone / email / social URLs are stubs to be swapped
// before launch via a separate "Contact data finalize" issue. The license
// number and brand name are real and must not be touched without legal review.
export const SITE_CONFIG = {
  brand: 'Vayana Bungalows',
  license: '1327673',
  phone: { display: '+359 88 888 8888', href: 'tel:+359888888888' },
  email: { display: 'contact@vayanabungalows.com', href: 'mailto:contact@vayanabungalows.com' },
  // Address has two display levels:
  //   - short:  used in the compact footer column ("Tsarevo, Bulgaria")
  //   - full:   used in the dedicated #contact section (street + city + country)
  // Splitting them up front so the contact section can show the street
  // line without bloating the footer copy. If ops need a second
  // street-and-city line, add address.line3 here and reference it in HTML.
  address: {
    line1: 'Tsarevo',
    line2: 'Bulgaria',
    street: 'ul. Kraybrezhna 1, Tsarevo',
    country: 'Bulgaria',
  },
  social: {
    facebook: 'https://www.youtube.com/',
    instagram: 'https://www.youtube.com/',
    linkedin: 'https://www.youtube.com/',
  },
  // Policy paths are RELATIVE TO THE SITE BASE. The inject helper prepends
  // import.meta.env.BASE_URL via [data-site-config-path] so that these resolve
  // correctly under the GitHub Pages /arapq-website/ prefix in prod and at /
  // in dev. Don't include the leading slash here.
  policies: {
    terms: 'terms/',
    cancellation: 'cancellation/',
    privacy: 'privacy/',
  },
  // The heart glyph is a literal U+2764 — must match `&#10084;` in HTML so
  // the textContent rewrite at hydration is a no-op (no visible flicker).
  copyright: '© 2026 Made with ❤ by Vayana di Mare',
};
