#!/usr/bin/env node
/**
 * Non-negotiable check: shipped code must never reference a remote URL — no CDN,
 * no remote font, no remote model.
 *
 * Scans apps/, packages/, tools/ source. Excludes docs/, generated output, and
 * documentation-only fields in the model manifest (`sourceUrl`, `licenseUrl`,
 * `repo`), which record provenance and are never fetched at runtime.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps', 'packages', 'tools'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'pkg',
  'coverage',
  'target',
  'public',
  'test-results',
  'playwright-report',
  '.vite',
]);
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.json']);

/** Documentation-only JSON keys allowed to contain a URL. */
const ALLOWED_JSON_KEYS = /^\s*"(sourceUrl|licenseUrl|repo|homepage|\$schema)"\s*:/;

/** Comment lines may cite a URL for provenance; they are not code. */
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|<!--|#)/;

const URL_RE = /https?:\/\/[^\s"'`)]+/;

/** Explicit, reviewed exceptions. */
const ALLOW_LIST = [
  // W3C/schema namespaces in SVG markup are identifiers, not network fetches.
  /xmlns/,
  /www\.w3\.org/,
  // Our own dev/preview servers.
  /^https?:\/\/localhost(:\d+)?/,
];

/**
 * Test and config files are not shipped. They legitimately name CDNs in order to
 * assert that those URLs are *rejected*, and they name localhost for dev servers.
 */
const NON_SHIPPED =
  /(\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|[\\/]tests?[\\/]|playwright\.config\.|vitest\.config\.)/;

const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (EXTS.has(extname(name))) scan(full);
  }
}

function scan(file) {
  const rel = relative(root, file);
  if (NON_SHIPPED.test(rel)) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const match = URL_RE.exec(line);
    if (!match) return;
    if (ALLOW_LIST.some((re) => re.test(line) || re.test(match[0]))) return;
    if (COMMENT_LINE.test(line)) return;
    if (extname(file) === '.json' && ALLOWED_JSON_KEYS.test(line)) return;
    violations.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

for (const r of ROOTS) {
  try {
    walk(join(root, r));
  } catch {
    /* directory may not exist yet */
  }
}

if (violations.length > 0) {
  console.error('Remote URL references found in shipped code:\n');
  for (const v of violations) console.error('  ' + v);
  console.error(
    '\nThis project must run fully offline. Bundle the asset locally, or (for pure ' +
      'provenance/documentation) move the URL into a comment or an allowed manifest field.',
  );
  process.exit(1);
}

console.log('check-no-remote: OK — no remote URLs in apps/, packages/, tools/.');
