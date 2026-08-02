# Dynamic Offers Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static home-page Image-CTA block with a dynamic offers section that renders 1–6 portrait cards fetched at runtime from a new `GET /offers` route on the existing Cloudflare Worker.

**Architecture:** The existing `vayana-enquiries` Worker gains a second route, `GET /offers`, that reads `'Offers'!B3:H8` from the same Google Sheet it already writes to (reusing the JWT service-account token flow), filters rows (enabled + non-empty), and returns JSON edge-cached ~1 min. A new front-end module `offers.js` fetches that JSON, builds cards, and sets a `data-count` attribute; CSS renders a static centered grid on pure-mouse desktop and a scroll-snap swipe carousel on touch devices (reusing PR #91's input-capability media queries verbatim). Localized labels/messages are baked into DOM data-attributes via existing i18n markers and read at runtime (there is no runtime dictionary in this codebase).

**Tech Stack:** Cloudflare Workers (`jose` for JWT, already a dep), Google Sheets v4 REST API, vanilla ES modules bundled by Vite, `node:test` for tests, the repo's custom i18n Vite plugin.

## Global Constraints

- **Node.js ≥ 18** (README prerequisite).
- **No new npm dependencies** — Worker reuses `jose` (already in `worker/package.json`); front-end is vanilla.
- **No new secrets, no new Google permissions** — the offers tab is in the same spreadsheet (`GSHEETS_SHEET_ID = 1d_NAxImy1UbRx70os2sXxWRweduqWevQPR0v6fG7Ew8`) the Worker already accesses; access is per-file.
- **Worker error logging:** every `catch` logs a generic string only — NEVER `err.message` (avoids leaking service-account private-key fragments). Mirror `worker/src/sheets.js`.
- **i18n key parity:** `locales/en.json` and `locales/bg.json` MUST have the identical key set — the i18n plugin throws at build time otherwise. Every added/removed key must be mirrored in both.
- **i18n lint:** `npm run i18n:lint` must stay green — every `data-i18n*` marker needs a key in every dict, and every non-`_note` key must be referenced by ≥1 marker (no orphans).
- **Test invocation (CORRECTION — verified against the repo):** `worker/package.json` has a `test` script (added in Task 2.5) → run Worker tests with `cd worker && npm test` OR directly `cd worker && node --test __tests__/offers.test.mjs`. The ROOT `npm test` uses an **explicit hardcoded file list** (no auto-discovery), so any NEW test file MUST be registered in the root `package.json` `test` script or it will silently not run. Task 2.5 registers `worker/__tests__/offers.test.mjs` and `assets/js/__tests__/offers.test.mjs`.
- **No runtime i18n dictionary exists.** Localized strings reach JS only by (a) build-time `data-i18n`/`data-i18n-attr` markers baking text into the DOM, then reading `textContent`/`dataset`, or (b) hardcoded English fallback literals. Follow pattern (a) for all offers copy.
- **Enquiries route is `/submit`** (not `/enquiries`) — do NOT rename or weaken it.
- **CSS media-query buckets (copy verbatim from `assets/css/sections.css`):**
  - Stepper/desktop-grid enable: `@media (hover: hover) and (pointer: fine) and (not (any-pointer: coarse))`
  - Arrow-hide (pure-touch): `@media not all and (hover: hover) and (pointer: fine)`
- **Currency:** Price before/after are bare numbers in the sheet; the front-end prepends `€`. Discount appends `%`.
- **Enable flag:** an offer shows only when column H, trimmed and lower-cased, `=== 'true'`. Blank / anything else → hidden.
- **Base path:** site is served under `/vayana-bungalows/` in prod, `/` in dev — never hardcode the base; the offers fetch hits the Worker origin (absolute URL from `site-config.js`), so base path does not apply to the fetch, but any asset URLs must use `import.meta.env.BASE_URL`.

---

## File Structure

**Worker (new + modified):**
- Create `worker/src/offers.js` — `fetchOffers(env)`: reads `'<OffersTab>'!B3:H8`, parses + filters, returns an offers array. Reuses a token-getter shared with `sheets.js`.
- Modify `worker/src/sheets.js` — export the internal `getAccessToken(env)` so `offers.js` can reuse the token flow without duplicating the JWT code.
- Modify `worker/src/lib/response.js` — add a `jsonCacheableResponse(body, status, request, env, maxAge)` builder (like `jsonResponse` but with `Cache-Control: public, max-age=<n>` instead of `no-store`) and widen `corsHeaders` allow-methods to include `GET`.
- Modify `worker/src/index.js` — add the `GET /offers` route before/beside the existing `/submit` gate.
- Modify `worker/wrangler.toml` + `worker/.dev.vars.example` — add `GSHEETS_OFFERS_TAB` var.
- Create `worker/__tests__/offers.test.mjs` — route + parse/filter tests (Sheets API mocked).

**Front-end (new + modified):**
- Create `assets/js/offers.js` — `initOffers()`: fetch, render cards, set `data-count`, empty/error states.
- Modify `assets/js/site-config.js` — add `endpoints.offers`.
- Modify `assets/js/main.js` — import + call `initOffers()`.
- Modify `index.html` — replace the `.cta-block` section with the `.offers` section.
- Modify `assets/css/sections.css` — remove `.cta-block*`, add `.offers` / `.offer-card` block.
- Modify `locales/en.json` + `locales/bg.json` — remove `home.cta_block.*` (5 keys), add `home.offers.*` (10 keys).
- Create `assets/js/__tests__/offers.test.mjs` — module render/format/state tests.

---

## Task 1: Worker config — add the offers tab var

**Files:**
- Modify: `worker/wrangler.toml`
- Modify: `worker/.dev.vars.example`

**Interfaces:**
- Produces: `env.GSHEETS_OFFERS_TAB` (string, e.g. `"Offers"`) available to the Worker runtime.

- [ ] **Step 1: Add the var to wrangler.toml**

In `worker/wrangler.toml`, under the existing `[vars]` block (after `SITE_BASE`), add:

```toml
# Tab name within GSHEETS_SHEET_ID holding the offers table (range B3:H8).
# Same spreadsheet file as the Enquires tab — the service account already
# has read access, so no new secret/permission is needed.
GSHEETS_OFFERS_TAB = "Offers"
```

- [ ] **Step 2: Document it in .dev.vars.example**

In `worker/.dev.vars.example`, after the `GSHEETS_ENQUIRES_TAB` line, add:

```
# Tab name holding the offers table (range B3:H8). Same spreadsheet as
# GSHEETS_SHEET_ID. Non-secret — also set in wrangler.toml [vars]; listed
# here so `wrangler dev` mirrors prod config.
GSHEETS_OFFERS_TAB="Offers"
```

- [ ] **Step 3: Commit**

```bash
git add worker/wrangler.toml worker/.dev.vars.example
git commit -m "chore(worker): add GSHEETS_OFFERS_TAB config var"
```

---

## Task 2: Worker — expose the shared access-token getter

**Files:**
- Modify: `worker/src/sheets.js:54` (change `async function getAccessToken` to an exported function)
- Test: `worker/__tests__/offers.test.mjs` (created in Task 4; no test here — this is a pure refactor guarded by the existing `locale.test.mjs` + Task 4)

**Interfaces:**
- Produces: `export async function getAccessToken(env)` → `Promise<string>` (the OAuth access token). Already implemented at `sheets.js:54`; this task only adds the `export` keyword so `offers.js` can import it. Behavior unchanged.

- [ ] **Step 1: Export getAccessToken**

In `worker/src/sheets.js`, change line 54 from:

```js
async function getAccessToken(env) {
```

to:

```js
export async function getAccessToken(env) {
```

Leave everything else in the function unchanged.

- [ ] **Step 2: Verify the existing Worker tests still pass**

Run: `cd worker && npm test`
Expected: PASS (this is a non-behavioral change — adding `export` to an already-defined function).

- [ ] **Step 3: Commit**

```bash
git add worker/src/sheets.js
git commit -m "refactor(worker): export getAccessToken for reuse by offers reader"
```

---

## Task 2.5: Test infrastructure — worker test script + register new test files

**Files:**
- Modify: `worker/package.json` (add a `test` script)
- Modify: `package.json` (append the two new offers test files to the root `test` script)

**Interfaces:**
- Produces: `cd worker && npm test` runs the Worker's `node --test` suite; root `npm test` includes `worker/__tests__/offers.test.mjs` and `assets/js/__tests__/offers.test.mjs`.

Rationale: discovered during Task 2 — `worker/package.json` had no `test` script (so `cd worker && npm test` failed) and the root `test` script is an explicit file list with no auto-discovery (so new test files would silently not run). This task fixes both BEFORE the tasks that add those test files. The two offers test files do not exist yet, so registering them makes root `npm test` fail until Tasks 3/10 create them — that is expected; only run root `npm test` as a gate at Task 12.

- [ ] **Step 1: Add a test script to worker/package.json**

In `worker/package.json`, add to the `scripts` object (after `"tail": "wrangler tail"`):

```json
    "test": "node --test"
```

(Add a comma after the `tail` line.) `node --test` with no args auto-discovers `__tests__/*.test.mjs` under the worker dir.

- [ ] **Step 2: Register the new offers test files in the root test script**

In the root `package.json`, append these two paths to the END of the existing `test` script's `node --test ...` file list (space-separated, before the closing quote):

```
worker/__tests__/offers.test.mjs assets/js/__tests__/offers.test.mjs
```

- [ ] **Step 3: Verify the worker script works on the existing suite**

Run: `cd worker && npm test`
Expected: PASS — the existing `locale.test.mjs` runs (offers.test.mjs doesn't exist yet, so it's simply not present; `node --test` only runs what exists).

- [ ] **Step 4: Commit**

```bash
git add worker/package.json package.json
git commit -m "test(worker): add worker test script + register offers test files"
```

---

## Task 3: Worker — offers reader module (`fetchOffers`)

**Files:**
- Create: `worker/src/offers.js`
- Test: `worker/__tests__/offers.test.mjs` (this task adds the parse/filter tests; route tests come in Task 5)

**Interfaces:**
- Consumes: `getAccessToken(env)` from `./sheets.js` (Task 2); `env.GSHEETS_SHEET_ID`, `env.GSHEETS_OFFERS_TAB`.
- Produces:
  - `export function parseOffers(rows)` → `Offer[]`. `rows` is the raw `values` 2-D array from the Sheets API (each row is an array of cell strings, possibly short/sparse). Returns only enabled, non-empty offers.
  - `export async function fetchOffers(env)` → `Promise<Offer[]>`. Reads `'<tab>'!B3:H8` and returns `parseOffers(values)`.
  - `Offer` shape: `{ dates, discountPct, priceBefore, priceAfter, nights, message }` — each value a trimmed non-empty string, or `null` if that cell was blank.

- [ ] **Step 1: Write the failing test for parseOffers**

Create `worker/__tests__/offers.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOffers } from '../src/offers.js';

// Column order in B3:H8 → row array indices:
//   [0]=B Dates, [1]=C Discount%, [2]=D PriceBefore, [3]=E PriceAfter,
//   [4]=F Nights, [5]=G Message, [6]=H Enable
const enabled = (over = {}) => {
  const base = ['12–18 Jun', '20', '400', '320', '4', 'Free breakfast', 'True'];
  const r = [...base];
  for (const [i, v] of Object.entries(over)) r[i] = v;
  return r;
};

test('keeps a fully-filled enabled offer, mapping columns to fields', () => {
  const out = parseOffers([enabled()]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    dates: '12–18 Jun', discountPct: '20', priceBefore: '400',
    priceAfter: '320', nights: '4', message: 'Free breakfast',
  });
});

test("drops a row whose H is not 'true' (case/space insensitive)", () => {
  assert.equal(parseOffers([enabled({ 6: 'False' })]).length, 0);
  assert.equal(parseOffers([enabled({ 6: '' })]).length, 0);
  assert.equal(parseOffers([enabled({ 6: 'yes' })]).length, 0);
  assert.equal(parseOffers([enabled({ 6: '  TRUE  ' })]).length, 1); // trims+lowercases
});

test('drops an enabled row whose B–G are all blank', () => {
  const row = ['', '', '', '', '', '', 'True'];
  assert.equal(parseOffers([row]).length, 0);
});

test('keeps an enabled row with only ONE field filled; blanks become null', () => {
  const row = ['', '', '', '', '', 'Just a message', 'True'];
  const out = parseOffers([row]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    dates: null, discountPct: null, priceBefore: null,
    priceAfter: null, nights: null, message: 'Just a message',
  });
});

test('handles short/sparse rows (Sheets omits trailing empty cells)', () => {
  // Row physically ends at C but H is logically blank → disabled → dropped.
  assert.equal(parseOffers([['12 Jun', '20']]).length, 0);
});

test('preserves sheet order and treats every surviving row uniformly', () => {
  const out = parseOffers([
    enabled({ 5: 'first' }),
    ['', '', '', '', '', '', 'False'], // disabled → gone
    enabled({ 5: 'third' }),
  ]);
  assert.deepEqual(out.map(o => o.message), ['first', 'third']);
});

test('trims whitespace-only cells to null', () => {
  const out = parseOffers([enabled({ 0: '   ' })]);
  assert.equal(out[0].dates, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && node --test __tests__/offers.test.mjs`
Expected: FAIL — `Cannot find module '../src/offers.js'` (or `parseOffers is not a function`).

- [ ] **Step 3: Implement offers.js**

Create `worker/src/offers.js`:

```js
// Google Sheets read — offers table on the 'Offers' tab.
//
// Reads B3:H8 (up to 6 offers) and returns the ENABLED, NON-EMPTY ones.
// Reuses getAccessToken() from sheets.js (same JWT service-account flow,
// same module-scoped token cache). Like sheets.js, every catch logs ONLY
// a generic string — never err.message — because a stack trace could
// carry service-account private-key fragments.

import { getAccessToken } from './sheets.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column layout of the B3:H8 range, as row-array indices (B is index 0).
const COL = { dates: 0, discountPct: 1, priceBefore: 2, priceAfter: 3, nights: 4, message: 5, enable: 6 };

// A cell → trimmed string, or null when blank/whitespace-only.
function cell(row, idx) {
  const raw = row[idx];
  if (typeof raw !== 'string') return raw == null ? null : String(raw).trim() || null;
  const t = raw.trim();
  return t === '' ? null : t;
}

/**
 * Map + filter the raw Sheets `values` 2-D array into Offer objects.
 * - Enabled only: H (index 6), trimmed + lower-cased, must equal 'true'.
 * - Non-empty only: at least one of B–G (indices 0–5) is non-blank.
 * - Order preserved; offer position/number is irrelevant.
 */
export function parseOffers(rows) {
  if (!Array.isArray(rows)) return [];
  const offers = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const enableRaw = row[COL.enable];
    const enabled = typeof enableRaw === 'string' && enableRaw.trim().toLowerCase() === 'true';
    if (!enabled) continue;
    const offer = {
      dates: cell(row, COL.dates),
      discountPct: cell(row, COL.discountPct),
      priceBefore: cell(row, COL.priceBefore),
      priceAfter: cell(row, COL.priceAfter),
      nights: cell(row, COL.nights),
      message: cell(row, COL.message),
    };
    const hasContent = Object.values(offer).some(v => v !== null);
    if (!hasContent) continue;
    offers.push(offer);
  }
  return offers;
}

/**
 * Read the offers range from the sheet and return parsed offers.
 * Throws a generic Error on any failure (config missing, token, fetch,
 * parse) — the route handler turns that into a 502 without leaking detail.
 */
export async function fetchOffers(env) {
  if (!env.GSHEETS_SHEET_ID || !env.GSHEETS_OFFERS_TAB) {
    throw new Error('offers-config-missing');
  }
  const token = await getAccessToken(env);
  const range = encodeURIComponent(
    `'${env.GSHEETS_OFFERS_TAB.replace(/'/g, "''")}'!B3:H8`,
  );
  const url =
    `${SHEETS_BASE}/${encodeURIComponent(env.GSHEETS_SHEET_ID)}` +
    `/values/${range}?majorDimension=ROWS`;

  let res;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('offers-fetch-failed');
  }
  if (!res.ok) {
    throw new Error(`offers-read-failed:${res.status}`);
  }
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error('offers-parse-failed');
  }
  return parseOffers(payload.values || []);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd worker && node --test __tests__/offers.test.mjs`
Expected: PASS (all `parseOffers` tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/offers.js worker/__tests__/offers.test.mjs
git commit -m "feat(worker): offers reader — parse+filter B3:H8 (enabled, non-empty)"
```

