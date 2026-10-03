// Markup contract for the /enquiries/ Guests stepper popover (replaces the
// former 3-select Adults/Children/Infants trio with one popover + 4 hidden
// inputs + a new Pets category). Parses enquiries/index.html statically —
// enquiry.js can't be plain-imported in Node (DOM/flatpickr chain), same
// rationale as enquiry-errors.test.mjs, which this mirrors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'node-html-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const HTML = readFileSync(join(ROOT, 'enquiries', 'index.html'), 'utf8');
const form = parse(HTML).querySelector('[data-enquiry-form]');

test('guests field: four hidden inputs with correct names and defaults', () => {
  const wrap = form.querySelector('[data-enquiry-guests]');
  assert.ok(wrap, 'missing [data-enquiry-guests] wrapper');
  const defs = { adults: '1', children: '0', infants: '0', pets: '0' };
  for (const [key, val] of Object.entries(defs)) {
    const el = form.querySelector(`[data-enquiry-${key}]`);
    assert.ok(el, `missing hidden input [data-enquiry-${key}]`);
    assert.equal(el.getAttribute('type'), 'hidden');
    assert.equal(el.getAttribute('name'), key);
    assert.equal(el.getAttribute('value'), val);
  }
});

test('guests field: toggle is a disclosure (aria-expanded + aria-controls, not a dialog)', () => {
  const toggle = form.querySelector('[data-enquiry-guests-toggle]');
  const pop = form.querySelector('[data-enquiry-guests-popover]');
  assert.ok(toggle && pop, 'toggle or popover missing');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), pop.getAttribute('id'));
  assert.ok(pop.hasAttribute('hidden'), 'popover must ship hidden');
  // Non-modal inline popover: must NOT claim to be a modal dialog (no focus
  // trap / aria-modal is provided, so role=dialog would oversell it — I3).
  assert.ok(!toggle.getAttribute('aria-haspopup'), 'no aria-haspopup=dialog on a disclosure');
  assert.notEqual(pop.getAttribute('role'), 'dialog', 'popover must not carry role=dialog');
});

test('guests field: four stepper rows each with dec/count/inc', () => {
  for (const row of ['adults', 'children', 'infants', 'pets']) {
    const r = form.querySelector(`[data-guest-row="${row}"]`);
    assert.ok(r, `missing row ${row}`);
    assert.ok(r.querySelector('[data-guest-dec]'), `${row} missing dec`);
    assert.ok(r.querySelector('[data-guest-count]'), `${row} missing count`);
    assert.ok(r.querySelector('[data-guest-inc]'), `${row} missing inc`);
  }
});

test('guests field: the old selects are gone', () => {
  assert.equal(form.querySelectorAll('select').length, 0, 'no <select> should remain');
});

test('guests summary ships the placeholder label (toggle shows GUESTS* until first pick)', () => {
  // setupGuests() snapshots this text into PLACEHOLDER and shows it on the
  // toggle until the guest first steps a count. If the baked text or the
  // i18n binding is removed, PLACEHOLDER captures '' and the toggle renders
  // a blank accessible name — this locks that contract (review M1).
  const summary = form.querySelector('[data-enquiry-guests-summary]');
  assert.ok(summary, 'missing [data-enquiry-guests-summary]');
  assert.equal(summary.getAttribute('data-i18n'), 'enquiries.guests.toggle_placeholder',
    'summary must carry the i18n placeholder binding so BG bakes a localized label');
  assert.ok(summary.textContent.trim().length > 0, 'summary must ship non-empty placeholder text');
});

test('error pill has a stable id for aria-errormessage wiring (I2 fix)', () => {
  // showError() points the errored field at the pill via aria-errormessage +
  // aria-describedby; that needs a stable id on the pill. Without it the
  // guests <button> error relies on aria-invalid-on-button, which AT support
  // for is spotty.
  const pill = form.querySelector('[data-enquiry-error]');
  assert.ok(pill, 'error pill missing');
  assert.ok(pill.getAttribute('id'), 'error pill must carry an id for aria-errormessage');
});

test('guests field: form bakes summary + live templates for the JS to read', () => {
  // The summary/live strings reach enquiry.js via data-* attributes baked
  // onto <form> (same mechanism as data-err-*). Assert the i18n-attr binding
  // names the right keys so BG users get localized summaries, not EN literals.
  const attr = form.getAttribute('data-i18n-attr') || '';
  for (const bind of [
    'data-guests-summary-guest:enquiries.guests.summary_guest',
    'data-guests-summary-guests:enquiries.guests.summary_guests',
    'data-guests-summary-pet:enquiries.guests.summary_pet',
    'data-guests-summary-pets:enquiries.guests.summary_pets',
    'data-guests-summary-join:enquiries.guests.summary_join',
    'data-guests-live:enquiries.a11y.guests_live',
  ]) {
    assert.ok(attr.includes(bind), `form data-i18n-attr missing binding: ${bind}`);
  }
});
