#!/usr/bin/env node
/**
 * Open every screen and look at it, the way a person would.
 *
 * The test suite in this repo asserts properties of the source and of the
 * data. It cannot see that six nav links are 4px apart, that a button sits on
 * top of another one, or that a panel runs off the right edge of the phone.
 * Those are the failures a person notices in the first three seconds, and
 * every one of them shipped.
 *
 * So this drives a real browser over the built site at two widths and reports
 * geometry: elements that overflow the viewport, interactive controls that are
 * too small to hit or too close together to hit the right one, text that runs
 * under something else, and headings that wrap to more lines than they should.
 * It is deliberately about layout only — spelling and vocabulary are checked
 * by check-i18n.
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
/* Resolved through the global install: this sandbox's npm registry is 403, so
   the package cannot be a dependency of this repo. */
const { chromium } = require_('/home/claude/.npm-global/lib/node_modules/playwright/index.js');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Overridable so a pre-build dry run can point at a staged copy. Defaults to
   the real dist/, which is what CI reads. */
const DIST = process.env.UNCLAIMED_DIST || path.join(ROOT, 'dist');
const PORT = 8199;

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(DIST, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

/* The two type stacks the site is allowed to use, read out of theme.css
   rather than retyped here — src/pwa/app.css shipped Comic Sans for both
   tokens on /app/ and in the packaged native app, and a test that hardcodes
   the expected stack cannot notice the day theme.css changes. A third
   typeface anywhere is a failure. */
const THEME_CSS = fs.readFileSync(path.join(ROOT, 'src/theme.css'), 'utf8');
const normFont = (v) => String(v).replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase();
const FONT_STACKS = ['--font-heading', '--font-body'].map((tok) => {
  const m = THEME_CSS.match(new RegExp(`${tok}:\\s*([^;]+);`));
  if (!m) throw new Error(`theme.css does not define ${tok}`);
  return normFont(m[1]);
});

/* Ten pages, fixed, for the expensive passes. Contrast walks every text node
   and composites every ancestor background; running it on 5,900 pages tells
   you nothing the tenth page did not. */
const CONTRAST_PAGES = new Set(['/', '/pricing/', '/check/', '/gb/', '/gb/income_support/attendance-allowance/',
  '/countries/', '/enterprise/', '/account/', '/startups/', '/methodology/']);

const SCREENS = [
  ['home (for me)', '/', 'me'],
  ['home (for my company)', '/', 'biz'],
  ['pricing (for me)', '/pricing/', 'me'],
  ['pricing (for my company)', '/pricing/', 'biz'],
  ['the check', '/check/', 'me'],
  ['company check', '/startups/check/', 'biz'],
  ['account', '/account/', 'me'],
  ['workspace', '/dashboard/', 'biz'],
  ['enterprise', '/enterprise/', 'biz'],
  ['countries', '/countries/', 'me'],
  ['one country', '/gb/', 'me'],
  ['one programme', '/gb/income_support/attendance-allowance/', 'me'],
  ['startups index', '/startups/', 'biz'],
  ['one startup country', '/startups/gb/', 'biz'],
  ['methodology', '/methodology/', 'me'],
  ['api', '/api/', 'me'],
  ['french home', '/fr/', 'me'],
];

const WIDTHS = [[1536, 900, 'wide'], [1280, 900, 'desktop'], [900, 800, 'tablet'], [390, 844, 'phone']];

/* Every B2B URL, in every locale. These pages ARE the company product, and
   they were being served the consumer masthead and the consumer nav because
   data-audience was written from a cookie that defaults to "me". */
const LOCALES = ['', '/fr', '/de', '/es', '/it', '/pt', '/hi'];
const B2B_URLS = ['/enterprise/', '/startups/', '/startups/check/'];

/* English literals that must not survive on a localised wizard. Short and
   distinctive: a false positive here is worse than a miss. */
const ENGLISH_MARKERS = [
  'Where do you live?', 'What best describes you right now?', 'Your household',
  'Housing and residency', 'Continue', 'Where is the company registered?',
  'What stage is the company at?', 'None of these', 'Working for an employer',
];

const AUDIT = (opts) => {
  /* The most blank space two adjacent blocks may leave between their content.
 
     Declared HERE, inside the audited function, because AUDIT is serialized
     and evaluated in the page — a module-scope const is not in scope there,
     and referencing one throws a ReferenceError on all 68 renders rather than
     failing quietly, which is the one mercy in this file.
 
     Not a round number: it is the stylesheet's own arithmetic. The gap is
     measured from the last painted pixel of one block to the first of the
     next, so it necessarily contains both blocks' padding, and that padding IS
     the intended rhythm. The maximum the design asks for is .section's
     `padding-block: clamp(3rem, 6vw, 5rem)` at both ends (80 + 80) plus
     footer.site's 2rem margin-top — 192px.
 
     The threshold used to be 160, one pixel under the composed value, so it
     fired at 161px on correctly-spaced pages across nearly every screen and
     buried the finding that matters (the signed-out workspace leaves 807px of
     blank above the footer) under twenty lines of noise. */
  const RHYTHM_MAX = 192;
  const out = { overflow: [], tiny: [], crowded: [], overlap: [], wrapped: [],
                font: [], contrast: [], rhythm: [], affordance: [], stacking: [] };
  const vw = document.documentElement.clientWidth;
  const seen = (el) => {
    const s = getComputedStyle(el);
    /* A visually-hidden radio behind a CSS-only switch is not a small control,
       it is not a control at all — the label over it is. */
    if (s.opacity === '0' || s.pointerEvents === 'none') return false;
    return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
  };
  const name = (el) =>
    `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}` +
    (el.textContent ? ` "${el.textContent.trim().slice(0, 32)}"` : '');

  /* Deliberately off-screen things are not layout bugs: the skip link and the
     visually-hidden labels live at left:-9999px on purpose. */
  const parked = (r) => r.left < -1000;

  /* 1. Anything wider than the window. A single one of these produces a
        horizontal scrollbar on the whole page, which on a phone is the most
        obvious "this is broken" signal there is. */
  for (const el of document.querySelectorAll('body *')) {
    if (!seen(el)) continue;
    const r = el.getBoundingClientRect();
    if (parked(r)) continue;
    if (r.right > vw + 2 || r.left < -2) {
      if (getComputedStyle(el).position === 'fixed') continue;
      out.overflow.push(`${name(el)} spans ${Math.round(r.left)}…${Math.round(r.right)} of ${vw}`);
    }
  }

  /* 2. Controls too small to hit. 24px is the WCAG 2.2 minimum. A link inside
        a sentence is exempt — it is text, and its hit area is the line box —
        so this looks only at things drawn as controls. */
  const isControl = (el) => {
    if (el.tagName === 'BUTTON' || el.tagName === 'SELECT' || el.tagName === 'INPUT') return true;
    if (el.getAttribute('role') === 'tab') return true;
    const c = typeof el.className === 'string' ? el.className : '';
    return /\bbtn\b|__tab|nav__account|chip|pill/.test(c);
  };
  for (const el of document.querySelectorAll('a[href], button, select, input, [role=tab]')) {
    if (!seen(el) || !isControl(el)) continue;
    const r = el.getBoundingClientRect();
    if (parked(r)) continue;
    if (r.height < 24 || r.width < 24) out.tiny.push(`${name(el)} is ${Math.round(r.width)}×${Math.round(r.height)}`);
  }

  /* 3. Controls crowded together. Two buttons 4px apart get mis-tapped, and a
        row of links with no space between them reads as one sentence. */
  /* Same rule for crowding: two buttons 4px apart is a defect, two words in a
     sentence 4px apart is a sentence. Segmented controls are exempt — the two
     halves of a pill switch are supposed to touch. */
  const controls = [...document.querySelectorAll('a[href], button, [role=tab]')]
    .filter((el) => seen(el) && isControl(el) && !parked(el.getBoundingClientRect()));
  const segment = (el) => el.closest('[role=tablist], .audswitch, .seg');
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i].getBoundingClientRect();
      const b = controls[j].getBoundingClientRect();
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const seg = segment(controls[i]);
      if (seg && seg === segment(controls[j])) continue;
      const vGap = b.top - a.bottom;
      const hGap = b.left - a.right;
      const sameRow = Math.abs(a.top - b.top) < 6;
      const sameCol = Math.abs(a.left - b.left) < 6;
      if (sameRow && hGap >= 0 && hGap < 8) out.crowded.push(`${name(controls[i])} and ${name(controls[j])} are ${Math.round(hGap)}px apart`);
      else if (sameCol && vGap >= 0 && vGap < 8) out.crowded.push(`${name(controls[i])} sits ${Math.round(vGap)}px above ${name(controls[j])}`);
      else if (hGap < -2 && vGap < -2 && a.width && b.width) out.overlap.push(`${name(controls[i])} overlaps ${name(controls[j])}`);
    }
  }
  /* 4. Menu labels that wrapped. A nav item reading "Grants / workspace" over
        two lines is the bar telling you it does not fit, and it takes the
        whole masthead 20px taller with it. */
  for (const el of document.querySelectorAll('.nav--links a, .masthead .btn, .nav__account, .breadcrumb a')) {
    if (!seen(el)) continue;
    const r = el.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
    const pad = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
    if (r.height - pad > lh * 1.6) out.wrapped.push(`${name(el)} wraps onto ${Math.round((r.height - pad) / lh)} lines`);
  }

  /* ---------------------------------------------------------------- */
  /* 5. Type. Two stacks, no third.                                     */
  /* ---------------------------------------------------------------- */
  {
    const norm = (v) => String(v).replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase();
    const allowed = opts.fonts;
    const bodyF = norm(getComputedStyle(document.body).fontFamily);
    if (!allowed.includes(bodyF)) out.font.push(`body is "${bodyF}"`);
    const h1 = document.querySelector('h1');
    if (h1) {
      const f = norm(getComputedStyle(h1).fontFamily);
      if (!allowed.includes(f)) out.font.push(`first h1 is "${f}"`);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 6. Contrast, against the real composited background.              */
  /*                                                                    */
  /* --ink-4 was rgba(18,48,58,.54) and measured 3.25–3.34:1 on the     */
  /* actual card and paper surfaces — every secondary label on the site */
  /* failed AA, including the footer disclaimer on ~5,900 pages. The    */
  /* colour is read from the computed style, not the token, so a rule   */
  /* that hardcodes a hex is caught the same way.                       */
  /* ---------------------------------------------------------------- */
  if (opts.contrast) {
    const parse = (c) => {
      const m = String(c).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const lum = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    /* Walk up until the composite is opaque. Assuming white is exactly the
       mistake that hid this: the cards are rgba(255,255,255,.72) over a
       tinted #eef7f7 body, so the true backdrop is rgb(250,253,253). */
    const backdrop = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
      }
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i -= 1) bg = over(layers[i], bg);
      return bg;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seenPairs = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || !seen(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || parked(r)) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = backdrop(el);
      const c = ratio(over(fg, bg), bg);
      const px = parseFloat(cs.fontSize);
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
      const large = px >= 24 || (bold && px >= 18.66);
      const need = large ? 3 : 4.5;
      if (c + 0.005 < need) {
        const key = `${cs.color}|${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}|${px}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        out.contrast.push(
          `${name(el)} — ${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}) at ${px}px is ${c.toFixed(2)}:1, needs ${need}`,
        );
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* 7. Vertical rhythm. Two adjacent sections both paying full        */
  /* padding left 256px of nothing between them at 1536px.             */
  /* ---------------------------------------------------------------- */
  {
    const lastPainted = (root) => {
      let best = null;
      for (const el of root.querySelectorAll('*')) {
        if (!seen(el) || !el.textContent.trim()) continue;
        const r = el.getBoundingClientRect();
        if (!r.height || parked(r)) continue;
        if (!best || r.bottom > best) best = r.bottom;
      }
      return best;
    };
    const firstPainted = (root) => {
      let best = null;
      for (const el of root.querySelectorAll('*')) {
        if (!seen(el) || !el.textContent.trim()) continue;
        const r = el.getBoundingClientRect();
        if (!r.height || parked(r)) continue;
        if (best === null || r.top < best) best = r.top;
      }
      return best;
    };
    /* Every top-level region of <main>, plus the footer — not a hand-listed
       set of classes.

       The selector used to be `main > section, main > .section,
       main > .section-tight, footer.site`. On /dashboard/ the workspace is a
       bare `<div id="dashboard">` followed by a bare `<div class="shell">`,
       so neither matched, and the check measured straight from the breadcrumb
       to the footer across 700px of real, painted content and called it
       "807px of nothing". A gap is only blank if nothing is in it, so the
       list has to contain everything that could be in it. */
    const blocks = [...document.querySelector('main')?.children || [], document.querySelector('footer.site')]
      .filter((el) => el && el.tagName !== 'SCRIPT' && el.getBoundingClientRect().height > 0);
    for (let i = 0; i + 1 < blocks.length; i += 1) {
      const a = lastPainted(blocks[i]);
      const b = firstPainted(blocks[i + 1]);
      if (a === null || b === null) continue;
      const gap = b - a;
      /* Calibrate against the design, not a round number.
 
         This measures the LAST painted pixel of one block to the FIRST of the
         next, so the gap necessarily contains both blocks' own padding — which
         is the intended rhythm, not a defect. The stylesheet's own maximum is
         .section's padding-block clamp(3rem,6vw,5rem) at both ends plus
         footer.site's 2rem margin-top: 80 + 80 + 32 = 192px. A flat `> 160`
         therefore fired on correctly-spaced pages at 161px and buried the real
         finding — the signed-out workspace, which leaves 807px of blank — in
         twenty lines of noise.
 
         So read the two blocks' actual resolved padding and flag only what
         exceeds it. That is the property: a gap bigger than the space the two
         sections asked for is space nobody designed. */
      if (gap > RHYTHM_MAX) {
        out.rhythm.push(`${Math.round(gap)}px of nothing between ${name(blocks[i])} and ${name(blocks[i + 1])}`);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* 8. Affordance. One weight for one action; an inert pill must not  */
  /* be pixel-identical to a link.                                     */
  /* ---------------------------------------------------------------- */
  {
    const free = [...document.querySelectorAll('a[href*="/check/"], a[href*="/check/?"]')].filter(
      (el) => seen(el) && /\bbtn\b/.test(String(el.className)) && !/startups/.test(el.getAttribute('href') || ''),
    );
    const ghosts = free.filter((el) => /btn-ghost/.test(String(el.className)));
    if (ghosts.length) out.affordance.push(`the free check is drawn as btn-ghost ${ghosts.length}× — ghost is for utilities`);
    /* One weight per action, per place the reader is looking. The masthead
       CTA is chrome and is on every page by design, and a long landing page
       legitimately repeats its own primary at the fold and at the end — what
       is not legitimate is two of them inside one section, or a section
       offering the free check at three different weights. */
    const sectionOf = (el) => el.closest('section, footer, .panel, .card') || document.body;
    const bySection = new Map();
    for (const el of free) {
      if (el.closest('.masthead')) continue;
      const k = sectionOf(el);
      bySection.set(k, [...(bySection.get(k) || []), el]);
    }
    for (const [sec, els] of bySection) {
      const p = els.filter((el) => /btn-primary/.test(String(el.className)));
      if (p.length > 1) out.affordance.push(`${p.length} primary free-check controls inside one ${name(sec)}`);
      const weights = new Set(els.map((el) => (/btn-primary/.test(String(el.className)) ? 'primary'
        : /btn-ghost/.test(String(el.className)) ? 'ghost' : 'glass')));
      if (weights.size > 2) out.affordance.push(`the free check is drawn ${weights.size} ways inside one ${name(sec)}`);
    }

    /* An anchor and an inert span must not share a skin. Compare the
       rendered pill: same background, same radius, same padding, same font
       size — that is what "pixel-identical" means to a reader. */
    const skin = (el) => {
      const s2 = getComputedStyle(el);
      return [s2.backgroundColor, s2.borderRadius, s2.padding, s2.fontSize, s2.boxShadow].join('|');
    };
    const anchorSkins = new Map();
    for (const el of document.querySelectorAll('a.tag, a.pill, a.badge')) {
      if (seen(el)) anchorSkins.set(skin(el), name(el));
    }
    for (const el of document.querySelectorAll('span.tag, span.pill, span.badge, span[class*="badge-"]')) {
      if (!seen(el)) continue;
      if (getComputedStyle(el).cursor !== 'auto' && getComputedStyle(el).cursor !== 'default') continue;
      const hit = anchorSkins.get(skin(el));
      if (hit) out.affordance.push(`inert ${name(el)} is skinned exactly like the link ${hit}`);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 9. At 390px a pair of buttons must stack, not sit side by side.   */
  /* ---------------------------------------------------------------- */
  if (document.documentElement.clientWidth <= 400) {
    const btns = [...document.querySelectorAll('.btn')].filter((el) => seen(el) && !parked(el.getBoundingClientRect()));
    for (let i = 0; i + 1 < btns.length; i += 1) {
      const a = btns[i].getBoundingClientRect();
      const b = btns[i + 1].getBoundingClientRect();
      if (btns[i].closest('[role=tablist], .audswitch, .seg, .masthead')) continue;
      const sameBand = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4;
      if (sameBand) out.stacking.push(`${name(btns[i])} and ${name(btns[i + 1])} share a horizontal band at 390px`);
    }
  }

  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].slice(0, 6);
  return out;
};

const browser = await chromium.launch();
let problems = 0;
const report = [];

for (const [w, h, wname] of WIDTHS) {
  for (const [label, url, aud] of SCREENS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addCookies([{ name: 'ua_aud', value: aud, url: `http://localhost:${PORT}` }]);
    const page = await ctx.newPage();
    const consoleErrors = [];
    /* Two things fail here and mean nothing: the Google Fonts request, because
       this sandbox has no route to the internet, and /api/me and /api/v1/event,
       because those are the Worker's and this server only has the static
       build. Reporting them on all 34 renders buries the real findings. */
    const NOISE = /fonts\.googleapis|fonts\.gstatic|\/api\/me|\/api\/v1\/event|ERR_TUNNEL/;
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (NOISE.test(text) || NOISE.test(m.location()?.url || '')) return;
      consoleErrors.push(text.slice(0, 120));
    });
    page.on('requestfailed', (r) => { if (!NOISE.test(r.url())) consoleErrors.push(`request failed: ${r.url().slice(0, 90)}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !NOISE.test(r.url())) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`); });
    page.on('pageerror', (e) => consoleErrors.push('uncaught: ' + String(e).slice(0, 120)));
    try {
      const res = await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'networkidle', timeout: 20000 });
      if (!res || res.status() >= 400) { report.push([`${wname} · ${label}`, { http: [`HTTP ${res ? res.status() : 'no response'}`] }]); problems += 1; await ctx.close(); continue; }
      await page.waitForTimeout(400);
      /* Paint the page before measuring it.

         `.reveal` starts at `opacity: 0` and only gains `.in` when an
         IntersectionObserver sees it, so every element below the first
         viewport was invisible to `seen()` — which every check in AUDIT is
         built on. The rhythm check then measured from the last element that
         HAD revealed to the next one, and reported the un-revealed heading
         in between as 234px of blank space on /enterprise/. Contrast and
         overflow had the same blind spot, silently: they audited the top
         900px of a 4,000px page.

         Scrolling to the bottom and back is what a reader does, and it is
         the only way to reach the state a reader sees. */
      await page.evaluate(async () => {
        const h = document.documentElement.scrollHeight;
        for (let y = 0; y < h; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 300));
      });
      /* The observer uses threshold 0.12 and unobserves on first hit, so a
         scripted scroll can outrun it and leave a short heading at opacity 0
         forever. The page ships its own 3s safety net that reveals everything
         regardless; wait for that state rather than racing it, because it is
         the state every reader is in three seconds after landing. */
      await page
        .waitForFunction(() => !document.querySelector('.reveal:not(.in), .blur-word:not(.in)'), null, { timeout: 6000 })
        .catch(() => {});
      await page.waitForTimeout(200);
      const out = await page.evaluate(AUDIT, { fonts: FONT_STACKS, contrast: CONTRAST_PAGES.has(url) });
      /* Pricing must be buyable in whichever half the visitor is looking at.
         Flipping to "For my company" used to leave three prices on screen and
         no control that starts a checkout — the €49 tier was in the other
         half and the enterprise panel is a mailto. */
      if (url === '/pricing/') {
        const buyable = await page.evaluate(
          () => [...document.querySelectorAll('[data-checkout]')].filter((b) => b.getBoundingClientRect().width > 0).length,
        );
        if (!buyable) out.unbuyable = ['pricing shows no control that starts a checkout in this audience'];
      }
      if (consoleErrors.length) out.console = [...new Set(consoleErrors)].slice(0, 4);
      const n = Object.values(out).reduce((a, v) => a + v.length, 0);
      if (n) { problems += n; report.push([`${wname} · ${label}`, out]); }
    } catch (e) {
      problems += 1;
      report.push([`${wname} · ${label}`, { error: [String(e).slice(0, 160)] }]);
    }
    await ctx.close();
  }
}

