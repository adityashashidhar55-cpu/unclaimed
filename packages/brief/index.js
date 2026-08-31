/**
 * The brief a generated document is written from.
 *
 * The competition in this market submits a deck that could have been written
 * for any funder, because it was. What makes a grant application land is
 * answering the criteria the funder actually published, in the order they
 * published them, with the applicant's own numbers in the places the funder
 * asks for numbers. None of that is a writing problem — it is an assembly
 * problem, and assembly is deterministic.
 *
 * So the model is never handed "write a pitch deck for this grant". It is
 * handed a brief: the funder's own words, the specific eligibility rules this
 * company clears and the ones it does not, the required documents, the
 * deadline, the co-funding the company must find, and the sections the output
 * must contain. Everything in it comes from the programme record or the
 * company profile. Nothing is invented here, and the same rule the rest of
 * this codebase runs on applies: no amount appears that is not in
 * amount_min / amount_max.
 *
 * The reason this file has no model call in it is that the brief is the part
 * worth testing. A prompt you cannot assert on is a prompt that quietly
 * degrades.
 */

import { amountShape, amountSentence, KIND } from '../amounts/index.js';
import { deadlineState, effectiveStatus } from '../deadlines/index.js';

/** What each generator must produce, section by section. */
export const OUTLINES = Object.freeze({
  deck: [
    'The problem, in the funder’s own framing',
    'What we are building',
    'Why this programme, specifically',
    'Traction and evidence',
    'The team',
    'What the money is for',
    'Milestones against the funder’s assessment criteria',
    'Risks and how they are managed',
  ],
  narrative: [
    'Summary',
    'Objectives',
    'Method and workplan',
    'Fit with the programme’s stated priorities',
    'Expected impact',
    'Capability to deliver',
  ],
  budget: [
    'Cost lines',
    'Justification per line',
    'Co-funding and where it comes from',
    'Value for money',
  ],
  cover_letter: ['Opening', 'Why us, why this call', 'What we are asking for', 'Close'],
  review: ['What is strong', 'What the funder will object to', 'What is missing', 'Line edits'],
});

/**
 * Eligibility, sorted into what this company clears, what it fails, and what
 * we still do not know.
 *
 * The unknowns are the most useful third and the one everybody drops. A deck
 * that quietly omits the question the funder will ask first is worse than one
 * that flags it, because the applicant finds out at the assessment stage.
 */
export function eligibilityBrief(verdict) {
  return {
    verdict: verdict?.verdict ?? 'unknown',
    fails: verdict?.fails ?? [],
    unknowns: verdict?.unknowns ?? [],
    sme_category: verdict?.sme_category ?? null,
  };
}

/** Only fields the company actually filled in. A profile full of nulls
 *  rendered into a brief invites the model to fill them in itself. */
