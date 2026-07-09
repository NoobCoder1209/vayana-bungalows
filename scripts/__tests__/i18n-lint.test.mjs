/**
 * Tests for scripts/i18n-lint.js
 *
 * Strategy: spawn the lint script as a child process against synthetic
 * fixtures under a temp directory, then assert on exit code + stdout/stderr.
 * Running it via `node --test` in-process would require re-plumbing
 * `process.exit` and `console.*`, and is more brittle than a clean subprocess.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LINT_SCRIPT = resolve(__dirname, '..', 'i18n-lint.js');
const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Set up a temp fixture root with `locales/` and optional HTML pages. */
function makeFixture(dicts, htmlFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
  const localesDir = join(root, 'locales');
  mkdirSync(localesDir, { recursive: true });
  for (const [locale, content] of Object.entries(dicts)) {
    writeFileSync(join(localesDir, `${locale}.json`), JSON.stringify(content, null, 2));
  }
  for (const [relPath, content] of Object.entries(htmlFiles)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function runLint(root, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [LINT_SCRIPT, '--root', root, '--locales-dir', join(root, 'locales'), ...extraArgs],
    { encoding: 'utf-8' },
  );
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// Symmetric baseline dicts reused across the happy-path tests.
const goodDicts = {
  en: { hello: 'Hello', bye: 'Bye', greet: 'Hi {name}' },
  bg: { hello: 'Здравей', bye: 'Чао', greet: 'Здрасти {name}' },
};

test('exits 0 on symmetric dicts with no HTML markers (initial rollout state)', () => {
  const root = makeFixture(goodDicts);
  try {
    const { code, stdout } = runLint(root);
    // No markers → every key is orphan (warning), but exit is still 0.
    assert.equal(code, 0, `expected exit 0, got ${code}`);
    assert.match(stdout, /i18n-lint: OK/);
    assert.match(stdout, /3 orphan/); // hello, bye, greet all unused
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exits 0 when every dict key is referenced in HTML', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `
      <p data-i18n="hello">Hello</p>
      <p data-i18n="bye">Bye</p>
      <p data-i18n="greet">Hi {name}</p>
    `,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0);
    assert.match(stdout, /0 orphan/);
    assert.match(stdout, /0 missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exits 1 on missing key referenced in HTML', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<p data-i18n="not.in.dict">???</p>`,
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    assert.match(stderr, /missing key/i);
    assert.match(stderr, /not\.in\.dict/);
    assert.match(stderr, /index\.html/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exits 1 on malformed data-i18n-attr (missing colon)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<a data-i18n-attr="hello"></a>`,
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    assert.match(stderr, /missing colon separator/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exits 1 on malformed data-i18n-attr (empty attr or key)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<a data-i18n-attr=":hello"></a><a data-i18n-attr="href:"></a>`,
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    assert.match(stderr, /empty attr name/);
    assert.match(stderr, /empty key/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts multi-pair data-i18n-attr with valid attr:key pairs', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<a data-i18n-attr="href:hello; title:bye">x</a>`,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0, `stdout=${stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects trailing ";" in data-i18n-attr (matches plugin) (H1)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<a data-i18n-attr="href:hello;">x</a>`,
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    assert.match(stderr, /empty pair/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects ";;" duplicate separator in data-i18n-attr (H1)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<a data-i18n-attr="href:hello;;title:bye">x</a>`,
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    assert.match(stderr, /empty pair/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exits 1 on empty data-i18n value', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<p data-i18n=""></p>`,
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    assert.match(stderr, /empty data-i18n=/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exits 1 when locale dicts are asymmetric', () => {
  const root = makeFixture({
    en: { hello: 'Hello', bye: 'Bye' },
    bg: { hello: 'Здравей' }, // missing "bye"
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    assert.match(stderr, /dictionary validation failed/);
    assert.match(stderr, /not symmetric/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exits 1 on malformed tokens in dict values (uppercase name)', () => {
  const root = makeFixture({
    en: { greet: 'Hi {Name}' },
    bg: { greet: 'Здрасти {Name}' },
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    assert.match(stderr, /dictionary validation failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('warns on orphan keys by default (exit 0)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<p data-i18n="hello">Hello</p>`, // uses only "hello"
  });
  try {
    const { code, stdout, stderr } = runLint(root);
    assert.equal(code, 0);
    // Warnings go to stderr via console.warn.
    const combined = stdout + stderr;
    assert.match(combined, /2 orphan/);
    assert.match(combined, /\[WARN\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--strict-orphans upgrades orphan warnings to errors (exit 1)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<p data-i18n="hello">Hello</p>`,
  });
  try {
    const { code, stderr } = runLint(root, ['--strict-orphans']);
    assert.equal(code, 1);
    assert.match(stderr, /\[ERROR\] 2 orphan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips node_modules, dist, .git, and __tests__ directories', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<p data-i18n="hello">Hi</p>`,
    'node_modules/foo/x.html': `<p data-i18n="not.in.dict">nm</p>`,
    'dist/index.html': `<p data-i18n="also.missing">d</p>`,
    'scripts/__tests__/fixtures/bad.html': `<p data-i18n="fixture.missing">f</p>`,
  });
  try {
    const { code, stdout } = runLint(root);
    // If skips fail, the "not.in.dict" etc. keys would trigger missing-key errors.
    assert.equal(code, 0, `unexpected non-zero exit; stdout=${stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('detects markers across multiple HTML files', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<p data-i18n="hello">x</p>`,
    'pages/about.html': `<p data-i18n="bye">y</p>`,
    'pages/nested/deep.html': `<p data-i18n="greet">z</p>`,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0);
    assert.match(stdout, /3 HTML file\(s\) scanned/);
    assert.match(stdout, /3 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recognises all four marker kinds (text/html/attr/meta)', () => {
  const dicts = {
    en: { t: 'T', h: '<b>H</b>', a: 'A', m: 'M', extra: 'E' },
    bg: { t: 'Т', h: '<b>Х</b>', a: 'А', m: 'М', extra: 'Е' },
  };
  const root = makeFixture(dicts, {
    'index.html': `
      <p data-i18n="t">T</p>
      <p data-i18n-html="h"><b>H</b></p>
      <a data-i18n-attr="title:a">x</a>
      <meta name="x" data-i18n-meta="m">
    `,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0);
    assert.match(stdout, /4 used/);
    assert.match(stdout, /1 orphan/); // only "extra"
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does NOT confuse similar-looking attributes (data-i18nfoo)', () => {
  // If the regex weren't anchored on \b + attribute-name boundary, a
  // hand-written attribute like `data-i18nfoo="bar"` would match.
  const root = makeFixture(goodDicts, {
    'index.html': `<p data-i18nfoo="not.in.dict">x</p>`,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0, `expected 0 (attr should not match), got stdout=${stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does NOT falsely match data-i18n-attrs (trailing plural s)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<p data-i18n-attrs="not.in.dict">x</p>`,
  });
  try {
    const { code } = runLint(root);
    assert.equal(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handles single-quoted attribute values', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `<p data-i18n='hello'>x</p>`,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0);
    assert.match(stdout, /1 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--help prints usage and exits 0', () => {
  const result = spawnSync(process.execPath, [LINT_SCRIPT, '--help'], {
    encoding: 'utf-8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--strict-orphans/);
});

test('unknown flag exits 2', () => {
  const result = spawnSync(process.execPath, [LINT_SCRIPT, '--bogus'], {
    encoding: 'utf-8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument/);
});

test('missing root dir exits 2', () => {
  const result = spawnSync(
    process.execPath,
    [LINT_SCRIPT, '--root', '/nonexistent/path/xyzzy'],
    { encoding: 'utf-8' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /does not exist/);
});

test('--root at end of argv exits 2 with a friendly message (M3)', () => {
  const result = spawnSync(process.execPath, [LINT_SCRIPT, '--root'], {
    encoding: 'utf-8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing value for --root/);
});

test('--locales-dir at end of argv exits 2 with a friendly message (M3)', () => {
  const result = spawnSync(process.execPath, [LINT_SCRIPT, '--locales-dir'], {
    encoding: 'utf-8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing value for --locales-dir/);
});

test('ignores data-i18n inside <script> template literals (H2)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `
      <p data-i18n="hello">real</p>
      <script>
        const tpl = '<p data-i18n="not.in.dict">fake</p>';
        console.log(tpl);
      </script>
    `,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0, `expected 0, stdout=${stdout}`);
    assert.match(stdout, /1 used/); // only "hello"
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignores data-i18n inside <style> blocks (H2)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `
      <style>
        /* data-i18n="not.in.dict" — this is a CSS comment, not a marker */
        .foo::before { content: 'data-i18n="also.fake"'; }
      </style>
      <p data-i18n="hello">real</p>
    `,
  });
  try {
    const { code } = runLint(root);
    assert.equal(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignores data-i18n inside HTML comments (H2)', () => {
  const root = makeFixture(goodDicts, {
    'index.html': `
      <!-- TODO drop data-i18n="legacy.stub" once migration complete -->
      <p data-i18n="hello">real</p>
    `,
  });
  try {
    const { code } = runLint(root);
    assert.equal(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does NOT confuse data-i18n-attr with data-i18n (H2 regex anchoring)', () => {
  // The negative-lookahead `(?![\w-])` after each attribute name means
  // `data-i18n` should NOT match `data-i18n-attr` or `data-i18n-html`.
  const root = makeFixture(goodDicts, {
    'index.html': `<a data-i18n-attr="href:hello">x</a>`,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0);
    assert.match(stdout, /1 used/); // "hello" via attr, NOT via text
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mask ordering: <script> body first, then comments — stray "<!--" in a script string cannot eat across </script> (H2)', () => {
  // The classic regression: `<script>const t='<!-- foo';</script>` used
  // to make the comment regex consume from inside-script's `<!--` up to
  // the next `-->` on the page, blanking real markers in between.
  // Round-2 fix masks script content first, so any `<!--`/`-->` inside
  // the script body is already spaces before the comment pass runs.
  const root = makeFixture(goodDicts, {
    'index.html': [
      `<script>const t = '<!-- foo';</script>`,
      `<p data-i18n="hello">real</p>`,
      `<!-- trailer comment -->`,
    ].join('\n'),
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0);
    // Critical: "hello" must appear in used-keys, not be blanked away.
    assert.match(stdout, /1 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markers ON the <script> element itself are still seen by lint (H3)', () => {
  // The plugin's DOM parse finds `<script data-i18n="key">…</script>`
  // as a real marker. Lint must too, or it fails-open on JS-heavy
  // pages that legitimately use markers on <script>/<style>.
  const root = makeFixture(goodDicts, {
    'index.html': `<script data-i18n="hello">console.log(1)</script>`,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0);
    assert.match(stdout, /1 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markers inside <script> BODY are still masked (H3 tail — scripts don\'t leak content markers)', () => {
  // The complement of the previous test: the opening tag is visible so
  // its own attributes are scannable, but content between the tags is
  // blanked so `data-i18n="fake"` inside a JS template literal remains
  // masked.
  const root = makeFixture(goodDicts, {
    'index.html': [
      `<p data-i18n="hello">real</p>`,
      `<script>const tpl = '<p data-i18n="not.in.dict">fake</p>';</script>`,
    ].join('\n'),
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0, `expected 0, stdout=${stdout}`);
    assert.match(stdout, /1 used/); // only "hello", not "not.in.dict"
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('script opening tag with ">" inside attribute value does NOT truncate the mask (H3 tail)', () => {
  // The old regex `<script\b[^>]*>` truncated at the first `>` even if
  // it was inside a quoted attribute value. Round-2 uses a two-step
  // scan (RE_SCRIPT_OPEN then string search for `</script`) which
  // survives this shape.
  const root = makeFixture(goodDicts, {
    'index.html': [
      `<script data-cfg="{'k':'>'}">const x='data-i18n="not.in.dict"';</script>`,
      `<p data-i18n="hello">real</p>`,
    ].join('\n'),
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0, `expected 0, stdout=${stdout}`);
    assert.match(stdout, /1 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('marker regexes are case-insensitive to match HTML5 attribute semantics (M1)', () => {
  // parse5 (used by the plugin) normalises attribute names to lowercase
  // on DOM ingest, so `<p Data-I18N="hello">` is a legitimate marker
  // to the plugin. Lint must match.
  const root = makeFixture(goodDicts, {
    'index.html': `<p Data-I18N="hello">x</p>`,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0);
    assert.match(stdout, /1 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed multi-pair marker does NOT contribute its valid pairs to the used-key set (H4)', () => {
  // Before the fix, `<a data-i18n-attr="href:hello; ; title:bye">`
  // would push {kind:'attr', key:'hello'} into `usedKeys` before
  // recording the empty-pair error. That silently masked orphans:
  // if `hello` were referenced ONLY by this broken marker, it would
  // still count as used. Now the whole marker's keys are buffered and
  // only committed if the marker parses cleanly.
  //
  // We assert by making `hello` orphan-elsewhere-only. If H4 is
  // buggy, orphan count is 2 (bye, greet) because hello counts as
  // used. Correct behaviour: orphan count is 3 (hello, bye, greet).
  const root = makeFixture(goodDicts, {
    'index.html': `<a data-i18n-attr="href:hello; ; title:bye">x</a>`,
  });
  try {
    const { code, stderr } = runLint(root, ['--strict-orphans']);
    // Empty pair is still an error → exit 1.
    assert.equal(code, 1);
    assert.match(stderr, /empty pair/);
    // And the orphan report must include hello — proving hello was NOT
    // counted as used despite the marker mentioning it.
    assert.match(stderr, /\bhello\b/);
    assert.match(stderr, /\bbye\b/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runs cleanly against the real project tree (smoke)', () => {
  // The real repo currently has locales/en+bg and one un-keyed index.html.
  // This test guards against the lint script blowing up on the real inputs.
  const result = spawnSync(
    process.execPath,
    [LINT_SCRIPT, '--root', PROJECT_ROOT, '--locales-dir', join(PROJECT_ROOT, 'locales')],
    { encoding: 'utf-8' },
  );
  // Expected exit is 0 with warnings about orphans (nothing keyed yet).
  assert.equal(
    result.status,
    0,
    `stdout=${result.stdout}\nstderr=${result.stderr}`,
  );
});

// ---------------------------------------------------------------------
// Round-3 lint fixes: H1 (script-open regex tokenises quoted attrs),
// H3-attr-values (attribute-value masking), H4/H2 (regex close search),
// M3-propagation (duplicate-attr in multi-pair markers), M4 shared
// parser.
// ---------------------------------------------------------------------

test('marker ON <script> opening tag AFTER a quoted ">" is visible to lint (H1)', () => {
  // The round-2 RE_SCRIPT_OPEN used /<script\b[\s\S]*?>/gi which is
  // non-greedy and truncated at the first `>` — including one inside
  // a quoted attribute value. A marker sitting on the open tag AFTER
  // that quoted `>` was blanked. Round-3 rewrites the regex to
  // tokenise quoted attribute values.
  const root = makeFixture(goodDicts, {
    'index.html': `<script data-cfg="{'x':'>'}" data-i18n="hello">body</script>`,
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0, `stdout=${stdout}`);
    // Critical: "hello" must count as used, proving the H1 regression
    // is closed.
    assert.match(stdout, /1 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('marker regex ignores data-i18n= substrings inside another attribute\'s value (H3-attr)', () => {
  // `<div title="see data-i18n='fake'">` used to trip RE_I18N_TEXT
  // because maskNonMarkupRegions only blanked script/style/comments.
  // Round-3 adds an attribute-value masking pass that blanks quoted
  // values while preserving the marker attribute names themselves.
  const root = makeFixture(goodDicts, {
    'index.html': [
      `<div title="see data-i18n='not.in.dict' here">visible text</div>`,
      `<p data-i18n="hello">real</p>`,
    ].join('\n'),
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0, `stdout=${stdout}`);
    // Only "hello" is counted; the fake inside the title is masked out.
    assert.match(stdout, /1 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('marker on element itself is preserved through attribute-value masking (H3-attr — outer marker visible)', () => {
  // The attribute-value mask must NOT blank the value of a
  // data-i18n* marker itself — otherwise every real marker becomes
  // invisible after the mask pass.
  const root = makeFixture(goodDicts, {
    'index.html': [
      `<a href="/x" data-i18n="hello" title="tooltip">real</a>`,
      `<div data-i18n-attr="href:bye">x</div>`,
    ].join('\n'),
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0, `stdout=${stdout}`);
    // Both markers must be found.
    assert.match(stdout, /2 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed <script> without close tag does NOT blank the entire tail (H4/H2 regression)', () => {
  // The round-2 fallback `closeIdx < 0 ? source.length : closeIdx`
  // consumed the entire tail on an unclosed <script>, silently
  // blanking any real markers after it. Round-3 keeps the fallback
  // (matching HTML5 parser tolerance) but the RE_SCRIPT_CLOSE regex
  // now has a proper `(?![\w-])` boundary check so partial matches
  // like </scriptzz can't fake it into thinking the tag closed.
  const root = makeFixture(goodDicts, {
    'index.html': [
      `<script>const s = '</scriptzz';</script>`,
      `<p data-i18n="hello">real</p>`,
    ].join('\n'),
  });
  try {
    const { code, stdout } = runLint(root);
    assert.equal(code, 0, `stdout=${stdout}`);
    assert.match(stdout, /1 used/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate attr in multi-pair marker is rejected by lint (M3 propagation)', () => {
  // Lint imports parseAttrPairs from the plugin (M4), so the
  // duplicate-attr rejection surfaces at lint-time too, giving the
  // developer the same fast-feedback the build would give.
  const root = makeFixture(goodDicts, {
    'index.html': `<a data-i18n-attr="href:hello; href:bye">x</a>`,
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    assert.match(stderr, /duplicates attribute "href"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lint parseAttrPairs consumption matches plugin error shapes (M4/M5)', () => {
  // Cross-check: same input into both lint and plugin produces the
  // same core message. Lint prefixes with relPath, plugin prefixes
  // with `[i18n] pagePath:`. The MIDDLE of both messages is now
  // identical because both call parseAttrPairs.
  const root = makeFixture(goodDicts, {
    'index.html': `<a data-i18n-attr="href:hello;">x</a>`,
  });
  try {
    const { code, stderr } = runLint(root);
    assert.equal(code, 1);
    // The plugin's error for this same input would say:
    //   `[i18n] pagePath: data-i18n-attr="href:hello;" contains an
    //    empty pair (leading/trailing/duplicate ";"). ...`
    // Lint should share the "contains an empty pair" wording.
    assert.match(stderr, /contains an empty pair \(leading\/trailing\/duplicate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
