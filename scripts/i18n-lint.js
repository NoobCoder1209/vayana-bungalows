#!/usr/bin/env node
/**
 * i18n-lint — standalone validator for locale dictionaries and HTML markers.
 *
 * Runs the same load-time validations the Vite plugin runs at build time
 * (symmetry, tokens, entities, symlinks, depth cap) and additionally scans
 * every HTML file in the source tree for `data-i18n*` markers, then
 * cross-references marker keys against the dictionaries.
 *
 * Exit codes:
 *   0 — clean (may print WARNINGS but nothing broken)
 *   1 — errors found (missing keys / malformed markers / dict validation
 *       failure)
 *   2 — usage error
 *
 * Usage:
 *   node scripts/i18n-lint.js [--locales-dir <path>] [--strict-orphans]
 *
 * Options:
 *   --locales-dir <path>   Where the locale JSONs live (default: ./locales)
 *   --strict-orphans       Treat orphan keys (in dict, unused in HTML) as
 *                          errors instead of warnings. Enable once every
 *                          page has been keyed (post-Task #165).
 *   --root <path>          Root directory to scan for HTML files
 *                          (default: cwd)
 *   --help                 Print this help and exit 0.
 *
 * The HTML scan is a lightweight regex sweep — it does NOT parse markup,
 * because the plugin already does authoritative parsing at build time and
 * re-doing it here doubles the surface for bugs. What we need is
 * "is this key in the dict, yes/no", and a regex reliably answers that.
 * If a marker attribute value happens to contain HTML-quote characters
 * they'd have been rejected as invalid HTML long before reaching lint.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadDictionaries } from './i18n-plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// Marker regexes — anchor on the attribute NAME so we don't accidentally
// match `data-i18n-attrs="…"` (with trailing s) or `data-i18nfoo="…"`.
// The attribute name must be immediately followed by `=` (allowing
// tolerant whitespace, though HTML5 disallows it). Value can be single-
// or double-quoted.
//
// One regex per marker kind so we can attach kind-specific parsing:
const RE_I18N_TEXT   = /\bdata-i18n\s*=\s*("([^"]*)"|'([^']*)')/g;
const RE_I18N_HTML   = /\bdata-i18n-html\s*=\s*("([^"]*)"|'([^']*)')/g;
const RE_I18N_ATTR   = /\bdata-i18n-attr\s*=\s*("([^"]*)"|'([^']*)')/g;
const RE_I18N_META   = /\bdata-i18n-meta\s*=\s*("([^"]*)"|'([^']*)')/g;

// Directories to skip when walking the tree. `dist/` is a build artefact
// (it contains injected translations, which would fake-pass every check).
// `node_modules/` is obvious. `scripts/__tests__/fixtures/` contains
// intentionally-malformed dicts for the plugin's own test suite.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
]);

/**
 * Recursively walk a directory, yielding every `.html` file path (absolute).
 * Symlinks are followed via readdirSync's default behavior; we don't try
 * to be defensive here because a repo checkout shouldn't have adversarial
 * symlinks and the plugin's build-time symlink guard covers the locale
 * files (which is the real attack surface).
 */
function* walkHtml(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Missing dir is fatal only if it's the top-level scan root; a
    // missing subdirectory during recursion means it disappeared
    // mid-walk, which is fine to skip.
    if (dir === PROJECT_ROOT) throw err;
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    // Skip fixtures for the plugin's own tests — they intentionally contain
    // malformed dicts/HTML and would blow up the lint.
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkHtml(full);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      // Explicit skip for anything under a `__tests__` directory anywhere
      // in the tree — fixtures live there.
      const rel = relative(PROJECT_ROOT, full);
      if (rel.split(sep).includes('__tests__')) continue;
      yield full;
    }
  }
}

/**
 * Extract all i18n marker references from a single HTML source. Returns a
 * list of `{kind, key, raw}` records; `kind` is one of `text | html |
 * attr | meta` and `key` is the dot-path to look up in the dictionaries.
 *
 * For `data-i18n-attr` the raw value can pack multiple `attr:key` pairs
 * separated by `;` — we split-on-last-colon per pair to allow keys with
 * embedded colons (which the plugin also does).
 */
function extractMarkers(html, relPath) {
  const out = [];
  const errors = [];

  const capture = (match) => match[2] ?? match[3] ?? '';

  for (const m of html.matchAll(RE_I18N_TEXT)) {
    const val = capture(m).trim();
    if (!val) {
      errors.push(`${relPath}: empty data-i18n= value`);
      continue;
    }
    out.push({ kind: 'text', key: val });
  }

  for (const m of html.matchAll(RE_I18N_HTML)) {
    const val = capture(m).trim();
    if (!val) {
      errors.push(`${relPath}: empty data-i18n-html= value`);
      continue;
    }
    out.push({ kind: 'html', key: val });
  }

  for (const m of html.matchAll(RE_I18N_ATTR)) {
    const val = capture(m).trim();
    if (!val) {
      errors.push(`${relPath}: empty data-i18n-attr= value`);
      continue;
    }
    for (const pair of val.split(';')) {
      const p = pair.trim();
      if (!p) continue;
      // Split on the LAST colon so keys may contain colons (unusual but
      // permitted — the plugin's `handleAttrMarker` uses the same rule).
      const idx = p.lastIndexOf(':');
      if (idx <= 0 || idx === p.length - 1) {
        errors.push(
          `${relPath}: malformed data-i18n-attr pair "${p}" — expected "attr:key"`,
        );
        continue;
      }
      const attr = p.slice(0, idx).trim();
      const key = p.slice(idx + 1).trim();
      if (!attr || !key) {
        errors.push(
          `${relPath}: malformed data-i18n-attr pair "${p}" — attr and key must be non-empty`,
        );
        continue;
      }
      out.push({ kind: 'attr', key, attr });
    }
  }

  for (const m of html.matchAll(RE_I18N_META)) {
    const val = capture(m).trim();
    if (!val) {
      errors.push(`${relPath}: empty data-i18n-meta= value`);
      continue;
    }
    out.push({ kind: 'meta', key: val });
  }

  return { markers: out, errors };
}