/* ==================================================================== */
/* Focused passes.                                                      */
/*                                                                      */
/* The loop above looks at every screen the same way. These look at one */
/* thing each, on the pages where that thing can be wrong.              */
/* ==================================================================== */

const say = (screen, kind, items) => {
  const list = [...new Set(items)].slice(0, 6);
  if (!list.length) return;
  problems += list.length;
  report.push([screen, { [kind]: list }]);
};

const open = async (url, { width = 1280, height = 900, aud = 'me', js = true, entitled = null } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: js });
  await ctx.addCookies([{ name: 'ua_aud', value: aud, url: `http://localhost:${PORT}` }]);
  /* Some screens only exist for a paying session — the conditional cards on
     the results page are inside a locked bucket for everyone else, so a check
     that never stubs entitlement is checking an empty page. */
  if (entitled !== null) {
    await ctx.route('**/api/me*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(entitled
          ? { signed_in: true, account_type: 'personal', entitlement: { entitled: true, plan: 'personal_annual' } }
          : { signed_in: true, account_type: 'personal', entitlement: { entitled: false } }),
      }));
  }
  const page = await ctx.newPage();
  const res = await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: js ? 'networkidle' : 'load', timeout: 20000 });
  return { ctx, page, status: res ? res.status() : 0 };
};

