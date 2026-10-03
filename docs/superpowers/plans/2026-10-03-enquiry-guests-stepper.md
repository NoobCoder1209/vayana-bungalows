# Enquiry Guests Stepper + Pets Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three guest `<select>` fields on `/enquiries/` with one Airbnb-style stepper popover (Adults/Children/Infants/Pets), add a new Pets column to the Enquires sheet, and thread all four counts through JS → i18n → Worker → sheet.

**Architecture:** The popover writes to four `<input type="hidden">` (adults/children/infants/pets) that are the single source of truth the submit handler reads — so the proven payload/validation/Worker path changes minimally. A new `setupGuests()` helper in `enquiry.js` owns the stepper state machine, bounds, summary string, open/close, and a11y. The Worker gains a `pets` field and the sheet row grows A:O → A:P.

**Tech Stack:** Vanilla JS ES modules, Vite multi-page build, i18n baked at build (`scripts/i18n-plugin.js`), CSS custom properties, Cloudflare Worker (`jose` JWT → Google Sheets append), `node --test` + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-03-enquiry-guests-stepper-design.md`

## Global Constraints

- **Repo:** github.com/NoobCoder1209/vayana-bungalows, default branch `main`. Feature branch `feature/enquiry-guests-stepper`.
- **BG i18n tracer prefix:** every BG string in `locales/bg.json` keeps its `Код NNN·` prefix. **New BG keys start at `Код 634·`** (current max is 633) and increment. Do NOT add BG strings without the prefix; do NOT remove existing prefixes.
- **i18n parity:** `npm run i18n:lint` must stay green — every EN key has a BG counterpart and vice-versa. Removing an EN key means removing its BG twin in the same commit.
- **Test registration:** `npm test` runs a hardcoded file list in `package.json`. Any NEW test file must be added to that list or it won't run.
- **worker deps:** `worker/` has its own `node_modules` (needs `jose`). Run `cd worker && npm install` once before worker tests.
- **Field-name contract:** payload keys `adults`/`children`/`infants`/`pets` must match between `enquiry.js` and `worker/src/validation.js`.
- **Sheet column order** is governed by the `values` array in `worker/src/sheets.js`, NOT object key order. New 16-column layout: `A timestamp | B bungalow | C name | D email | E phone | F checkin | G checkout | H adults | I children | J infants | K pets | L message | M price | N consent | O source_ip_hash | P locale`.
- **Limits:** adults min 1, adults+children ≤ 4, infants 0–2, pets 0–2.
- **Deploy ordering:** the sheet "Pets" header column (inserted via gsheets MCP) must exist BEFORE the Worker A:P change is live, or rows misalign.

## Review Focus

- **DevTools-tampered hidden input** (e.g. `adults` set to `"9"` or `"0"` or `"abc"` via console): the submit handler must reject with the adults error, not POST an out-of-range party. → Task 2.
- **adults+children pushed to 5 via rapid clicks / tamper:** the `+` buttons must be disabled at the sum bound AND the submit handler must re-clamp defensively. → Task 2.
- **Worker receives `pets` out of range or missing** (`pets:"5"`, or key omitted entirely by a third-party caller): must degrade to a valid 0–2 value or reject cleanly, never write junk to Column K. → Task 4.
- **bfcache Back-navigation** after the select→hidden-input swap: counts must persist with NO console error from the removed sessionStorage snapshot code. → Task 2.
- **BG locale rendering**: the popover labels/captions/summary/aria must all resolve to BG `Код 634·`… strings with no missing-key fallback to English. → Task 3.

---

## Task 1: Markup — replace the 3 selects with the guests popover

**Files:**
- Modify: `enquiries/index.html` (the `.enquiry-form__guests` block, ~lines 299–341)
- Test: `assets/js/__tests__/enquiry-guests-markup.test.mjs` (new)

**Interfaces:**
- Produces (DOM hooks consumed by Task 2): `[data-enquiry-guests]` (field wrapper), `[data-enquiry-adults]` / `[data-enquiry-children]` / `[data-enquiry-infants]` / `[data-enquiry-pets]` (hidden inputs), `[data-enquiry-guests-toggle]` (button), `[data-enquiry-guests-popover]` (div, id `eq-guests-popover`), `[data-enquiry-guests-summary]` (span), `[data-enquiry-guests-live]` (sr-only span), per-row `[data-guest-row="adults|children|infants|pets"]` each containing `[data-guest-dec]`, `[data-guest-count]` (`<output>`), `[data-guest-inc]`.

- [ ] **Step 1: Write the failing test**

Create `assets/js/__tests__/enquiry-guests-markup.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'node-html-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '../../../enquiries/index.html'), 'utf8');
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

