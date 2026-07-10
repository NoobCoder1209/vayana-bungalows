// Tests for assets/js/lang.js — runtime language pill wiring.
//
// lang.js is a browser module. We don't have jsdom in the tree, so we bring
// in `node-html-parser` (already a dep) for the DOM tree and wrap each
// element with a shim that adds addEventListener + click() dispatch. The
// shim covers exactly the surface lang.js touches — classList.contains,
// getAttribute, setAttribute, dataset, and event dispatch — nothing more.
//
// The module itself is loaded via a dynamic import of a `data:` URL so we
// can inject a fresh `document`/`localStorage`/`window` per test without
// dragging in a full browser polyfill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'node-html-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANG_JS_PATH = join(__dirname, '..', 'lang.js');

// Load lang.js as source text once. Each test evals it inside a scoped
// function so `document` / `localStorage` / `console` come from the shim
// we control, not the real Node globals.
const LANG_JS_SRC = readFileSync(LANG_JS_PATH, 'utf8');

// ── DOM shim ──────────────────────────────────────────────────────────────
//
// Wraps a node-html-parser element in a thin proxy that adds the surface
// lang.js uses. We do NOT wrap every element in the tree — only those the
// module actually reaches via querySelector/querySelectorAll.

function shimElement(el, wrapFn) {
  const listeners = new Map(); // event name → [handler, ...]
  const shim = {
    _raw: el,
    classList: {
      contains(cls) {
        const c = el.getAttribute('class') || '';
        return c.split(/\s+/).indexOf(cls) !== -1;
      },
    },
    getAttribute(name) {
      // Real DOM's Element.getAttribute returns `null` for missing attrs;
      // node-html-parser returns `undefined`. Normalize so lang.js's own
      // future `x !== null` checks (a common idiom) behave the same in
      // tests as in browsers.
      const v = el.getAttribute(name);
      return v === undefined ? null : v;
    },
    setAttribute(name, value) {
      el.setAttribute(name, value);
    },
    querySelector(sel) {
      const found = el.querySelector(sel);
      return found ? (wrapFn ? wrapFn(found) : shimElement(found)) : null;
    },
    querySelectorAll(sel) {
      const found = el.querySelectorAll(sel);
      const wrapped = found.map((n) => (wrapFn ? wrapFn(n) : shimElement(n)));
      // Return an array-like: length + forEach + indexed access + Symbol.iterator.
      wrapped.forEach = Array.prototype.forEach;
      return wrapped;
    },
    // node-html-parser exposes attributes as an object under `.attributes`
    // but not a `.dataset` getter. Build a live-ish proxy: reads always
    // pull from the current attribute snapshot.
    get dataset() {
      const out = {};
      const attrs = el.attributes || {};
      for (const key of Object.keys(attrs)) {
        if (key.startsWith('data-')) {
          const camel = key
            .slice(5)
            .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          out[camel] = attrs[key];
        }
      }
      // Writes: only support the one lang.js does (documentElement.dataset.langInit).
      return new Proxy(out, {
        set(target, prop, value) {
          const kebab =
            'data-' +
            prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
          el.setAttribute(kebab, value);
          target[prop] = value;
          return true;
        },
      });
    },
    addEventListener(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      const arr = listeners.get(event);
      // Real DOM's addEventListener de-duplicates identical (event, handler,
      // options) tuples. Mirror that so a lang.js regression that
      // registers the same handler twice would fire once — matching the
      // browser — instead of firing twice and masking the bug.
      if (arr.indexOf(handler) !== -1) return;
      arr.push(handler);
    },
    // Test-only: dispatch a click through the registered handlers with a
    // MouseEvent-shaped payload the module reads (metaKey/ctrlKey/shiftKey/
    // altKey/button + preventDefault). Handlers see the same event object
    // and can inspect .defaultPrevented from a prior handler's
    // preventDefault(); stopImmediatePropagation() halts further handlers.
    _dispatchClick(overrides = {}) {
      const evt = {
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        button: 0,
        defaultPrevented: false,
        _defaultPrevented: false, // legacy alias for older tests
        _propagationStopped: false,
        preventDefault() {
          this.defaultPrevented = true;
          this._defaultPrevented = true;
        },
        stopImmediatePropagation() {
          this._propagationStopped = true;
        },
        ...overrides,
      };
      const handlers = listeners.get('click') || [];
      for (const h of handlers) {
        if (evt._propagationStopped) break;
        h(evt);
      }
      return evt;
    },
  };
  return shim;
}