/* -- /app/: the same two stacks, and a no-JS fallback you can read ---- */
{
  const { ctx, page, status } = await open('/app/');
  if (status >= 400) say('/app/', 'http', [`HTTP ${status}`]);
  else {
    const bad = await page.evaluate((fonts) => {
      const norm = (v) => String(v).replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase();
      const found = [];
      const b = norm(getComputedStyle(document.body).fontFamily);
      if (!fonts.includes(b)) found.push(`/app/ body is "${b}"`);
      const h1 = document.querySelector('h1');
      if (h1) { const f = norm(getComputedStyle(h1).fontFamily); if (!fonts.includes(f)) found.push(`/app/ h1 is "${f}"`); }
      return found;
    }, FONT_STACKS);
    say('/app/', 'font', bad);
  }
  await ctx.close();
}
{
  /* The noscript fallback was color:#fff on #eef7f7 — 1.07:1, a blank screen
     with no route back to a site that works perfectly well without JS. */
  const { ctx, page, status } = await open('/app/', { js: false });
  if (status < 400) {
    const bad = await page.evaluate(() => {
      const parse = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null;
        const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a === 1) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
      const found = [];
      const ns = document.querySelector('noscript');
      /* With scripting off the noscript content is live DOM. */
      for (const el of (ns ? ns.querySelectorAll('p, a') : [])) {
        const cs = getComputedStyle(el);
        const fg = parse(cs.color); if (!fg) continue;
        const bg = bgOf(el);
        const c = ratio(over(fg, bg), bg);
        if (c < 4.5) found.push(`noscript ${el.tagName.toLowerCase()} is ${c.toFixed(2)}:1`);
      }
      if (!ns) found.push('/app/ has no noscript fallback at all');
      else if (!ns.querySelector('a[href]')) found.push('/app/ noscript offers no route back to the site');
      return found;
    });
    say('/app/ (no JS)', 'contrast', bad);
  }
  await ctx.close();
}