test('guests field: toggle wired to popover via aria', () => {
  const toggle = form.querySelector('[data-enquiry-guests-toggle]');
  const pop = form.querySelector('[data-enquiry-guests-popover]');
  assert.ok(toggle && pop, 'toggle or popover missing');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), pop.getAttribute('id'));
  assert.ok(pop.hasAttribute('hidden'), 'popover must ship hidden');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /tmp/vayana-enq && npx node --test assets/js/__tests__/enquiry-guests-markup.test.mjs`
Expected: FAIL (old markup still has selects / no `[data-enquiry-guests]`). If `node-html-parser` is missing, use the same parser the existing `enquiry-errors.test.mjs` imports — check its import line and match it.

- [ ] **Step 3: Replace the markup**

In `enquiries/index.html`, replace the entire block from `<!-- 4–6. Guest counts ... -->` through the closing `</div>` of `.enquiry-form__guests` (the three `<select>` fields) with:

```html
<!-- 4–7. Guests — one field opening an Airbnb-style stepper popover.
     Four hidden inputs (adults/children/infants/pets) are the single
     source of truth the submit handler reads; setupGuests() in
     assets/js/enquiry.js writes to them. Adults is required (min 1);
     the rest start at 0. Limits: adults+children ≤ 4, infants ≤ 2,
     pets ≤ 2. The old 3-select trio was replaced here — bfcache
     select-snapshot code in enquiry.js went with it (hidden inputs
     survive bfcache natively). -->
<div class="enquiry-form__field enquiry-form__field--full enquiry-form__guests"
     data-enquiry-guests>
  <input type="hidden" name="adults"   value="1" data-enquiry-adults />
  <input type="hidden" name="children" value="0" data-enquiry-children />
  <input type="hidden" name="infants"  value="0" data-enquiry-infants />
  <input type="hidden" name="pets"     value="0" data-enquiry-pets />

  <button type="button" class="enquiry-form__guests-toggle"
          data-enquiry-guests-toggle
          aria-haspopup="dialog" aria-expanded="false"
          aria-controls="eq-guests-popover">
    <span class="enquiry-form__guests-summary"
          data-enquiry-guests-summary
          data-i18n="enquiries.guests.toggle_placeholder">GUESTS*</span>
    <span class="enquiry-form__guests-caret" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
           stroke="currentColor" stroke-width="1.6"><path d="M6 9l6 6 6-6"/></svg>
    </span>
  </button>

  <div class="enquiry-form__guests-popover" id="eq-guests-popover"
       role="dialog"
       data-i18n-attr="aria-label:enquiries.a11y.guests_dialog_aria"
       aria-label="Choose guests"
       data-enquiry-guests-popover hidden>

    <div class="enquiry-form__guests-row" data-guest-row="adults">
      <span class="enquiry-form__guests-meta">
        <span class="enquiry-form__guests-label"  data-i18n="enquiries.guests.adults_label">Adults</span>
        <span class="enquiry-form__guests-caption" data-i18n="enquiries.guests.adults_caption">Ages 13 or above</span>
      </span>
      <span class="enquiry-form__guests-stepper">
        <button type="button" class="enquiry-form__guests-dec" data-guest-dec
                data-i18n-attr="aria-label:enquiries.a11y.guests_dec_adults"
                aria-label="Decrease adults">&minus;</button>
        <output class="enquiry-form__guests-count" data-guest-count>1</output>
        <button type="button" class="enquiry-form__guests-inc" data-guest-inc
                data-i18n-attr="aria-label:enquiries.a11y.guests_inc_adults"
                aria-label="Increase adults">+</button>
      </span>
    </div>

    <div class="enquiry-form__guests-row" data-guest-row="children">
      <span class="enquiry-form__guests-meta">
        <span class="enquiry-form__guests-label"  data-i18n="enquiries.guests.children_label">Children</span>
        <span class="enquiry-form__guests-caption" data-i18n="enquiries.guests.children_caption">Ages 2 – 12</span>
      </span>
      <span class="enquiry-form__guests-stepper">
        <button type="button" class="enquiry-form__guests-dec" data-guest-dec
                data-i18n-attr="aria-label:enquiries.a11y.guests_dec_children"
                aria-label="Decrease children">&minus;</button>
        <output class="enquiry-form__guests-count" data-guest-count>0</output>
        <button type="button" class="enquiry-form__guests-inc" data-guest-inc
                data-i18n-attr="aria-label:enquiries.a11y.guests_inc_children"
                aria-label="Increase children">+</button>
      </span>
    </div>

    <div class="enquiry-form__guests-row" data-guest-row="infants">
      <span class="enquiry-form__guests-meta">
        <span class="enquiry-form__guests-label"  data-i18n="enquiries.guests.infants_label">Infants</span>
        <span class="enquiry-form__guests-caption" data-i18n="enquiries.guests.infants_caption">Under 2</span>
      </span>
      <span class="enquiry-form__guests-stepper">
        <button type="button" class="enquiry-form__guests-dec" data-guest-dec
                data-i18n-attr="aria-label:enquiries.a11y.guests_dec_infants"
                aria-label="Decrease infants">&minus;</button>
        <output class="enquiry-form__guests-count" data-guest-count>0</output>
        <button type="button" class="enquiry-form__guests-inc" data-guest-inc
                data-i18n-attr="aria-label:enquiries.a11y.guests_inc_infants"
                aria-label="Increase infants">+</button>
      </span>
    </div>

    <div class="enquiry-form__guests-row" data-guest-row="pets">
      <span class="enquiry-form__guests-meta">
        <span class="enquiry-form__guests-label"  data-i18n="enquiries.guests.pets_label">Pets</span>
        <span class="enquiry-form__guests-caption" data-i18n="enquiries.guests.pets_caption">Max 2</span>
      </span>
      <span class="enquiry-form__guests-stepper">
        <button type="button" class="enquiry-form__guests-dec" data-guest-dec
                data-i18n-attr="aria-label:enquiries.a11y.guests_dec_pets"
                aria-label="Decrease pets">&minus;</button>
        <output class="enquiry-form__guests-count" data-guest-count>0</output>
        <button type="button" class="enquiry-form__guests-inc" data-guest-inc
                data-i18n-attr="aria-label:enquiries.a11y.guests_inc_pets"
                aria-label="Increase pets">+</button>
      </span>
    </div>
  </div>

  <span class="sr-only" aria-live="polite" data-enquiry-guests-live></span>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /tmp/vayana-enq && npx node --test assets/js/__tests__/enquiry-guests-markup.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the new test in package.json**

