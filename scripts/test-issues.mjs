#!/usr/bin/env node
/**
 * "Report an error": validation, storage, rate limiting, the honeypot, the
 * admin queue — and that the MCP tool's reports land in the same table.
 * Same shape as scripts/test-leads.mjs: real migrations on node:sqlite, the
 * Worker's own handlers, no regex over the source.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import { validateIssueInput, validateResolution, ISSUE_TYPES } from '../packages/issues/index.js';
import { __test } from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = allMigrations(ROOT);

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));
const no = (v, m) => (!v ? ok(m) : bad(`${m} — it did not refuse`));

console.log('\n"Report an error"\n');

/* ---- validation ------------------------------------------------------ */
yes(ISSUE_TYPES.includes('wrong_amount') && ISSUE_TYPES.includes('dead_link'), 'the issue types are the MCP tool\'s');
no(validateIssueInput({ slug: '', description: 'wrong amount here' }).ok, 'no slug is refused');
no(validateIssueInput({ slug: '../../etc', description: 'wrong amount here' }).ok, 'a slug with path characters is refused');
no(validateIssueInput({ slug: 'gb/x', description: 'no' }).ok, 'a description of two letters is refused');
no(validateIssueInput({ slug: 'gb/x', issue_type: 'made_up', description: 'wrong amount here' }).ok, 'an unknown issue type is refused');
no(validateIssueInput({ slug: 'gb/x', description: 'wrong amount here', evidence_url: 'javascript:alert(1)' }).ok, 'a non-http evidence URL is refused');
no(validateIssueInput({ slug: 'gb/x', description: 'wrong amount here', reporter_contact: 'not-an-email' }).ok, 'a malformed contact address is refused');
{
  const v = validateIssueInput({
    slug: 'gb/some-grant', country_code: ' GB ', audience: 'company', issue_type: 'wrong_amount',
    description: '  The maximum is now 50,000  ', evidence_url: 'https://www.gov.uk/x', reporter_contact: 'A@B.com',
  });
  yes(v.ok, 'a well-formed report is accepted');
  is(v.country_code, 'gb', 'country is lowercased');
  is(v.description, 'The maximum is now 50,000', 'description is trimmed');
  is(v.reporter_contact, 'a@b.com', 'contact is lowercased');
  is(validateIssueInput({ slug: 'x', description: 'something wrong', audience: 'zzz' }).audience, '', 'an unknown audience is dropped, not fatal');
}
yes(validateIssueInput({ slug: 'x', description: 'something wrong', website: 'http://spam' }).honeypot === true, 'a filled honeypot is recognised');
no(validateResolution({ id: 'x', status: 'nonsense' }).ok, 'an unknown resolution status is refused');

/* ---- the handler against a real database ------------------------------ */
const makeEnv = () => ({ DB: memoryD1(MIGRATIONS), APP_ORIGIN: 'https://unclaimedgrant.com' });
const req = (url, { method = 'POST', body, headers = {} } = {}) =>
  new Request(`https://unclaimedgrant.com${url}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

{
  const env = makeEnv();
  const report = { slug: 'gb/some-grant', country_code: 'gb', audience: 'household', issue_type: 'dead_link', description: 'The apply link 404s', page_url: 'https://unclaimedgrant.com/gb/x/' };

  const bad1 = await __test.handleReportIssue(req('/api/report-issue', { body: { ...report, description: '' } }), env);
  is(bad1.status, 422, 'an empty description is a 422');

  const res = await __test.handleReportIssue(req('/api/report-issue', { body: report, headers: { 'cf-connecting-ip': '203.0.113.9' } }), env);
  is(res.status, 200, 'a well-formed report is accepted');
  const data = await res.json();
  yes(/^ir-[a-z0-9]{8}$/.test(data.reference), 'and answers with a reference to quote');

  const row = await env.DB.prepare('SELECT * FROM issue_reports WHERE reference = ?').bind(data.reference).first();
  yes(row != null, 'the report is stored in D1');
  is(row.status, 'open', 'it starts open');
  is(row.source, 'web', 'it records that it came from the web form');
  yes(row.ip_hash && row.ip_hash.length === 16 && !row.ip_hash.includes('203'), 'the network address is stored as a short hash, not as itself');

  /* honeypot: 200, stores nothing */
  const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM issue_reports').first()).n;
  const hp = await __test.handleReportIssue(req('/api/report-issue', { body: { ...report, website: 'http://spam.example' } }), env);
  is(hp.status, 200, 'a bot that fills the honeypot gets a 200');
  is((await env.DB.prepare('SELECT COUNT(*) AS n FROM issue_reports').first()).n, before, 'and nothing is stored');

  /* rate limit */
  let last = 200;
  for (let i = 0; i < 12; i += 1) {
    last = (await __test.handleReportIssue(req('/api/report-issue', { body: report, headers: { 'cf-connecting-ip': '198.51.100.7' } }), env)).status;
  }
  is(last, 429, 'one connection is capped per hour');

  /* admin queue */
  const anon = await __test.handleAdminIssues(req('/api/admin/issues', { method: 'GET' }), env);
  is(anon.status, 403, 'listing reports with no admin session is refused');
  const auth = { authorization: `Bearer ${await __test.signSession(env, { uid: 'u1', adm: true, email: 'owner@example.com' })}` };
  const list = await (await __test.handleAdminIssues(req('/api/admin/issues', { method: 'GET', headers: auth }), env)).json();
  yes(Array.isArray(list.issues) && list.issues.some((i) => i.reference === data.reference), 'an admin can list open reports, the new one included');
  yes(list.counts.open >= 1, 'with a count per status');

  const resolved = await __test.handleAdminIssueResolve(req('/api/admin/issues/resolve', { body: { id: data.reference, status: 'fixed', note: 'Link updated' }, headers: auth }), env);
  is(resolved.status, 200, 'an admin can mark a report fixed (by reference)');
  const after = await env.DB.prepare('SELECT status, resolution_note FROM issue_reports WHERE reference = ?').bind(data.reference).first();
  is(after.status, 'fixed', 'the status changed');
  const audit = await env.DB.prepare("SELECT action FROM admin_audit WHERE action = 'issue_resolve'").first();
  yes(audit != null, 'and the change is in the audit trail');
  const anonResolve = await __test.handleAdminIssueResolve(req('/api/admin/issues/resolve', { body: { id: data.reference, status: 'open' } }), env);
  is(anonResolve.status, 403, 'resolving with no admin session is refused');
}

/* ---- MCP: report_issue lands in the same table ------------------------ */
{
  /* env.ASSETS serves the published tool schemas, which tools/call validates against. */
  const fs = await import('node:fs');
  const env = {
    ...makeEnv(),
    ASSETS: { fetch: async () => new Response(fs.readFileSync(path.join(ROOT, 'data/mcp-tools.json'), 'utf8'), { headers: { 'content-type': 'application/json' } }) },
  };
  const res = await __test.handleMcp(
    new Request('https://unclaimedgrant.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'report_issue', arguments: { country_code: 'gb', slug: 'gb/x', issue_type: 'wrong_deadline', description: 'Closes in March, not June' } },
      }),
    }),
    env,
  );
  const out = await res.json();
  yes(!out.error, 'the MCP tool still answers');
  const row = await env.DB.prepare("SELECT source, issue_type FROM issue_reports WHERE slug = 'gb/x'").first();
  yes(row && row.source === 'mcp' && row.issue_type === 'wrong_deadline', 'and the report is stored, marked as coming from MCP');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
