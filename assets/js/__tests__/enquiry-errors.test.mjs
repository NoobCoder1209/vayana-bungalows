// Static contract test for the enquiry.js dynamic-error wiring (issue #61).
//
// enquiry.js can't be plain-imported in Node (it pulls in a DOM /
// flatpickr / import.meta.env chain), so — like the other assets/js
// tests — we don't execute it. Instead we lock the STRUCTURAL CONTRACT
// that the localized error strings depend on, across three artifacts:
//
//   enquiries/index.html   — the <form data-enquiry-form> carries a
//                            data-err-* attribute per error string plus a
//                            data-i18n-attr map pointing each at a locale key.
//   assets/js/enquiry.js   — initEnquiry() reads those attrs off
//                            form.dataset (camelCase) into ERROR_MSGS /
//                            the field-error vars.
//   locales/{en,bg}.json   — every referenced key must exist in BOTH.
//
// The subtle failure mode this guards is the camelCase <-> kebab-case
// mapping (data-err-rate-limit <-> d.errRateLimit <-> enquiries.errors
// .rate_limit): a rename on any one side silently drops a localized
// string back to its English fallback. This test fails loudly instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'node-html-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

const HTML = readFileSync(join(ROOT, 'enquiries', 'index.html'), 'utf8');
const JS = readFileSync(join(ROOT, 'assets', 'js', 'enquiry.js'), 'utf8');
const EN = JSON.parse(readFileSync(join(ROOT, 'locales', 'en.json'), 'utf8'));
const BG = JSON.parse(readFileSync(join(ROOT, 'locales', 'bg.json'), 'utf8'));

// data-err-rate-limit -> errRateLimit (how the DOM exposes it on .dataset)
const toCamel = (attr) =>
  attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// Resolve "a.b.c" against a nested object, or undefined.
const dig = (obj, dotted) =>
  dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const form = parse(HTML).querySelector('[data-enquiry-form]');

test('enquiry form element exists and carries the i18n-attr map', () => {
  assert.ok(form, 'no [data-enquiry-form] element found');
  assert.ok(
    form.getAttribute('data-i18n-attr'),
    'form is missing its data-i18n-attr map',
  );
});

// Parse the data-i18n-attr map: "data-err-x:key.a; data-err-y:key.b" ...
const i18nAttrRaw = form.getAttribute('data-i18n-attr') || '';
const attrToKey = new Map(
  i18nAttrRaw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      return [attr, key];
    }),
);

// Every data-err-* attribute physically present on the form.
const errAttrs = Object.keys(form.attributes).filter((a) =>
  a.startsWith('data-err-'),
);

test('there is at least one data-err-* attribute wired', () => {
  assert.ok(errAttrs.length >= 15, `expected >=15 data-err-*, got ${errAttrs.length}`);
});

for (const attr of errAttrs) {
  test(`${attr}: has an English fallback value, an i18n key, JS read, and EN+BG entries`, () => {
    // 1. The attr has a non-empty English fallback baked in the HTML.
    const fallback = form.getAttribute(attr);
    assert.ok(fallback && fallback.length > 0, `${attr} has no fallback value`);

    // 2. It appears in the data-i18n-attr map.
    const key = attrToKey.get(attr);
    assert.ok(key, `${attr} is not in the data-i18n-attr map`);
    assert.match(key, /^enquiries\.(errors|field_errors)\./, `${attr} -> unexpected key ${key}`);

    // 3. enquiry.js reads the matching camelCase dataset property.
    const camel = toCamel(attr); // errRateLimit
    assert.ok(
      JS.includes(`d.${camel}`),
      `enquiry.js never reads form.dataset.${camel} (for ${attr})`,
    );

    // 4. The key resolves in BOTH locales.
    assert.ok(dig(EN, key) != null, `${key} missing from en.json`);
    assert.ok(dig(BG, key) != null, `${key} missing from bg.json`);
  });
}

test('every data-i18n-attr entry corresponds to a real data-err-* attribute', () => {
  for (const attr of attrToKey.keys()) {
    assert.ok(
      form.getAttribute(attr) != null,
      `data-i18n-attr references ${attr} but the form has no such attribute`,
    );
  }
});

test('ERROR_MSGS is mutated (not reassigned) so its const binding is safe', () => {
  // Guards the const-object mutation pattern: we set properties, never
  // reassign the binding. The ONLY `ERROR_MSGS =` in the file must be the
  // `const` declaration; any other is an illegal reassignment.
  const assigns = [...JS.matchAll(/ERROR_MSGS\s*=(?!=)/g)];
  assert.equal(assigns.length, 1, `expected exactly one "ERROR_MSGS =" (the const decl), found ${assigns.length}`);
  const declPos = JS.indexOf('const ERROR_MSGS =');
  assert.equal(assigns[0].index, declPos + 'const '.length, 'the sole ERROR_MSGS assignment must be its const declaration');
  assert.match(JS, /ERROR_MSGS\.validation\s*=/, 'expected property-level mutation of ERROR_MSGS');
});

test('field-error message vars are `let` (reassigned from the DOM at init)', () => {
  for (const v of ['NAME_ERROR_MSG', 'DATE_ERROR_MSG', 'DATE_ORDER_ERROR_MSG',
    'PAST_DATE_ERROR_MSG', 'EMAIL_ERROR_MSG', 'PHONE_ERROR_MSG']) {
    assert.match(JS, new RegExp(`let ${v} =`), `${v} must be declared with let (reassigned at init)`);
  }
});