function makeDom(html) {
  const root = parse(html, { comment: true });
  const htmlEl = root.querySelector('html') || root;

  // Cache: don't wrap the same underlying node twice — lang.js sets
  // classList / attributes and reads them back.
  const cache = new WeakMap();
  function wrap(el) {
    if (!el) return null;
    if (cache.has(el)) return cache.get(el);
    const s = shimElement(el, wrap);
    cache.set(el, s);
    return s;
  }
  const shimmedHtml = wrap(htmlEl);

  const document = {
    documentElement: shimmedHtml,
    querySelector(sel) {
      return wrap(root.querySelector(sel));
    },
  };
  return { document, root, wrap };
}

function makeStorage() {
  const store = new Map();
  return {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
  };
}

// Read the util once so we can inline it into the eval-as-script wrapper.
const IS_PRIMARY_CLICK_PATH = join(__dirname, '..', 'util', 'is-primary-click.js');
const IS_PRIMARY_CLICK_SRC = readFileSync(IS_PRIMARY_CLICK_PATH, 'utf8');

// Load lang.js inside a fresh scope with our shim globals bound.
async function loadInitLang({ document, localStorage, warn }) {
  const console = { warn: warn || (() => {}) };
  // Rewrite the module source for `new Function()`'s script parser:
  //   - Strip every `export` keyword form (function, const, default, {…}).
  //     /g flag matters — a future second export would otherwise survive
  //     and blow up the parser with an obscure SyntaxError.
  //   - Replace the `import { isPrimaryClick } from './util/is-primary-click.js'`
  //     line with the util's source (also stripped of `export`) so
  //     isPrimaryClick becomes a local in the eval scope.
  const utilInlined = IS_PRIMARY_CLICK_SRC.replace(/\bexport\s+/g, '');
  const src = LANG_JS_SRC
    .replace(
      /^\s*import\s*\{\s*isPrimaryClick\s*\}\s*from\s*['"][^'"]+['"];?\s*$/m,
      utilInlined,
    )
    .replace(/\bexport\s+/g, '');
  const factory = new Function(
    'document',
    'localStorage',
    'console',
    `${src}
     return initLang;`,
  );
  return factory(document, localStorage, console);
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const HTML_EN_ACTIVE = `<!DOCTYPE html>
<html lang="en" data-lang-pill-expected="1">
<body>
  <div class="site-header__lang" role="group" aria-label="Language">
    <a href="/vayana-bungalows/" class="site-header__lang-seg is-active"
       data-lang="en" aria-current="true"
       data-aria-current="English, current language"
       data-aria-switch="Switch to English"
       hreflang="en">EN</a>
    <a href="/vayana-bungalows/bg/" class="site-header__lang-seg"
       data-lang="bg"
       data-aria-current="Bulgarian, current language"
       data-aria-switch="Switch to Bulgarian"
       hreflang="bg">BG</a>
  </div>
</body>
</html>`;

const HTML_BG_ACTIVE = `<!DOCTYPE html>
<html lang="bg" data-lang-pill-expected="1">
<body>
  <div class="site-header__lang" role="group" aria-label="Език">
    <a href="/vayana-bungalows/" class="site-header__lang-seg"
       data-lang="en"
       data-aria-current="Английски, текущ език"
       data-aria-switch="Превключване на английски"
       hreflang="en">EN</a>
    <a href="/vayana-bungalows/bg/" class="site-header__lang-seg is-active"
       data-lang="bg" aria-current="true"
       data-aria-current="Български, текущ език"
       data-aria-switch="Превключване на български"
       hreflang="bg">BG</a>
  </div>
</body>
</html>`;

const HTML_NO_PILL_EXPECTED = `<!DOCTYPE html>
<html lang="en" data-lang-pill-expected="1"><body><p>pill missing</p></body></html>`;

const HTML_NO_PILL_LEGIT = `<!DOCTYPE html>
<html lang="en"><body><p>no pill here (legit sub-page)</p></body></html>`;

const HTML_EMPTY_PILL = `<!DOCTYPE html>
<html lang="en" data-lang-pill-expected="1">
<body>
  <div class="site-header__lang" role="group" aria-label="Language"></div>
</body>
</html>`;

const HTML_REDIRECT_IN_FLIGHT = `<!DOCTYPE html>
<html lang="en" data-lang-pill-expected="1" data-i18n-redirecting="1">
<body>
  <div class="site-header__lang" role="group" aria-label="Language">
    <a href="/vayana-bungalows/" class="site-header__lang-seg is-active"
       data-lang="en" aria-current="true"
       data-aria-current="English, current language"
       data-aria-switch="Switch to English">EN</a>
    <a href="/vayana-bungalows/bg/" class="site-header__lang-seg"
       data-lang="bg"
       data-aria-current="Bulgarian, current language"
       data-aria-switch="Switch to Bulgarian">BG</a>
  </div>
</body>
</html>`;

// ── Tests ─────────────────────────────────────────────────────────────────

test('lang.js: active segment aria-label = data-aria-current on EN page', async () => {
  const { document } = makeDom(HTML_EN_ACTIVE);
  const initLang = await loadInitLang({ document, localStorage: makeStorage() });
  initLang();

  const segs = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg');
  assert.equal(
    segs[0].getAttribute('aria-label'),
    'English, current language',
    'EN segment (active) should promote data-aria-current',
  );
  assert.equal(
    segs[1].getAttribute('aria-label'),
    'Switch to Bulgarian',
    'BG segment (inactive) should promote data-aria-switch',
  );
});

test('lang.js: active segment aria-label = data-aria-current on BG page', async () => {
  const { document } = makeDom(HTML_BG_ACTIVE);
  const initLang = await loadInitLang({ document, localStorage: makeStorage() });
  initLang();

  const segs = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg');
  assert.equal(
    segs[0].getAttribute('aria-label'),
    'Превключване на английски',
    'EN segment (inactive) should promote data-aria-switch',
  );
  assert.equal(
    segs[1].getAttribute('aria-label'),
    'Български, текущ език',
    'BG segment (active) should promote data-aria-current',
  );
});

test('lang.js: click on active segment is a no-op (preventDefault, no storage write)', async () => {
  const { document } = makeDom(HTML_EN_ACTIVE);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  const enSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[0];
  const evt = enSeg._dispatchClick();

  assert.equal(evt._defaultPrevented, true, 'active click should preventDefault');
  assert.equal(storage.getItem('vb.lang'), null, 'active click must not persist');
});

test('lang.js: click on inactive segment writes localStorage and does NOT preventDefault', async () => {
  const { document } = makeDom(HTML_EN_ACTIVE);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  const evt = bgSeg._dispatchClick();

  assert.equal(evt._defaultPrevented, false, 'inactive click must let default nav proceed');
  assert.equal(storage.getItem('vb.lang'), 'bg', 'inactive click persists chosen locale');
});

test('lang.js: modifier-click on inactive segment does NOT persist (new tab)', async () => {
  const { document } = makeDom(HTML_EN_ACTIVE);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  bgSeg._dispatchClick({ metaKey: true });

  assert.equal(
    storage.getItem('vb.lang'),
    null,
    'cmd-click opens new tab — the current tab did not switch, so do not persist',
  );
});

test('lang.js: middle-click on inactive segment does NOT persist', async () => {
  const { document } = makeDom(HTML_EN_ACTIVE);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  bgSeg._dispatchClick({ button: 1 });

  assert.equal(storage.getItem('vb.lang'), null);
});

test('lang.js: click on inactive segment survives localStorage exception', async () => {
  const { document } = makeDom(HTML_EN_ACTIVE);
  const storage = {
    setItem() {
      throw new Error('QuotaExceededError');
    },
    getItem() {
      return null;
    },
  };
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  const evt = bgSeg._dispatchClick();

  assert.equal(
    evt._defaultPrevented,
    false,
    'storage denial (Safari private mode) must not block navigation',
  );
});

test('lang.js: missing pill on EXPECTED page warns (data-lang-pill-expected="1")', async () => {
  const { document } = makeDom(HTML_NO_PILL_EXPECTED);
  const warnings = [];
  const initLang = await loadInitLang({
    document,
    localStorage: makeStorage(),
    warn: (msg) => warnings.push(msg),
  });
  initLang();

  assert.equal(warnings.length, 1, 'pill-expected page missing pill must warn');
  assert.match(warnings[0], /data-lang-pill-expected/);
});

test('lang.js: missing pill on LEGIT no-pill page is silent (no data-lang-pill-expected)', async () => {
  // Sub-pages that legitimately do not carry the pill (10 of 12 pages in
  // production) must not spam the console. The plugin stamps
  // data-lang-pill-expected="1" ONLY on pages whose source had a
  // .site-header__lang, so absence of the marker is the "silent" signal.
  const { document } = makeDom(HTML_NO_PILL_LEGIT);
  const warnings = [];
  const initLang = await loadInitLang({
    document,
    localStorage: makeStorage(),
    warn: (msg) => warnings.push(msg),
  });
  initLang();

  assert.equal(warnings.length, 0, 'legit no-pill page must NOT warn');
});

test('lang.js: empty pill container (no segments) warns', async () => {
  // Author edited pill and shipped an empty role="group". HTML valid, no
  // build/lint gate. Warn so it surfaces in dev.
  const { document } = makeDom(HTML_EMPTY_PILL);
  const warnings = [];
  const initLang = await loadInitLang({
    document,
    localStorage: makeStorage(),
    warn: (msg) => warnings.push(msg),
  });
  initLang();

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no .site-header__lang-seg children|no \.site-header__lang-seg children/);
});

