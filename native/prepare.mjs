/**
 * Assemble the native web root.
 *
 * Capacitor serves a folder of static files from inside the binary. This
 * copies exactly what the app needs out of the built site — and nothing else,
 * because bundling all 5,884 marketing pages into an app download would be
 * absurd and would push the binary past the size where people install it on
 * mobile data.
 *
 * What ships inside the app:
 *   the app shell, its CSS and JS, the shared engines and packages, and the
 *   full programme dataset. That last one is the point: the check runs on
 *   device against bundled data, so the app works in airplane mode on day one
 *   rather than after a first successful sync.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '..', 'dist');
const WWW = path.join(HERE, 'www');

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `node src/build.mjs` first.');
  process.exit(1);
}

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

const copy = (rel, { optional = false } = {}) => {
  const from = path.join(DIST, rel);
  const to = path.join(WWW, rel);
  if (!fs.existsSync(from)) {
    if (optional) return 0;
    console.error(`missing required asset: ${rel}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.cpSync(from, to, { recursive: true });
    let n = 0;
    (function count(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) count(path.join(d, e.name));
        else n += 1;
      }
    })(from);
    return n;
  }
  fs.copyFileSync(from, to);
  return 1;
};

let files = 0;
for (const asset of [
  'app/app.css',
  'app/app.js',
  'app/native.js',
  'app/auth.js',
  /* auth.js imports ../beacon.js. Missing here, that import does not resolve,
     and a failed module import takes the WHOLE graph down — app.js never
     evaluates and the app opens to a blank screen. Nothing in the shell logs
     it anywhere a store reviewer would think to look. */
  'beacon.js',
  'audience.js',
  'engine',
  'packages',
  'api/v1',
  'theme.css',
  'icon-192.svg',
  'icon-512.svg',
]) {
  files += copy(asset);
}

/* Raster icons for the native shell. Safari ignores an SVG apple-touch-icon
   and substitutes a screenshot of the page, which looks broken on the home
   screen — so the PNGs generated for the stores are reused here. */
for (const png of ['icon-180.png', 'icon-192.png', 'icon-512.png']) {
  const from = path.join(HERE, 'resources', png);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(WWW, png));
    files += 1;
  } else {
    console.warn(`missing ${png} — run \`python3 gen-assets.py\` before packaging.`);
  }
}

/* index.html goes at the ROOT of the web dir — Capacitor loads `/index.html`,
   not `/app/index.html`, and a wrong path here shows a white screen on device
   with no error anywhere useful. */