Add `assets/js/__tests__/enquiry-guests-markup.test.mjs` to the `scripts.test` file list in `package.json`.

- [ ] **Step 6: Commit**

```bash
cd /tmp/vayana-enq
git add enquiries/index.html assets/js/__tests__/enquiry-guests-markup.test.mjs package.json
git commit -m "feat(enquiry): replace guest selects with stepper popover markup"
```

---

## Task 2: JS — setupGuests() state machine + payload + retire bfcache snapshot

**Files:**
- Modify: `assets/js/enquiry.js` (element lookups ~138–186; `allFields` ~405; `successPath` ~440–470; bfcache block ~476–522; payload ~677–702; submit validation ~603–616)
- Test: `assets/js/__tests__/enquiry-guests.test.mjs` (new, jsdom)

**Interfaces:**
- Consumes (from Task 1): all `data-enquiry-guests-*` / `data-guest-*` / `data-enquiry-{adults,children,infants,pets}` DOM hooks.
- Produces: `setupGuests(form)` → returns `{ reset() }`. Writes hidden-input `.value` (string ints) on every change. `reset()` restores adults=1/others=0, re-syncs summary + button-disabled state, closes the popover. The submit handler reads `adults/children/infants/pets` hidden inputs; payload gains `pets: pets.value`.

- [ ] **Step 1: Write the failing test**

Create `assets/js/__tests__/enquiry-guests.test.mjs`. Match the jsdom bootstrapping pattern used by the existing jsdom tests in that folder (check `calendar-selection.test.mjs` or `header.test.mjs` for how they set up `global.document`). Core assertions:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
// ... jsdom setup mirroring the sibling tests; import { setupGuests } from '../enquiry.js'
// (export setupGuests from enquiry.js for testability — see Step 3).

function build() {
  document.body.innerHTML = `
    <form data-enquiry-form>
      <div data-enquiry-guests>
        <input type="hidden" name="adults" value="1" data-enquiry-adults>
        <input type="hidden" name="children" value="0" data-enquiry-children>
        <input type="hidden" name="infants" value="0" data-enquiry-infants>
        <input type="hidden" name="pets" value="0" data-enquiry-pets>
        <button data-enquiry-guests-toggle aria-expanded="false" aria-controls="p">
          <span data-enquiry-guests-summary></span></button>
        <div id="p" data-enquiry-guests-popover hidden>
          ${['adults','children','infants','pets'].map(k=>`
          <div data-guest-row="${k}">
            <button data-guest-dec></button>
            <output data-guest-count>0</output>
            <button data-guest-inc></button>
          </div>`).join('')}
        </div>
        <span data-enquiry-guests-live></span>
      </div>
    </form>`;
  // Seed EN strings onto a data attr or stub the i18n lookup the way the
  // module reads it — summary uses enquiries.guests.summary_* keys baked
  // into data-* on the form at build time; in the test, assert the numeric
  // structure (counts + pluralised unit) rather than exact localized words
  // if the module falls back to English literals.
  return document.querySelector('[data-enquiry-form]');
}

test('initial summary reads 1 Guest', () => {
  const form = build();
  setupGuests(form);
  assert.match(form.querySelector('[data-enquiry-guests-summary]').textContent, /1 Guest\b/);
});

test('adults dec is disabled at 1 (min)', () => {
  const form = build(); setupGuests(form);
  const dec = form.querySelector('[data-guest-row="adults"] [data-guest-dec]');
  assert.ok(dec.disabled, 'adults − must be disabled at the min of 1');
});