---

## Task 4: Worker — cacheable JSON response + GET in CORS methods

**Files:**
- Modify: `worker/src/lib/response.js:32-44` (corsHeaders) and add `jsonCacheableResponse`
- Test: `worker/__tests__/offers.test.mjs` (add response-builder assertions)

**Interfaces:**
- Consumes: existing `corsHeaders(request, env)`.
- Produces: `export function jsonCacheableResponse(body, status, request, env, maxAge)` → `Response` with `Cache-Control: public, max-age=<maxAge>` and CORS headers. `corsHeaders` now advertises `GET, POST, OPTIONS`.

- [ ] **Step 1: Write the failing test**

Append to `worker/__tests__/offers.test.mjs`:

```js
import { jsonCacheableResponse, corsHeaders } from '../src/lib/response.js';

const req = (origin = 'http://localhost:5173') =>
  new Request('https://w.example/offers', { headers: origin ? { origin } : {} });
const env = { ALLOWED_ORIGINS: 'http://localhost:5173,https://noobcoder1209.github.io' };

test('corsHeaders advertises GET alongside POST and OPTIONS', () => {
  const h = corsHeaders(req(), env);
  assert.match(h['access-control-allow-methods'], /GET/);
  assert.match(h['access-control-allow-methods'], /POST/);
});

test('jsonCacheableResponse sets public max-age and echoes allowed origin', async () => {
  const res = jsonCacheableResponse({ ok: true, offers: [] }, 200, req(), env, 60);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await res.json(), { ok: true, offers: [] });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && node --test __tests__/offers.test.mjs`
