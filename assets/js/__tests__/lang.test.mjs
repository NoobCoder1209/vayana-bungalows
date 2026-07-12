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
    removeAttribute(name) {
      el.removeAttribute(name);
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
        defaultPrevented: false,      // spec-name; new tests may read this
        _defaultPrevented: false,     // primary field every existing test reads
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
  //   - Strip every top-level ESM `import ... from '...';` line and inject
  //     the util's source at the top so its exports are locals in the
  //     eval scope. This is intentionally NAME-AGNOSTIC (Round-2 finding
  //     #12): the prior single-name regex would silently fail to match
  //     if lang.js added a second named import, re-introducing the exact
  //     SyntaxError trap this harness was written to prevent.
  const utilInlined = IS_PRIMARY_CLICK_SRC.replace(/\bexport\s+/g, '');
  const stripped = LANG_JS_SRC
    // Strip ANY top-level `import ... from '...';` line, regardless of
    // named/default/namespace/renamed forms. Matches only single-line
    // imports (multi-line imports would need dotall + non-greedy which
    // we avoid; if lang.js ever grows a multi-line import, add it here).
    .replace(/^\s*import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/\bexport\s+/g, '');
  // Inject the util's stripped source at the top so its exports (functions,
  // consts) are in-scope for the rest of the module body.
  const src = `${utilInlined}\n${stripped}`;
  const factory = new Function(
    'document',
    'localStorage',
    'console',
    `${src}
     return { initLang: initLang, __resetWarnOnceForTests: typeof __resetWarnOnceForTests === 'function' ? __resetWarnOnceForTests : () => {} };`,
  );
  const api = factory(document, localStorage, console);
  // Reset the module-scope one-shot warn dedup between tests so a warn
  // fired in a prior test doesn't suppress the warn assertion of a later
  // test. In production the module is instantiated once per page; tests
  // instantiate a fresh factory per case but the closure state within a
  // single case can still leak across initLang() calls, which is what
  // some tests deliberately exercise.
  api.__resetWarnOnceForTests();
  return api.initLang;
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
  assert.match(warnings[0], /no \.site-header__lang-seg children/);
});

test('lang.js: redirect-in-flight — clears the flag and PROCEEDS with wiring (Round-2 F1 recovery semantics)', async () => {
  // Round-2 F1 changed the semantics: the prior version BAILED when
  // data-i18n-redirecting was set, which meant a stuck-in-flight state
  // (location.replace() failed silently) would leave the pill permanently
  // dead. The new behavior clears the flag on entry so the page is
  // recoverable. By the time DOMContentLoaded → initLang runs, either:
  //   (a) The redirect succeeded — this module is on the destination page.
  //   (b) The redirect failed — this module is on the source page and
  //       clearing the flag restores click handling.
  // Either way, clearing + wiring is correct; bailing would strand case (b).
  const { document } = makeDom(HTML_REDIRECT_IN_FLIGHT);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  // Flag is cleared.
  assert.equal(
    document.documentElement.getAttribute('data-i18n-redirecting'),
    null,
    'redirect flag must be cleared on init',
  );

  // Aria-labels wired (this fixture is EN-active).
  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  assert.equal(
    bgSeg.getAttribute('aria-label'),
    'Switch to Bulgarian',
    'aria-label must be wired after flag clear',
  );

  // Click persists correctly.
  const evt = bgSeg._dispatchClick();
  assert.equal(storage.getItem('vb.lang'), 'bg', 'click must persist after flag clear');
  assert.equal(evt._defaultPrevented, false, 'inactive click must let default nav run');

  // Sentinel stamped (successful wire).
  assert.equal(
    document.documentElement.getAttribute('data-lang-init'),
    '1',
    'successful wire on flag-cleared path must stamp langInit',
  );
});