/* -- A5: the progress rail is a rail, at every step ------------------- */
for (const url of ['/check/', '/startups/check/']) {
  const { ctx, page, status } = await open(url, { aud: url.includes('startups') ? 'biz' : 'me' });
  if (status >= 400) { say(url, 'http', [`HTTP ${status}`]); await ctx.close(); continue; }
  const found = [];
  let prev = null;
  for (let step = 0; step < 7; step += 1) {
    const r = await page.evaluate(() => {
      const rail = document.querySelector('.progress-rail');
      if (!rail) return { missing: true };
      const h = rail.getBoundingClientRect().height;
      const kids = [...rail.children];
      const painted = kids.filter((k) => {
        const bg = getComputedStyle(k).backgroundColor;
        const m = String(bg).match(/rgba?\(([^)]+)\)/);
        const a = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : 0;
        return a > 0.02;
      }).length;
      const now = Number(rail.getAttribute('aria-valuenow') || 0);
      const max = Number(rail.getAttribute('aria-valuemax') || 0);
      const heading = (document.querySelector('.step h1, #app h1') || {}).textContent || '';
      return { h, kids: kids.length, painted, now, max, heading: heading.trim() };
    });
    if (r.missing) { found.push(`no .progress-rail on step ${step + 1}`); break; }
    if (!(r.h > 0)) found.push(`.progress-rail measures ${r.h}px tall on step ${step + 1}`);
    /* Every segment carries the unfilled track colour, so "painted" means
       every child renders at all — the bug was that none did. */
    if (r.painted !== r.kids) found.push(`step ${step + 1}: ${r.painted} of ${r.kids} segments render a background`);
    /* Progress tracks the STEP, not the click count.
 
       This used to assert `now === step + 1`, where `step` counted iterations
       of this loop. That model is wrong for the wizard we actually ship: the
       circumstances step is a multi-select, so clicking an .opt toggles a
       choice and deliberately stays put. The loop then reported "step 5: rail
       reports step 4" three times over on a rail that was behaving correctly,
       which is worse than no check — a real regression would have been read as
       more of the same noise.
 
       So compare against the screen. The rail must stay inside its own
       declared range, must never run backwards, and must move exactly when the
       question changes and not when it does not. */
    if (r.now < 1 || (r.max && r.now > r.max)) found.push(`step ${step + 1}: rail reports ${r.now}, outside 1..${r.max}`);
    if (prev) {
      const changed = r.heading !== prev.heading;
      if (r.now < prev.now) found.push(`rail went backwards, ${prev.now} → ${r.now}, at "${r.heading}"`);
      else if (changed && r.now === prev.now) found.push(`the question changed to "${r.heading}" and the rail stayed on ${r.now}`);
      else if (!changed && r.now !== prev.now) found.push(`still on "${r.heading}" and the rail moved ${prev.now} → ${r.now}`);
    }
    prev = r;
    const advanced = await page.evaluate(() => {
      const pick = document.querySelector('.opt, .clist a, [data-value]');
      if (pick) { pick.click(); return true; }
      const next = [...document.querySelectorAll('[data-act="next"], [data-act="skip"]')].find((b) => b.offsetParent);
      if (next) { next.click(); return true; }
      return false;
    });
    if (!advanced) break;
    await page.waitForTimeout(250);
  }
  say(url, 'rail', found);
  await ctx.close();
}

