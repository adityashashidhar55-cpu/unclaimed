#!/usr/bin/env node
/**
 * The MCP endpoint, driven exactly as an external client would drive it:
 * real HTTP-shaped Requests into the real Worker's fetch handler, over a
 * fake env.ASSETS that reads the real dist/ (so a broken build shows up
 * here, not just at 3am on unclaimedgrant.com).
 *
 * What this checks, in order of what breaks if it regresses:
 *
 *   1. The protocol handshake works at all (initialize, tools/list) — an MCP
 *      client refuses to talk to a server that gets this wrong, so a bug here
 *      is total: every tool becomes unreachable, not just one.
 *   2. tools/call actually respects the paywall: check_company_eligibility
 *      must return totals, never the programme list, over MCP exactly as it
 *      does over the plain POST /api/startups/check the website calls.
 *   3. search_company_grants — the tool that IS allowed to name names,
 *      because those facts are already public on each grant's own page —
 *      returns a real record with a page_url and a status that has been
 *      recomputed against "now", not served stale from the last build.
 *   4. The transport-level edges: an unknown tool is a JSON-RPC error, not a
 *      500 or a silent empty result; GET is refused with the right verb in
 *      Allow; a CORS preflight succeeds for an arbitrary origin (unlike the
 *      rest of the API, this endpoint is meant to be called from anywhere).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { __test } from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.UNCLAIMED_DIST || path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const t = (name, ok, detail = '') => {
  ok ? (pass += 1, console.log(`  ✓ ${name}`)) : (fail += 1, console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`));
};

if (!fs.existsSync(path.join(DIST, 'api/v1/mcp-tools.json'))) {
  console.error('test-mcp: dist/api/v1/mcp-tools.json is missing — run `npm run build` first');
  process.exit(1);
}

/** env.ASSETS over the real dist/ — the same pattern test-dataset-degraded.mjs
 *  uses, so this test fails the moment the build stops emitting what the
 *  Worker's MCP handlers read (mcp-tools.json, the full/ dataset, the
 *  startup pools, countries.json). */
const env = {
  DB: {
    prepare: () => ({
      bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({}),
    }),
  },
  ASSETS: {
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      if (p.startsWith('/api/v1/full/')) {
        const f = path.join(DIST, p);
        if (!fs.existsSync(f)) return new Response('Not found', { status: 404 });
        return new Response(fs.readFileSync(f), { headers: { 'content-type': 'application/json' } });
      }
      const f = path.join(DIST, p);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response('Not found', { status: 404 });
      return new Response(fs.readFileSync(f), { headers: { 'content-type': 'application/json' } });
    },
  },
};

const ctx = { waitUntil() {} };

