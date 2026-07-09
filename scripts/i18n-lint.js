#!/usr/bin/env node
/**
 * i18n-lint — standalone validator for locale dictionaries and HTML markers.
 *
 * Scope: validates dict integrity (via loadDictionaries — symmetry, tokens,
 * entities, symlinks, depth cap) + cross-references HTML `data-i18n*`
 * markers against the dictionaries. It does NOT reproduce the plugin's
 * markup-level checks (double-marker collisions, attribute-name allowlist,
 * URL-scheme allowlist, <meta http-equiv> rejection, sanitiser rules) —
 * those are transform-time concerns and the plugin owns them at build.
 * The lint's job is the fast-feedback dict/marker cross-reference so
 * broken keys don't require a full build to surface.
 *
 * Exit codes:
 *   0 — clean (may print WARNINGS but nothing broken)
 *   1 — errors found (missing keys / malformed markers / dict validation
 *       failure)
 *   2 — usage error
 *
 * Usage:
 *   node scripts/i18n-lint.js [--locales-dir <path>] [--root <path>]
 *                             [--strict-orphans]
 *
 * Options:
 *   --locales-dir <path>   Where the locale JSONs live (default:
 *                          <root>/locales, resolved after --root)
 *   --root <path>          Root directory to scan for HTML files
 *                          (default: the repo root that contains this
 *                          script, NOT process.cwd())
 *   --strict-orphans       Treat orphan keys (in dict, unused in HTML) as
 *                          errors instead of warnings. Enable once every
 *                          page has been keyed (post-Task #165).
 *   --help                 Print this help and exit 0.
 *
 * The HTML scan is a lightweight regex sweep — it does NOT DOM-parse. To
 * avoid false positives from marker-shaped substrings inside <script>
 * template literals, <style> blocks, or HTML comments (which the DOM-
 * parsing plugin never sees as attributes), we strip those regions from
 * the source before matching. A DOM-parse would also work but doubles the
 * bug surface for a linter that already fails-open on the plugin's own
 * markup checks.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadDictionaries } from './i18n-plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// Marker regexes — anchor on the attribute NAME so we don't accidentally
// match `data-i18n-attrs="…"` (with trailing s) or `data-i18nfoo="…"`.
// The attribute name must be immediately followed by `=` (allowing
// tolerant whitespace, though HTML5 disallows it). Value can be single-
// or double-quoted. `[^"]*` and `[^']*` DO match newlines by default in
// JavaScript regex, so multi-line attribute values work.
//
// The negative-lookahead `(?![\w-])` after each attribute name prevents
// a false match on `data-i18nfoo="…"` or `data-i18n-html="…"` when we
// were looking for `data-i18n`.
//
// The `i` flag is REQUIRED: HTML5 attribute names are ASCII case-
// insensitive; parse5 (used by the plugin) normalises to lowercase on
// DOM ingest, so `<p Data-I18N="x">` is a legitimate marker to the
// plugin. Without `i` the lint regex misses it and the plugin/lint
// contract breaks (M1).
const RE_I18N_TEXT   = /\bdata-i18n(?![\w-])\s*=\s*("([^"]*)"|'([^']*)')/gi;
const RE_I18N_HTML   = /\bdata-i18n-html(?![\w-])\s*=\s*("([^"]*)"|'([^']*)')/gi;
const RE_I18N_ATTR   = /\bdata-i18n-attr(?![\w-])\s*=\s*("([^"]*)"|'([^']*)')/gi;
const RE_I18N_META   = /\bdata-i18n-meta(?![\w-])\s*=\s*("([^"]*)"|'([^']*)')/gi;

// Regions to blank out before marker extraction. `[\s\S]` is the
// newline-inclusive "any char" idiom (regex `.` alone doesn't cross
// newlines without the `s` flag, and even then some hosts have parsing
// quirks). All patterns are non-greedy so nested tag-like content
// doesn't over-consume.
//
// Script/style are handled in TWO parts: the opening tag is left
// visible (so `<script data-i18n="...">` markers ON the element itself
// are still seen by the marker regexes — the plugin's DOM parse finds
// them, so lint must too, per the H3 fix), and only the CONTENT between
// the tags is blanked. `RE_TAG_CONTENT` in maskNonMarkupRegions uses
// per-tag scans instead of a single regex to avoid the `[^>]*` early-
// truncation footgun on tags whose attributes contain `>` (H3 tail).
const RE_HTML_COMMENT   = /<!--[\s\S]*?-->/g;
const RE_SCRIPT_OPEN    = /<script\b[\s\S]*?>/gi;
const RE_STYLE_OPEN     = /<style\b[\s\S]*?>/gi;

// Directories to skip when walking the tree. `dist/` is a build artefact
// (it contains injected translations, which would fake-pass every check).
// `node_modules/` is obvious. `__tests__/` contains fixtures with
// intentionally-malformed dicts/HTML that would blow up the lint.
// `.github`/`.claude`/`.husky` etc. all fall through the dotfile skip
// below and don't need explicit entries here.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '__tests__',
]);

/**
 * Recursively walk a directory, yielding every `.html` file path (absolute).
 *
 * Symlinks are NOT followed. With `withFileTypes: true`, Dirent.isDirectory()
 * returns false for symlinks-to-directories (they satisfy isSymbolicLink()
 * instead), so recursion never descends into them. This is deliberate —
 * a repo checkout with adversarial symlinks would let a lint that follows
 * them scan outside the tree it was pointed at.
 */
