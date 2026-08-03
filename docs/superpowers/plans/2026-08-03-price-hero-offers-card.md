# Price Hero Offers Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the offer card's generic labeled-rows layout with the Price Hero design (mock Batch 1 #03) on the live site's dynamic offers section.

**Architecture:** Front-end-only change. Rewrite `buildCard` in `assets/js/offers.js` to emit a structured Price Hero DOM, add a `priceAfter`-required filter and a `deriveSave` helper; swap the `.offer-card` internal CSS; swap i18n label keys for three compose keys (EN+BG); update the `[data-offers]` dataset attrs in `index.html`; rewrite the card-structure unit tests. Worker, fetch flow, sheet contract, grid/carousel layout, and empty/error states are untouched.

**Tech Stack:** Vanilla ES module (`offers.js`), `node:test` (dependency-free fake DOM), custom build-time i18n Vite plugin (EN/BG parity enforced), plain CSS with design tokens, Playwright (Firefox) for visual verification.

## Global Constraints

- **Card = Price Hero.** Order: eyebrow(dates) → struck(priceBefore) → hero(priceAfter, REQUIRED) → save pill → pct line(discountPct) → divider → nights → message. Each row omitted when its field is blank; **an offer with blank `priceAfter` is not rendered.**
- **Save pill:** derived `Save €{before−after}` when both prices numeric and `before > after`; else `{discountPct}% off` when discountPct present and `>0`; else no pill.
- **Pct line:** `discountPct` (col C) renders as its own small line whenever present (`>0`), independent of the pill — so a full offer shows BOTH `Save €80` pill and `20% off` line.
- **Prices:** render raw sheet value with `€` prepended, UNLESS the raw already starts with `€` (no double symbol). Sheet holds bare numbers.
- **Numeric parse:** `Number(String(v).replace(/[^0-9.]/g, ''))`; derive saving only when both finite and `before > after`.
- **i18n:** NO runtime dict. Labels come from `container.dataset.*` baked at build time. EN/BG key parity is enforced by the plugin; `npm run i18n:lint` must stay green. Offers section is home-only — no header/footer KEEP-IN-SYNC changes.
- **Test DOM fake** (in `offers.test.mjs`) provides only: `createElement`, `append`, `textContent`, `className`, `dataset`, `querySelectorAll` (by single class), `setAttribute`/`getAttribute`. It has **no `prepend`, no `replaceChildren`, no `createTextNode`**. Production code must keep working under this fake (it already guards `prepend`/`replaceChildren` with feature checks — preserve that pattern; do NOT introduce `createTextNode` or `innerHTML`).
- **Tokens only** for CSS (no hardcoded hex): `--primary-deep`, `--secondary`, `--text-muted`, `--text-dark`, `--border`, `--font-heading`, `--radius-card`, spacing vars. Gold-on-white uses `--primary-deep`.
- Done gate: `npm run build` clean · `npm test` green · `npm run i18n:lint` clean · Playwright (Firefox) buckets pass.

---

## File Structure

- `assets/js/offers.js` — MODIFY: rewrite `buildCard`, add `deriveSave` + `parsePrice` helpers, add `priceAfter` filter in `renderOffers`. Keep `buildMessage`, `renderError`, `initOffers`, fetch flow, `dataset.count`.
- `assets/js/__tests__/offers.test.mjs` — REWRITE: card-structure tests for Price Hero DOM + new helpers; keep the fetch/empty/error tests' intent.
- `index.html` — MODIFY: `[data-offers]` `data-i18n-attr` mapping (drop 6 label attrs, add 3 compose-label attrs).
- `locales/en.json` + `locales/bg.json` — MODIFY: drop 6 `home.offers.label_*`, add `home.offers.save|off|nights`.
- `assets/css/sections.css` — MODIFY: remove `.offer-card__row`/`.offer-card__label`; retune `.offer-card`; add `.offer-card__eyebrow|__struck|__hero|__save|__pct|__divider|__nights|__msg`.

Order rationale: helpers+render (Task 1, TDD) → CSS (Task 2) → i18n+html wiring (Task 3) → visual verification (Task 4). Task 1 is the only logic; 2–3 are declarative; 4 is end-to-end proof.

---

