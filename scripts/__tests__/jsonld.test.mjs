// Unit tests for the LodgingBusiness JSON-LD generator (scripts/jsonld.js).
//
// Run with:  node --test scripts/__tests__/jsonld.test.mjs
//
// Pure-function coverage: object shape (required + optional fields), geo
// all-or-nothing, sameAs handling, inLanguage per locale, and the </script>
// break-out escaping in renderJsonLdScript.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JSONLD_PAGES,
  buildLodgingBusinessJsonLd,
  renderJsonLdScript,
} from '../jsonld.js';

const BUSINESS = {
  name: 'Vayana Bungalows',
  description: 'Boutique bungalows on the Black Sea coast in Tsarevo, Bulgaria.',
  telephone: '+359 899 873 990',
  email: 'vayanamare@gmail.com',
  streetAddress: 'Arapya',
  addressLocality: 'Tsarevo',
  addressCountry: 'BG',
  latitude: 42.1885867,
  longitude: 27.8350773,
  image: 'https://noobcoder1209.github.io/vayana-bungalows/og-home.jpg',
  sameAs: [
    'https://www.facebook.com/profile.php?id=61573811610794/',
    'https://www.instagram.com/vayana.joy.arapya/',
  ],
};
const URL_EN = 'https://noobcoder1209.github.io/vayana-bungalows/';
const URL_BG = 'https://noobcoder1209.github.io/vayana-bungalows/bg/';

// ── JSONLD_PAGES ─────────────────────────────────────────────────────────────

test('JSONLD_PAGES: home + contacts only', () => {
  assert.ok(JSONLD_PAGES.has('index.html'));
  assert.ok(JSONLD_PAGES.has('contacts/index.html'));
  assert.equal(JSONLD_PAGES.size, 2);
});

// ── buildLodgingBusinessJsonLd ───────────────────────────────────────────────

test('build: core shape — @context, @type, name, url', () => {
  const o = buildLodgingBusinessJsonLd({ business: BUSINESS, url: URL_EN, locale: 'en' });
  assert.equal(o['@context'], 'https://schema.org');
  assert.equal(o['@type'], 'LodgingBusiness');
  assert.equal(o.name, 'Vayana Bungalows');
  assert.equal(o.url, URL_EN);
  assert.equal(o.inLanguage, 'en');
});

test('build: contact + address + geo populated correctly', () => {
  const o = buildLodgingBusinessJsonLd({ business: BUSINESS, url: URL_EN, locale: 'en' });
  assert.equal(o.telephone, '+359 899 873 990');
  assert.equal(o.email, 'vayanamare@gmail.com');
  assert.equal(o.address['@type'], 'PostalAddress');
  assert.equal(o.address.streetAddress, 'Arapya');
  assert.equal(o.address.addressLocality, 'Tsarevo');
  assert.equal(o.address.addressCountry, 'BG');
  assert.equal(o.geo['@type'], 'GeoCoordinates');
  assert.equal(o.geo.latitude, 42.1885867);
  assert.equal(o.geo.longitude, 27.8350773);
});

test('build: sameAs carries the social profiles (copy, not the same ref)', () => {
  const o = buildLodgingBusinessJsonLd({ business: BUSINESS, url: URL_EN, locale: 'en' });
  assert.deepEqual(o.sameAs, BUSINESS.sameAs);
  assert.notEqual(o.sameAs, BUSINESS.sameAs, 'should be a copy, not the same array');
});

test('build: BG locale uses the BG url + inLanguage bg (facts unchanged)', () => {
  const o = buildLodgingBusinessJsonLd({ business: BUSINESS, url: URL_BG, locale: 'bg' });
  assert.equal(o.url, URL_BG);
  assert.equal(o.inLanguage, 'bg');
  // Name / geo / phone are facts — identical across locales.
  assert.equal(o.name, 'Vayana Bungalows');
  assert.equal(o.telephone, '+359 899 873 990');
});

test('build: geo is all-or-nothing — a non-finite coordinate omits geo entirely', () => {
  for (const bad of [{ latitude: NaN }, { longitude: undefined }, { latitude: '42' }]) {
    const o = buildLodgingBusinessJsonLd({
      business: { ...BUSINESS, ...bad }, url: URL_EN, locale: 'en',
    });
    assert.ok(!('geo' in o), `geo omitted when coordinate is ${JSON.stringify(bad)}`);
  }
});

test('build: optional fields absent → keys omitted (no empty strings)', () => {
  const o = buildLodgingBusinessJsonLd({
    business: { name: 'X' }, url: URL_EN, locale: 'en',
  });
  assert.equal(o.name, 'X');
  assert.ok(!('description' in o));
  assert.ok(!('telephone' in o));
  assert.ok(!('address' in o), 'no address when no address fields');
  assert.ok(!('geo' in o));
  assert.ok(!('sameAs' in o));
});

test('build: throws without a business config', () => {
  assert.throws(() => buildLodgingBusinessJsonLd({ url: URL_EN, locale: 'en' }), /business config/);
});

// ── renderJsonLdScript ───────────────────────────────────────────────────────

test('render: wraps in application/ld+json script and round-trips as JSON', () => {
  const o = buildLodgingBusinessJsonLd({ business: BUSINESS, url: URL_EN, locale: 'en' });
  const html = renderJsonLdScript(o);
  assert.match(html, /^<script type="application\/ld\+json">/);
  assert.match(html, /<\/script>$/);
  const json = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '').replace(/\\u003c/g, '<');
  const parsed = JSON.parse(json);
  assert.equal(parsed['@type'], 'LodgingBusiness');
});

test('render: escapes < so a value containing </script> cannot break out', () => {
  const html = renderJsonLdScript({ name: 'a</script><script>alert(1)</script>' });
  // No literal </script> before the intended closing tag.
  const body = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  assert.ok(!body.includes('</script>'), 'no raw </script> inside the JSON body');
  assert.ok(body.includes('\\u003c/script>'), 'the < was escaped to \\u003c');
});
