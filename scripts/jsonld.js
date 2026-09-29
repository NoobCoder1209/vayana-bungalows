// LodgingBusiness JSON-LD generator (schema.org structured data).
//
// Pure + dependency-free. Produces the machine-readable "business card" Google
// reads to build a rich result / knowledge panel for the property: name,
// contact, postal address, geo-coordinates, image, and social profiles. The
// i18n plugin injects the rendered <script type="application/ld+json"> into the
// <head> of the home + contacts pages (per JSONLD_PAGES below), once per
// locale, with the page's own locale URL + inLanguage.
//
// Data source: the BUSINESS constant in vite.config.js (co-located with ORIGIN,
// matching how the config already mirrors site-config.js values into
// i18nContext). Kept prefix-free on purpose — it must NOT inherit the locale
// files' "Code NNN·" tracer prefixes, which would poison the structured data.

// Source-tree page paths (index-form, forward-slash) that carry the JSON-LD.
// Home is the authoritative site entity; contacts reinforces it. A
// single-location business gains nothing from repeating it site-wide.
export const JSONLD_PAGES = new Set(['index.html', 'contacts/index.html']);

// schema.org Intl language tags per site locale.
const IN_LANGUAGE = { en: 'en', bg: 'bg' };

/**
 * Build the LodgingBusiness JSON-LD object for one locale.
 *
 * @param {object} args
 * @param {object} args.business  the BUSINESS config:
 *   { name, description, telephone, email, streetAddress, addressLocality,
 *     addressRegion?, addressCountry, latitude, longitude, image, sameAs[] }
 * @param {string} args.url       the page's absolute locale URL (e.g.
 *                                 https://…/vayana-bungalows/ or …/bg/)
 * @param {string} args.locale    'en' | 'bg' (for inLanguage)
 * @returns {object} a plain JSON-LD object (caller stringifies)
 */
export function buildLodgingBusinessJsonLd({ business, url, locale }) {
  if (!business || typeof business !== 'object') {
    throw new Error('buildLodgingBusinessJsonLd: business config required');
  }
  const {
    name,
    description,
    telephone,
    email,
    streetAddress,
    addressLocality,
    addressRegion,
    addressCountry,
    latitude,
    longitude,
    image,
    sameAs,
  } = business;

  const address = { '@type': 'PostalAddress' };
  if (streetAddress) address.streetAddress = streetAddress;
  if (addressLocality) address.addressLocality = addressLocality;
  if (addressRegion) address.addressRegion = addressRegion;
  if (addressCountry) address.addressCountry = addressCountry;

  const obj = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    name,
    url,
  };
  if (description) obj.description = description;
  if (telephone) obj.telephone = telephone;
  if (email) obj.email = email;
  if (Object.keys(address).length > 1) obj.address = address;
  // geo — only when BOTH coordinates are finite numbers (a partial pin is worse
  // than none; Google wants a real point or nothing).
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    obj.geo = { '@type': 'GeoCoordinates', latitude, longitude };
  }
  if (image) obj.image = image;
  if (Array.isArray(sameAs) && sameAs.length) obj.sameAs = sameAs.slice();
  if (IN_LANGUAGE[locale]) obj.inLanguage = IN_LANGUAGE[locale];

  return obj;
}

/**
 * Render the JSON-LD object as a full <script type="application/ld+json">
 * element string, ready to splice into <head>. The JSON is escaped for safe
 * embedding: `<` is escaped to `<` so a value containing `</script>` (or
 * `<!--`) can never break out of the script element — the standard, spec-safe
 * way to inline JSON in HTML. (Our values are repo-controlled, but this is the
 * correct defense regardless.)
 */
export function renderJsonLdScript(obj) {
  const json = JSON.stringify(obj).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