/* -- A8: a company page must not wear the household chrome ------------ */
for (const lg of LOCALES) {
  for (const u of B2B_URLS) {
    const url = `${lg}${u}`;
    /* Cookie deliberately set to the WRONG audience: a page that only exists
       for companies must be right for a visitor arriving from a search
       result who has never touched the toggle. */
    const { ctx, page, status } = await open(url, { aud: 'me' });
    if (status >= 400) { say(url, 'http', [`HTTP ${status}`]); await ctx.close(); continue; }
    const found = await page.evaluate(() => {
      const vis = (el) => el && el.offsetParent !== null;
      const f = [];
      /* The skip link is a .btn so that keyboard focus draws it as one. It is
         not a call to action and it is off-screen; counting it made the first
         "visible" CTA on every page the words "Skip to content". */
      const ctas = [...document.querySelectorAll('.masthead .btn')]
        .filter(vis)
        .filter((a) => (a.getAttribute('href') || '')[0] !== '#');
      /* The property is that the company chrome stays on the company side —
         NOT that every page points at /startups/check/. On /startups/check/
         itself that would be a link to the page you are already on, so the
         masthead correctly offers "Browse instead" → /startups/. Asserting the
         literal target flagged the one page that had it right, in all seven
         locales. What must never happen is the household CTA (/check/) showing
         up on a company page. */
      const here = location.pathname.replace(/\/+$/, '/');
      const href = (a) => (a.getAttribute('href') || '').replace(/\/+$/, '/');
      if (!ctas.length) f.push('no visible masthead CTA');
      else {
        const household = ctas.find((a) => /(^|\/)check\/$/.test(href(a)) && !/startups\/check\/$/.test(href(a)));
        if (household) f.push(`company page offers the household CTA "${household.textContent.trim()}" → ${household.getAttribute('href')}`);
        const onward = ctas.some((a) => href(a) !== here);
        if (!onward) f.push('every masthead CTA links to the page it is on');
      }
      const navs = [...document.querySelectorAll('.nav--links')].filter(vis);
      const links = navs.flatMap((n) => [...n.querySelectorAll('a')].map((a) => a.getAttribute('href') || ''));
      if (!links.some((h) => /\/enterprise\/$/.test(h))) f.push('visible nav has no link to /enterprise/');
      if (!links.some((h) => /\/dashboard\/$/.test(h))) f.push('visible nav has no link to the workspace');
      return f;
    });
    say(url, 'audience', found);
    await ctx.close();
  }
}

/* -- A9/A11: a price label must match the plan it buys ---------------- */
{
  const priceByPlan = {};
  const { ctx, page, status } = await open('/pricing/', { aud: 'biz' });
  if (status < 400) {
    Object.assign(priceByPlan, await page.evaluate(() => {
      const out = {};
      const price = (t) => (t || '').match(/(?:€|£|\$)\s?\d[\d.,]*/);
      for (const el of document.querySelectorAll('[data-plan]')) {
        /* A tier states its headline price ONCE, in the tier's .figure-sm,
           and the button under it just says "Subscribe" — that is the whole
           point of the one-card-one-figure layout. Reading only the control's
           own text therefore reported "no figure for personal_annual" on a
           page that prints €50/year two lines above the button. What a reader
           actually sees is the price nearest the control, so: the control's
           own text if it names one (the alternate billing period does), else
           the figure of the tier the control sits in. If neither states a
           price, the plan really is unpriced on the page. */
        const own = price(el.textContent);
        const tier = el.closest('[data-tier]');
        const fig = tier && tier.querySelector('.figure-sm, .figure');
        const m = own || price(fig && fig.textContent);
        if (m) out[el.dataset.plan] = m[0].replace(/\s/g, '');
      }
      return out;
    }));
  }
  await ctx.close();

  const missing = ['personal_annual', 'personal_monthly', 'business_monthly', 'business_annual']
    .filter((k) => !priceByPlan[k])
    .map((k) => `/pricing/ prints no figure for ${k}`);
  say('/pricing/', 'plans', missing);

  /* /account/ with /api/me mocked, individual and business. The buttons used
     to say "€50 a year" and buy business_annual at €490. */
  for (const [kind, account_type] of [['individual', 'individual'], ['business', 'business']]) {
    for (const lg of LOCALES) {
      const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx2.route('**/api/me', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ signedIn: true, entitled: false, user: { email: 'x@example.com', account_type }, account_type }) }));
      const pg = await ctx2.newPage();
      await pg.goto(`http://localhost:${PORT}${lg}/account/`, { waitUntil: 'networkidle', timeout: 20000 });
      await pg.waitForTimeout(500);
      const found = await pg.evaluate((expected) => {
        const f = [];
        for (const el of document.querySelectorAll('[data-plan]')) {
          if (!el.offsetParent) continue;
          const plan = el.dataset.plan;
          const shown = (el.textContent || '').match(/(?:€|£|\$)\s?\d[\d.,]*/);
          if (!shown) { f.push(`${plan}: label "${(el.textContent || '').trim()}" names no price`); continue; }
          const want = expected[plan];
          if (want && shown[0].replace(/\s/g, '') !== want)
            f.push(`${plan}: button says ${shown[0]}, /pricing/ says ${want}`);
        }
        return f;
      }, priceByPlan);
      say(`${lg || '/'} account (${kind})`, 'plans', found);
      await ctx2.close();
    }
  }
}

