// Single source of truth for brand + contact strings used across the site.
// Footer + (eventually) header / contact sections read from here via the
// site-config-inject helper, which hydrates [data-site-config="<path>"]
// nodes on page load. The HTML still ships canonical text inline so the
// site degrades gracefully with JS disabled (#9 acceptance test, Negative
// case 7) — JS just keeps things in sync if these values ever change.
//
// Placeholder values: phone / email / social URLs are stubs to be swapped
// before launch via a separate "Contact data finalize" issue. The license
// number and brand / company names are real and must not be touched
// without legal review.
export const SITE_CONFIG = {
  brand: 'Vayana Bungalows',
  company: 'Vayana di Mare',
  license: '1327673',
  phone: { display: '+359 88 888 8888', href: 'tel:+359888888888' },
  email: 'contact@vayanabungalows.com',
  address: { line1: 'Tsarevo', line2: 'Bulgaria' },
  social: {
    facebook: 'https://www.youtube.com/',
    instagram: 'https://www.youtube.com/',
    linkedin: 'https://www.youtube.com/',
  },
  copyright: '© 2026 Made with ❤ by Vayana di Mare',
};