function* walkHtml(dir, rootDir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Missing dir is fatal only if it's the top-level scan root; a
    // missing subdirectory during recursion means it disappeared
    // mid-walk, which is fine to skip.
    if (dir === rootDir) throw err;
    return;
  }
  for (const entry of entries) {
    // Skip all dotfiles/dotdirs — this covers `.git`, `.github`, `.claude`,
    // `.vscode`, `.husky`, `.env*`, and anything else prefixed with a dot.
    // None of these contain HTML the lint should be validating.
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkHtml(full, rootDir);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      yield full;
    }
  }
}

/**
 * Blank out `<script>` / `<style>` element CONTENT and HTML comments in
 * the source so marker regexes can't false-match on template literals,
 * CSS content, or commented-out markup. Replacement is space-of-equal-
 * length so subsequent regex offsets (if we ever add source-position
 * reporting) stay meaningful.
 *
 * IMPORTANT ordering (H2 fix): script/style CONTENT is blanked FIRST,
 * comments SECOND. If comments were blanked first, a stray `<!--` inside
 * a `<script>` string literal (e.g. `const t = '<!-- foo';`) would
 * make the non-greedy comment regex consume across the script's closing
 * tag up to any later `-->` on the page, eating legitimate markers in
 * between.
 *
 * IMPORTANT masking granularity (H3 fix): we blank ONLY the content
 * between opening and closing tags, leaving the opening tag visible so
 * marker regexes can still find `<script data-i18n="…">` — the plugin's
 * DOM parse sees those markers and enforces them at build; lint must too
 * or it fails-open on JS-heavy pages that legitimately use markers on
 * <script>/<style> elements.
 *
 * The tag-content masks use a two-step scan (opening-tag regex → find
 * matching closing tag by string search) instead of a single
 * `<script\b[^>]*>...</script>` regex. The `[^>]*` shape truncates at
 * the first `>` inside the opening tag, so an opening like
 * `<script data-cfg="{'k':'>'}">` breaks the single-regex approach
 * silently. Using `<script\b[\s\S]*?>` (which is greedy about crossing
 * `>` in quoted attribute values) then a plain `indexOf('</script')`
 * for the close is more robust — matches how HTML5 parsers actually
 * find the script boundary.
 */
function maskNonMarkupRegions(html) {
  const blank = (n) => ' '.repeat(n);
  let out = html;

  // Blank content of every <script>/<style> element. Opening tag is
  // preserved (so its own attributes remain scannable for markers).
  const maskTagContent = (source, openRe, closeTag) => {
    let result = '';
    let cursor = 0;
    openRe.lastIndex = 0;
    let m;
    while ((m = openRe.exec(source)) !== null) {
      // Everything up to and including the opening tag stays as-is.
      const openEnd = m.index + m[0].length;
      result += source.slice(cursor, openEnd);
      // Find the matching close tag. Case-insensitive search via
      // toLowerCase substring; falls back to end-of-source if the
      // author forgot the close (matches HTML5 parser tolerance).
      const closeIdx = source
        .toLowerCase()
        .indexOf(closeTag, openEnd);
      const contentEnd = closeIdx < 0 ? source.length : closeIdx;
      result += blank(contentEnd - openEnd);
      cursor = contentEnd;
      openRe.lastIndex = contentEnd; // advance past the blanked span
    }
    result += source.slice(cursor);
    return result;
  };

  out = maskTagContent(out, RE_SCRIPT_OPEN, '</script');
  out = maskTagContent(out, RE_STYLE_OPEN, '</style');

  // Comments last — anything comment-shaped that was inside a now-
  // blanked script/style body is already spaces, so this pass only
  // touches real HTML comments in the visible markup.
  out = out.replace(RE_HTML_COMMENT, (m) => blank(m.length));

  return out;
}

/**
 * Extract all i18n marker references from a single HTML source. Returns a
 * list of `{kind, key}` records; `kind` is one of `text | html | attr |
 * meta` and `key` is the dot-path to look up in the dictionaries.
 *
 * For `data-i18n-attr` the raw value packs 1..N `attr:key` pairs
 * separated by `;` — matches the plugin's `handleAttrMarker` semantics.
 * Empty pairs (leading/trailing/duplicate `;`) are errors, matching the
 * plugin's behaviour so the lint can catch them before build.
 */