/** Parse a simple long-flag CLI: `--flag`, `--flag value`. */
function parseArgs(argv) {
  const opts = {
    localesDir: null,
    strictOrphans: false,
    root: PROJECT_ROOT,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--strict-orphans') {
      opts.strictOrphans = true;
    } else if (arg === '--locales-dir') {
      opts.localesDir = argv[++i];
    } else if (arg === '--root') {
      opts.root = resolve(argv[++i]);
    } else {
      console.error(`i18n-lint: unknown argument "${arg}"`);
      return null;
    }
  }
  if (!opts.localesDir) opts.localesDir = join(opts.root, 'locales');
  return opts;
}

const HELP = `Usage: node scripts/i18n-lint.js [options]

Validates locale dictionaries and HTML i18n markers.

Options:
  --locales-dir <path>   Locale JSONs directory (default: ./locales)
  --root <path>          Directory tree to scan for HTML (default: cwd)
  --strict-orphans       Treat unused dict keys as errors (default: warn)
  -h, --help             Print this help and exit
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) return 2;
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  // Sanity check the root — a missing root should be a usage error, not a
  // crash halfway through the walk.
  let rootStat;
  try {
    rootStat = statSync(opts.root);
  } catch {
    console.error(`i18n-lint: --root does not exist: ${opts.root}`);
    return 2;
  }
  if (!rootStat.isDirectory()) {
    console.error(`i18n-lint: --root is not a directory: ${opts.root}`);
    return 2;
  }

  // 1. Load + validate dictionaries. Any structural problem throws.
  let dictBundle;
  try {
    dictBundle = loadDictionaries(opts.localesDir);
  } catch (err) {
    console.error(`i18n-lint: dictionary validation failed`);
    console.error(`  ${err.message}`);
    return 1;
  }
  const { locales, dicts } = dictBundle;
  // Reference key set — all locales are already symmetric per loadDictionaries.
  const dictKeys = new Set(Object.keys(dicts[locales[0]]));

  // 2. Walk HTML sources, extract markers, collect malformed-marker errors.
  const usedKeys = new Set();
  const missingKeys = new Map(); // key -> [relPath, ...]
  const markerErrors = [];
  let filesScanned = 0;

  for (const file of walkHtml(opts.root)) {
    filesScanned++;
    const rel = relative(opts.root, file);
    let html;
    try {
      html = readFileSync(file, 'utf-8');
    } catch (err) {
      markerErrors.push(`${rel}: could not read (${err.message})`);
      continue;
    }
    const { markers, errors } = extractMarkers(html, rel);
    markerErrors.push(...errors);
    for (const { key } of markers) {
      usedKeys.add(key);
      if (!dictKeys.has(key)) {
        if (!missingKeys.has(key)) missingKeys.set(key, []);
        missingKeys.get(key).push(rel);
      }
    }
  }

  // 3. Orphan keys — in dict, not used in HTML. During Task #165 rollout
  //    most keys will look orphaned; downgrade to warning unless the
  //    caller opts into strict mode.
  const orphans = [];
  for (const k of dictKeys) {
    if (!usedKeys.has(k)) orphans.push(k);
  }
  orphans.sort();

  // 4. Report.
  console.log(
    `i18n-lint: ${filesScanned} HTML file(s) scanned, ${dictKeys.size} key(s) in dict, ${usedKeys.size} used, ${orphans.length} orphan(s), ${missingKeys.size} missing`,
  );

  let hasErrors = false;

  if (markerErrors.length) {
    hasErrors = true;
    console.error(`\n[ERROR] ${markerErrors.length} malformed marker(s):`);
    for (const e of markerErrors) console.error(`  ${e}`);
  }

  if (missingKeys.size) {
    hasErrors = true;
    console.error(`\n[ERROR] ${missingKeys.size} missing key(s):`);
    for (const [k, refs] of [...missingKeys.entries()].sort()) {
      const preview = refs.slice(0, 3).join(', ');
      const more = refs.length > 3 ? `, +${refs.length - 3} more` : '';
      console.error(`  ${k}  (referenced by: ${preview}${more})`);
    }
  }

  if (orphans.length) {
    const label = opts.strictOrphans ? 'ERROR' : 'WARN';
    if (opts.strictOrphans) hasErrors = true;
    const stream = opts.strictOrphans ? console.error : console.warn;
    stream(`\n[${label}] ${orphans.length} orphan key(s) (in dict, not used in any HTML):`);
    for (const k of orphans.slice(0, 20)) stream(`  ${k}`);
    if (orphans.length > 20) stream(`  ...+${orphans.length - 20} more`);
  }

  if (hasErrors) return 1;
  console.log(`\ni18n-lint: OK`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('i18n-lint: unhandled exception');
    console.error(err.stack || err.message);
    process.exit(1);
  },
);