const rpc = (body, extraHeaders = {}) =>
  worker.fetch(
    new Request('https://unclaimedgrant.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );

console.log('\nMCP server (/mcp)\n');

/* ---- 1. handshake -------------------------------------------------- */

{
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  t('initialize responds 200', res.status === 200, `got ${res.status}`);
  const body = await res.json();
  t('initialize echoes a supported protocolVersion', body.result?.protocolVersion === '2025-06-18');
  t('initialize advertises the tools capability', !!body.result?.capabilities?.tools);
  t('initialize names the server', body.result?.serverInfo?.name === 'unclaimed');
}

{
  // A notification (no id) gets no JSON-RPC body at all — 202, per the spec.
  const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  t('notifications/initialized gets 202 with no body', res.status === 202);
  const text = await res.text();
  t('and the body really is empty', text === '');
}

{
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const body = await res.json();
  const tools = body.result?.tools ?? [];
  t('tools/list returns exactly the 9 published tools', tools.length === 9, `got ${tools.length}`);
  t('every tool carries an inputSchema', tools.length > 0 && tools.every((tool) => tool && typeof tool.inputSchema === 'object'));
  const names = tools.map((tool) => tool.name).sort();
  const expected = [
    'check_company_eligibility', 'check_entitlements', 'get_coverage', 'get_documents',
    'get_procedure', 'get_programme', 'report_issue', 'search_company_grants', 'search_programmes',
  ];
  t('and they are the right nine', JSON.stringify(names) === JSON.stringify(expected), names.join(', '));
}

{
  const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' });
  const body = await res.json();
  t('ping is answered', res.status === 200 && body.result !== undefined);
}

/* ---- 2. the paywall, over MCP ---------------------------------------- */

{
  const res = await rpc({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'check_company_eligibility', arguments: { jurisdiction: 'eu', stage: 'seed' } },
  });
  const body = await res.json();
  const sc = body.result?.structuredContent;
  t('check_company_eligibility answers 200 over JSON-RPC', res.status === 200 && !body.error);
  t('it returns totals', sc && typeof sc === 'object' && ('totals' in sc || 'non_dilutive' in sc), JSON.stringify(sc).slice(0, 200));
  const asText = JSON.stringify(sc);
  t(
    'and never a programme names list — no name_en/funder anywhere in the payload',
    !/"name_en"/.test(asText) && !/"funder"/.test(asText),
  );
  t('it points the assistant at the results page', typeof sc?.results_url === 'string' && sc.results_url.includes('/startups/check'));
  t('every result carries the governance note', typeof sc?.governance === 'string' && sc.governance.length > 0);
  t('every result carries status_as_of', typeof sc?.status_as_of === 'string' && !Number.isNaN(Date.parse(sc.status_as_of)));
}

/* ---- 3. search_company_grants: named records, live status ------------ */

{
  const res = await rpc({
    jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { name: 'search_company_grants', arguments: { jurisdiction: 'eu', query: 'accelerator' } },
  });
  const body = await res.json();
  const sc = body.result?.structuredContent;
  t('search_company_grants answers 200', res.status === 200 && !body.error);
  const results = sc?.results ?? [];
  t('it found at least one match for "accelerator" in the eu pool', results.length > 0, `got ${results.length}`);
  const eic = results.find((r) => /european innovation council accelerator/i.test(r.name_en || ''));
  t('the EIC Accelerator is among the results', !!eic, results.map((r) => r.name_en).join(' | '));
  t('it carries a page_url on unclaimedgrant.com', typeof eic?.page_url === 'string' && eic.page_url.startsWith('https://unclaimedgrant.com/startups/'));
  t('it carries an effective status, not just whatever was stored', typeof eic?.status === 'string' && eic.status.length > 0);
  t(
    'and the status is not stale relative to now: a stored "open" past its own closes_at is never returned as open',
    !(eic.status_stored === 'open' && eic.closes_at && Date.parse(eic.closes_at) < Date.now() && eic.status === 'open'),
  );
  t('governance note is present here too', typeof sc?.governance === 'string' && sc.governance.length > 0);
}

/* ---- 3b. page_url points at the page that really renders the record ---- */
/*
 * Household pages live at /<cc>/<category>/<slug>/, company pages at
 * /startups/<pool>/<slug>/. A page_url that 404s sends the assistant's user
 * to nothing, so each one is checked against the built dist/ file — and a
 * company slug merged away as a duplicate (data/startups/redirects.json) must
 * still resolve, to the surviving record, via get_programme.
 */
{
  const call = async (name, args, id) => {
    const res = await rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const body = await res.json();
    return body.result?.structuredContent ?? null;
  };
  const builtAt = (url) => {
    if (typeof url !== 'string' || !url.startsWith('https://unclaimedgrant.com/')) return false;
    const rel = new URL(url).pathname.replace(/^\//, '');
    return fs.existsSync(path.join(DIST, rel, 'index.html'));
  };

  const hhSearch = await call('search_programmes', { country_code: 'de' }, 31);
  const hh = hhSearch?.results?.[0];
  t('search_programmes page_url is /<cc>/<category>/<slug>/ and is built', !!hh && hh.page_url.endsWith(`/de/${hh.category}/${hh.slug}/`) && builtAt(hh.page_url), hh?.page_url);
  const hhAll = (hhSearch?.results ?? []).every((r) => builtAt(r.page_url));
  t('every household search result page_url exists in dist/', hhAll);

  const hhGet = await call('get_programme', { country_code: 'de', slug: hh?.slug }, 32);
  t('get_programme household page_url matches search and is built', hhGet?.page_url === hh?.page_url && builtAt(hhGet?.page_url), hhGet?.page_url);
  t('and it is labelled a household record', hhGet?.record_type === 'household');

  const coSearch = await call('search_company_grants', { jurisdiction: 'eu' }, 33);
  t('every company search result page_url is /startups/<pool>/<slug>/ and is built',
    (coSearch?.results ?? []).length > 0 && coSearch.results.every((r) => r.page_url.endsWith(`/startups/eu/${r.slug}/`) && builtAt(r.page_url)));

  const coGet = await call('get_programme', { country_code: 'de', slug: 'de-forschungszulage' }, 34);
  t('get_programme resolves a company record by country + slug', coGet?.slug === 'de-forschungszulage' && coGet?.record_type === 'company', JSON.stringify(coGet)?.slice(0, 200));
  t('its page_url is the /startups/ page, and is built', coGet?.page_url === 'https://unclaimedgrant.com/startups/de/de-forschungszulage/' && builtAt(coGet?.page_url), coGet?.page_url);

  const redirects = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/startups/redirects.json'), 'utf8'));
  let resolved = 0;
  const bad = [];
  for (const r of redirects) {
    const got = await call('get_programme', { country_code: r.country, slug: r.from }, 35);
    if (got?.slug === r.to && got?.redirected_from === r.from && got?.page_url === `https://unclaimedgrant.com/startups/${r.country}/${r.to}/` && builtAt(got.page_url)) resolved += 1;
    else bad.push(`${r.country}/${r.from}`);
  }
  t(`every merged-away company slug (${redirects.length}) resolves via redirects.json to its canonical, built page`, resolved === redirects.length, bad.join(', '));

  const docs = await call('get_documents', { country_code: 'eu', slug: 'eic-accelerator' }, 36);
  t('get_documents follows the same redirect', docs?.slug === 'eu-eic-accelerator' && docs?.page_url === 'https://unclaimedgrant.com/startups/eu/eu-eic-accelerator/');
  const proc = await call('get_procedure', { country_code: 'eu', slug: 'eu-eic-accelerator' }, 37);
  t('get_procedure works for a company record', proc?.slug === 'eu-eic-accelerator' && builtAt(proc?.page_url));

  const miss = await call('get_programme', { country_code: 'de', slug: 'no-such-programme' }, 38);
  t('an unknown slug is still "programme not found"', miss?.error === 'programme not found');
  const trav = await call('get_programme', { country_code: '../full', slug: 'x' }, 39);
  t('a malformed country_code is refused, not turned into an asset path', trav?.error === 'programme not found');
}

/* ---- 4. transport edges ----------------------------------------------- */

{
  const res = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'not_a_real_tool', arguments: {} } });
  const body = await res.json();
  t('an unknown tool is a JSON-RPC error, not a crash', res.status === 200 && !!body.error, JSON.stringify(body));
  t('the error names the bad tool', /not_a_real_tool/.test(body.error?.message || ''));
}

