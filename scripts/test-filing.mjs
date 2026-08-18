/* Filing on a company's behalf: the authority, the machine, the trail.
 *
 * This is the enterprise product, so the failure modes are not cosmetic. The
 * three that would actually cost something:
 *
 *   - filing without a recorded authority, which is the one row that must not
 *     be possible to create;
 *   - a revocation that does not stop work already moving, which makes the
 *     word "revoke" mean "eventually";
 *   - filing the same programme at the same funder twice, which is worse than
 *     a refused button.
 *
 * The state machine and the guards are lifted out of worker/index.js by text
 * rather than reimplemented, so this cannot drift from what runs.
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const t = (name, ok) => { ok ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}`)); };

const ROOT = new URL('..', import.meta.url);
const src = fs.readFileSync(new URL('worker/index.js', ROOT), 'utf8');

/* Pull the real machine out of the Worker. */
const block = src.slice(src.indexOf('const FILING_STATES = {'), src.indexOf('const TERMINAL_STATES'));
const FILING_STATES = (await import('data:text/javascript,' + encodeURIComponent(`${block}\nexport default FILING_STATES;`))).default;

/* ---- the machine -------------------------------------------------- */
{
  const states = Object.keys(FILING_STATES);
  t('every state a transition points at is itself a state',
    states.every((s) => FILING_STATES[s].every((to) => states.includes(to))));
  t('the terminal states are terminal', ['awarded', 'rejected', 'withdrawn'].every((s) => FILING_STATES[s].length === 0));
  t('nothing reaches submitted except through ready', states.filter((s) => FILING_STATES[s].includes('submitted')).join() === 'ready');
  t('a filing cannot go straight from queued to submitted', !FILING_STATES.queued.includes('submitted'));
  t('a failed filing can be retried', FILING_STATES.failed.includes('queued'));
  t('withdrawing is reachable from every live state',
    ['queued', 'needs_input', 'ready'].every((s) => FILING_STATES[s].includes('withdrawn')));
  t('but not from a decided one', !FILING_STATES.awarded.includes('withdrawn') && !FILING_STATES.rejected.includes('withdrawn'));

  /* Reachability: a state nothing points at is a state the product can never
     show, which is a bug that reads as a feature in the code. */
  const reachable = new Set(['queued']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of [...reachable]) for (const to of FILING_STATES[s]) if (!reachable.has(to)) { reachable.add(to); grew = true; }
  }
  const orphans = states.filter((s) => !reachable.has(s));
  t(`every state is reachable from queued (orphans: ${orphans.join(', ') || 'none'})`, orphans.length === 0);
}