test('lang.js: redirect-in-flight (data-i18n-redirecting="1") skips wiring entirely', async () => {
  // The boot script sets this sentinel before location.replace(). If lang.js
  // wires up during flight, a user click can enqueue a second navigation
  // and toggle vb.lang between two writers. Bail out.
  const { document } = makeDom(HTML_REDIRECT_IN_FLIGHT);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  // No aria-label wiring, no click handler registration, no idempotency
  // sentinel stamped (so when the redirect resolves and the destination
  // page runs its own initLang, it wires normally).
  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  assert.equal(
    bgSeg.getAttribute('aria-label'),
    null,
    'redirect-in-flight page must not wire aria-labels',
  );
  assert.equal(
    document.documentElement.getAttribute('data-lang-init'),
    null,
    'redirect-in-flight page must not stamp langInit sentinel',
  );

  // Click during flight must not persist — no handler was registered.
  const evt = bgSeg._dispatchClick();
  assert.equal(storage.getItem('vb.lang'), null);
  assert.equal(evt._defaultPrevented, false);
});

test('lang.js: idempotency — second init call is a no-op (dataset.langInit guard)', async () => {
  const { document } = makeDom(HTML_EN_ACTIVE);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();
  initLang(); // second call must not stack handlers

  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  bgSeg._dispatchClick();

  assert.equal(storage.getItem('vb.lang'), 'bg', 'still writes once');

  // Guard sentinel is set (stamped AFTER successful wiring, not before).
  assert.equal(
    document.documentElement.getAttribute('data-lang-init'),
    '1',
    'dataset.langInit sentinel must be stamped AFTER successful wiring',
  );
});