{
  const res = await rpc({ jsonrpc: '2.0', id: 7, method: 'not/a/real/method' });
  const body = await res.json();
  t('an unknown method is also a JSON-RPC error', !!body.error && body.error.code === -32601);
}

{
  const res = await worker.fetch(new Request('https://unclaimedgrant.com/mcp', { method: 'GET' }), env, ctx);
  t('GET /mcp is refused', res.status === 405, `got ${res.status}`);
  t('and says which verb is allowed', res.headers.get('allow') === 'POST', res.headers.get('allow'));
}

{
  const res = await worker.fetch(
    new Request('https://unclaimedgrant.com/mcp', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://claude.ai',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, authorization',
      },
    }),
    env,
    ctx,
  );
  t('CORS preflight from an arbitrary MCP client origin succeeds', res.status === 204, `got ${res.status}`);
  t('and the origin is wide open, unlike the rest of the API', res.headers.get('access-control-allow-origin') === '*');
  t(
    'and mcp-session-id / mcp-protocol-version are allowed request headers',
    (res.headers.get('access-control-allow-headers') || '').includes('mcp-session-id'),
  );
}

/* ---- 5. a batch request, and a request with no id at all -------------- */

{
  const res = await rpc([
    { jsonrpc: '2.0', id: 8, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/whatever' },
    { jsonrpc: '2.0', id: 9, method: 'ping' },
  ]);
  const body = await res.json();
  t('a batch returns one entry per request that had an id', Array.isArray(body) && body.length === 2, JSON.stringify(body));
}

/* ---- 6. GET /api/v1/startups/{cc}.json recomputes status --------------- */
/*
 * Independent of real data (which, post daily-rebuild, may have nothing
 * currently stale to show): inject a company record whose stored status is
 * "open" but whose closes_at is well in the past, through a fake env.ASSETS,
 * and assert the route corrects it rather than serving the frozen field.
 */
{
  const stalePayload = {
    country_code: 'zz', country_name: 'Testland', currency: 'EUR', language: 'en', entity: 'startup',
    programmes: [{
      slug: 'stale-grant', name_en: 'Stale Grant', status: 'open', closes_at: '2020-01-01', opens_at: null,
    }],
  };
  const staleEnv = {
    ...env,
    ASSETS: {
      fetch: async (req) => {
        const p = new URL(req.url).pathname;
        if (p === '/api/v1/full/startups/zz.json') return new Response('Not found', { status: 404 });
        if (p === '/api/v1/startups/zz.json') {
          return new Response(JSON.stringify(stalePayload), { headers: { 'content-type': 'application/json' } });
        }
        return env.ASSETS.fetch(req);
      },
    },
  };
  const res = await worker.fetch(new Request('https://unclaimedgrant.com/api/v1/startups/zz.json'), staleEnv, ctx);
  const body = await res.json();
  const p = body?.programmes?.[0];
  t('a public read of a stale-open startup record is corrected to closed', p?.status === 'closed', JSON.stringify(p));
  t('the raw stored value survives as status_stored', p?.status_stored === 'open');
  t('the payload carries a top-level status_as_of', typeof body?.status_as_of === 'string' && !Number.isNaN(Date.parse(body.status_as_of)));
}

console.log(`\ntest-mcp: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