Expected: FAIL — `jsonCacheableResponse is not a function` and the GET assertion fails (methods currently `POST, OPTIONS`).

- [ ] **Step 3: Implement the changes**

In `worker/src/lib/response.js`, change the `access-control-allow-methods` line in `corsHeaders` (line ~35) from:

```js
    'access-control-allow-methods': 'POST, OPTIONS',
```

to:

```js
    'access-control-allow-methods': 'GET, POST, OPTIONS',
```

Then add this new export after `jsonResponse` (after line ~62):

```js
// Like jsonResponse but cacheable — used by the read-only GET /offers
// route so the edge (Worker Cache API + browser) can serve repeat hits
// without re-reading the sheet. maxAge is in seconds.
export function jsonCacheableResponse(body, status, request, env, maxAge) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      ...corsHeaders(request, env),
    },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && node --test __tests__/offers.test.mjs`
Expected: PASS.

- [ ] **Step 5: Confirm nothing else regressed**

Run: `cd worker && npm test`
Expected: PASS (existing `locale.test.mjs` unaffected — it doesn't assert the methods string).

- [ ] **Step 6: Commit**

```bash
git add worker/src/lib/response.js worker/__tests__/offers.test.mjs
git commit -m "feat(worker): cacheable JSON response builder + allow GET in CORS"
```

---

## Task 5: Worker — wire the `GET /offers` route

**Files:**
- Modify: `worker/src/index.js:22-32` (imports), `:55-87` (route/method gates)
- Test: `worker/__tests__/offers.test.mjs` (add route-level tests with a mocked `fetchOffers`)

**Interfaces:**
- Consumes: `fetchOffers(env)` (Task 3), `jsonCacheableResponse` + `jsonResponse` + `corsHeaders` (Task 4).
- Produces: `GET /offers` → `200 { ok: true, offers: [...] }` (cache 60s) on success; `502 { ok: false, error: 'offers-unavailable' }` on read failure. `/submit` behavior unchanged. Other paths still `404`. OPTIONS still `204`.

The route handler is small and testable via the exported default fetch handler. Because `index.js` imports `fetchOffers` from `./offers.js`, the route tests stub the network by mocking the Sheets `fetch` (global), not by injecting a fake — matching how the Worker is exercised end-to-end.

- [ ] **Step 1: Write the failing route tests**

Append to `worker/__tests__/offers.test.mjs`:

```js
import worker from '../src/index.js';
import { _resetForTests } from '../src/sheets.js';

// Minimal env for the /offers path. No Turnstile/IP salt needed — /offers
// never reaches those gates. GSHEETS_SA_JSON is a syntactically valid but
// fake SA; we mock global fetch so no real key use occurs.
const FAKE_SA = JSON.stringify({
  client_email: 'x@y.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n',
});
const offersEnv = {
  ALLOWED_ORIGINS: 'http://localhost:5173',
  GSHEETS_SHEET_ID: 'SHEET',
  GSHEETS_OFFERS_TAB: 'Offers',
  GSHEETS_SA_JSON: FAKE_SA,
};
const getReq = (path = '/offers') =>
  new Request(`https://w.example${path}`, {
    method: 'GET',
    headers: { origin: 'http://localhost:5173' },
  });