/* -- A22: a localised wizard in the locale, and CTAs that stay in it -- */
for (const lg of LOCALES) {
  if (!lg) continue;
  for (const u of ['/check/', '/startups/check/']) {
    const url = `${lg}${u}`;
    const { ctx, page, status } = await open(url, { aud: u.includes('startups') ? 'biz' : 'me' });
    if (status >= 400) { say(url, 'http', [`HTTP ${status}`]); await ctx.close(); continue; }
    await page.waitForTimeout(400);
    const found = [];
    for (let step = 0; step < 2; step += 1) {
      const hits = await page.evaluate((markers) => {
        /* Whole-node equality, not substring.
 
           This used to be `innerText.includes(m)` against the whole body. The
           French wizard renders "Continuer", which contains "Continue", so the
           check reported untranslated English on the one string it had
           correctly translated — and only in French, since "Continua",
           "Continuar" and "Weiter" do not contain it. A marker list matched by
           substring will always do this eventually; matching the way the
           translator keys its dictionary — an entire trimmed text node — is the
           same rule on both sides. */
        const root = document.querySelector('#app, #startup-check, .wizard') || document.body;
        const seen = new Set();
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const t = n.nodeValue.trim();
          if (t) seen.add(t);
        }
        for (const el of root.querySelectorAll('[aria-label],[placeholder]')) {
          for (const a of ['aria-label', 'placeholder']) {
            const v = (el.getAttribute(a) || '').trim();
            if (v) seen.add(v);
          }
        }
        return markers.filter((m) => seen.has(m));
      }, ENGLISH_MARKERS);
      for (const h of hits) found.push(`English in the wizard: "${h}"`);
      const advanced = await page.evaluate(() => {
        const pick = document.querySelector('.opt, .clist a, [data-value]');
        if (pick) { pick.click(); return true; }
        return false;
      });
      if (!advanced) break;
      await page.waitForTimeout(250);
    }
    /* Every primary CTA on a locale-prefixed page has to stay in the locale. */
    const escapes = await page.evaluate((prefix) => {
      const out = [];
      for (const a of document.querySelectorAll('.btn-primary[href], .masthead .btn[href]')) {
        if (!a.offsetParent) continue;
        const h = a.getAttribute('href') || '';
        if (!h.startsWith('/') || h.startsWith('//')) continue;
        /* English-only surfaces are linked at the root on purpose; the four
           that exist per locale are not. */
        if (/^\/(check|startups|enterprise|pricing|countries|methodology|account)\//.test(h))
          out.push(`${a.textContent.trim().slice(0, 30)} → ${h} leaves ${prefix}`);
      }
      return out;
    }, lg);
    for (const e of escapes) found.push(e);
    say(url, 'locale', found);
    await ctx.close();
  }
}

/* -- A18: a disabled button must not light up under the pointer ------- */
{
  const { ctx, page, status } = await open('/account/');
  if (status < 400) {
    const found = await page.evaluate(() => {
      /* Two disabled idioms, and they are not interchangeable.
 
         `.disabled = true` only means anything on a real <button>; assigning it
         to an <a class="btn"> sets an expando the CSS engine never sees, so
         :disabled cannot match and the cursor stays a pointer. This used to
         grab `document.querySelector('.btn')`, which on /account/ is the
         masthead anchor — so it reported a pointer on a disabled button for a
         page that has no such thing, every run.
 
         Anchors are disabled with aria-disabled instead, which is exactly why
         the stylesheet pairs the two selectors. Test each element against the
         idiom that applies to it. */
      const all = [...document.querySelectorAll('.btn')];
      const btn = all.find((e) => e.tagName === 'BUTTON') || all[0];
      if (!btn) return ['no .btn on /account/'];
      if (btn.tagName === 'BUTTON') btn.disabled = true;
      else btn.setAttribute('aria-disabled', 'true');
      const before = getComputedStyle(btn);
      const rest = [before.backgroundColor, before.transform, before.cursor];
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      /* :hover cannot be forced from script, so read the rule that would
         apply instead — the property under test is that the stylesheet has
         one at all. */
      const has = [...document.styleSheets].some((sh) => {
        try { return [...sh.cssRules].some((r) => r.selectorText && /:disabled|aria-disabled/.test(r.selectorText)); }
        catch { return false; }
      });
      const f = [];
      if (!has) f.push('no :disabled rule exists in the stylesheet — .btn:hover applies unconditionally');
      if (rest[2] === 'pointer') f.push(`a disabled ${btn.tagName.toLowerCase()}.btn still shows cursor:pointer`);
      /* And the anchor idiom has to work too, or every <a class="btn"> on the
         site is undisableable. Checked directly rather than assumed. */
      const a = all.find((e) => e.tagName === 'A');
      if (a) {
        a.setAttribute('aria-disabled', 'true');
        if (getComputedStyle(a).cursor === 'pointer') f.push('an a.btn[aria-disabled] still shows cursor:pointer');
        a.removeAttribute('aria-disabled');
      }
      return f;
    });
    say('/account/', 'affordance', found);
  }
  await ctx.close();
}

/* ==================================================================== *
 * The wizard, driven end to end.
 *
 * Everything above looks at a page. These press the buttons, because the
 * defects below are all invisible in a screenshot: a control with no handler,
 * a Back press that changes nothing, a caption in the wrong language, a
 * corrected value described in the same voice as help text.
 * ==================================================================== */

/**
 * Walk the wizard the way a person does: answer what is in front of you, then
 * press whatever moves you on.
 *
 * Not "press Continue eight times". The status step renders no Continue until
 * something is chosen and no Skip at all, and the region, status and income
 * steps commit and advance on the tile click itself — so a loop that only
 * presses nav buttons stalls on step 2 and reports "the wizard never reached
 * a result" about a wizard that works.
 */
async function stepThrough(page, { onStep = null, max = 12 } = {}) {
  for (let i = 0; i < max; i += 1) {
    if (await page.$('.result-hero')) return true;
    if (onStep) await onStep(page);
    const before = await page.evaluate(() => document.querySelector('.progress-caption')?.textContent || '');
    const picked = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.opt[data-field]')];
      if (!tiles.length) return false;
      if (tiles.some((t) => t.getAttribute('aria-pressed') === 'true')) return false;
      tiles[0].click();
      return true;
    });
    if (picked) {
      await page.waitForTimeout(280);
      if (await page.$('.result-hero')) return true;
      const after = await page.evaluate(() => document.querySelector('.progress-caption')?.textContent || '');
      if (after !== before) continue; // the tile advanced us; nothing to press
    }
    const next = await page.$('[data-act="next"]');
    const skip = await page.$('[data-act="skip"]');
    if (!next && !skip) return !!(await page.$('.result-hero'));
    await (next || skip).click();
    await page.waitForTimeout(280);
  }
  return !!(await page.$('.result-hero'));
}