### Task 1: Rewrite the card builder (offers.js) with TDD

**Files:**
- Modify: `assets/js/offers.js`
- Test: `assets/js/__tests__/offers.test.mjs`

**Interfaces:**
- Consumes: offer objects `{ dates, discountPct, priceBefore, priceAfter, nights, message }` (string-or-null each), and `container.dataset` keys `saveLabel`, `offLabel`, `nightsLabel`, `emptyMsg`, `errorMsg`.
- Produces: `renderOffers(container, offers)` (unchanged signature) now (a) filters offers to those with non-blank `priceAfter` before counting/building, (b) builds Price Hero cards. Exports unchanged: `renderOffers`, `initOffers`. New non-exported helpers `parsePrice(v)`, `deriveSave(offer)`.

- [ ] **Step 1: Replace the whole test file with the Price Hero suite**

Overwrite `assets/js/__tests__/offers.test.mjs` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOffers } from '../offers.js';

// Dependency-free DOM fake. offers.js uses only createElement, append,
// textContent, className, dataset, and (guarded) prepend/replaceChildren.
// The fake deliberately omits prepend/replaceChildren/createTextNode to lock
// the module to that minimal surface.
function makeEl() {
  return {
    children: [], dataset: {}, className: '', textContent: '',
    append(...kids) { this.children.push(...kids); },
    querySelectorAll(sel) {
      const cls = sel.replace('.', '');
      const out = [];
      const walk = (n) => {
        if (n.className && n.className.split(' ').includes(cls)) out.push(n);
        (n.children || []).forEach(walk);
      };
      this.children.forEach(walk);
      return out;
    },
  };
}
globalThis.document = { createElement: () => makeEl() };

const container = () => {
  const c = makeEl();
  c.dataset = {
    saveLabel: 'Save', offLabel: 'off', nightsLabel: 'nights',
    emptyMsg: 'No current offers.', errorMsg: 'Unavailable.',
  };
  return c;
};

const full = () => ({
  dates: '12–18 Jun 2026', discountPct: '20',
  priceBefore: '400', priceAfter: '320', nights: '4',
  message: 'Free breakfast included',
});
const txt = (card, cls) => {
  const n = card.querySelectorAll(cls);
  return n.length ? n[0].textContent : null;
};

test('full offer → all Price Hero rows present with correct text', () => {
  const c = container();
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__eyebrow'), '12–18 Jun 2026');
  assert.equal(txt(card, '.offer-card__struck'), '€400');
  assert.equal(txt(card, '.offer-card__hero'), '€320');
  assert.equal(txt(card, '.offer-card__save'), 'Save €80');
  assert.equal(txt(card, '.offer-card__pct'), '20% off');
  assert.equal(txt(card, '.offer-card__nights'), '4 nights');
  assert.equal(txt(card, '.offer-card__msg'), 'Free breakfast included');
});

test('save pill = derived euro when both prices present and before > after', () => {
  const c = container();
  renderOffers(c, [{ ...full(), discountPct: null, message: null, dates: null, nights: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__save'), 'Save €80');
});

test('pill falls back to "% off" when no before-price but discountPct present', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '20', priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__save'), '20% off');
});

test('pill AND pct line co-occur when both prices and discountPct present', () => {
  const c = container();
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__save'), 'Save €80'); // euro pill
  assert.equal(txt(card, '.offer-card__pct'), '20% off');   // separate line
});

test('no pill when neither euro saving nor discountPct available', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
});

test('only priceAfter present → hero only, no other rows, no divider', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), '€320');
  assert.equal(card.querySelectorAll('.offer-card__struck').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__pct').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__nights').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__msg').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__divider').length, 0);
});

test('offer without priceAfter is dropped; count matches rendered cards', () => {
  const c = container();
  renderOffers(c, [full(), { ...full(), priceAfter: null }]);
  assert.equal(c.querySelectorAll('.offer-card').length, 1);
  assert.equal(c.dataset.count, '1');
});

test('all offers lack priceAfter → empty message, count 0', () => {
  const c = container();
  renderOffers(c, [{ ...full(), priceAfter: null }, { ...full(), priceAfter: '' }]);
  assert.equal(c.querySelectorAll('.offer-card').length, 0);
  assert.equal(c.dataset.count, '0');
  const msgs = c.querySelectorAll('.offers__msg');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].textContent, 'No current offers.');
});