// Swap global fetch for a scripted stub over the two upstream calls the
// offers path makes: (1) the OAuth token exchange, (2) the Sheets values.get.
function withMockedSheets(valuesOrThrow, run) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('sheets.googleapis.com')) {
      if (valuesOrThrow === 'ERR') return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ values: valuesOrThrow }), { status: 200 });
    }
    return new Response('unexpected', { status: 418 });
  };
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = real; _resetForTests(); });
}

test('GET /offers returns enabled offers as JSON with cache header', async () => {
  await withMockedSheets(
    [['12 Jun', '20', '400', '320', '4', 'Breakfast', 'True']],
    async () => {
      const res = await worker.fetch(getReq(), offersEnv, {});
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.offers.length, 1);
      assert.equal(body.offers[0].message, 'Breakfast');
    },
  );
});

test('GET /offers returns [] when the sheet has no enabled rows', async () => {
  await withMockedSheets(
    [['', '', '', '', '', '', 'False']],
    async () => {
      const res = await worker.fetch(getReq(), offersEnv, {});
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).offers, []);
    },
  );
});

test('GET /offers returns 502 when the sheet read fails', async () => {
  await withMockedSheets('ERR', async () => {
    const res = await worker.fetch(getReq(), offersEnv, {});
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'offers-unavailable');
  });
});

test('POST /offers is rejected (405) — offers is GET-only', async () => {
  const res = await worker.fetch(
    new Request('https://w.example/offers', { method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: '{}' }),
    offersEnv, {},
  );
  assert.equal(res.status, 405);
});

test('GET /submit is rejected (405) — submit stays POST-only', async () => {
  const res = await worker.fetch(getReq('/submit'), offersEnv, {});
  assert.equal(res.status, 405);
});