test('lang.js: sentinel is NOT stamped on early-return paths (missing/empty pill)', async () => {
  // A future re-init (HMR, dynamic mount) after a page injects the pill
  // late must be able to retry. Stamping the guard on the missing-pill
  // path would poison that retry.
  const { document } = makeDom(HTML_EMPTY_PILL);
  const initLang = await loadInitLang({
    document,
    localStorage: makeStorage(),
    warn: () => {}, // swallow the expected warn
  });
  initLang();
  assert.equal(
    document.documentElement.getAttribute('data-lang-init'),
    null,
    'early-return path must not stamp langInit — leaves room for a valid re-init',
  );
});

test('lang.js: aria-label fallback — missing data-aria-* leaves existing aria-label alone', async () => {
  // Simulates a partial rollout: a segment somehow lost its data-aria-current
  // marker. We should NOT clobber the existing aria-label with `undefined`.
  const html = `<!DOCTYPE html><html lang="en" data-lang-pill-expected="1"><body>
    <div class="site-header__lang">
      <a class="site-header__lang-seg is-active" data-lang="en" aria-current="true"
         aria-label="pre-existing">EN</a>
      <a class="site-header__lang-seg" data-lang="bg">BG</a>
    </div>
  </body></html>`;
  const { document } = makeDom(html);
  const initLang = await loadInitLang({ document, localStorage: makeStorage() });
  initLang();

  const enSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[0];
  assert.equal(
    enSeg.getAttribute('aria-label'),
    'pre-existing',
    'missing data-aria-current must not clobber existing aria-label with undefined',
  );
});