/* ---- authority is not optional ------------------------------------ */
{
  const create = src.slice(src.indexOf('async function handleFilingCreate'), src.indexOf('async function handleFilingList'));
  t('queueing refuses without an authorisation id', /authorisation_id is required/.test(create));
  t('and re-checks the authority per programme, not once', /for \(const p of items\)[\s\S]{0,400}liveAuthorisation\(/.test(create));
  t('a duplicate live filing is refused rather than double-submitted', /already_in_flight/.test(create));
  t('and the batch is bounded', /at most 100 filings/.test(create));

  const advance = src.slice(src.indexOf('async function handleFilingAdvance'), src.indexOf('async function handleFilingEvents'));
  t('an illegal transition is refused with the legal ones named', /illegal_transition/.test(advance) && /allowed/.test(advance));
  t('authority is re-checked on every advance, not just at queue time', /liveAuthorisation\(/.test(advance));
  t('except when stopping, because stopping must always be possible',
    /to !== 'withdrawn' && to !== 'failed'/.test(advance));

  const live = src.slice(src.indexOf('async function liveAuthorisation'), src.indexOf('/** POST /api/enterprise/authorisations'));
  t('a revoked authority fails the check', /revoked_at\) return \{ ok: false, code: 'authorisation_revoked'/.test(live));
  t('an expired one fails too', /expires_at < Date\.now\(\)/.test(live));
  t('and a programme outside the scope fails', /programme_out_of_scope/.test(live));
}

/* ---- revoking actually stops things ------------------------------- */
{
  const revoke = src.slice(src.indexOf('async function handleAuthorisationRevoke'), src.indexOf('async function handleFilingCreate'));
  t('revoking withdraws everything still in flight', /state IN \('queued','preparing','needs_input','ready'\)/.test(revoke));
  t('and records each withdrawal in the trail', /recordEvent\(/.test(revoke));
  t('but does not pretend to retract what was already filed', /cannot unsend/.test(revoke));
  t('only an owner or admin may revoke', /not_authorised_to_sign/.test(revoke));
}

/* ---- who may sign ------------------------------------------------- */
{
  const create = src.slice(src.indexOf('async function handleAuthorisationCreate'), src.indexOf('/** GET /api/enterprise/authorisations'));
  t('a seat holder cannot bind the company', /role !== 'owner' && gate\.role !== 'admin'/.test(create));
  t('the signatory name and role are required', /the name and role of the person signing are required/.test(create));
  t('a blanket authorisation is refused', /must name at least one programme/.test(create));
  t('the scope is bounded', /at most 200 programmes/.test(create));
  t('the signature is stamped with time, ip and agent', /signed_ip/.test(create) && /signed_ua/.test(create));
  t('and it expires', /expires_at/.test(create) && /months/.test(create));
}

/* ---- the org boundary --------------------------------------------- */
{
  /* Which grants a company is chasing is strategy. Every query that touches a
     filing must be scoped to the org, and a missing scope is a data leak
     rather than a slow query. */
  /* Extract WHOLE sql string literals rather than a fixed window around the
     verb. A window truncates the long UPDATE before its WHERE clause and then
     reports a scoped query as unscoped — a test that fails on formatting is a
     test nobody trusts the third time. */
  const region = src.slice(src.indexOf('const FILING_STATES'), src.indexOf('/* Admin — one operator login'));
  const literals = [...region.matchAll(/`([^`]*)`|'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1] ?? m[2] ?? '')
    .filter((q) => /\b(FROM|UPDATE|INTO)\s+(filings|application_events)\b/i.test(q));
  const unscoped = literals.filter(
    (q) => /FROM filings|UPDATE filings|FROM application_events/i.test(q) && !/org_id/i.test(q),
  );
  t(`the filing queries were actually found (${literals.length})`, literals.length >= 5);
  t(`every filing query is org-scoped (unscoped: ${unscoped.length})`, unscoped.length === 0);
  t('filing requires an org at all', /no_organisation/.test(src));
}

/* ---- the trail is append-only ------------------------------------- */
{
  t('events are only ever inserted', !/UPDATE application_events|DELETE FROM application_events/.test(src));
  t('and record who did it', /actor/.test(src.slice(src.indexOf('async function recordEvent'), src.indexOf('async function liveAuthorisation'))));

  const mig = fs.readFileSync(new URL('migrations/0007_filings.sql', ROOT), 'utf8');
  t('the schema forbids a filing with no authority', /authorisation_id TEXT NOT NULL/.test(mig));
  t('and enforces one live filing per programme in the database, not just the UI',
    /CREATE UNIQUE INDEX[\s\S]{0,200}filings\(org_id, programme_slug\)/.test(mig));
  t('the queue table is not called applications, which already exists', /CREATE TABLE IF NOT EXISTS filings/.test(mig) && !/CREATE TABLE IF NOT EXISTS applications/.test(mig));
}

/* ---- the screen --------------------------------------------------- */
{
  const dash = fs.readFileSync(new URL('src/pwa/dashboard.js', ROOT), 'utf8');
  t('the workspace has an auto-file screen', /filing: filingView/.test(dash));
  t('and it is in the navigation', /\['filing', 'Auto-file'\]/.test(dash));
  t('filings are read from the server, not the workspace document', /\/api\/enterprise\//.test(dash));
  t('a personal account is told why it cannot file rather than shown an error', /needs a business account/.test(dash));
  t('refusals are surfaced rather than swallowed', /alertRefusals/.test(dash));
  t('the audit trail is viewable from the row', /data-act="trail"/.test(dash));
  t('revoking says what it does and does not do', /cannot unsend/.test(dash));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
