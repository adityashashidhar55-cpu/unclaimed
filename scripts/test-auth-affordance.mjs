#!/usr/bin/env node
/**
 * From every page, in every signed-in state, there is a way out.
 *
 * The bug this exists to stop had no error and no failing test. The masthead
 * chip was one link whose label became "Upgrade" the moment you signed in
 * without a subscription — the majority state, since it covers every free
 * account and every paid one between signing in and paying. In it, the only
 * account affordance anywhere in the chrome was a filled green button that
 * reads as a purchase, and there was no "Sign out" on any page except
 * /account/ itself, which you could only reach by guessing that the Upgrade
 * button went there.
 *
 * Measured before the fix, across four pages and three auth states: signed-in
 * free found zero sign-out controls on three of the four pages.
 *
 * So this asserts the property rather than the markup. Not "the masthead has a
 * link whose text is My account" — that passes on a chip that opens nothing.
 * The property is: a signed-in visitor can reach their account and can sign
 * out, from any page, without typing a URL. And a signed-out visitor can find
 * the way in.
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
/* Global install: this sandbox's npm registry answers 403, so Playwright
   cannot be a dependency of this repo. */
const { chromium } = require_('/home/claude/.npm-global/lib/node_modules/playwright/index.js');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 8188;

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

let pass = 0, fail = 0;
const t = (name, ok, detail = '') =>
  ok ? (pass += 1, console.log(`  ✓ ${name}`)) : (fail += 1, console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`));

/* Four pages that between them cover the marketing site, the wizard, a
   generated country page and the account page itself. */
const PAGES = ['/', '/check/', '/gb/', '/account/'];
const STATES = {
  out: { signed_in: false },
  free: { signed_in: true, email: 'someone@example.com', entitlement: { entitled: false, reason: 'no_subscription' } },
  paid: { signed_in: true, email: 'someone@example.com', entitlement: { entitled: true, reason: 'active', plan: 'personal_annual' } },
};

console.log('\nSigning in and signing out\n');

const browser = await chromium.launch();

for (const [state, body] of Object.entries(STATES)) {
  for (const url of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/api/me*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(700);

    const seen = await page.evaluate(async () => {
      const vis = (e) => e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
      const chip = document.getElementById('nav-account');
      const out = { chip: chip && vis(chip) ? chip.textContent.trim() : null, signOut: [], account: [], who: null, whoEmpty: false };
      /* Open whatever the chip opens before looking for the items — a control
         a person can reach in one click counts, one they cannot does not. */
      /* Only when the script has actually wired it into a menu. Signed out the
         chip stays a plain link to /account/, and clicking it here would
         navigate away and destroy the context we are measuring. */
      if (chip && vis(chip) && chip.getAttribute('role') === 'button') {
        chip.click();
        await new Promise((r) => setTimeout(r, 150));
      }
      for (const el of document.querySelectorAll('a[href], button')) {
        if (!vis(el)) continue;
        const text = el.textContent.trim();
        if (/sign ?out|se déconnecter|abmelden|cerrar sesión|esci|terminar sessão|साइन आउट/i.test(text)) out.signOut.push(text);
        if (/my account|mon compte|mein konto|mi cuenta|il mio account|minha conta|मेरा खाता/i.test(text)) out.account.push(text);
      }
      /* The strip that names the account. Present and empty is worse than
         absent: a bordered blank line reads as a component that broke. */
      const whoEl = document.getElementById('acct-menu-email');
      if (whoEl) {
        out.who = whoEl.textContent.trim();
        out.whoEmpty = vis(whoEl) && !out.who;
      }
      return out;
    });

    const where = `${state} · ${url}`;
    if (state === 'out') {
      t(`${where}: offers a way in`, seen.chip !== null, `chip=${JSON.stringify(seen.chip)}`);
      t(`${where}: offers no way out`, seen.signOut.length === 0, `found ${JSON.stringify(seen.signOut)}`);
    } else {
      t(`${where}: can reach their account`, seen.account.length > 0, `chip=${JSON.stringify(seen.chip)}`);
      t(`${where}: can sign out`, seen.signOut.length > 0, `chip=${JSON.stringify(seen.chip)}, none found`);
      /* The label names the person, not the plan we would like to sell them. */
      t(`${where}: the menu names the account`, seen.who === 'someone@example.com', `who=${JSON.stringify(seen.who)}`);
      t(`${where}: no empty strip where the address goes`, !seen.whoEmpty);
      t(`${where}: the chip is not a sales pitch`,
        !/upgrade|passer à|upgraden|mejorar|aggiorna|atualizar/i.test(seen.chip || ''),
        `chip=${JSON.stringify(seen.chip)}`);
    }
    await ctx.close();
  }
}

await browser.close();
server.close();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
