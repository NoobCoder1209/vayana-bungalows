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
      return el.getAttribute(name);
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
      listeners.get(event).push(handler);
    },
    // Test-only: dispatch a click through the registered handlers with a
    // MouseEvent-shaped payload the module reads (metaKey/ctrlKey/shiftKey/
    // altKey/button + preventDefault).
    _dispatchClick(overrides = {}) {
      const evt = {
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        button: 0,
        _defaultPrevented: false,
        preventDefault() {
          this._defaultPrevented = true;
        },
        ...overrides,
      };
      const handlers = listeners.get('click') || [];
      for (const h of handlers) h(evt);
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
    _store: store,
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    _throwOnSet: false,
  };
}

// Load lang.js inside a fresh scope with our shim globals bound.
async function loadInitLang({ document, localStorage, warn }) {
  const console = { warn: warn || (() => {}) };
  // Strip the `export` keyword so `new Function()` (script parser, not
  // module parser) can eval the source. The module still exports `initLang`
  // in a real browser build — we only rewrite for the test harness.
  const src = LANG_JS_SRC.replace(/\bexport\s+function\b/, 'function');
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
<html lang="en">
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
<html lang="bg">
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

const HTML_NO_PILL = `<!DOCTYPE html>
<html lang="en"><body><p>no pill here</p></body></html>`;

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

test('lang.js: missing pill warns and returns without throwing', async () => {
  const { document } = makeDom(HTML_NO_PILL);
  const warnings = [];
  const initLang = await loadInitLang({
    document,
    localStorage: makeStorage(),
    warn: (msg) => warnings.push(msg),
  });
  initLang();

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /site-header__lang/);
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

  // Guard sentinel is set.
  assert.equal(
    document.documentElement.getAttribute('data-lang-init'),
    '1',
    'dataset.langInit sentinel must be stamped',
  );
});

test('lang.js: aria-label fallback — missing data-aria-* leaves existing aria-label alone', async () => {
  // Simulates a partial rollout: a segment somehow lost its data-aria-current
  // marker. We should NOT clobber the existing aria-label with `undefined`.
  const html = `<!DOCTYPE html><html lang="en"><body>
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