function extractMarkers(html, relPath) {
  const out = [];
  const errors = [];

  const source = maskNonMarkupRegions(html);
  const capture = (match) => match[2] ?? match[3] ?? '';

  for (const m of source.matchAll(RE_I18N_TEXT)) {
    const val = capture(m).trim();
    if (!val) {
      errors.push(`${relPath}: empty data-i18n= value`);
      continue;
    }
    out.push({ kind: 'text', key: val });
  }

  for (const m of source.matchAll(RE_I18N_HTML)) {
    const val = capture(m).trim();
    if (!val) {
      errors.push(`${relPath}: empty data-i18n-html= value`);
      continue;
    }
    out.push({ kind: 'html', key: val });
  }

  for (const m of source.matchAll(RE_I18N_ATTR)) {
    const raw = capture(m);
    if (raw.trim().length === 0) {
      errors.push(`${relPath}: empty data-i18n-attr= value`);
      continue;
    }
    // Buffer this marker's pairs into a local array; only merge into
    // `out` if the marker parses cleanly (H4 fix). This matches the
    // plugin's atomicity: a malformed marker MUST NOT contribute keys
    // to the "used" set, or an orphan check gets silently poisoned by
    // a broken marker.
    const pairs = raw.split(';');
    const pending = [];
    let markerHadError = false;
    for (const rawPair of pairs) {
      const pair = rawPair.trim();
      if (pair.length === 0) {
        errors.push(
          `${relPath}: data-i18n-attr="${raw}" contains an empty pair (leading/trailing/duplicate ";"). Expected "attr:key" pairs separated by ";".`,
        );
        markerHadError = true;
        // Match the plugin: stop at first empty pair; other errors
        // ALSO stop here for consistency (finding P9 tail — one policy,
        // uniformly applied). The marker is invalid; more error messages
        // for the same marker are noise.
        break;
      }
      // Split on the LAST colon so keys may contain colons (permitted by
      // the plugin, though the dict flattener doesn't currently produce
      // such keys).
      const idx = pair.lastIndexOf(':');
      if (idx < 0) {
        errors.push(
          `${relPath}: data-i18n-attr="${raw}" pair "${pair}" missing colon separator (expected attr:key)`,
        );
        markerHadError = true;
        break;
      }
      const attr = pair.slice(0, idx).trim();
      const key = pair.slice(idx + 1).trim();
      if (!attr) {
        errors.push(
          `${relPath}: data-i18n-attr="${raw}" pair "${pair}" has empty attr name`,
        );
        markerHadError = true;
        break;
      }
      if (!key) {
        errors.push(
          `${relPath}: data-i18n-attr="${raw}" pair "${pair}" has empty key`,
        );
        markerHadError = true;
        break;
      }
      pending.push({ kind: 'attr', key, attr });
    }
    // Only commit pairs from a fully-valid marker.
    if (!markerHadError) {
      for (const p of pending) out.push(p);
    }
  }

  for (const m of source.matchAll(RE_I18N_META)) {
    const val = capture(m).trim();
    if (!val) {
      errors.push(`${relPath}: empty data-i18n-meta= value`);
      continue;
    }
    out.push({ kind: 'meta', key: val });
  }

  return { markers: out, errors };
}

/**
 * Parse a simple long-flag CLI: `--flag`, `--flag value`. Returns null
 * (with a message printed to stderr) on any usage error so main() can
 * exit 2. Missing values for value-flags are explicit usage errors
 * rather than crashes.
 */
function parseArgs(argv) {
  const opts = {
    localesDir: null,
    strictOrphans: false,
    root: PROJECT_ROOT,
    help: false,
  };
  const requireValue = (flag, i) => {
    if (i + 1 >= argv.length) {
      console.error(`i18n-lint: missing value for ${flag}`);
      return null;
    }
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--strict-orphans') {
      opts.strictOrphans = true;
    } else if (arg === '--locales-dir') {
      const v = requireValue(arg, i);
      if (v == null) return null;
      opts.localesDir = v;
      i++;
    } else if (arg === '--root') {
      const v = requireValue(arg, i);
      if (v == null) return null;
      opts.root = resolve(v);
      i++;
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
  --locales-dir <path>   Locale JSONs directory (default: <root>/locales)
  --root <path>          Directory tree to scan for HTML (default: repo root)
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
  // Reference key set — loadDictionaries has already enforced symmetry
  // (every locale declares the same key set) and thrown if not, so
  // sampling from locales[0] is safe.
  const dictKeys = new Set(Object.keys(dicts[locales[0]]));

  // 2. Walk HTML sources, extract markers, collect malformed-marker errors.
  const usedKeys = new Set();
  const missingKeys = new Map(); // key -> [relPath, ...]
  const markerErrors = [];
  let filesScanned = 0;

  for (const file of walkHtml(opts.root, opts.root)) {
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