test('adults+children clamp at 4; inc disables at the sum bound', () => {
  const form = build(); setupGuests(form);
  const aInc = form.querySelector('[data-guest-row="adults"] [data-guest-inc]');
  const cInc = form.querySelector('[data-guest-row="children"] [data-guest-inc]');
  aInc.click(); aInc.click(); aInc.click(); // adults 1→4
  assert.equal(form.querySelector('[data-enquiry-adults]').value, '4');
  assert.ok(aInc.disabled && cInc.disabled, 'both + disabled when adults+children=4');
  cInc.click(); // should be a no-op (disabled)
  assert.equal(form.querySelector('[data-enquiry-children]').value, '0');
});

test('infants and pets clamp at 2', () => {
  const form = build(); setupGuests(form);
  const iInc = form.querySelector('[data-guest-row="infants"] [data-guest-inc]');
  const pInc = form.querySelector('[data-guest-row="pets"] [data-guest-inc]');
  iInc.click(); iInc.click(); iInc.click();
  pInc.click(); pInc.click(); pInc.click();
  assert.equal(form.querySelector('[data-enquiry-infants]').value, '2');
  assert.equal(form.querySelector('[data-enquiry-pets]').value, '2');
  assert.ok(iInc.disabled && pInc.disabled);
});

test('summary shows pets only when >=1: "3 Guests / 1 Pet"', () => {
  const form = build(); setupGuests(form);
  form.querySelector('[data-guest-row="adults"] [data-guest-inc]').click();   // 2 adults
  form.querySelector('[data-guest-row="children"] [data-guest-inc]').click(); // 1 child → 3 guests
  form.querySelector('[data-guest-row="pets"] [data-guest-inc]').click();     // 1 pet
  const s = form.querySelector('[data-enquiry-guests-summary]').textContent;
  assert.match(s, /3 Guests \/ 1 Pet\b/);
});