test('lang.js: idempotency — second init call does NOT stack click handlers (setItem call-count)', async () => {
  // Round-2 F7: the prior version of this test only asserted the final
  // storage value, which is invariant under N>=1 identical writes. Now
  // we count setItem calls: exactly ONE write per click, even after two
  // initLang() invocations. If a regression removed the dataset.langInit
  // guard, each initLang() would register another handler, and the
  // dispatch would fire N handlers and produce N writes.
  const { document } = makeDom(HTML_EN_ACTIVE);
  let writeCount = 0;
  const storage = {
    _store: new Map(),
    getItem(k) { return this._store.has(k) ? this._store.get(k) : null; },
    setItem(k, v) { writeCount += 1; this._store.set(k, String(v)); },
  };
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();
  initLang(); // second call must not stack handlers

  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  bgSeg._dispatchClick();

  assert.equal(writeCount, 1, 'exactly one setItem write per click — stacked handlers would fire N times');
  assert.equal(storage.getItem('vb.lang'), 'bg');

  // Guard sentinel is set (stamped AFTER successful wiring, not before).
  assert.equal(
    document.documentElement.getAttribute('data-lang-init'),
    '1',
    'dataset.langInit sentinel must be stamped AFTER successful wiring',
  );
});

// Round-2 F8: parameterise over ALL early-return fixtures so a regression
// that stamps the sentinel on one branch is caught. The prior test loaded
// only HTML_EMPTY_PILL, silently missing regressions on the missing-pill
// branch. Redirect-in-flight is NOT in this list because Round-2 F1
// changed its semantics: initLang now clears the flag and PROCEEDS with
// wiring (see the dedicated redirect-in-flight test above).
for (const [label, html] of [
  ['missing-pill (expected)', HTML_NO_PILL_EXPECTED],
  ['empty-pill container', HTML_EMPTY_PILL],
]) {
  test(`lang.js: sentinel is NOT stamped on early-return path — ${label}`, async () => {
    // A future re-init (HMR, dynamic mount) after a page injects the pill
    // late must be able to retry. Stamping the guard on any early-return
    // branch would poison that retry.
    const { document } = makeDom(html);
    const initLang = await loadInitLang({
      document,
      localStorage: makeStorage(),
      warn: () => {}, // swallow the expected warn
    });
    initLang();
    assert.equal(
      document.documentElement.getAttribute('data-lang-init'),
      null,
      `early-return path (${label}) must not stamp langInit`,
    );
  });
}

// Round-2 F9: prove the retry-after-early-return contract actually works.
// The sentinel-not-stamped assertion above is necessary but insufficient
// — it doesn't verify that a SECOND initLang() call, after the pill
// becomes present, actually wires it. A future refactor that stored an
// "attempted" flag or cached a query result would break the advertised
// HMR behavior; only this test would catch it.
test('lang.js: initLang retries successfully after an early-return once the pill is injected', async () => {
  // Start with an empty-pill fixture — first call bails, sentinel stays unset.
  const { document, root } = makeDom(HTML_EMPTY_PILL);
  const storage = makeStorage();
  const initLang = await loadInitLang({
    document,
    localStorage: storage,
    warn: () => {},
  });
  initLang();
  assert.equal(
    document.documentElement.getAttribute('data-lang-init'),
    null,
    'first call bails and does NOT stamp sentinel',
  );

  // Now inject the segments into the pill container — simulates a
  // late/dynamic mount. Then re-invoke initLang() — must wire correctly.
  const pillRaw = root.querySelector('.site-header__lang');
  pillRaw.set_content(`
    <a href="/" class="site-header__lang-seg is-active" data-lang="en" aria-current="true"
       data-aria-current="English, current language" data-aria-switch="Switch to English">EN</a>
    <a href="/bg/" class="site-header__lang-seg" data-lang="bg"
       data-aria-current="Bulgarian, current language" data-aria-switch="Switch to Bulgarian">BG</a>
  `);
  initLang();

  // Second call succeeded: sentinel stamped, aria-labels applied.
  assert.equal(
    document.documentElement.getAttribute('data-lang-init'),
    '1',
    'retry after pill injection must succeed and stamp the sentinel',
  );
  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  assert.equal(bgSeg.getAttribute('aria-label'), 'Switch to Bulgarian');
  // Click handler wired — verify by dispatching.
  bgSeg._dispatchClick();
  assert.equal(storage.getItem('vb.lang'), 'bg', 'click handler was wired on retry');
});