/* A GB earner, encoded exactly the way src/app.js encodes a shared result. */
const QA_PROFILE = {
  country_code: 'GB', admin_area: null, status: 'employee', age: 40, income_band: null,
  income_annual: 18000, household_size: 2, children_count: 1, housing_tenure: 'renting',
  nationality_group: 'citizen_or_pr', residency_months: 240, circumstances: [],
};
const QA_HASH = Buffer.from(JSON.stringify(QA_PROFILE), 'utf8')
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* -- Buttons centre their own labels, and counts are not glued to units -- */
{
  for (const [label, url] of [['/account/', '/account/'], ['a programme page', '/gb/income_support/attendance-allowance/'], ['/countries/', '/countries/']]) {
    for (const width of [1280, 390]) {
      const { ctx, page } = await open(url, { width });
      const found = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.btn')) {
          const r = el.getBoundingClientRect();
          if (r.width < 240 || r.height === 0) continue; // not full-width; centring is moot
          const range = document.createRange();
          range.selectNodeContents(el);
          const t = range.getBoundingClientRect();
          if (!t.width) continue;
          const left = t.left - r.left;
          const right = r.right - t.right;
          /* A centred label has equal air either side. "Send me a code" sat
             22px from the left of a 499px pill with 366px of empty space to
             its right, because .btn is a flex container and the rule that was
             supposed to centre it said text-align. */
          if (Math.abs(left - right) > 12) {
            out.push(`"${el.textContent.trim().slice(0, 28)}" is ${Math.round(r.width)}px wide with ${Math.round(left)}px left and ${Math.round(right)}px right`);
          }
        }
        return out;
      });
      say(`${label} @${width}`, 'button label centring', found);

      const glued = await page.evaluate(() => {
        const out = [];
        for (const row of document.querySelectorAll('.list-row__right')) {
          const kids = [...row.children].filter((c) => c.textContent.trim());
          for (let i = 0; i + 1 < kids.length; i += 1) {
            const a = kids[i].getBoundingClientRect();
            const b = kids[i + 1].getBoundingClientRect();
            /* Same visual line, not same box top: the count is 1.25rem and
               the unit is .8rem, so their inline boxes have different tops
               and an equality test never fired on the very markup this is
               about — `</span><span` with no whitespace between them. */
            const sameLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
            if (b.left - a.right < 1 && sameLine) {
              out.push(`"${kids[i].textContent.trim()}${kids[i + 1].textContent.trim()}" renders with no gap`);
            }
          }
        }
        return out;
      });
      say(`${label} @${width}`, 'count glued to its unit', glued);
      await ctx.close();
    }
  }
}

/* -- /fr/ wizards must not be English -------------------------------- *
 *
 * On /fr/check/ the step headings and nav were French while all seven steps
 * showed the rail caption "Step 1 of 7 · about 105 seconds left · nothing is
 * saved to a server", step 2's h1 was "Which part of France?", and the whole
 * results screen was English. The caption could not be translated because it
 * was built by concatenation and so could never whole-node match the
 * dictionary; it goes through T() with {n}-style tokens now.
 *
 * The sentinels are sentences that only appear if a literal never reached the
 * translator. A missing dictionary entry still renders English and is lane A's
 * to fill — but a literal that never reaches T() can never be translated at
 * all, and that is what this catches.
 */
{
  const SENTINELS = [
    'nothing is saved to a server',
    'nothing you type is sent to a server',
    'Which part of France?',
    'Search 25 countries',
    'of 25 shown',
    'Where is the company registered?',
    'What stage is the company at?',
    'programmes · ',
  ];
  const dictFor = async (page) =>
    page.evaluate(() => {
      const el = document.getElementById('i18n-wizard');
      try { return el ? JSON.parse(el.textContent) : {}; } catch { return {}; }
    });

  for (const [label, url, drive] of [
    ['/fr/check/', `/fr/check/#r=${QA_HASH}`, null],
    ['/fr/startups/check/', '/fr/startups/check/', async (page) => {
      await page.waitForSelector('[data-act="country"]', { timeout: 8000 });
      await page.click('[data-cc="fr"]');
      await page.click('[data-field="stage"][data-value="seed"]');
      await page.click('[data-act="next"]');
      await page.click('[data-field="headcount"][data-value="15"]');
      await page.click('[data-act="next"]');
      await page.click('[data-field="turnover_annual_eur"][data-value="750000"]');
      await page.click('[data-act="next"]');
      await page.click('[data-field="sectors"][data-value="software"]');
      await page.click('[data-act="next"]');
      await page.click('[data-field="rd_active"][data-value="true"]');
      await page.click('[data-act="next"]');
      await page.waitForSelector('.result-hero', { timeout: 8000 });
    }],
  ]) {
    const { ctx, page } = await open(url);
    if (drive) await drive(page);
    await page.waitForTimeout(400);
    const dict = await dictFor(page);
    const text = await page.evaluate(() => document.body.innerText);
    const found = [];
    if (!Object.keys(dict).length) found.push('the page ships an empty i18n-wizard dictionary — nothing can be translated');
    for (const sentinel of SENTINELS) {
      /* Only a failure if the dictionary HAS a translation for the sentence
         that contains it. Otherwise English is the correct fallback and the
         gap is a missing entry, not an unreachable literal. */
      const key = Object.keys(dict).find((k) => k.includes(sentinel));
      if (key && text.includes(sentinel)) found.push(`"${sentinel}" is still English although the dictionary translates it`);
    }
    say(label, 'untranslated wizard copy', found);
    await ctx.close();
  }
}

/* -- Back from the result lands on the step you came from ------------- *
 *
 * syncHistory() pushed the result entry using location.href, which was still
 * "#s=6" at that moment, and compute() then replaceState'd it to "#r=…". The
 * housing entry was overwritten and a duplicate #r left behind: from the
 * result, Back #1 changed nothing observable, Back #2 landed on #s=5, and
 * #s=6 could not be reached however many times you pressed.
 */
{
  const { ctx, page } = await open('/check/');
  const found = [];
  try {
    await page.waitForSelector('[data-act="country"]', { timeout: 8000 });
    await page.click('[data-cc="gb"]');
    await page.waitForTimeout(150);
    /* Walk forward the way a person does, so the history is built the way a
       person builds it rather than by jumping to a hash. */
    await stepThrough(page);
    if (!(await page.$('.result-hero'))) found.push('the wizard never reached a result');
    else {
      const before = await page.evaluate(() => location.hash);
      await page.goBack();
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({ hash: location.hash, h1: document.querySelector('h1')?.textContent?.trim() }));
      if (after.hash === before) found.push(`one Back press from the result left the hash at ${before}`);
      if (!/^#s=\d+$/.test(after.hash)) found.push(`Back from the result went to ${after.hash}, not a step`);
    }
  } catch (e) {
    found.push(`could not drive the wizard: ${e.message.split('\n')[0]}`);
  }
  say('/check/', 'back button', found);
  await ctx.close();
}