export function companyFacts(profile = {}) {
  const keep = [
    'name', 'country_code', 'incorporation_date', 'headcount', 'stage',
    'sectors', 'turnover_annual_eur', 'balance_sheet_eur', 'rd_active',
    'has_local_entity', 'female_founder', 'underrepresented', 'summary',
  ];
  const out = {};
  for (const k of keep) {
    const v = profile[k];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * What the funder said, as the funder said it.
 *
 * `source_snippet` is quoted rather than paraphrased because it is the
 * evidence the whole record rests on, and because a paraphrase of a funder's
 * criterion is how an application ends up answering a question nobody asked.
 */
export function funderFacts(programme, asOf = Date.now()) {
  const shape = amountShape(programme);
  const deadline = deadlineState(programme, asOf);
  return {
    name: programme.name_en || programme.name_local,
    name_local: programme.name_local ?? null,
    funder: programme.funder,
    country: programme.country_code ?? null,
    instrument: programme.grant_type ?? programme.benefit_type ?? null,
    status: effectiveStatus(programme, asOf),
    /* "Status not published" is the deadline module's honest answer and it is
       noise in a brief — it tells the model nothing and invites it to write a
       sentence about the absence. Dropped rather than passed through. */
    deadline: deadline?.headline && !/not published/i.test(deadline.headline) ? deadline.headline : null,
    deadline_detail: deadline?.detail && !/not published/i.test(deadline.detail) ? deadline.detail : null,
    closes_at: programme.closes_at ?? null,
    /* The award, in whatever shape it genuinely has. A deck that states a
       figure the funder never published is the failure mode this whole
       codebase is built to avoid, so `amount_stated` is null unless the
       record carries structured money. */
    amount_stated:
      shape.kind === KIND.FLAT || shape.kind === KIND.RANGE
        ? { min: programme.amount_min ?? null, max: programme.amount_max ?? null, currency: programme.amount_currency ?? null, period: programme.amount_period ?? null }
        : null,
    amount_described: amountSentence(programme),
    cofunding_pct: programme.cofunding_pct ?? null,
    /* Flattened here rather than in the renderer, because both are arrays of
       OBJECTS — {step, detail, url} and {doc, mandatory, note} — and a
       template that interpolates them lands "[object Object]" in the brief,
       which the model then dutifully writes around. */
    steps: (programme.procedure_steps ?? []).map((s, i) =>
      typeof s === 'string' ? s : `${s.step ?? i + 1}. ${s.detail ?? ''}${s.url ? ` (${s.url})` : ''}`.trim()),
    documents: (programme.documents_required ?? []).map((d) =>
      typeof d === 'string' ? d : `${d.doc ?? ''}${d.mandatory === false ? ' (optional)' : ''}${d.note ? ` — ${d.note}` : ''}`.trim()),
    official_words: programme.source_snippet ?? null,
    source_url: programme.source_url ?? null,
    application_url: programme.application_url ?? null,
  };
}

/**
 * The rules the generated document must not break.
 *
 * Sent with every brief, in the payload rather than only in a system prompt,
 * so that they survive a caller who assembles the request differently. They
 * are the same rules the site is held to: the difference between a tool that
 * helps you apply and one that makes claims on your behalf.
 */
export const RULES = Object.freeze([
  'State no monetary amount that is not in amount_stated. If amount_stated is null, describe the award in words and do not put a number on it.',
  'Do not claim the application will succeed, or that the funder will award anything. The decision is the funder’s.',
  'Do not invent traction, revenue, headcount, customers, partners or awards. Use only the figures in company facts.',
  'Where a required fact is missing, write a clearly marked placeholder the applicant must fill in. Never guess it.',
  'Answer the funder’s published criteria in the funder’s own order and vocabulary.',
  'Quote the funder’s own words where they set a test, and mark the quote as theirs.',
]);

/**
 * Assemble the brief.
 *
 * `type` picks the outline; everything else is the same for every generator,
 * which is deliberate. One brief, many outputs, so a fix to how eligibility is
 * summarised improves the deck and the narrative and the review at once.
 */
export function buildBrief({ type, programme, profile = {}, verdict = null, asOf = Date.now(), lang = 'en' }) {
  const outline = OUTLINES[type];
  if (!outline) return { ok: false, error: 'unknown_type', message: `No outline for ${type}` };
  if (!programme) return { ok: false, error: 'no_programme', message: 'A brief needs a programme.' };

  const company = companyFacts(profile);
  const funder = funderFacts(programme, asOf);

  /* What the applicant still has to supply. Computed rather than left to the
     model, so the same gaps are reported whether or not the model notices
     them, and so the dashboard can ask for them before spending a unit. */
  const missing = [];
  if (!company.name) missing.push('company name');
  if (!company.summary) missing.push('one-line description of what the company does');
  if (funder.cofunding_pct != null && company.turnover_annual_eur == null) {
    missing.push('turnover, to show the co-funding can be met');
  }
  for (const u of verdict?.unknowns ?? []) missing.push(u);

  /* A hard eligibility failure is a refusal, not a warning.
   *
   * The whole complaint about the incumbents in this market is that they
   * submit decks into calls the applicant cannot win, and bill for it. A unit
   * spent on a programme restricted to series_a companies, for a seed company,
   * is worse than a unit not spent: it produces a document that reads
   * plausible and cannot succeed. `unknowns` are different — those are
   * questions the company has not answered yet, and the brief carries them
   * through as placeholders. */
  if (verdict?.verdict === 'not_eligible' && (verdict.fails ?? []).length) {
    return {
      ok: false,
      error: 'not_eligible',
      message: `This company does not meet the programme's own rules, so nothing is generated: ${verdict.fails.join('; ')}.`,
      fails: verdict.fails,
    };
  }
  if (verdict?.verdict === 'closed') {
    /* Closed is not a refusal. The next round is a date, and a document
       written now for a call that reopens in March is the single most useful
       thing this product can do with a closed programme. */
  }

  return {
    ok: true,
    type,
    lang,
    outline,
    rules: RULES,
    funder,
    company,
    eligibility: eligibilityBrief(verdict),
    missing: [...new Set(missing)],
    /* A closed programme is still worth writing for — the next round is a
       date, not a rejection — but the document has to say so rather than
       address a call that is not open. */
    write_for_next_round: funder.status === 'closed' || funder.status === 'paused',
  };
}

/**
 * A stable, human-readable rendering of the brief.
 *
 * Used as the model's user message, and printed in the dashboard so a
 * customer can see exactly what was sent before they spend a unit on it. A
 * generation whose input is hidden is a generation nobody can debug.
 */
export function briefText(brief) {
  if (!brief?.ok) return '';
  const L = [];
  const section = (title, body) => { if (body) { L.push(`## ${title}`, body, ''); } };
  const list = (xs) => (xs && xs.length ? xs.map((x) => `- ${x}`).join('\n') : null);

  L.push(`# Brief: ${brief.type}`, '');
  section('Funder and programme', [
    `Programme: ${brief.funder.name}${brief.funder.name_local && brief.funder.name_local !== brief.funder.name ? ` (${brief.funder.name_local})` : ''}`,
    `Funder: ${brief.funder.funder}`,
    brief.funder.instrument ? `Instrument: ${brief.funder.instrument}` : null,
    `Status: ${brief.funder.status}`,
    brief.funder.deadline ? `Deadline: ${brief.funder.deadline}` : null,
    brief.funder.cofunding_pct != null ? `Applicant must co-fund: ${100 - brief.funder.cofunding_pct}%` : null,
  ].filter(Boolean).join('\n'));

  section('The award', brief.funder.amount_stated
    ? `min ${brief.funder.amount_stated.min ?? '—'}, max ${brief.funder.amount_stated.max ?? '—'} ${brief.funder.amount_stated.currency ?? ''} ${brief.funder.amount_stated.period ?? ''}`.trim()
    : `No figure is published. ${brief.funder.amount_described ?? ''}`.trim());

  section('The funder’s own words', brief.funder.official_words ? `> ${brief.funder.official_words}` : null);
  section('Required steps', list(brief.funder.steps));
  section('Required documents', list(brief.funder.documents));
  section('Eligibility as assessed', [
    `Verdict: ${brief.eligibility.verdict}`,
    brief.eligibility.sme_category ? `SME category: ${brief.eligibility.sme_category}` : null,
    brief.eligibility.fails.length ? `Fails: ${brief.eligibility.fails.join('; ')}` : null,
    brief.eligibility.unknowns.length ? `Not yet answered: ${brief.eligibility.unknowns.join('; ')}` : null,
  ].filter(Boolean).join('\n'));

  section('Company facts', Object.entries(brief.company).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n'));
  section('Still missing — mark these as placeholders', list(brief.missing));
  section('Sections to produce, in order', list(brief.outline));
  section('Rules', list(brief.rules));
  if (brief.write_for_next_round) {
    section('Note', 'This call is not open. Write for the next round and say so in the opening.');
  }
  return L.join('\n').trim();
}
