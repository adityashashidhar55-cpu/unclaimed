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

/* ------------------------------------------------------------------ */
/* Module specifiers inside inline <script type="module">              */
/* ------------------------------------------------------------------ */

/* The link checker above walks href/src. It does not look inside a
   `<script type="module">`, and that blind spot shipped a real outage: the
   localised account pages imported `/de/app/auth.js`, which has never existed,
   because the template used the language-prefixed base instead of the site
   base. A 404 on a module specifier is the quietest failure in the browser —
   it does not throw anywhere visible, it just abandons the whole script, so
   the sign-in form's submit handler was never attached and pressing the button
   did nothing on six of the seven languages.
 
   Every absolute specifier in an inline module must resolve to a real file. */
{
  let checked = 0;
  const broken = [];  // shadows the href map above on purpose — different check
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    for (const block of html.matchAll(/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)) {
      for (const m of block[1].matchAll(/(?:from|import)\s+['"](\/[^'"]+)['"]/g)) {
        checked += 1;
        const spec = m[1].split('?')[0];
        if (!fs.existsSync(path.join(DIST, spec.replace(/^\//, '')))) {
          broken.push(`${path.relative(DIST, file)} imports ${spec}`);
        }
      }
    }
  }
  /* Resolving is not enough: an unversioned specifier resolves perfectly and
     still loads YESTERDAY's copy out of the browser cache. When that copy
     predates an export the page now imports, the browser refuses the module
     and abandons the entire <script type="module"> — no error on the page, no
     sign-in, no checkout. That has now happened twice, once from a 404 and
     once from a stale cache, and both times it read as "sign-in is broken for
     everyone". Every first-party module import must carry the asset version. */
  const unversioned = [];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    for (const block of html.matchAll(/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)) {
      for (const m of block[1].matchAll(/(?:from|import)\s+['"](\/[^'"]+)['"]/g)) {
        if (!/[?&]v=/.test(m[1])) unversioned.push(`${path.relative(DIST, file)} imports ${m[1]}`);
      }
    }
  }
  if (unversioned.length) {
    console.error(`\n  ✗ ${unversioned.length} inline module imports carry no ?v= and can load a stale copy:`);
    for (const b of unversioned.slice(0, 10)) console.error(`      ${b}`);
    console.error('');
    process.exit(1);
  }
  console.log(`  ✓ every inline module import is version-pinned`);

  /* And the imports INSIDE the JavaScript. This is the one that actually bit:
     /app.js was fresh on the server and imported './engine/matcher.js' with no
     version, so the service worker kept serving the matcher from whichever
     build a visitor first saw. The deploy was complete and the user saw no
     change at all — for weeks, in principle, since nothing would ever evict
     it. Checking only the HTML missed it entirely. */
  const jsFiles = [];
  (function walkJs(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walkJs(f);
      else if (e.name.endsWith('.js')) jsFiles.push(f);
    }
  })(DIST);

  const staleImports = [];
  for (const f of jsFiles) {
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.\.?\/[^'"]+\.js)(\?[^'"]*)?['"]/g)) {
      if (!/[?&]v=/.test(m[2] || '')) staleImports.push(`${path.relative(DIST, f)} imports ${m[1]}`);
    }
  }
  if (staleImports.length) {
    console.error(`\n  ✗ ${staleImports.length} imports inside JS files carry no ?v= — a cached copy can be pinned forever:`);
    for (const b of staleImports.slice(0, 10)) console.error(`      ${b}`);
    console.error('');
    process.exit(1);
  }
  console.log(`  ✓ every import inside a JS file is version-pinned too`);

  /* And the service worker version must move whenever the shell does, or the
     caches holding the old copies are never dropped. */
  const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  const v = sw.match(/VERSION\s*=\s*'([^']+)'/)?.[1];
  v && v !== 'v2'
    ? console.log(`  ✓ the service worker cache version is ${v}, past the poisoned v2`)
    : (console.error('\n  ✗ the service worker is still on v2, whose caches hold the pre-gate matcher\n'), process.exit(1));

  if (broken.length) {
    console.error(`\n  ✗ ${broken.length} inline module imports do not resolve:`);
    for (const b of broken.slice(0, 10)) console.error(`      ${b}`);
    console.error('');
    process.exit(1);
  }
  console.log(`  ✓ all ${checked} inline module imports resolve`);
}

/* Every class name in the built HTML must have a rule behind it.

   This found thirteen that did not, several on thousands of pages:
   `.detail-grid` (the programme page's two-column layout — so there was no
   second column), `.breadcrumb`, `.stack` and `.sticky-side` (three full-width
   buttons flush against each other), `.stat-strip`, `.badge-auto-apply` and
   `.badge-action` (the two states a reader most needs to tell apart, drawn
   identically), `.no-print`. None of them errors. The page renders; it is just
   not the page anyone designed. */
{
  const sheets = ['src/theme.css', 'src/pwa/app.css', 'src/pwa/dashboard.css']
    .map((f) => path.join(ROOT, f))
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const styled = new Set([...sheets.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const used = new Map();
  for (const f of htmlFiles) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c) used.set(c, (used.get(c) || 0) + 1);
    }
  }
  const orphans = [...used.entries()].filter(([c]) => !styled.has(c)).sort((a, b) => b[1] - a[1]);
  if (orphans.length) {
    console.error('\n  ✗ class names in the built HTML with no rule in any stylesheet:');
    for (const [c, n] of orphans.slice(0, 15)) console.error(`      .${c} — on ${n} element${n === 1 ? '' : 's'}`);
    console.error('');
    process.exit(1);
  }
  console.log(`  ✓ all ${used.size} class names used in the build are styled`);
}

/* The audience switch may only ever hide.

   `html[data-audience='biz'] .aud-biz { display: revert }` looks like it
   restores the element, and it restores the *browser's* default instead — so
   the enterprise nav, a flex row with a 1.3rem gap, rendered as inline text
   with its links 4px apart. Nothing errors, nothing 404s, and it is invisible
   in the individual view. So: no rule scoped to an audience may set `display`
   to anything but `none`. */
{
  /* Comments first — this file explains the bug it is guarding against, and a
     scanner that reads its own explanation as code fails on a correct file. */
  const css = fs.readFileSync(path.join(ROOT, 'src/theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const bad = [];
  for (const m of css.matchAll(/([^{}]*data-audience[^{}]*)\{([^}]*)\}/g)) {
    const decl = m[2].match(/display\s*:\s*([^;!]+)/);
    if (decl && decl[1].trim() !== 'none') bad.push(`${m[1].trim()} sets display: ${decl[1].trim()}`);
  }
  if (bad.length) {
    console.error('\n  ✗ an audience rule sets display to something other than none:');
    for (const b of bad) console.error(`      ${b}`);
    console.error('');
    process.exit(1);
  }
  console.log('  ✓ the audience switch only ever hides');
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