test('zero offers → single message card, count 0', () => {
  const c = container();
  renderOffers(c, []);
  assert.equal(c.dataset.count, '0');
  assert.equal(c.querySelectorAll('.offers__msg').length, 1);
});

test('compose labels come from dataset', () => {
  const c = container();
  c.dataset.saveLabel = 'Спестявате';
  c.dataset.offLabel = 'отстъпка';
  c.dataset.nightsLabel = 'нощувки';
  renderOffers(c, [full()]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__save'), 'Спестявате €80');
  assert.equal(txt(card, '.offer-card__pct'), '20% отстъпка');
  assert.equal(txt(card, '.offer-card__nights'), '4 нощувки');
});

test('€ guard: priceAfter already prefixed does not double the symbol', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: '€320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__hero'), '€320');
});

test('discountPct of 0 → no pct line and no pct pill fallback', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '0', priceBefore: null, priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(card.querySelectorAll('.offer-card__pct').length, 0);
  assert.equal(card.querySelectorAll('.offer-card__save').length, 0);
});

test('bad data: before < after → no euro saving; pct pill fallback if present', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '20', priceBefore: '300', priceAfter: '320', nights: null, message: null }]);
  const card = c.querySelectorAll('.offer-card')[0];
  assert.equal(txt(card, '.offer-card__struck'), '€300'); // present field still shown
  assert.equal(txt(card, '.offer-card__save'), '20% off'); // euro not derivable → pct fallback
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd /tmp/repo-analysis/vayana-bungalows && node --test assets/js/__tests__/offers.test.mjs`
Expected: FAIL — the current `buildCard` emits `.offer-card__row`/`__label`, so `.offer-card__hero` etc. are absent; several assertions fail.

- [ ] **Step 3: Rewrite `buildCard` + add helpers in `offers.js`**

In `assets/js/offers.js`, DELETE the `FIELDS` array and the current `buildCard` function. Add these helpers and the new `buildCard` (place above `renderOffers`):

```js
// Parse a raw sheet price string (bare number, maybe with € or spaces) to a
// finite number, or NaN. Tolerates "€400", "400", " 400 ".
function parsePrice(v) {
  if (v == null || v === '') return NaN;
  return Number(String(v).replace(/[^0-9.]/g, ''));
}

// Prepend € unless the raw value already carries it (avoid €€).
function euro(raw) {
  const s = String(raw);
  return s.startsWith('€') ? s : `€${s}`;
}

// A positive integer-ish discount, or null.
function pctValue(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Decide the save pill: euro saving preferred, pct fallback, else null.
// Returns the ready-to-render text or null.
function deriveSave(offer, dataset) {
  const before = parsePrice(offer.priceBefore);
  const after = parsePrice(offer.priceAfter);
  const saveLabel = dataset.saveLabel || 'Save';
  const offLabel = dataset.offLabel || 'off';
  if (Number.isFinite(before) && Number.isFinite(after) && before > after) {
    return `${saveLabel} €${before - after}`;
  }
  const pct = pctValue(offer.discountPct);
  if (pct != null) return `${pct}% ${offLabel}`;
  return null;
}

// Build one Price Hero card. priceAfter is guaranteed non-blank by the caller.
function buildCard(container, offer) {
  const ds = container.dataset;
  const card = document.createElement('article');
  card.className = 'offer-card';

  const add = (cls, text) => {
    const el = document.createElement('p');
    el.className = cls;
    el.textContent = text;
    card.append(el);
    return el;
  };

  if (offer.dates) add('offer-card__eyebrow', offer.dates);
  if (offer.priceBefore) add('offer-card__struck', euro(offer.priceBefore));
  add('offer-card__hero', euro(offer.priceAfter)); // required

  const save = deriveSave(offer, ds);
  if (save) add('offer-card__save', save);

  const pct = pctValue(offer.discountPct);
  if (pct != null) add('offer-card__pct', `${pct}% ${ds.offLabel || 'off'}`);

  // Divider only when something follows it (nights or message present).
  const hasFooter = !!offer.nights || !!offer.message;
  if (hasFooter) {
    const d = document.createElement('span');
    d.className = 'offer-card__divider';
    card.append(d);
  }

  if (offer.nights) add('offer-card__nights', `${offer.nights} ${ds.nightsLabel || 'nights'}`);
  if (offer.message) add('offer-card__msg', offer.message);

  return card;
}
```

- [ ] **Step 4: Add the `priceAfter` filter in `renderOffers`**

In `renderOffers`, after the clear-children block and BEFORE the empty check, filter:

```js
export function renderOffers(container, offers) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else if (Array.isArray(container.children)) container.children.length = 0;

  // Price Hero requires a hero (price-after). Drop offers without one so the
  // count matches rendered cards and the empty state triggers if all drop.
  const shown = (offers || []).filter((o) => o.priceAfter != null && o.priceAfter !== '');

  if (shown.length === 0) {
    container.dataset.count = '0';
    container.append(buildMessage(container.dataset.emptyMsg || 'No current offers.'));
    return;
  }
  container.dataset.count = String(shown.length);
  for (const offer of shown) container.append(buildCard(container, offer));
}
```

Leave `buildMessage`, `renderError`, `initOffers`, and the fetch flow unchanged.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd /tmp/repo-analysis/vayana-bungalows && node --test assets/js/__tests__/offers.test.mjs`
Expected: PASS (all cases).