test('toggle opens/closes popover and flips aria-expanded', () => {
  const form = build(); setupGuests(form);
  const toggle = form.querySelector('[data-enquiry-guests-toggle]');
  const pop = form.querySelector('[data-enquiry-guests-popover]');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(pop.hidden, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /tmp/vayana-enq && npx node --test assets/js/__tests__/enquiry-guests.test.mjs`
Expected: FAIL (`setupGuests` not exported / not defined).

- [ ] **Step 3: Implement `setupGuests` and wire it**

In `assets/js/enquiry.js`:

(a) Add the limits config + helper near the other consts (after `ADULTS_ERROR_MSG`, ~line 101):

```js
// Guest stepper bounds. adults+children share a combined cap of 4
// (COMBINED_MAX); infants and pets are independent 0..2. adults has a
// floor of 1 (required); the others floor at 0. Mirrored server-side in
// worker/src/validation.js for pets; adults/children/infants already
// bounded there.
const GUEST_MIN = { adults: 1, children: 0, infants: 0, pets: 0 };
const GUEST_MAX = { adults: 4, children: 4, infants: 2, pets: 2 };
const COMBINED_MAX = 4; // adults + children
```

(b) Add the exported helper (module scope, after `initEnquiry`'s closing brace or before it — must be reachable for import):

```js
// Guests stepper popover. Replaces the former three <select>s. Writes
// the four hidden inputs (the submit handler's source of truth) and keeps
// a localized summary ("3 Guests / 1 Pet") on the toggle. All bounds are
// enforced here AND re-checked in the submit handler (DevTools can poke
// the hidden values directly). Pluralisation + the summary join come from
// data-* strings the i18n plugin bakes onto the form; English literals are
// the fallback for an unbuilt page / test fixture.
export function setupGuests(form) {
  const wrap = form.querySelector('[data-enquiry-guests]');
  if (!wrap) return null;
  const inputs = {
    adults: form.querySelector('[data-enquiry-adults]'),
    children: form.querySelector('[data-enquiry-children]'),
    infants: form.querySelector('[data-enquiry-infants]'),
    pets: form.querySelector('[data-enquiry-pets]'),
  };
  const toggle = wrap.querySelector('[data-enquiry-guests-toggle]');
  const popover = wrap.querySelector('[data-enquiry-guests-popover]');
  const summaryEl = wrap.querySelector('[data-enquiry-guests-summary]');
  const liveEl = wrap.querySelector('[data-enquiry-guests-live]');

  // Localized summary templates (baked onto the form by the i18n plugin;
  // English fallback here). %N% is the count placeholder.
  const d = form.dataset;
  const T = {
    guest: d.guestsSummaryGuest || '%N% Guest',
    guests: d.guestsSummaryGuests || '%N% Guests',
    pet: d.guestsSummaryPet || '%N% Pet',
    pets: d.guestsSummaryPets || '%N% Pets',
    join: d.guestsSummaryJoin || ' / ',
    live: d.guestsLive || '%LABEL%, %N%',
  };
  const read = (k) => {
    const n = parseInt(inputs[k].value, 10);
    return Number.isFinite(n) ? n : GUEST_MIN[k];
  };
  const clampAll = () => {
    // Floor/ceil each, then enforce the adults+children combined cap by
    // trimming children (adults keeps priority as the required category).
    for (const k of Object.keys(inputs)) {
      let n = read(k);
      n = Math.max(GUEST_MIN[k], Math.min(GUEST_MAX[k], n));
      inputs[k].value = String(n);
    }
    if (read('adults') + read('children') > COMBINED_MAX) {
      inputs.children.value = String(Math.max(0, COMBINED_MAX - read('adults')));
    }
  };
  const fill = (tpl, map) =>
    Object.entries(map).reduce((s, [k, v]) => s.replaceAll(`%${k}%`, v), tpl);
  const renderSummary = () => {
    const guests = read('adults') + read('children') + read('infants');
    const pets = read('pets');
    let s = fill(guests === 1 ? T.guest : T.guests, { N: guests });
    if (pets >= 1) s += T.join + fill(pets === 1 ? T.pet : T.pets, { N: pets });
    summaryEl.textContent = s;
    if (toggle) toggle.setAttribute('aria-label', s);
  };
  const syncButtons = () => {
    const sum = read('adults') + read('children');
    wrap.querySelectorAll('[data-guest-row]').forEach((row) => {
      const k = row.getAttribute('data-guest-row');
      const dec = row.querySelector('[data-guest-dec]');
      const inc = row.querySelector('[data-guest-inc]');
      const n = read(k);
      const atMax = (k === 'adults' || k === 'children')
        ? sum >= COMBINED_MAX : n >= GUEST_MAX[k];
      if (dec) { dec.disabled = n <= GUEST_MIN[k]; dec.setAttribute('aria-disabled', String(dec.disabled)); }
      if (inc) { inc.disabled = atMax;             inc.setAttribute('aria-disabled', String(inc.disabled)); }
      const out = row.querySelector('[data-guest-count]');
      if (out) out.textContent = String(n);
    });
  };
  const refresh = () => { clampAll(); renderSummary(); syncButtons(); };
  const step = (k, delta) => {
    const next = read(k) + delta;
    if (next < GUEST_MIN[k] || next > GUEST_MAX[k]) return;
    if (delta > 0 && (k === 'adults' || k === 'children')
        && read('adults') + read('children') >= COMBINED_MAX) return;
    inputs[k].value = String(next);
    refresh();
    const label = k[0].toUpperCase() + k.slice(1);
    if (liveEl) liveEl.textContent = fill(T.live, { LABEL: label, N: next });
  };

  wrap.querySelectorAll('[data-guest-row]').forEach((row) => {
    const k = row.getAttribute('data-guest-row');
    row.querySelector('[data-guest-dec]')?.addEventListener('click', () => step(k, -1));
    row.querySelector('[data-guest-inc]')?.addEventListener('click', () => step(k, +1));
  });

  const open = () => {
    popover.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    wrap.querySelector('[data-guest-inc]:not([disabled]), [data-guest-dec]:not([disabled])')?.focus();
  };
  const close = (returnFocus) => {
    if (popover.hidden) return;
    popover.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus();
  };
  toggle?.addEventListener('click', () => (popover.hidden ? open() : close()));
  // Outside pointerdown closes.
  document.addEventListener('pointerdown', (e) => {
    if (!popover.hidden && !wrap.contains(e.target)) close(false);
  });
  // Esc closes + returns focus to the toggle.
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) { e.stopPropagation(); close(true); }
  });

  refresh();
  return {
    reset() {
      inputs.adults.value = '1';
      inputs.children.value = '0';
      inputs.infants.value = '0';
      inputs.pets.value = '0';
      refresh();
      close(false);
    },
  };
}
```

(c) In `initEnquiry()`: delete the `adults`/`children`/`infants` select lookups and their entries in the `missing[]` list; replace with a `guests` controller:

```js
const guests = setupGuests(form);
if (!guests) { console.warn('[enquiry] missing [data-enquiry-guests]'); return; }
// read hidden inputs directly where the old code read selects:
const adults = form.querySelector('[data-enquiry-adults]');
const children = form.querySelector('[data-enquiry-children]');
const infants = form.querySelector('[data-enquiry-infants]');
const pets = form.querySelector('[data-enquiry-pets]');
```

(d) `allFields` (~405): replace the `adults` select ref with `toggle` so aria-invalid/focus lands on the visible control:
```js
const guestsToggle = form.querySelector('[data-enquiry-guests-toggle]');
const allFields = [name, checkinEl, checkoutEl, guestsToggle, email, phone, message, consentInput];
```

(e) Submit validation (~603–616): keep the adults gate, now defensive against tampered hidden values, and add pets/combined re-clamp:
```js
const adultsVal = (adults.value || '').trim();
const childrenN = parseInt(children.value, 10);
const infantsN = parseInt(infants.value, 10);
const petsN = parseInt(pets.value, 10);
if (!ALLOWED_ADULTS.has(adultsVal)
    || !Number.isInteger(childrenN) || childrenN < 0 || childrenN > 4
    || parseInt(adultsVal, 10) + childrenN > COMBINED_MAX
    || !Number.isInteger(infantsN) || infantsN < 0 || infantsN > 2
    || !Number.isInteger(petsN) || petsN < 0 || petsN > 2) {
  showError(ADULTS_ERROR_MSG, guestsToggle);
  guestsToggle.focus();
  return;
}
```

(f) Payload (~677): add `pets: pets.value,` right after the `infants` line.

(g) `successPath()`: replace the `sessionStorage.removeItem(SELECT_SNAPSHOT_KEY)` try/catch with `guests.reset();`.

(h) **Delete the bfcache snapshot block** (`SELECT_SNAPSHOT_KEY`, `guestSelects`, both `pagehide`/`pageshow` listeners, ~476–522).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /tmp/vayana-enq && npx node --test assets/js/__tests__/enquiry-guests.test.mjs`
Expected: PASS (6 tests). If the summary tests fail on exact words, confirm the English-fallback literals in `T` match the regexes.

