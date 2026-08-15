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
  license: 'Ц2-0ТИ-В2Т-С0',
  phone: { display: '+359 899 873 990', href: 'tel:+359899873990' },
  email: { display: 'vayanamare@gmail.com', href: 'mailto:vayanamare@gmail.com' },
  // Address has two display levels:
  //   - short:  used in the compact footer column ("Tsarevo, Bulgaria")
  //   - full:   used by the contacts / destination / privacy / terms /
  //             cancellation pages (street + city + country)
  // Splitting them up front so those pages can show the street line
  // without bloating the footer copy. If ops need a second
  // street-and-city line, add address.line3 here and reference it in HTML.
  //
  // directionsUrl + mapEmbed are the single source of truth for
  // the homepage Location section (#10). If the property ever moves OR a
  // new embed URL is generated from Google's "Embed a map" dialog, edit
  // them here — the HTML hydrates them via [data-site-config*].
  address: {
    line1: 'Arapya',
    line2: 'Camping Joy',
    street: '',
    country: 'Bulgaria',
    // Coordinate-anchored Google Maps query — the lat/lng pin lands exactly
    // on the property's centre. If you regenerate this from Google's
    // "Embed a map" dialog you'll get a longer pb=… URL — just paste it in here.
    mapEmbed: 'https://maps.google.com/maps?q=42.1885867,27.8350773&z=17&output=embed',
    directionsUrl: 'https://maps.app.goo.gl/szcFXV6f5Pgx2iFt5',
  },
  social: {
    facebook: 'https://www.youtube.com/',
    instagram: 'https://www.youtube.com/',
  },
  // Policy paths are RELATIVE TO THE SITE BASE. The inject helper prepends
  // import.meta.env.BASE_URL via [data-site-config-path] so that these resolve
  // correctly under the GitHub Pages /vayana-bungalows/ prefix in prod and at /
  // in dev. Don't include the leading slash here.
  policies: {
    terms: 'terms/',
    cancellation: 'cancellation/',
    privacy: 'privacy/',
  },
  // Network endpoints called by the JS bundle. BOTH values are public:
  //   - endpoints.enquiry is the form action URL — visible in view-source
  //     of /enquiries/, hit from enquiry.js's fetch() call. When a custom
  //     domain ships (e.g. enquiries.vayanabungalows.com), swap this
  //     string only; nothing else moves.
  //   - endpoints.turnstileSiteKey is the Cloudflare Turnstile widget's
  //     site key (NOT the secret — the secret lives only in the Worker
  //     env). It's safe to ship in the HTML; Cloudflare validates the
  //     paired secret server-side on every submit.
  // The real *.workers.dev URL is filled in after the first wrangler
  // deploy resolves it; until then this placeholder stops the fetch
  // from ever hitting a real network (any string here that doesn't
  // resolve simply produces a TypeError caught by enquiry.js).
  endpoints: {
    enquiry: 'https://vayana-enquiries.vayana.workers.dev/submit',
    // Read-only GET endpoint for the home-page offers section. Same Worker
    // origin as `enquiry`, different route. Public. Swap the origin here
    // (only) when a custom domain ships.
    offers: 'https://vayana-enquiries.vayana.workers.dev/offers',
    // POST endpoint the /stay/ page calls to price a selected date range.
    // Body { checkin, checkout, bungalow? } → { ok, total, applied }. The client
    // reads `ok` + `total` only (`applied` is informational, currently unused).
    // Same Worker origin as `enquiry`/`offers`; swap the origin here (only) when
    // a custom domain ships. This is the SINGLE source of the pill price — the
    // frontend has no hardcoded per-night fallback.
    price: 'https://vayana-enquiries.vayana.workers.dev/price',
    turnstileSiteKey: '0x4AAAAAADpxs0HIUft5BY7_',
  },
  // The heart glyph is U+2764 followed by the U+FE0F emoji variation
  // selector (❤️) so it renders in red emoji presentation, matching the
  // home page's i18n copyright string. Must match `&#10084;&#65039;` in HTML
  // so the textContent rewrite at hydration is a no-op (no visible flicker).
  copyright: '© 2026 Made with ❤️ by Vayana di Mare',
};
