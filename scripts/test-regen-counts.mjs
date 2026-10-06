#!/usr/bin/env node
/**
 * scripts/regen-counts.mjs and scripts/lib/counts.mjs against a fixture root:
 * adding or retiring a record must be a one-command change to every document
 * that states a count, and nothing may need a number typed by hand.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { regenCounts } from './regen-counts.mjs';
import { computeCounts, ROOT } from './lib/counts.mjs';

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const t = (m, v, extra = '') => (v ? ok(m) : bad(`${m}${extra ? ` — ${extra}` : ''}`));

console.log('\nregen-counts\n');

const prog = (slug, extra = {}) => ({ slug, amount_min: null, amount_max: null, source_url: `https://example.org/${slug}/page`, verification_status: 'unverified', eligibility: {}, ...extra });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'regen-counts-'));
fs.mkdirSync(path.join(root, 'data/startups'), { recursive: true });
fs.mkdirSync(path.join(root, 'native'));
fs.mkdirSync(path.join(root, 'docs'));
fs.mkdirSync(path.join(root, 'scripts'));
const writeJ = (rel, o, ind = 1) => fs.writeFileSync(path.join(root, rel), JSON.stringify(o, null, ind) + (ind ? '\n' : ''));
writeJ('data/xx.json', { programmes: [prog('a', { verification_status: 'verified' }), prog('b'), prog('c')] });
writeJ('data/startups/yy.json', { programmes: [prog('d', { status: 'closed', amount_min: 5 }), prog('e', { status: 'open', verification_status: 'verified' })] }, 0);
writeJ('data/startups/manifest.json', { generated_at: '2000-01-01', total: 999, countries: [{ slug: 'yy', name: 'Yland', count: 99, verified: 9, priced: 9, open: 9, closed: 9 }] });
writeJ('data/manifest.json', { countries: [], total_programmes: 1, total_verified: 1 }, 2);
fs.writeFileSync(path.join(root, 'native/STORE.md'), '> Unclaimed collects 100 programmes across 1 jurisdictions, each\n> we track 7 closed programmes with\n');
fs.writeFileSync(path.join(root, 'docs/DEMO.md'), '| Benefit programmes | 1 across 1 countries |\n| Human-verified against the official page | 1 (1%) |\n| Company funding programmes | 1 across 1 jurisdictions |\n');
fs.writeFileSync(path.join(root, 'scripts/baselines.json'), JSON.stringify({ vague_source_ceiling: 50 }));

const c = computeCounts(root);
t('household and company totals are counted from the files', c.household.total === 3 && c.company.total === 2, JSON.stringify(c.household));
t('closed is counted from the stored status', c.company.closed === 1 && c.closed === 1);
t('jurisdictions are the union of file stems across both datasets', c.jurisdictions === 2);

const check = regenCounts({ root, check: true });
t('--check finds every stale statement', ['data/startups/manifest.json', 'data/manifest.json', 'native/STORE.md', 'docs/DEMO.md'].every((f) => check.stale.includes(f)), check.stale.join(','));
t('--check writes nothing', JSON.parse(fs.readFileSync(path.join(root, 'data/startups/manifest.json'), 'utf8')).total === 999);

regenCounts({ root, today: '2026-10-05' });
const sm = JSON.parse(fs.readFileSync(path.join(root, 'data/startups/manifest.json'), 'utf8'));
t('the startup manifest total and per-country stats are rewritten', sm.total === 2 && sm.countries[0].count === 2 && sm.countries[0].verified === 1 && sm.countries[0].priced === 1 && sm.countries[0].open === 1 && sm.countries[0].closed === 1, JSON.stringify(sm.countries[0]));
t('and its indent is preserved', /^\{\n "generated_at"/.test(fs.readFileSync(path.join(root, 'data/startups/manifest.json'), 'utf8')));
const store = fs.readFileSync(path.join(root, 'native/STORE.md'), 'utf8');
t('STORE.md states the live counts (programmes rounded to the nearest 100, closed exact)', /collects 0 programmes across 2 jurisdictions/.test(store) && /we track 1 closed/.test(store), store);
const demo = fs.readFileSync(path.join(root, 'docs/DEMO.md'), 'utf8');
t('DEMO.md states the live counts', /\| Benefit programmes \| 3 across 1 countries \|/.test(demo) && /\| 1 \(33%\) \|/.test(demo) && /\| Company funding programmes \| 2 across 1 jurisdictions \|/.test(demo), demo);
const hm = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
t('the household manifest totals are rewritten', hm.total_programmes === 3 && hm.total_verified === 1);
const base = JSON.parse(fs.readFileSync(path.join(root, 'scripts/baselines.json'), 'utf8'));
t('the vague-source ceiling ratchets DOWN to the live count (these fixtures cite specific pages)', base.vague_source_ceiling === 0, JSON.stringify(base));

/* idempotent, and the ratchet never rises */
const again = regenCounts({ root, today: '2030-01-01' });
t('a second run changes nothing', again.stale.length === 0, again.stale.join(','));
fs.writeFileSync(path.join(root, 'data/xx.json'), JSON.stringify({ programmes: [prog('a', { source_url: 'https://example.org/' })] }, null, 1));
regenCounts({ root });
t('a record with a homepage as its source does NOT raise the ceiling', JSON.parse(fs.readFileSync(path.join(root, 'scripts/baselines.json'), 'utf8')).vague_source_ceiling === 0);

/* the real repo agrees with itself after a regen */
{
  const real = computeCounts(ROOT);
  const sm2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/startups/manifest.json'), 'utf8'));
  t('the real startup manifest total equals the sum of the real files (run node scripts/regen-counts.mjs if not)', sm2.total === real.company.total, `${sm2.total} vs ${real.company.total}`);
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