const shell = fs
  .readFileSync(path.join(DIST, 'app', 'index.html'), 'utf8')
  /* Inside the binary everything is served from the root. */
  .replace(/data-base="[^"]*"/, 'data-base=""')
  .replace(/(href|src)="\/app\//g, '$1="app/')
  .replace(/(href|src)="\/(?!\/)/g, '$1="')
  /* No service worker in the native shell: the files are already local, and a
     second cache layer over a bundled asset only creates a way to serve a
     stale copy after an app update. */
  .replace(/<link rel="manifest"[^>]*>/, '')
  .replace(/<script>[\s\S]*?serviceWorker[\s\S]*?<\/script>/g, '')
  /* The no-JS escape hatch links back to the site root, which is empty once
     the base path is stripped. In the app it must be an absolute URL or it
     is a dead link. */
  .replace(/href="" style="color:#fff"/, 'href="https://unclaimedgrant.com/" style="color:#fff"')
  .replace(/href="icon-192\.png"/, 'href="icon-180.png"')
  /* Cache-busting query strings are for a CDN. Inside the binary the files are
     local and the ?v= suffix just makes the reference miss. */
  .replace(/(\.(?:css|js))\?v=\d+/g, '$1')
  /* Preconnect hints for a host the bundle no longer talks to. Harmless, and
     still a DNS lookup to Google on every launch. */
  .replace(/<link rel="(?:preconnect|dns-prefetch)"[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '')
  /* The one line that makes accounts work on a device.
     Capacitor serves this bundle from https://localhost, so a relative
     `/api/me` resolves to a file inside the app — which does not exist, 404s,
     and makes the client conclude "signed out". Not loudly: the app would
     simply never log anybody in, and nothing in the logs would say why.
     Stamping an absolute base here is what turns every API call in the bundle
     into a call to the real Worker. auth.js reads it and switches to bearer
     tokens at the same time, because a SameSite=Lax cookie is not sent
     cross-origin from a WKWebView either. */
  .replace(
    '<head>',
    '<head>\n<script>window.__UA_API__="https://unclaimedgrant.com";</script>',
  );

fs.writeFileSync(path.join(WWW, 'index.html'), shell);
files += 1;

/* No third party on launch.
 *
 * theme.css opens with an @import of Google Fonts. On the web that is fine.
 * Inside a packaged app it is three problems at once:
 *
 *   - the store listing says the app works in airplane mode, and a font that
 *     has to be fetched does not;
 *   - the Play Data Safety declaration says no data is shared with third
 *     parties, and a font request hands the user's IP to Google on every
 *     single launch;
 *   - it is a network round trip in front of first paint, on a cold start,
 *     over whatever connection the user has.
 *
 * Both faces already carry a full fallback stack — Georgia for the headings,
 * the platform UI sans for everything else — so removing the import changes
 * the typeface and nothing else about the layout. scripts/test-native-boot.mjs
 * loads the bundle in a real browser and fails if anything third-party is
 * requested.
 */
{
  /* Every stylesheet in the bundle, not a named one. theme.css was the obvious
     import and app/app.css carried a second copy — stripping only the file
     somebody thought of left the launch request exactly where it was, and the
     browser test still saw fonts.googleapis.com. */
  let stripped = 0;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.css')) continue;
      const before = fs.readFileSync(full, 'utf8');
      const after = before.replace(/@import url\((?:'|")?https:\/\/fonts\.googleapis\.com[^)]*\);?/g, '');
      if (after !== before) { fs.writeFileSync(full, after); stripped += 1; }
    }
  })(WWW);
  if (stripped) console.log(`removed the Google Fonts @import from ${stripped} stylesheet${stripped === 1 ? '' : 's'} — the app loads no third-party asset`);
}

/* The same cache-busting strip, over every module in the bundle.
 *
 * It was applied to index.html only, and index.html is not where most of the
 * specifiers are: `app/app.js` imports `../engine/matcher.js?v=1788159185479`
 * and four others the same way. Over HTTP the query is ignored and the file
 * loads. Inside the binary it is part of the path, the file is not found, and
 * a failed import in a `<script type="module">` takes down the ENTIRE graph
 * with no error anybody sees — the app opens to a blank screen, and the store
 * reviewer who sees it has no way to report anything more useful than "does
 * not work".
 *
 * This is the same silent-failure shape the repo keeps rediscovering, so the
 * strip is a walk over what was actually copied rather than a list of files
 * somebody has to remember to extend. scripts/verify-native.mjs resolves the
 * whole module graph afterwards and fails if any specifier still misses.
 */
{
  let stripped = 0;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(js|css)$/.test(e.name)) continue;
      const before = fs.readFileSync(full, 'utf8');
      const after = before.replace(/(\.(?:css|js))\?v=\d+/g, '$1');
      if (after !== before) { fs.writeFileSync(full, after); stripped += 1; }
    }
  })(WWW);
  if (stripped) console.log(`stripped ?v= cache-busting from ${stripped} bundled modules`);
}

/* app.js registers the service worker itself — strip that too. */
const appJs = path.join(WWW, 'app', 'app.js');
fs.writeFileSync(
  appJs,
  fs
    .readFileSync(appJs, 'utf8')
    .replace(
      /if \('serviceWorker' in navigator\)[\s\S]*?\n\}\n/,
      '/* Service worker removed for the native build: assets are bundled. */\n',
    ),
);

const size = (function du(d) {
  let b = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    b += e.isDirectory() ? du(p) : fs.statSync(p).size;
  }
  return b;
})(WWW);

console.log(`native/www ready — ${files} files, ${(size / 1024 / 1024).toFixed(1)} MB bundled.`);
if (size > 60 * 1024 * 1024) {
  console.warn('Bundle over 60 MB — Play warns above 150 MB, but check what grew.');
}