- [ ] **Step 5: Register the new test + run the existing enquiry test**

Add `assets/js/__tests__/enquiry-guests.test.mjs` to `package.json` `scripts.test`. Run `npx node --test assets/js/__tests__/enquiry-errors.test.mjs` — expect PASS (no select assertions there).

- [ ] **Step 6: Commit**

```bash
cd /tmp/vayana-enq
git add assets/js/enquiry.js assets/js/__tests__/enquiry-guests.test.mjs package.json
git commit -m "feat(enquiry): stepper state machine, pets payload, retire bfcache snapshot"
```

---

## Task 3: i18n — guests group + a11y keys (EN + BG), remove dead keys

**Files:**
- Modify: `locales/en.json`, `locales/bg.json`

**Interfaces:**
- Produces (consumed by Task 1 markup `data-i18n`/`data-i18n-attr` + Task 2 `data-*` summary strings): keys under `enquiries.guests.*` and `enquiries.a11y.guests_*`.

- [ ] **Step 1: Add EN keys**

In `locales/en.json` under `enquiries`, add a `guests` object and extend `a11y`:
```json
"guests": {
  "toggle_placeholder": "GUESTS*",
  "adults_label": "Adults",   "adults_caption": "Ages 13 or above",
  "children_label": "Children","children_caption": "Ages 2 – 12",
  "infants_label": "Infants", "infants_caption": "Under 2",
  "pets_label": "Pets",       "pets_caption": "Max 2",
  "summary_guest": "%N% Guest","summary_guests": "%N% Guests",
  "summary_pet": "%N% Pet",   "summary_pets": "%N% Pets",
  "summary_join": " / "
}
```
and in `enquiries.a11y`:
```json
"guests_dialog_aria": "Choose guests",
"guests_dec_adults": "Decrease adults",   "guests_inc_adults": "Increase adults",
"guests_dec_children": "Decrease children","guests_inc_children": "Increase children",
"guests_dec_infants": "Decrease infants", "guests_inc_infants": "Increase infants",
"guests_dec_pets": "Decrease pets",       "guests_inc_pets": "Increase pets",
"guests_live": "%LABEL%, %N%"
```

- [ ] **Step 2: Remove dead EN keys**

Delete `enquiries.form.adults_placeholder`, `children_placeholder`, `infants_placeholder` and `enquiries.a11y.adults_label`, `children_label`, `infants_label` (replaced by the guests group).

- [ ] **Step 3: Mirror in BG with `Код NNN·` prefixes (start 634)**

Add the same keys to `locales/bg.json`, each VALUE prefixed `Код 634·`, `Код 635·`… incrementing. Suggested translations (keep the prefix):
```json
"guests": {
  "toggle_placeholder": "Код 634· ГОСТИ*",
  "adults_label": "Код 635· Възрастни",   "adults_caption": "Код 636· Над 13 години",
  "children_label": "Код 637· Деца",      "children_caption": "Код 638· 2 – 12 години",
  "infants_label": "Код 639· Бебета",     "infants_caption": "Код 640· Под 2 години",
  "pets_label": "Код 641· Домашни любимци","pets_caption": "Код 642· Макс. 2",
  "summary_guest": "Код 643· %N% гост",   "summary_guests": "Код 644· %N% гости",
  "summary_pet": "Код 645· %N% любимец",  "summary_pets": "Код 646· %N% любимци",
  "summary_join": " / "
}
```
and `a11y` BG:
```json
"guests_dialog_aria": "Код 647· Изберете гости",
"guests_dec_adults": "Код 648· Намали възрастни",   "guests_inc_adults": "Код 649· Увеличи възрастни",
"guests_dec_children": "Код 650· Намали деца",      "guests_inc_children": "Код 651· Увеличи деца",
"guests_dec_infants": "Код 652· Намали бебета",     "guests_inc_infants": "Код 653· Увеличи бебета",
"guests_dec_pets": "Код 654· Намали любимци",       "guests_inc_pets": "Код 655· Увеличи любимци",
"guests_live": "%LABEL%, %N%"
```
Note: `summary_join` has no translatable text (just " / "), so it needs no `Код` prefix — but i18n-lint requires key parity, so include the key with value `" / "` in both. Remove the same dead keys from BG (`adults_placeholder` etc.) as in Step 2.