- [ ] **Step 6: Run the full unit suite (no regressions elsewhere)**

Run: `cd /tmp/repo-analysis/vayana-bungalows && npm test`
Expected: PASS. (Worker offers test + i18n smoke unaffected by this task.)

- [ ] **Step 7: Commit**

```bash
cd /tmp/repo-analysis/vayana-bungalows
git add assets/js/offers.js assets/js/__tests__/offers.test.mjs
git commit -m "feat(offers): render Price Hero card (price-after required, derived save)"
```

---

### Task 2: Price Hero CSS (sections.css)

**Files:**
- Modify: `assets/css/sections.css` (the `.offer-card` block, currently lines ~803–829)

**Interfaces:**
- Consumes: the DOM classes emitted by Task 1 (`.offer-card__eyebrow|__struck|__hero|__save|__pct|__divider|__nights|__msg`).
- Produces: styled Price Hero card. The `.offer-card` box keeps its flex-column / 3:4 / width-clamp / scroll-snap / border / radius so `.offers__grid` layout is unaffected.

- [ ] **Step 1: Replace the `.offer-card__row` / `.offer-card__label` rules and retune `.offer-card`**

In `assets/css/sections.css`, find the block starting `.offer-card {` (~L803). Keep the box properties but change the inner layout, and REPLACE the two `.offer-card__row` and `.offer-card__label` rules entirely with the Price Hero rules:

```css
.offer-card {
  flex: 0 0 auto;
  width: clamp(240px, 78vw, 320px);
  aspect-ratio: 3 / 4;
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;   /* Price Hero is vertically centered */
  align-items: center;       /* center the pill and rows */
  text-align: center;
  gap: 0;                     /* spacing is margin-driven per element */
  padding: var(--space-5);
  background: var(--bg-light);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-sizing: border-box;
}

.offer-card p { margin: 0; }

.offer-card__eyebrow {
  font-size: 0.65rem;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-muted);
}
.offer-card__struck {
  font-size: 1rem;
  margin: 0.75rem 0 0.15rem;
  text-decoration: line-through;
  color: var(--text-muted);
}
.offer-card__hero {
  font-family: var(--font-heading);
  font-size: clamp(2.6rem, 12vw, 3.6rem); /* fits the 240px narrow card */
  line-height: 1;
  color: var(--primary-deep);
}
.offer-card__save {
  align-self: center;
  margin-top: 0.75rem;
  font-size: 0.7rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #fff;
  background: var(--secondary);
  padding: 0.3rem 0.7rem;
  border-radius: 20px;
}
.offer-card__pct {
  margin-top: 0.5rem;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.offer-card__divider {
  width: 40px;
  height: 1px;
  background: var(--border);
  margin: 1.5rem auto;
}
.offer-card__nights {
  font-size: 0.85rem;
  color: var(--text-dark);
}
.offer-card__msg {
  margin-top: 0.6rem;
  font-size: 0.78rem;
  font-style: italic;
  color: var(--secondary);
}
```

