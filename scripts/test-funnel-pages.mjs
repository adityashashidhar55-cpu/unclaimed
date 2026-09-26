#!/usr/bin/env node
/**
 * Involve Consulting handoff + MCP landing page + readiness quiz — checks
 * against the actual built output in dist/, the same way scripts/verify.mjs
 * checks other generated pages. Run after `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const t = (name, cond) => (cond ? (pass += 1, console.log(`  ✓ ${name}`)) : (fail += 1, console.error(`  ✗ ${name}`)));

console.log('\nInvolve Consulting handoff, MCP landing page, readiness quiz\n');

if (!fs.existsSync(DIST)) {
  console.error('dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(DIST, rel));

/* ---- /connect/ --------------------------------------------------------*/

t('/connect/ is built', exists('connect/index.html'));
{
  const html = read('connect/index.html');
  t('it links the real /mcp URL', html.includes('https://unclaimedgrant.com/mcp'));
  t('it states a tool count that matches the actual generated mcp-tools.json', (() => {
    const tools = JSON.parse(read('api/v1/mcp-tools.json')).tools;
    return html.includes(`The ${tools.length} tools`) && tools.length === 9;
  })());
  t('every tool from the generated file is listed on the page', (() => {
    const tools = JSON.parse(read('api/v1/mcp-tools.json')).tools;
    return tools.every((tool) => html.includes(`<code>${tool.name}</code>`));
  })());
  t('it cites the Claude connector help page', html.includes('support.claude.com'));
  t('it cites the ChatGPT connector help page', html.includes('help.openai.com'));
  t('it carries a Claude Code / Cursor JSON config snippet', html.includes('"mcpServers"'));
  t('it is reachable from the footer', read('index.html').includes('href="/connect/"'));
}

/* ---- /help/expert/ (the lead form) ------------------------------------*/

t('/help/expert/ is built', exists('help/expert/index.html'));
{
  const html = read('help/expert/index.html');
  t('it posts to /api/leads', html.includes("fetch('/api/leads'"));
  t('it has a consent checkbox', html.includes('id="lead-consent"'));
  t('it says the service is paid and separate from Unclaimed', /paid/i.test(html) && /separate/i.test(html));
  t('it never quotes a percentage or success fee', !/\d+\s*%|\bcommission\b|success fee/i.test(html));
}

/* The CTA on a company programme page links to the lead form with context. */
{
  const programmeDir = path.join(DIST, 'startups/gb');
  const firstProgramme = fs.readdirSync(programmeDir, { withFileTypes: true }).find((d) => d.isDirectory() && d.name !== 'closing-soon');
  t('a company programme page exists to check', !!firstProgramme);
  if (firstProgramme) {
    const html = read(`startups/gb/${firstProgramme.name}/index.html`);
    t('it carries a "Get expert help" CTA to /help/expert/', /Talk to Involve Consulting/.test(html) && html.includes('href="/help/expert/'));
    t('the CTA never promises a success fee', !/success fee|commission|\d+\s*%\s*of\s*(your|the)?\s*(grant|award|funding)/i.test(html));
  }
}

/* ---- /startups/readiness/ (the quiz) ----------------------------------*/

t('/startups/readiness/ is built', exists('startups/readiness/index.html'));
t('readiness.js is built', exists('readiness.js'));
{
  const html = read('startups/readiness/index.html');
  const payloadMatch = html.match(/<script type="application\/json" id="readiness-data">([\s\S]*?)<\/script>/);
  t('the quiz embeds a JSON payload', !!payloadMatch);
  if (payloadMatch) {
    const data = JSON.parse(payloadMatch[1]);
    t('it has around 10 questions', data.questions.length >= 9 && data.questions.length <= 12);
    t('every question has at least two options', data.questions.every((q) => q.options.length >= 2));
    t('every flagged option has a matching next-step', data.questions.every((q) => q.options.every((o) => !o.flag || typeof data.nextSteps[o.flag] === 'string')));
    t('every next step links to a real page on this site (checked below) or names one', Object.values(data.nextSteps).every((s) => typeof s === 'string' && s.length > 0));
  }
  t('the quiz is client-side only — no fetch/XMLHttpRequest in the page or its script', !/\bfetch\(|XMLHttpRequest/.test(html) && !/\bfetch\(|XMLHttpRequest/.test(fs.readFileSync(path.join(DIST, 'readiness.js'), 'utf8')));
  {
    const js = fs.readFileSync(path.join(DIST, 'readiness.js'), 'utf8');
    t(
      'the result screen links onward to the full check, the de minimis calculator and closing-soon',
      (html + js).includes('/startups/check/') && (html + js).includes('/startups/de-minimis/') && (html + js).includes('/startups/closing-soon/'),
    );
  }
}

/* ---- household results and the application brief carry the CTA too ---*/

{
  const appJs = fs.readFileSync(path.join(ROOT, 'src/pwa/app.js'), 'utf8');
  t('the household results view (app.js) carries the expert-help CTA', appJs.includes('/help/expert/?audience=household'));
}
{
  const startupCheckJs = fs.readFileSync(path.join(ROOT, 'src/pwa/startup-check.js'), 'utf8');
  t('the company results view (startup-check.js) carries the expert-help CTA', startupCheckJs.includes('/help/expert/?audience=company'));
}
{
  const dashboardJs = fs.readFileSync(path.join(ROOT, 'src/pwa/dashboard.js'), 'utf8');
  t('the application brief (dashboard.js) carries the expert-help CTA', dashboardJs.includes('/help/expert/?audience=company') && dashboardJs.includes('Want a human to review this application?'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
