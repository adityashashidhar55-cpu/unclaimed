/**
 * /connect/ — "Use Unclaimed inside Claude, ChatGPT, Cursor".
 *
 * A landing page for the MCP server that already exists (see worker/index.js
 * handleMcp and /api/v1/mcp-tools.json, generated in src/build.mjs). This
 * page adds no new server behaviour — it explains how to point an existing
 * MCP client at the URL that already works, and lists the tools straight out
 * of the same generated file every other reference to "N tools" on this
 * site is computed from, so this page cannot drift from that count.
 *
 * The exact connector steps (menu names, button labels) for Claude and
 * ChatGPT are verified against their own help pages and cited at the bottom
 * of this page, per this repo's honesty rule: never invent UI copy for a
 * product we do not control.
 *
 * English-only, like /api/, /startups/** and /compare/**: a developer/agent
 * landing page, not prose that benefits from translation.
 */
import { esc, attr, layout } from '../ui.mjs';

const CLAUDE_HELP_URL = 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp';
const CLAUDE_CODE_MCP_URL = 'https://code.claude.com/docs/en/mcp';
const CHATGPT_HELP_URL = 'https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt';

/**
 * @param {{ BASE: string, LB: () => string, SITE_URL: string, tools: Array<{name:string,title?:string,description?:string}> }} opts
 */
export function renderConnectPage({ BASE, LB, SITE_URL, tools }) {
  const mcpUrl = `${SITE_URL}/mcp`;
  const toolRows = tools
    .map(
      (t) => `<tr><th><code>${esc(t.name)}</code></th><td>${esc((t.description || '').split(/(?<=[.!?])\s/)[0] || t.title || '')}</td></tr>`,
    )
    .join('');

  const body = `
<section class="section-tight shell">
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${LB()}/">Home</a><a href="${LB()}/api/">API</a><span aria-current="page">Connect</span></nav>
  <span class="eyebrow eyebrow-accent">MCP</span>
  <h1 style="max-width:22ch">Use Unclaimed inside Claude, ChatGPT or Cursor</h1>
  <p class="lede" style="max-width:64ch">Unclaimed runs a free, public MCP server — no key, no install, no rate limit — over the same
  sourced dataset the site is built from: government and institutional benefits for households, and grants for
  companies. Point any MCP-capable chatbot or editor at the URL below and it can ask this data directly, instead of
  guessing from what it already knows.</p>

  <div class="card" style="margin-top:1.6rem">
    <span class="eyebrow">Server URL</span>
    <pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin:.4rem 0 0"><code>${esc(mcpUrl)}</code></pre>
  </div>

  <h2 style="margin-top:2.5rem">Connect from Claude</h2>
  <ol style="max-width:64ch">
    <li>In Claude, open <strong>Customize → Connectors</strong> (custom connectors are available on Free, Pro, Max,
    Team and Enterprise plans; on Team or Enterprise an Owner first adds it under Organization settings → Connectors,
    then members click "Connect" on it).</li>
    <li>Click the "+" button next to Connectors, then "Add custom connector".</li>
    <li>Paste <code>${esc(mcpUrl)}</code> as the remote MCP server URL.</li>
    <li>Click "Add". You can now enable it per-conversation from the "+" button on the chat composer, under
    "Connectors".</li>
  </ol>
  <p class="tiny">Verified against Claude's own help article, linked in Sources below — steps change as the product
  does, so treat that article as the source of truth over this page if they ever disagree.</p>

  <h2 style="margin-top:2.5rem">Connect from ChatGPT</h2>
  <ol style="max-width:64ch">
    <li>Turn on developer mode: Settings → Apps → Advanced settings → Developer mode. OpenAI's article describes this
    for Pro (read/fetch tools only — which is all Unclaimed has) and for Business, Enterprise and Edu workspaces, where
    an admin may need to allow it first.</li>
    <li>Go to Settings → Apps → Create, and enter <code>${esc(mcpUrl)}</code> as the endpoint.</li>
    <li>Click "Scan Tools", wait for it to finish, then click "Create".</li>
    <li>In a chat, select the app for your message, or mention it in your prompt.</li>
  </ol>
  <p class="tiny">Verified against OpenAI's own help article, linked in Sources below. OpenAI's article notes that
  write/modify MCP actions are in beta for Business/Enterprise/Edu only — every Unclaimed tool is read-only, so this
  does not affect using it.</p>

  <h2 style="margin-top:2.5rem">Connect from Claude Code, Cursor, or any JSON-config MCP client</h2>
  <p>In Claude Code, one command:</p>
  <pre style="white-space:pre-wrap;overflow-wrap:anywhere"><code>claude mcp add --transport http unclaimed ${esc(mcpUrl)}</code></pre>
  <p>In Cursor or another client that reads a JSON config, add this to its MCP config file:</p>
  <pre style="white-space:pre-wrap;overflow-wrap:anywhere"><code>{
  "mcpServers": {
    "unclaimed": { "url": "${esc(mcpUrl)}" }
  }
}</code></pre>

  <h2 style="margin-top:2.5rem">The ${tools.length} tools</h2>
  <table class="rule-table">${toolRows}</table>
  <p class="small">Full JSON Schema for every tool: <a href="${SITE_URL}/api/v1/mcp-tools.json" rel="nofollow noopener">${esc(SITE_URL)}/api/v1/mcp-tools.json</a>.</p>

  <h2 style="margin-top:2.5rem">Example prompts</h2>
  <ul style="max-width:64ch">
    <li>"I live in France, I'm a student paying rent — what am I missing?"</li>
    <li>"We're a UK seed-stage SaaS company with 8 employees doing R&D — search company grants for us."</li>
    <li>"What documents do I need for [a programme you name]?"</li>
    <li>"Which programmes in Germany close in the next month?"</li>
  </ul>

  <h2 style="margin-top:2.5rem">Honest limits</h2>
  <ul style="max-width:64ch">
    <li>Free-tier answers over MCP match the free web check exactly: <code>check_entitlements</code> and
    <code>check_company_eligibility</code> return totals and counts, not the named list, unless the call carries an
    entitled session. <code>search_programmes</code> and <code>search_company_grants</code> can still name a
    specific record, because that record's own public page already names it.</li>
    <li>This is a discovery tool, not legal, tax or financial advice — every tool result says so in its own
    governance note, and states only that a profile appears to meet or fail the published criteria, never that a
    payment will follow.</li>
    <li>A null field means the fact is not published anywhere we found it, never a guess filled in on the model's
    behalf — every tool's governance note says the same.</li>
  </ul>

  <p style="margin-top:2rem"><a class="btn btn-primary" href="${LB()}/api/">See the full API and MCP reference</a></p>

  <p class="small" style="margin-top:2rem">Sources: <a href="${CLAUDE_HELP_URL}" rel="nofollow noopener">Claude — Get started with custom connectors using remote MCP</a>
  · <a href="${CHATGPT_HELP_URL}" rel="nofollow noopener">OpenAI — Developer mode and MCP apps in ChatGPT</a>
  · <a href="${CLAUDE_CODE_MCP_URL}" rel="nofollow noopener">Claude Code — Connect Claude Code to tools via MCP</a></p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: 'en',
    altLangs: [],
    title: 'Connect Unclaimed to Claude, ChatGPT or Cursor',
    description: `Add Unclaimed's free MCP server (${tools.length} tools, no key, no rate limit) to Claude, ChatGPT, Claude Code or Cursor — step-by-step setup and example prompts.`,
    canonical: `${SITE_URL}/connect/`,
    body,
  });
}
