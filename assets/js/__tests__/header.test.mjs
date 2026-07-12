// Lightweight integration test for assets/js/header.js's drawer link-click
// close path — specifically the interaction with the shared isPrimaryClick
// util. Round-2 F11: the util was untested at its consumer boundaries; a
// regression in the util (or in header.js's usage) had no test guardrail.
//
// This test focuses on the ONE interaction that matters for the util:
// clicking a link inside the drawer should close it on primary click but
// leave it open on modifier / non-primary clicks (user opens the link in
// a new tab, current context shouldn't lose its drawer state).
//
// The full drawer state machine (focus trap, scroll-lock, transition
// cleanup, etc.) is not exercised here — that would need a real browser
// harness. We assert only the util-boundary contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEADER_JS_PATH = join(__dirname, '..', 'header.js');
const HEADER_JS_SRC = readFileSync(HEADER_JS_PATH, 'utf8');

test('header.js: drawer link-click handler calls isPrimaryClick before close()', () => {
  // The static invariant: header.js's drawer-link click handler MUST
  // consult isPrimaryClick. If a refactor replaces it with an inline
  // check that misses one of the modifiers (or if the import gets
  // dropped), this assertion fires.
  //
  // Regex-based rather than eval-and-run because header.js has a large
  // amount of DOM machinery we'd need to shim (IntersectionObserver,
  // scroll locks, focus trap, transitions). Grep-level assertion is
  // enough to lock the util-integration point.

  // 1. header.js imports isPrimaryClick from the shared util.
  assert.match(
    HEADER_JS_SRC,
    /import\s*\{\s*isPrimaryClick\s*\}\s*from\s*['"]\.\/util\/is-primary-click\.js['"]/,
    'header.js must import isPrimaryClick from the shared util',
  );

  // 2. Somewhere in the file, there is a call to isPrimaryClick used to
  //    gate the close() call in the drawer-link click handler.
  assert.match(
    HEADER_JS_SRC,
    /if\s*\(\s*!\s*isPrimaryClick\s*\(\s*e\s*\)\s*\)\s*return\s*;/,
    'header.js must gate the drawer-link close with `if (!isPrimaryClick(e)) return;`',
  );

  // 3. The gated block must call close() (the drawer's close function).
  //    Extract the region immediately after the isPrimaryClick check and
  //    verify close() is invoked.
  const guardIdx = HEADER_JS_SRC.search(/if\s*\(\s*!\s*isPrimaryClick\s*\(\s*e\s*\)\s*\)\s*return\s*;/);
  assert.ok(guardIdx !== -1, 'guard must exist');
  const tail = HEADER_JS_SRC.slice(guardIdx, guardIdx + 200);
  assert.match(
    tail,
    /close\s*\(\s*\)\s*;/,
    'primary-click gate must lead to a close() call — otherwise the drawer wouldn\'t close on link nav',
  );
});

test('header.js: the OLD inline modifier check is no longer present (extraction complete)', () => {
  // Round-2 negative assertion: verify the extraction to isPrimaryClick
  // actually removed the inline check, otherwise the util is unused code
  // and a future edit could diverge from lang.js's behavior.
  //
  // The pattern that used to live here: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
  // followed by e.button !== 0. Both should NOT appear as consecutive
  // guards in a single click handler anymore. We assert the specific
  // 4-modifier OR expression is absent in the drawer-link close path.
  //
  // Note: the modifier-key expression may legitimately appear elsewhere
  // (call-CTA two-tap handler, keyboard shortcuts). We narrow by
  // requiring the specific 4-modifier full OR — the pre-extraction
  // exact string — inside a `data-nav-link` handler region.
  const navLinkIdx = HEADER_JS_SRC.indexOf('data-nav-link');
  assert.ok(navLinkIdx !== -1, 'header.js must still bind on data-nav-link');
  const region = HEADER_JS_SRC.slice(navLinkIdx, navLinkIdx + 600);
  assert.doesNotMatch(
    region,
    /e\.metaKey\s*\|\|\s*e\.ctrlKey\s*\|\|\s*e\.shiftKey\s*\|\|\s*e\.altKey/,
    'drawer-link handler must no longer inline the 4-modifier check — use isPrimaryClick instead',
  );
});