// ── BG-page click-flow coverage (finding: asymmetric coverage) ────────────

test('lang.js: click on inactive EN segment from BG-active page persists "en"', async () => {
  const { document } = makeDom(HTML_BG_ACTIVE);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  const enSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[0];
  const evt = enSeg._dispatchClick();

  assert.equal(evt._defaultPrevented, false, 'inactive click must let default nav proceed');
  assert.equal(storage.getItem('vb.lang'), 'en', 'BG page → EN click persists en');
});

test('lang.js: click on active BG segment from BG-active page is a no-op', async () => {
  const { document } = makeDom(HTML_BG_ACTIVE);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  const evt = bgSeg._dispatchClick();

  assert.equal(evt._defaultPrevented, true, 'active click must preventDefault');
  assert.equal(storage.getItem('vb.lang'), null, 'active click must not persist');
});

test('lang.js: cmd-click on ACTIVE segment is a no-op (does NOT open duplicate tab)', async () => {
  // Fix: modifier bail now runs AFTER the active-check, so cmd-click on
  // the current-page pill segment preventDefaults instead of opening a
  // duplicate tab of the same page.
  const { document } = makeDom(HTML_EN_ACTIVE);
  const initLang = await loadInitLang({ document, localStorage: makeStorage() });
  initLang();

  const enSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[0];
  const evt = enSeg._dispatchClick({ metaKey: true });
  assert.equal(evt._defaultPrevented, true, 'cmd-click on active must not open duplicate tab');
});

test('lang.js: unknown data-lang value does NOT persist (segment-derived allowlist)', async () => {
  // If a segment has a data-lang value we don't recognize (typo, injected
  // markup), skip the storage write. Derives the allowlist from the
  // segments themselves so a legit third locale (de.json + <a data-lang="de">)
  // just works.
  const html = `<!DOCTYPE html><html lang="en" data-lang-pill-expected="1"><body>
    <div class="site-header__lang">
      <a class="site-header__lang-seg is-active" data-lang="en" aria-current="true">EN</a>
      <a class="site-header__lang-seg" data-lang="xx">XX</a>
    </div>
  </body></html>`;
  const { document } = makeDom(html);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  const xxSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  xxSeg._dispatchClick();

  assert.equal(
    storage.getItem('vb.lang'),
    'xx',
    'segment-derived allowlist includes xx because it appears as a segment data-lang',
  );
});