> The `#fff` on `.offer-card__save` matches the mock and the existing `.v3 .save`
> (white text on sage) — acceptable as a literal since there is no white token;
> it mirrors other pill/badge rules already in this file.

- [ ] **Step 2: Build to confirm CSS compiles into both locales**

Run: `cd /tmp/repo-analysis/vayana-bungalows && npm run build`
Expected: build succeeds (CSS has no syntax error; the offers section still emits).

- [ ] **Step 3: Commit**

```bash
cd /tmp/repo-analysis/vayana-bungalows
git add assets/css/sections.css
git commit -m "style(offers): Price Hero card layout (hero price, save pill, divider)"
```

---

### Task 3: i18n key swap + index.html dataset wiring

**Files:**
- Modify: `locales/en.json`, `locales/bg.json`
- Modify: `index.html` (the `[data-offers]` `data-i18n-attr`, ~lines 324–333)

**Interfaces:**
- Consumes: nothing new.
- Produces: `container.dataset.saveLabel|offLabel|nightsLabel` baked at build time; `emptyMsg`/`errorMsg` unchanged. Drops the 6 unused `label_*` keys.

- [ ] **Step 1: Swap the EN offers keys**

In `locales/en.json`, in the `home.offers` object, DELETE these 6 keys:
`label_dates`, `label_discount`, `label_price_before`, `label_price_after`,
`label_nights`, `label_message`. ADD these 3 (keep `eyebrow`, `title`,
`empty`, `error`):

```json
      "save": "Save",
      "off": "off",
      "nights": "nights",
```

Resulting `home.offers` (EN): `eyebrow`, `title`, `save`, `off`, `nights`, `empty`, `error`.

- [ ] **Step 2: Swap the BG offers keys (parity)**

In `locales/bg.json`, in `home.offers`, DELETE the same 6 `label_*` keys and ADD:

```json
      "save": "Спестявате",
      "off": "отстъпка",
      "nights": "нощувки",
```

Both dicts must have the identical key set under `home.offers`.

- [ ] **Step 3: Update the `[data-offers]` dataset mapping in index.html**

In `index.html`, replace the `data-i18n-attr` value on the `.offers__grid`
element (lines ~324–333) so it maps the 3 new compose labels instead of the 6
old field labels (keep the empty/error mappings):

```html
          <div class="offers__grid"
               data-offers
               data-i18n-attr="data-save-label:home.offers.save;
                               data-off-label:home.offers.off;
                               data-nights-label:home.offers.nights;
                               data-empty-msg:home.offers.empty;
                               data-error-msg:home.offers.error"></div>
```

(`data-save-label` → `dataset.saveLabel`, etc. — matches what `buildCard`/`deriveSave` read.)

- [ ] **Step 4: Lint i18n (parity + markers)**

Run: `cd /tmp/repo-analysis/vayana-bungalows && npm run i18n:lint`
Expected: PASS — no orphaned keys, EN/BG parity holds, `data-i18n-attr` markers resolve to existing keys.

- [ ] **Step 5: Build both locales**

Run: `cd /tmp/repo-analysis/vayana-bungalows && npm run build`
Expected: PASS. Grep the built home page to confirm the new attrs baked in:
`grep -o 'data-save-label="[^"]*"' dist/index.html` → shows "Save" (EN build).

- [ ] **Step 6: Commit**

```bash
cd /tmp/repo-analysis/vayana-bungalows
git add locales/en.json locales/bg.json index.html
git commit -m "i18n(offers): swap field-label keys for save/off/nights compose labels"
```

---

### Task 4: End-to-end visual verification (Playwright, Firefox)

**Files:**
- Create (throwaway, not committed): a local Playwright script under `/tmp`.

**Interfaces:**
- Consumes: the built `dist/` (or a static serve honoring the `/vayana-bungalows/` base) + a mocked `/offers` response.
- Produces: confirmation the Price Hero card renders across counts and buckets with no clipping. No repo file output.

- [ ] **Step 1: Build the site**

Run: `cd /tmp/repo-analysis/vayana-bungalows && npm run build`
Expected: clean build; `dist/index.html` present.