test('lang.js: redirect-in-flight sentinel is CLEARED on init (recovery from stuck-in-flight state)', async () => {
  // Round-2 F1: the boot script sets data-i18n-redirecting=1 before
  // location.replace(). If the redirect fails silently (offline, CSP nav
  // block, popup interference, user hits Stop), the flag stays set. The
  // fix clears the flag on initLang entry so a future call can wire
  // normally. Without the clear, the pill would be permanently dead.
  const { document } = makeDom(HTML_REDIRECT_IN_FLIGHT);
  const initLang = await loadInitLang({
    document,
    localStorage: makeStorage(),
  });
  initLang();

  assert.equal(
    document.documentElement.getAttribute('data-i18n-redirecting'),
    null,
    'redirect flag must be cleared on init so a stuck-in-flight page can recover',
  );
});

test('lang.js: warn-once — repeated early-returns on the same page emit warn ONLY once', async () => {
  // Round-2 F2: React-strict-mode double-invocation / HMR retries /
  // dynamic-mount re-inits should not flood the console. Warns are
  // dedup'd module-scope by message text.
  const { document } = makeDom(HTML_EMPTY_PILL);
  const warnings = [];
  const initLang = await loadInitLang({
    document,
    localStorage: makeStorage(),
    warn: (msg) => warnings.push(msg),
  });
  initLang();
  initLang();
  initLang();
  assert.equal(warnings.length, 1, 'empty-pill warn must fire exactly once even across 3 init calls');
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

test('lang.js: 3rd-locale segment persists (segment-derived allowlist is dynamic)', async () => {
  // Round-1 F5 fix: the allowlist is derived from the segments themselves,
  // so a legit third locale (locales/de.json + <a data-lang="de">) works
  // without touching lang.js. This test pins the DYNAMIC allowlist:
  // whatever segment set the DOM carries IS the allowlist. Its counterpart
  // below verifies that data-lang values NOT in the segment set do NOT
  // persist (which is the actual "unknown data-lang" contract).
  const html = `<!DOCTYPE html><html lang="en" data-lang-pill-expected="1"><body>
    <div class="site-header__lang">
      <a class="site-header__lang-seg is-active" data-lang="en" aria-current="true">EN</a>
      <a class="site-header__lang-seg" data-lang="de">DE</a>
    </div>
  </body></html>`;
  const { document } = makeDom(html);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  const deSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  deSeg._dispatchClick();

  assert.equal(
    storage.getItem('vb.lang'),
    'de',
    'segment-derived allowlist accepts any data-lang present in the DOM segments',
  );
});

test('lang.js: click handler on a segment whose data-lang was mutated to an unknown value does NOT persist', async () => {
  // The allowlist is captured at initLang() TIME from the segments the
  // plugin baked. If the DOM is later mutated to change a segment's
  // data-lang to a value not in the initial set (a runtime XSS injection,
  // a dynamic pill mutation), the click handler's knownLangs.has() check
  // rejects it. This is the actual "unknown data-lang does NOT persist"
  // contract.
  const html = `<!DOCTYPE html><html lang="en" data-lang-pill-expected="1"><body>
    <div class="site-header__lang">
      <a class="site-header__lang-seg is-active" data-lang="en" aria-current="true">EN</a>
      <a class="site-header__lang-seg" data-lang="bg">BG</a>
    </div>
  </body></html>`;
  const { document } = makeDom(html);
  const storage = makeStorage();
  const initLang = await loadInitLang({ document, localStorage: storage });
  initLang();

  // At initLang time, knownLangs = {en, bg}. Now mutate the BG segment's
  // data-lang AFTER wiring to simulate a late injection.
  const bgSeg = document
    .querySelector('.site-header__lang')
    .querySelectorAll('.site-header__lang-seg')[1];
  bgSeg.setAttribute('data-lang', 'xx-injection');
  bgSeg._dispatchClick();

  assert.equal(
    storage.getItem('vb.lang'),
    null,
    'post-init mutation to an unknown data-lang must NOT persist — the allowlist is snapshot at init',
  );
});