test('GET on an unknown path is 404', async () => {
  const res = await worker.fetch(getReq('/nope'), offersEnv, {});
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && node --test __tests__/offers.test.mjs`
Expected: FAIL — `GET /offers` currently hits the `pathname !== '/submit'` gate and returns 404.

- [ ] **Step 3: Add the import**

In `worker/src/index.js`, add to the imports (after line 24, `import { appendEnquiry } from './sheets.js';`):

```js
import { fetchOffers } from './offers.js';
```

And update the response import block (lines 26–30) to include the new builder:

```js
import {
  jsonResponse,
  jsonCacheableResponse,
  redirectResponse,
  corsHeaders,
} from './lib/response.js';
```

- [ ] **Step 4: Implement the route**

In `worker/src/index.js`, insert the offers route immediately AFTER the OPTIONS block (after line 64, before the `// 2. Path gate` comment):

```js
    // Offers route — GET /offers only. Read-only, cacheable, no captcha /
    // rate-limit / IP gates (those are enquiry-submit concerns). Placed
    // before the /submit path gate so /offers isn't swallowed by the 404.
    const { pathname } = new URL(request.url);
    if (pathname === '/offers') {
      if (request.method !== 'GET') {
        return jsonResponse({ ok: false, error: 'method' }, 405, request, env);
      }
      try {
        const offers = await fetchOffers(env);
        return jsonCacheableResponse({ ok: true, offers }, 200, request, env, 60);
      } catch {
        // Generic log only — never echo err.message (could leak SA key fragments).
        console.error('offers.fetch failed');
        return jsonResponse({ ok: false, error: 'offers-unavailable' }, 502, request, env);
      }
    }
```

Then REMOVE the now-duplicate `const { pathname } = new URL(request.url);` declaration on the existing line ~69 (the offers block above already declares `pathname` in the same scope). The `/submit` path gate that follows keeps using that same `pathname`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && node --test __tests__/offers.test.mjs`
Expected: PASS (all route tests + the earlier parse/response tests).

- [ ] **Step 6: Full Worker suite + smoke the token cache reset**

Run: `cd worker && npm test`
Expected: PASS (all suites, including `locale.test.mjs`).

- [ ] **Step 7: Commit**

```bash
git add worker/src/index.js worker/__tests__/offers.test.mjs
git commit -m "feat(worker): add GET /offers route (cacheable, GET-only)"
```

---

## Task 6: Front-end config — add the offers endpoint

**Files:**
- Modify: `assets/js/site-config.js:65-68` (endpoints block)

**Interfaces:**
- Produces: `SITE_CONFIG.endpoints.offers` (string, absolute Worker URL ending `/offers`).

- [ ] **Step 1: Add the endpoint**

In `assets/js/site-config.js`, inside the `endpoints` object (after the `enquiry` line, ~line 66), add:

```js
    // Read-only GET endpoint for the home-page offers section. Same Worker
    // origin as `enquiry`, different route. Public. Swap the origin here
    // (only) when a custom domain ships.
    offers: 'https://vayana-enquiries.vayana.workers.dev/offers',
```

- [ ] **Step 2: Sanity-check the bundle still builds**

Run: `npm run build`
Expected: build completes with no error (config is plain data; this just adds a key).

- [ ] **Step 3: Commit**

```bash
git add assets/js/site-config.js
git commit -m "chore(config): add endpoints.offers Worker URL"
```

---

## Task 7: i18n — swap cta_block keys for offers keys

**Files:**
- Modify: `locales/en.json:86-92` (remove `cta_block`, add `offers`)
- Modify: `locales/bg.json` (same keys — remove `cta_block`, add `offers` with BG values)

**Interfaces:**
- Produces: `home.offers.*` keys (10) present in BOTH dicts; `home.cta_block.*` keys (5) removed from BOTH. These keys are referenced by the HTML markers added in Task 8, keeping `i18n:lint` green once Task 8 lands.

Note: after this task, `i18n:lint` will TEMPORARILY report the new keys as orphans (no marker references them yet) and will no longer see `cta_block` markers. Do NOT run the full lint gate until Task 8 adds the markers. This task's verification is JSON validity + key parity only.

- [ ] **Step 1: Remove cta_block, add offers in en.json**

In `locales/en.json`, replace the `cta_block` block (lines 86–92):

```json
    "cta_block": {
      "eyebrow": "A retreat for two",
      "title": "Stay four nights, the fifth is on us.",
      "body": "An invitation to slow down, between June and September, in any of our bungalows.",
      "cta": "View the offer",
      "img_alt": "Infinity pool overlooking the ocean"
    },
```

with:

```json
    "offers": {
      "eyebrow": "Special offers",
      "title": "Current offers",
      "label_dates": "Dates",
      "label_discount": "Discount",
      "label_price_before": "Price before",
      "label_price_after": "Price after",
      "label_nights": "Nights",
      "label_message": "Message",
      "empty": "No current offers at the moment.",
      "error": "Offers are temporarily unavailable. Please try again later."
    },
```

- [ ] **Step 2: Remove cta_block, add offers in bg.json**

In `locales/bg.json`, find the `home.cta_block` block (same nesting under `home`) and replace it with the BG translation:

```json
    "offers": {
      "eyebrow": "Специални оферти",
      "title": "Актуални оферти",
      "label_dates": "Дати",
      "label_discount": "Отстъпка",
      "label_price_before": "Цена преди",
      "label_price_after": "Цена след",
      "label_nights": "Нощувки",
      "label_message": "Съобщение",
      "empty": "В момента няма активни оферти.",
      "error": "Офертите временно не са налични. Моля, опитайте по-късно."
    },
```

Remove the entire `cta_block` object from `bg.json` (the EN one is removed in Step 1).

- [ ] **Step 3: Verify both files are valid JSON and key-parity holds**

Run:
```bash
node -e "const e=require('./locales/en.json'),b=require('./locales/bg.json');const keys=o=>{const s=[];(function w(x,p){for(const k in x){const q=p?p+'.'+k:k;typeof x[k]==='object'&&x[k]?w(x[k],q):s.push(q)}})(o,'');return s.sort()};const ek=keys(e),bk=keys(b);const miss=ek.filter(k=>!bk.includes(k)).concat(bk.filter(k=>!ek.includes(k)));console.log(miss.length?'PARITY FAIL: '+miss.join(', '):'parity OK ('+ek.length+' keys)')"
```
Expected: `parity OK (<n> keys)`. If `PARITY FAIL`, fix the mismatch before committing.

- [ ] **Step 4: Commit**

```bash
git add locales/en.json locales/bg.json
git commit -m "i18n(offers): replace home.cta_block keys with home.offers keys"
```

---

## Task 8: HTML — replace the cta-block section with the offers section

**Files:**
- Modify: `index.html:314-329` (replace `<section class="cta-block section">`)

**Interfaces:**
- Consumes: `home.offers.*` i18n keys (Task 7).
- Produces: a `<section class="offers section">` containing `<div class="offers__grid" data-offers>` with localized labels/messages baked onto it via `data-i18n-attr` (read at runtime by `offers.js` in Task 10). The eyebrow + title use standard `data-i18n` markers.

The card field labels and the empty/error messages are baked as `data-*` attributes on the grid container so `offers.js` can read them from `dataset` — there is NO runtime dictionary in this codebase, so this build-time bake is how JS gets localized copy (mirrors how `enquiry.js` reads `data-busy-label`).

- [ ] **Step 1: Replace the section**

In `index.html`, replace lines 314–329 (the entire `<!-- 11. Image CTA -->` comment through the closing `</section>`):

```html
      <!-- 11. Image CTA -->
      <section class="cta-block section" aria-labelledby="cta-title">
        <div class="container cta-block__inner reveal">
          <div class="cta-block__frame">
            <img src="/assets/img/cta-pool.jpg"
                 data-i18n-attr="alt:home.cta_block.img_alt"
                 alt="Infinity pool overlooking the ocean" loading="lazy" />
          </div>
          <div class="cta-block__copy">
            <span class="eyebrow" data-i18n="home.cta_block.eyebrow">A retreat for two</span>
            <h3 id="cta-title" data-i18n="home.cta_block.title">Stay four nights, the fifth is on us.</h3>
            <p data-i18n="home.cta_block.body">An invitation to slow down, between June and September, in any of our bungalows.</p>
            <a href="#" class="btn btn-primary" data-i18n="home.cta_block.cta">View the offer</a>
          </div>
        </div>
      </section>
```

with:

```html
      <!-- 11. Offers (dynamic — populated by offers.js from GET /offers) -->
      <section class="offers section" aria-labelledby="offers-title">
        <div class="container offers__head reveal">
          <span class="eyebrow" data-i18n="home.offers.eyebrow">Special offers</span>
          <h3 id="offers-title" data-i18n="home.offers.title">Current offers</h3>
        </div>
        <div class="container">
          <!-- Localized card labels + state messages are baked here as
               data-* attributes (no runtime i18n dict exists); offers.js
               reads them from dataset. -->
          <div class="offers__grid"
               data-offers
               data-i18n-attr="data-label-dates:home.offers.label_dates;
                               data-label-discount:home.offers.label_discount;
                               data-label-price-before:home.offers.label_price_before;
                               data-label-price-after:home.offers.label_price_after;
                               data-label-nights:home.offers.label_nights;
                               data-label-message:home.offers.label_message;
                               data-empty-msg:home.offers.empty;
                               data-error-msg:home.offers.error"></div>
        </div>
      </section>
```

- [ ] **Step 2: Verify build strips all markers and emits both locales**

Run: `npm run build`
Expected: build succeeds. Then confirm no marker leaked and the container is present:

```bash
grep -c 'data-i18n-attr=' dist/index.html; echo "--- LIVE attributes, should be 0 (a prose mention in the header KEEP-IN-SYNC comment is NOT a marker; match the '=' to exclude it) ---"
grep -c "data-offers" dist/index.html dist/bg/index.html
grep -o 'data-label-dates="[^"]*"' dist/index.html dist/bg/index.html
```
Expected: first grep `0` (markers stripped); `data-offers` present in both EN and BG; `data-label-dates` shows `Dates` in EN emit and `Дати` in BG emit.

- [ ] **Step 3: Run i18n lint (now green — markers reference the new keys)**

Run: `npm run i18n:lint`
Expected: PASS — every `home.offers.*` key is now referenced, and no `cta_block` markers/keys remain.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(home): replace image-CTA with dynamic offers section markup"
```

---

## Task 9: CSS — remove cta-block, add offers grid + carousel

**Files:**
- Modify: `assets/css/sections.css:777-830` (remove `.cta-block*`), add `.offers` / `.offer-card` block

**Interfaces:**
- Consumes: the `.offers`, `.offers__grid[data-offers]`, `.offer-card` structure from Task 8 + Task 10; the `data-count` attribute set by `offers.js` (Task 10).
- Produces: the visual layout — static centered grid on pure-mouse desktop (row rules by `data-count`), scroll-snap swipe carousel on touch. Uses design tokens from `tokens.css` (`--radius-card`, `--primary`, `--border`, `--bg-*`, `--container-pad`, `--space-*`, `--t-*`).

- [ ] **Step 1: Remove the cta-block rules**

In `assets/css/sections.css`, delete the entire `.cta-block` group — from `.cta-block {` (line ~777) through the closing `}` of its `@media (max-width: 768px)` block (the block ending just before `/* ========== Testimonial ========== */`, line ~830). Remove the mobile media block too.

- [ ] **Step 2: Add the offers styles**

Add this block where the `.cta-block` rules were (keep it adjacent to the other home-section blocks):

```css
/* ========== Offers (dynamic — offers.js) ========== */
.offers {
  background: var(--bg-cream);
}

.offers__head {
  text-align: center;
  margin-bottom: var(--space-6);
}

/* Base = touch/native-scroll carousel (buckets B & C: phones, tablets,
   touch-laptops). One card snaps into view at a time; swipe scrolls. This
   is the SAME model as the photo galleries (see .gallery__track above). */
.offers__grid {
  display: flex;
  gap: 1.5rem;
  padding: 0 var(--container-pad);
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  touch-action: pan-x;
  -webkit-overflow-scrolling: touch;
  justify-content: flex-start;
}

.offers__grid::-webkit-scrollbar { display: none; }

.offer-card {
  flex: 0 0 auto;
  width: clamp(240px, 78vw, 320px); /* portrait card, one-per-view on phones */
  aspect-ratio: 3 / 4;
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
  background: var(--bg-light);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-sizing: border-box;
}

.offer-card__row {
  margin: 0;
  line-height: 1.4;
}

.offer-card__label {
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--primary);
}

/* Empty / error state — a single centered message card. */
.offers__grid[data-count="0"] {
  justify-content: center;
}
.offers__msg {
  flex: 0 0 auto;
  max-width: 32rem;
  text-align: center;
  color: var(--text-muted, currentColor);
  padding: var(--space-5);
}

/* Pure-mouse desktop (bucket A): static centered grid, NO scroll/snap,
   NO carousel. Row rules keyed off data-count. Copied verbatim from the
   gallery stepper media condition so the two never desync. */
@media (hover: hover) and (pointer: fine) and (not (any-pointer: coarse)) {
  .offers__grid {
    display: grid;
    overflow-x: visible;
    scroll-snap-type: none;
    touch-action: auto;
    justify-content: center;
    max-width: 1100px;
    margin-inline: auto;
    grid-template-columns: repeat(3, minmax(0, 280px));
  }
  .offers__grid .offer-card { width: auto; }

  /* 1 / 2 / 3 → single centered row of exactly N columns. */
  .offers__grid[data-count="1"] { grid-template-columns: minmax(0, 280px); }
  .offers__grid[data-count="2"] { grid-template-columns: repeat(2, minmax(0, 280px)); }
  .offers__grid[data-count="3"] { grid-template-columns: repeat(3, minmax(0, 280px)); }
  /* 4 → 2 + 2 (force a 2-column grid; rows wrap naturally). */
  .offers__grid[data-count="4"] { grid-template-columns: repeat(2, minmax(0, 280px)); }
  /* 5 → 3 + 2, 6 → 3 + 3 (3-column grid; last row centers via auto margins
     on the trailing item is unnecessary — grid centering handles it). */
  .offers__grid[data-count="5"],
  .offers__grid[data-count="6"] { grid-template-columns: repeat(3, minmax(0, 280px)); }

  /* 5 cards in a 3-col grid leaves the 4th/5th on row 2; center that row by
     spanning the trailing two across the track with justified centering. The
     grid is already justify-content:center so the short last row is centered
     as a group. No extra rule needed. */

  .offers__msg { grid-column: 1 / -1; }
}
```

- [ ] **Step 3: Build and eyeball the CSS compiles**

Run: `npm run build`
Expected: build succeeds, no CSS syntax error.

- [ ] **Step 4: Commit**

```bash
git add assets/css/sections.css
git commit -m "style(offers): grid (desktop) + scroll-snap carousel (touch)"
```

---

## Task 10: Front-end — offers.js module (fetch + render + states)

**Files:**
- Create: `assets/js/offers.js`
- Test: `assets/js/__tests__/offers.test.mjs`

**Interfaces:**
- Consumes: `SITE_CONFIG.endpoints.offers` (Task 6); the `[data-offers]` container with baked `data-label-*` / `data-empty-msg` / `data-error-msg` attributes (Task 8); the `.offer-card` / `.offers__msg` CSS (Task 9).
- Produces:
  - `export function renderOffers(container, offers)` — builds card DOM, sets `container.dataset.count`. Pure DOM, no network — the unit-testable core.
  - `export function initOffers()` — no-op without `[data-offers]`; fetches the endpoint; calls `renderOffers` on success, or renders the localized empty/error message. Exported for `main.js`.
  - Field render order (one per line, blanks omitted): Dates, Discount (`+ '%'`), Price before (`'€' +`), Price after (`'€' +`), Nights, Message.

- [ ] **Step 1: Write the failing test**

Create `assets/js/__tests__/offers.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOffers } from '../offers.js';

// Minimal DOM stand-in: this module only uses createElement, append,
// textContent, dataset, and className. We use a tiny fake so the test
// runs under plain node:test with no jsdom dependency (matches the repo's
// existing dependency-free test style).
function makeEl() {
  return {
    children: [], dataset: {}, className: '', textContent: '',
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    append(...kids) { this.children.push(...kids); },
    querySelectorAll(sel) {
      // only '.offer-card' and '.offers__msg' are queried in tests
      const cls = sel.replace('.', '');
      const out = [];
      const walk = (n) => { if (n.className && n.className.split(' ').includes(cls)) out.push(n); (n.children||[]).forEach(walk); };
      this.children.forEach(walk);
      return out;
    },
  };
}
// Patch a global document factory the module uses via a small shim.
globalThis.document = { createElement: () => makeEl() };

const container = () => {
  const c = makeEl();
  c.dataset = {
    labelDates: 'Dates', labelDiscount: 'Discount',
    labelPriceBefore: 'Price before', labelPriceAfter: 'Price after',
    labelNights: 'Nights', labelMessage: 'Message',
    emptyMsg: 'No current offers.', errorMsg: 'Unavailable.',
  };
  return c;
};

test('renders one card per offer and sets data-count', () => {
  const c = container();
  renderOffers(c, [
    { dates: '12 Jun', discountPct: '20', priceBefore: '400', priceAfter: '320', nights: '4', message: 'Hi' },
    { dates: '1 Jul', discountPct: null, priceBefore: null, priceAfter: null, nights: null, message: 'Yo' },
  ]);
  assert.equal(c.dataset.count, '2');
  assert.equal(c.querySelectorAll('.offer-card').length, 2);
});

test('omits blank fields (null → no row)', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: null, priceBefore: null, priceAfter: null, nights: null, message: 'Only me' }]);
  const card = c.querySelectorAll('.offer-card')[0];
  const rows = card.querySelectorAll('.offer-card__row');
  assert.equal(rows.length, 1);
});

test('formats discount with % and prices with €', () => {
  const c = container();
  renderOffers(c, [{ dates: null, discountPct: '20', priceBefore: '400', priceAfter: '320', nights: null, message: null }]);
  const rows = c.querySelectorAll('.offer-card')[0].querySelectorAll('.offer-card__row');
  const text = rows.map(r => r.textContent).join('|');
  assert.match(text, /20%/);
  assert.match(text, /€400/);
  assert.match(text, /€320/);
});

test('zero offers → single message card, data-count=0, uses emptyMsg', () => {
  const c = container();
  renderOffers(c, []);
  assert.equal(c.dataset.count, '0');
  const msgs = c.querySelectorAll('.offers__msg');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].textContent, 'No current offers.');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test assets/js/__tests__/offers.test.mjs`
Expected: FAIL — `Cannot find module '../offers.js'`.

- [ ] **Step 3: Implement offers.js**

Create `assets/js/offers.js`:

```js
// Home-page offers section — fetches GET /offers and renders 1–6 cards.
//
// Data comes from the Worker (SITE_CONFIG.endpoints.offers), NOT a static
// file, so this can't reuse bookings-data.js. Localized copy (field labels,
// empty/error messages) is baked onto the [data-offers] container as data-*
// attributes at build time by the i18n plugin (there is no runtime dict);
// we read them from dataset. On any failure the section shows a localized
// error message and the rest of the page is unaffected.
//
// Layout is CSS's job: this module only sets container.dataset.count so the
// stylesheet can pick the right grid (desktop) / carousel (touch) rule.

import { SITE_CONFIG } from './site-config.js';

// Field render order + how each value is decorated. label is the dataset key
// holding the localized label; format wraps the raw sheet value.
const FIELDS = [
  { key: 'dates', label: 'labelDates', format: v => v },
  { key: 'discountPct', label: 'labelDiscount', format: v => `${v}%` },
  { key: 'priceBefore', label: 'labelPriceBefore', format: v => `€${v}` },
  { key: 'priceAfter', label: 'labelPriceAfter', format: v => `€${v}` },
  { key: 'nights', label: 'labelNights', format: v => v },
  { key: 'message', label: 'labelMessage', format: v => v },
];

function buildCard(container, offer) {
  const card = document.createElement('article');
  card.className = 'offer-card';
  for (const field of FIELDS) {
    const raw = offer[field.key];
    if (raw == null || raw === '') continue; // omit blank fields
    const row = document.createElement('p');
    row.className = 'offer-card__row';
    const label = document.createElement('span');
    label.className = 'offer-card__label';
    label.textContent = container.dataset[field.label] || field.key;
    row.append(label, document.createTextNode(field.format(raw)));
    card.append(row);
  }
  return card;
}

function buildMessage(text) {
  const msg = document.createElement('p');
  msg.className = 'offers__msg';
  msg.textContent = text;
  return msg;
}

/**
 * Render offers into the container. Pure DOM (no network) so it's unit
 * testable. Sets dataset.count = number of offers (0 for the empty state).
 */
export function renderOffers(container, offers) {
  // Clear any prior render (loading state / re-init).
  while (container.children && container.children.length) container.children.pop?.();
  if (typeof container.replaceChildren === 'function') container.replaceChildren();

  if (!offers || offers.length === 0) {
    container.dataset.count = '0';
    container.append(buildMessage(container.dataset.emptyMsg || 'No current offers.'));
    return;
  }
  container.dataset.count = String(offers.length);
  for (const offer of offers) container.append(buildCard(container, offer));
}

function renderError(container) {
  container.dataset.count = '0';
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  container.append(buildMessage(container.dataset.errorMsg || 'Offers are temporarily unavailable.'));
}

/**
 * Wire the offers section on the home page. No-op elsewhere.
 */
export function initOffers() {
  const container = document.querySelector('[data-offers]');
  if (!container) return;

  fetch(SITE_CONFIG.endpoints.offers, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      if (!data || data.ok !== true || !Array.isArray(data.offers)) {
        throw new Error('bad-shape');
      }
      renderOffers(container, data.offers);
    })
    .catch((err) => {
      console.warn('[offers] could not load offers:', err.message);
      renderError(container);
    });
}
```

Note on the test shim: the `renderOffers` test uses a fake element whose `children` is a plain array; the `replaceChildren`/`children.pop` clear logic above is written to tolerate both the real DOM (browser) and the array fake (test). In the browser `replaceChildren()` does the clearing; in the fake, the `pop?.()` loop empties the array.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test assets/js/__tests__/offers.test.mjs`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add assets/js/offers.js assets/js/__tests__/offers.test.mjs
git commit -m "feat(offers): offers.js — fetch, render cards, empty/error states"
```

---

## Task 11: Wire initOffers into the page bootstrap

**Files:**
- Modify: `assets/js/main.js:1-14` (imports), `:22-35` (init calls)

**Interfaces:**
- Consumes: `initOffers` from `./offers.js` (Task 10).
- Produces: `initOffers()` runs on every page load (no-ops off the home page via its own `[data-offers]` guard).

- [ ] **Step 1: Add the import**

In `assets/js/main.js`, add after line 14 (`import { initEnquiry } from './enquiry.js';`):

```js
import { initOffers } from './offers.js';
```

- [ ] **Step 2: Add the init call**

In `assets/js/main.js`, add after line 35 (`initEnquiry();`):

```js
  initOffers();
```

- [ ] **Step 3: Build to confirm the module graph resolves**

Run: `npm run build`
Expected: build succeeds; `offers.js` is bundled (no unresolved-import error).

- [ ] **Step 4: Commit**

```bash
git add assets/js/main.js
git commit -m "feat(offers): wire initOffers into main bootstrap"
```

---

## Task 12: Full verification gate + manual browser pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — all suites (i18n plugin/lint/smoke, lang, worker locale, the new worker offers suite, the new front-end offers suite). Note the smoke test rebuilds if `dist/` is stale.

- [ ] **Step 2: i18n lint**

Run: `npm run i18n:lint`
Expected: PASS — no missing keys, no orphans (offers keys referenced, cta_block gone).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: clean build; `dist/index.html` and `dist/bg/index.html` both contain `data-offers` with the correct per-locale labels and NO `data-i18n*` markers.

- [ ] **Step 4: Manual browser pass (Playwright, Firefox — per user standing pref)**

Serve the build and drive it. The Worker endpoint is live, so the offers fetch hits real data; to exercise layout deterministically, verify counts by temporarily toggling sheet rows OR by asserting whatever the sheet currently returns.

Run: `npm run preview` (serves `dist/` under `/vayana-bungalows/`).

Then, using Playwright with Firefox (no `--isolated`), verify on `/vayana-bungalows/`:
- **Desktop (default Firefox viewport, mouse):** offers render as a static centered grid, `[data-offers]` has a numeric `data-count`, no horizontal scrollbar on the grid, no arrows.
- **Phone emulation (narrow, touch):** offers are a horizontal scroll-snap track; swiping moves one card at a time; page still scrolls vertically over the cards.
- **Empty state:** if the sheet currently returns 0 enabled offers, the single localized "No current offers" message shows and `data-count="0"`.
- **BG mirror** (`/vayana-bungalows/bg/`): field labels render in Bulgarian (e.g. "Дати", "Отстъпка").
- **Error path:** with network throttled/offline for the Worker origin, the localized error message shows and the rest of the page is intact.

Record the observed results (counts seen, screenshots) in the PR description.

- [ ] **Step 5: Final commit (if any verification tweaks were needed)**

Only if Step 4 surfaced a fix. Otherwise nothing to commit — the feature is complete across Tasks 1–11.

```bash
git add -A
git commit -m "test(offers): verification pass fixes"
```

---

## Self-Review Notes

- **Spec coverage:** Worker `/offers` (T1–T5) · reuse SA token/no new secret (T2–T3) · enable+non-empty filter, strict 'True' (T3) · 1-min edge cache (T4–T5) · front-end fetch/render (T6, T10, T11) · desktop grid + touch carousel via PR#91 buckets (T9) · labeled rows, €/% formatting, blanks omitted (T9–T10) · zero-offers message + fetch-error message (T9–T10) · i18n EN/BG labels, content as-is (T7–T8) · cta_block removal (T7–T9) · tests + verification gate (T3–T5, T10, T12). All spec sections map to a task.
- **Route correction vs spec:** spec said POST on `/enquiries`; the actual route is `/submit`. Plan uses `/submit` (verified in `index.js:70`).
- **Key-count correction vs spec:** `cta_block` has 5 keys (incl. `img_alt`), not 4 — T7 removes all 5.
- **i18n mechanism:** spec said "read like enquiry.js reads dynamic strings"; the concrete mechanism is build-time `data-i18n-attr` baking onto the container + `dataset` reads (there is no runtime dict). T8/T10 implement exactly that.
- **Type consistency:** `Offer` shape identical across T3 (worker) and T10 (front-end): `{ dates, discountPct, priceBefore, priceAfter, nights, message }`. `renderOffers(container, offers)` / `initOffers()` / `fetchOffers(env)` / `parseOffers(rows)` / `jsonCacheableResponse(...)` / `getAccessToken(env)` names are used identically wherever referenced.
- **Ordering:** T7 intentionally leaves lint red until T8 adds markers — called out in T7's note; the lint gate is only asserted in T8 Step 3 and T12.

## Open items (non-blocking, from the spec)

- Exact per-field placement within the card (currently one-per-line B→G) — a later styling refinement.
- Final heading/eyebrow copy (placeholders "Special offers" / "Current offers") — swap the two `home.offers.eyebrow`/`title` values anytime.
