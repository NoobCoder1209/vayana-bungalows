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
    assert.match(stderr, /malformed data-i18n-attr/);
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
    assert.match(stderr, /malformed data-i18n-attr/);
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

test('runs cleanly against the real project tree (smoke)', () => {
  // The real repo currently has locales/en+bg and one un-keyed index.html.
  // This test guards against the lint script blowing up on the real inputs.
  const result = spawnSync(
    process.execPath,
    [LINT_SCRIPT, '--root', PROJECT_ROOT, '--locales-dir', join(PROJECT_ROOT, 'locales')],
    { encoding: 'utf-8' },
  );
  // Expected exit is 0 with warnings about orphans (nothing keyed yet).
  assert.equal(result.status, 0, `stderr=${result.stderr}`);
});