- [ ] **Step 4: Run i18n-lint + its test**

Run: `cd /tmp/vayana-enq && npm run i18n:lint`
Expected: OK (locale parity). Then `npx node --test scripts/__tests__/i18n-plugin.test.mjs scripts/__tests__/i18n-lint.test.mjs` — expect PASS. If a test asserts the removed placeholder keys exist, update that assertion.

- [ ] **Step 5: Commit**

```bash
cd /tmp/vayana-enq
git add locales/en.json locales/bg.json
git commit -m "i18n(enquiry): guests stepper strings + a11y labels (EN+BG), drop dead select keys"
```

---

## Task 4: Worker — accept pets, write Column K, grow row to A:P

**Files:**
- Modify: `worker/src/validation.js` (add pets ~after infants block), `worker/src/sheets.js` (range + values array + comment)
- Test: `worker/__tests__/append-row.test.mjs` (shift indices), `worker/__tests__/locale.test.mjs` (add pets to body)

**Interfaces:**
- Consumes: `body.pets` (string). Produces: `cleaned.pets` (string "0".."2"); row Column K.

- [ ] **Step 1: Update append-row test (write the new expectations first)**

In `worker/__tests__/append-row.test.mjs`:
- Add `pets: '0',` to the `submitBody()` object (after `infants`).
- Replace every `row.length, 15` → `row.length, 16` and every "range A:O" text → "A:P".
- In the price test: `row[11]` → `row[12]` (price), `row[12]`→`row[13]` (consent), `row[13]`→`row[14]` (ip hash), `row[14]`→`row[15]` (locale). Update the inline comment "Column L (index 11)" → "Column M (index 12)" etc.
- In "no price" + "junk price" tests: `row[11]` → `row[12]`.
- Add a new test:
```js
test('POST /submit writes pets into Column K (index 10)', async () => {
  await withCapturedAppend(async (captured) => {
    const res = await worker.fetch(submitReq(submitBody({ pets: '2' })), submitEnv, {});
    assert.equal(res.status, 200);
    const row = captured.appendBody.values[0];
    assert.equal(row[10], '2', 'Column K (index 10) must carry pets');
    assert.equal(row[11], 'Hi', 'message shifts to Column L (index 11)');
    assert.equal(row.length, 16);
  });
});
test('POST /submit with out-of-range pets rejects (400 validation)', async () => {
  const res = await worker.fetch(submitReq(submitBody({ pets: '5' })), submitEnv, {});
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Add pets to locale.test body**

In `worker/__tests__/locale.test.mjs`, add `pets: '0',` to the sample body (after `infants: '0',`) so it stays a valid submission.

- [ ] **Step 3: Run worker tests to verify they fail**

Run: `cd /tmp/vayana-enq/worker && npm install && npx node --test __tests__/append-row.test.mjs`
Expected: FAIL (row is still 15 wide / no pets handling).

- [ ] **Step 4: Implement validation + sheets changes**

`worker/src/validation.js` — after the infants block, add:
```js
// Pets — OPTIONAL, 0..2. Same placeholder/dash tolerance as children/
// infants (normaliseOptionalCount maps ''/'-' → '0'), but a tighter
// ceiling of 2. Out-of-range (e.g. '5') or non-member → invalid, so a
// hand-crafted body can't write junk to Column K. The client UI caps at
// 2, so a real submission is always in range.
const ALLOWED_PETS = new Set(['', '-', '0', '1', '2']);
const petsRaw = typeof body.pets === 'string' ? body.pets : String(body.pets ?? '');
if (!ALLOWED_PETS.has(petsRaw)) {
  invalid.push('pets');
} else {
  cleaned.pets = normaliseOptionalCount(petsRaw);
}
```
Place this so `cleaned.pets` is set after `cleaned.infants` (object key order is cosmetic — sheets.js governs column order — but keep it readable).

`worker/src/sheets.js`:
- Range: `` `'…'!A:O` `` → `` `'…'!A:P` ``.
- In `values`, insert `row.pets,` between `row.infants,` and `row.message,`.
- Update the column-map comment to the 16-column layout (A..P as in Global Constraints).

- [ ] **Step 5: Run worker tests to verify they pass**

Run: `cd /tmp/vayana-enq/worker && npx node --test __tests__/append-row.test.mjs __tests__/locale.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /tmp/vayana-enq
git add worker/src/validation.js worker/src/sheets.js worker/__tests__/append-row.test.mjs worker/__tests__/locale.test.mjs
git commit -m "feat(worker): accept pets field, write Column K, grow enquiry row to A:P"
```

---

## Task 5: CSS — popover styling

**Files:**
- Modify: `assets/css/sections.css` (replace `.enquiry-form__guests` rule at 2648–2652; add popover rules; mobile block ~2904)

**Interfaces:** consumes the Task 1 class names. No test (visual).

- [ ] **Step 1: Replace the guests grid rule + add popover styles**

Replace the `.enquiry-form__guests { … }` rule (lines 2648–2652, the 3-col grid) with position context + popover styling. Reuse existing tokens (`--border`, `--bg-light`, `--radius-form`, `--text-muted`, `--text-dark`, `--space-*`). Key rules:
```css
/* Guests field — a toggle pill that matches the sibling input pills,
   plus an absolutely-positioned stepper popover. Replaces the former
   3-select trio. */