- [ ] **Step 2: Serve dist under the correct base path**

The `/vayana-bungalows/` base only applies to `build`, and `vite preview` does not
serve it in a way that loads the hashed assets at that path reliably. Use a tiny
static server that maps `/vayana-bungalows/<path>` → `dist/<path>` on a fixed port
(e.g. write `/tmp/vayana-static.cjs` serving `dist` under the base on port 4180),
and run it in the background.

Expected: `http://localhost:4180/vayana-bungalows/` serves the built home page with assets 200.

- [ ] **Step 3: Playwright script — mock /offers, assert Price Hero across counts + buckets**

Write `/tmp/verify-pricehero.cjs` (Firefox, per repo pref; no `--isolated`) that, for offer counts 1, 3, 5, 6:
- `page.route('**/offers', …)` fulfilling `{ ok: true, offers: [...] }` with the sample offer repeated N times (dates, discountPct '20', priceBefore '400', priceAfter '320', nights '4', message 'Free breakfast included').
- desktop viewport (1280×900, default pointer:fine) → assert `.offers__grid` is a grid, N `.offer-card`, each has `.offer-card__hero` = "€320", `.offer-card__save` = "Save €80", `.offer-card__pct` = "20% off"; assert `document.scrollWidth <= innerWidth+2` (no h-scroll) and no card `scrollHeight > clientHeight+6` (no clip).
- touch viewport (390×844, `hasTouch:true`) → assert `.offers__grid` scroll-snaps (overflow-x auto) and a single card is ~one-per-view; hero still renders.
- Two extra cases: an offer with `priceAfter:null` mixed in → asserts it's dropped (count matches); an offer with only `priceAfter` → hero only, no divider.
- Screenshot each count to `/tmp/pricehero-<n>.png`.

Run: `GLOBAL_NM=$(npm root -g) && NODE_PATH="$GLOBAL_NM" node /tmp/verify-pricehero.cjs`
Expected: JSON report shows, for every count, correct hero/save/pct text, no overflow, no clipping, grid on desktop + carousel on touch.

- [ ] **Step 4: Eyeball the screenshots**

Read `/tmp/pricehero-1.png`, `-3.png`, `-5.png`, `-6.png`. Confirm: centered Price Hero, hero €320 dominant, small struck €400, sage "SAVE €80" pill, "20% off" line, divider, "4 nights", italic message; 5-count row-2 centered under row-1 (existing layout rule); narrow touch card not clipping the 3.6rem hero (clamp should hold).

- [ ] **Step 5: Final gate**

Run: `cd /tmp/repo-analysis/vayana-bungalows && npm run i18n:lint && npm test && npm run build`
Expected: all green. This is the done gate.

(No commit — Task 4 produces only throwaway `/tmp` artifacts. If Step 4 reveals a spacing/clip issue, fix it in `sections.css` under Task 2's file and amend/commit there.)

---

## Self-Review

**Spec coverage:** eyebrow/struck/hero/save/pct/divider/nights/msg mapping (Task 1 build + Task 2 CSS); save-pill euro-then-pct-then-none rules (Task 1 `deriveSave` + tests); pct-line co-occurrence (Task 1 test "pill AND pct line co-occur"); price-after-required drop + empty fallback (Task 1 filter + tests); €-double-symbol guard (Task 1 `euro` + test); numeric parse tolerance (Task 1 `parsePrice`); `discountPct` 0 handling (Task 1 `pctValue` + test); bad-data before<after (Task 1 test); i18n key swap EN+BG + parity (Task 3); dataset attr rewrite (Task 3); CSS swap keeping the box (Task 2); Playwright buckets 1–6 (Task 4). All spec sections map to a task. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete and concrete; the Playwright script is described step-by-step with exact assertions (the static-server + route-mock approach mirrors the prior offers feature's verified method). ✓

**Type consistency:** dataset keys are consistent across tasks — `saveLabel`/`offLabel`/`nightsLabel` used in Task 1 code, produced by Task 3's `data-save-label`/`data-off-label`/`data-nights-label` (camelCase dataset mapping). Class names identical between Task 1 (emit) and Task 2 (style). `deriveSave(offer, dataset)` signature matches its call in `buildCard`. `renderOffers` signature unchanged. ✓
