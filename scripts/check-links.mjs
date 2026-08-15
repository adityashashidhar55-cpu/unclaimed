#!/usr/bin/env node
/**
 * Every internal link in the built site, resolved against what was actually
 * written to disk.
 *
 * This exists because broken links were reported and I had no way to find them
 * except by clicking. A static site can be checked exhaustively in a second —
 * there is no excuse for shipping a nav item that 404s.
 *
 * Only internal links: external URLs are the funders' problem and change
 * without notice, and hammering 3,900 government sites on every build would be
 * rude and slow.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const htmlFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmlFiles.push(p);
  }
})(DIST);

/* Routes the Worker answers before the static assets are consulted — they are
   real URLs with no file behind them, and wrangler.jsonc's run_worker_first is
   the source of truth. Kept in sync by test, not by memory: see verify.mjs. */
const WORKER_ROUTES = [/^\/api\//, /^\/auth\//, /^\/webhooks\//];

/** Does this href resolve to something on disk? */
function resolves(href) {
  let p = href.split('#')[0].split('?')[0];
  if (!p) return true;
  if (WORKER_ROUTES.some((re) => re.test(p))) return true;
  if (!p.startsWith('/')) return null; // relative — checked against its page
  const target = path.join(DIST, p);
  if (fs.existsSync(target)) {
    if (fs.statSync(target).isDirectory()) return fs.existsSync(path.join(target, 'index.html'));
    return true;
  }
  return fs.existsSync(target + '.html') || fs.existsSync(path.join(target, 'index.html'));
}

const broken = new Map(); // href -> pages that link to it
let checked = 0;

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const page = '/' + path.relative(DIST, file).replace(/index\.html$/, '').replace(/\\/g, '/');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|data:|#|javascript:)/.test(href)) continue;
    checked += 1;
    let ok;
    if (href.startsWith('/')) {
      ok = resolves(href);
    } else {
      const base = path.dirname(file);
      const t = path.join(base, href.split('#')[0].split('?')[0]);
      ok = fs.existsSync(t) || fs.existsSync(t + '.html') || fs.existsSync(path.join(t, 'index.html'));
    }
    if (!ok) {
      if (!broken.has(href)) broken.set(href, new Set());
      broken.get(href).add(page);
    }
  }
}

console.log(`\nChecked ${checked} internal links across ${htmlFiles.length} pages.\n`);

if (!broken.size) {
  console.log('  ✓ every internal link resolves\n');
  process.exit(0);
}

/* Sorted by blast radius: a dead link in the footer breaks 5,900 pages and is
   a different problem from one on a single programme page. */
const rows = [...broken.entries()].sort((a, b) => b[1].size - a[1].size);
console.error(`  ✗ ${rows.length} distinct broken targets\n`);
for (const [href, pages] of rows.slice(0, 40)) {
  const sample = [...pages].slice(0, 2).join(', ');
  console.error(`  ${String(pages.size).padStart(5)} pages → ${href}`);
  console.error(`        e.g. ${sample}`);
}
if (rows.length > 40) console.error(`\n  …and ${rows.length - 40} more.`);
console.error('');
process.exit(1);