.enquiry-form__guests { position: relative; }

.enquiry-form__guests-toggle {
  width: 100%; min-height: 48px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border); background: var(--bg-light);
  color: var(--text-dark); border-radius: var(--radius-form);
  font-family: var(--font-body); font-size: 1rem; cursor: pointer;
  text-transform: uppercase; letter-spacing: 0.12em;
}
.enquiry-form__guests-popover {
  position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0;
  background: #fff; border: 1px solid var(--border);
  border-radius: var(--radius-form); box-shadow: 0 8px 28px rgba(0,0,0,0.12);
  padding: var(--space-3);
}
.enquiry-form__guests-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3); padding: var(--space-3) 0;
}
.enquiry-form__guests-row + .enquiry-form__guests-row { border-top: 1px solid var(--border); }
.enquiry-form__guests-meta { display: flex; flex-direction: column; gap: 0.15rem; }
.enquiry-form__guests-label { color: var(--text-dark); font-size: 1rem; }
.enquiry-form__guests-caption { color: var(--text-muted); font-size: 0.85rem; }
.enquiry-form__guests-stepper { display: flex; align-items: center; gap: 0.75rem; }
.enquiry-form__guests-dec, .enquiry-form__guests-inc {
  width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid var(--border); background: #fff; color: var(--text-dark);
  font-size: 1.2rem; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.enquiry-form__guests-dec:disabled, .enquiry-form__guests-inc:disabled {
  opacity: 0.35; cursor: not-allowed;
}
.enquiry-form__guests-count { min-width: 1.5ch; text-align: center; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 2: Update the mobile block**

At the responsive `@media` rule (~2904, the old `.enquiry-form__guests { grid-template-columns: 1fr; }`), replace with: ensure the popover stays full-width (it already is via `left:0; right:0`); drop the obsolete grid override. If nothing else is needed, remove the stale rule rather than leave a no-op.

- [ ] **Step 3: Build + visual sanity**

Run: `cd /tmp/vayana-enq && npm run build`
Expected: clean build. Then `npm run dev`, open `/enquiries/`, confirm the pill matches sibling inputs and the popover opens below it.

- [ ] **Step 4: Commit**

```bash
cd /tmp/vayana-enq
git add assets/css/sections.css
git commit -m "style(enquiry): guests stepper popover styling"
```

---

## Task 6: Full suite, build, live-path dry run, PR

**Files:** none (verification + delivery)

- [ ] **Step 1: Full test suite**

Run: `cd /tmp/vayana-enq && cd worker && npm install && cd .. && npm test`
Expected: all green (557 baseline + new tests). Fix any red before proceeding.

- [ ] **Step 2: i18n-lint + build**

Run: `npm run i18n:lint && npm run build`
Expected: OK + clean. Confirm `dist/enquiries/index.html` and `dist/bg/enquiries/index.html` both contain the guests popover with the right language strings and no leftover `<select>`.

- [ ] **Step 3: Push branch + open PR**

```bash
cd /tmp/vayana-enq
git push -u origin feature/enquiry-guests-stepper
gh pr create --title "feat(enquiry): Guests stepper popover + Pets column" --body "<summary of the 6 tasks; note the sheet-header shift must precede merge>"
```

- [ ] **Step 4: pr-reviewer gate**

Dispatch the pr-reviewer agent (Opus, effort high). Fix all findings. Re-run `npm test`.

- [ ] **Step 5: /security-review**

Run the security review; address findings.

- [ ] **Step 6: Sheet header + merge (ordering is load-bearing)**

Once auth is refreshed: via gsheets MCP, `get_metadata` → Enquires tab `sheet_id`; read row 1; `insert_dimension` COLUMNS one blank after the Infants column; `write_range` the "Pets" header; read back row 1 to verify. THEN (only on explicit "merge" from the user) `gh pr merge <n> --squash --delete-branch`. Watch the Pages + Worker deploy; submit one live enquiry and confirm the row lands with Pets in Column K through Column P aligned.

---

## Notes for the executor

- The repo is cloned at `/tmp/vayana-enq` on branch `main`. **Create the feature branch first:** `cd /tmp/vayana-enq && git checkout -b feature/enquiry-guests-stepper`.
- Shell cwd resets to `$HOME` between Bash calls — prefix every command `cd /tmp/vayana-enq && …`.
- The site base is `/vayana-bungalows/` in prod, `/` in dev — don't hardcode.
- Do NOT merge without an explicit "merge" from the user.
- `/usr/bin/curl` for any live checks (PATH issues otherwise).