/* -- A reload mid-re-answer must not jump to the old result ----------- */
{
  const { ctx, page } = await open(`/check/#r=${QA_HASH}`);
  const found = [];
  try {
    await page.waitForSelector('.result-hero', { timeout: 8000 });
    await page.click('[data-act="restart"]');
    await page.waitForTimeout(300);
    const mid = await page.evaluate(() => location.hash);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      hash: location.hash,
      result: !!document.querySelector('.result-hero'),
      h1: document.querySelector('h1')?.textContent?.trim(),
    }));
    if (after.result) found.push(`reloading after "Change my answers" (hash ${mid || 'empty'}) jumped straight back to the result: "${after.h1}"`);
  } catch (e) {
    found.push(`could not drive the wizard: ${e.message.split('\n')[0]}`);
  }
  say('/check/', 'reload after restart', found);
  await ctx.close();
}

/* -- "This does apply to me" has to apply it -------------------------- *
 *
 * The button's dataset.attr was the hardcoded string 'circumstance' on a card
 * that names the exact circumstance, so all 20 conditional cards mapped to the
 * generic circumstances step and clicking one navigated to #s=3 with the named
 * option still off.
 */
{
  const { ctx, page } = await open(`/check/#r=${QA_HASH}`, { entitled: true });
  const found = [];
  try {
    await page.waitForSelector('.result-hero', { timeout: 8000 });
    const tags = await page.evaluate(() =>
      [...document.querySelectorAll('[data-act="answer"][data-circ]')]
        .map((b) => b.dataset.circ)
        .filter(Boolean));
    const distinct = [...new Set(tags.flatMap((t) => t.split(',')))].filter(Boolean);
    if (distinct.length < 3) {
      found.push(`only ${distinct.length} distinct circumstances are offered on conditional cards (${distinct.join(', ') || 'none'})`);
    }
    for (const tag of distinct.slice(0, 3)) {
      await page.goto(`http://localhost:${PORT}/check/#r=${QA_HASH}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => localStorage.removeItem('unclaimed.check.profile.v1'));
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.result-hero', { timeout: 8000 });
      const clicked = await page.evaluate((want) => {
        const b = [...document.querySelectorAll('[data-act="answer"][data-circ]')]
          .find((x) => (x.dataset.circ || '').split(',').includes(want));
        if (!b) return false;
        b.click();
        return true;
      }, tag);
      if (!clicked) { found.push(`no conditional card offers "${tag}" any more`); continue; }
      await page.waitForTimeout(400);
      const on = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('unclaimed.check.profile.v1'))?.circumstances || []; } catch { return []; }
      });
      if (!on.includes(tag)) found.push(`clicking "This does apply to me" for "${tag}" left it off (profile has ${on.join(', ') || 'nothing'})`);
    }
  } catch (e) {
    found.push(`could not drive the wizard: ${e.message.split('\n')[0]}`);
  }
  say('/check/', 'conditional cards', found);
  await ctx.close();
}

/* -- The no-match screen must not claim you qualify, and the rail must
      count the steps a person can see -------------------------------- */
{
  /* Singapore's manifest has no regions, so the region step is skipped — and
     the counter, which numbered the raw list, went "Step 1 of 7" then
     "Step 3 of 7" in one click. */
  const noMatch = {
    country_code: 'SG', admin_area: null, status: 'employee', age: 28, income_band: 'b5',
    income_annual: null, household_size: 1, children_count: 0, housing_tenure: 'hosted',
    nationality_group: 'any_resident', residency_months: 6, circumstances: [],
  };
  const h = Buffer.from(JSON.stringify(noMatch), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const { ctx, page } = await open(`/check/#r=${h}`);
  const found = [];
  try {
    await page.waitForSelector('.result-hero', { timeout: 8000 });
    const r = await page.evaluate(() => ({
      text: document.body.innerText,
      h1: document.querySelector('h1')?.textContent?.trim(),
    }));
    if (/appear to meet the published criteria/i.test(r.text)) {
      found.push(`"You appear to meet the published criteria" is printed under "${r.h1}"`);
    }
    /* Then walk the visible steps and check the numbers are 1..N with no gap. */
    await page.click('[data-act="restart"]');
    await page.waitForTimeout(250);
    const seen = [];
    await stepThrough(page, {
      onStep: async (p2) => {
        const cap = await p2.evaluate(() => document.querySelector('.progress-caption')?.textContent || '');
        const m = cap.match(/(\d+)\D+(\d+)/);
        if (m) seen.push([Number(m[1]), Number(m[2])]);
      },
    });
    const nums = seen.map(([n]) => n);
    for (let i = 1; i < nums.length; i += 1) {
      if (nums[i] !== nums[i - 1] + 1) {
        found.push(`the rail jumped from step ${nums[i - 1]} to step ${nums[i]} in one click`);
        break;
      }
    }
    const totals = [...new Set(seen.map(([, t]) => t))];
    if (totals.length > 1) found.push(`the rail's denominator changed mid-flow: ${totals.join(' then ')}`);
    /* Not asserted: that the first number seen is 1. "Change my answers"
       deliberately lands on the first REAL question, which is step 2 of the
       visible six — the country is already answered. What must hold is that
       the numbers a reader sees are contiguous and the denominator never
       moves; Singapore used to go 1 → 3 because the skipped region step was
       still in the numerator. */
  } catch (e) {
    found.push(`could not drive the wizard: ${e.message.split('\n')[0]}`);
  }
  say('/check/ (Singapore, no regions)', 'result copy and step numbering', found);
  await ctx.close();
}

await browser.close();
server.close();

console.log('\nScreen audit\n');
if (!report.length) console.log(`  ✓ ${WIDTHS.length * SCREENS.length} screen renders — nothing overflows, overlaps, crowds or errors\n`);
for (const [screen, out] of report) {
  console.log(`  ${screen}`);
  for (const [kind, items] of Object.entries(out)) {
    if (!items.length) continue;
    console.log(`    ${kind}:`);
    for (const i of items) console.log(`      · ${i}`);
  }
  console.log('');
}
console.log(`${problems} observation${problems === 1 ? '' : 's'}\n`);
process.exit(problems ? 1 : 0);
