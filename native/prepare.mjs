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
  .replace(/href="" style="color:#fff"/, 'href="https://unlistedgrants.com/" style="color:#fff"')
  .replace(/href="icon-192\.png"/, 'href="icon-180.png"');

fs.writeFileSync(path.join(WWW, 'index.html'), shell);
files += 1;

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
