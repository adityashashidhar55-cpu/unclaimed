/**
 * /startups/readiness/ — the grant readiness quiz.
 *
 * ~10 short questions about the company (incorporation, age, staff, R&D
 * activity, co-funding, prior de minimis aid, banking, financial statements,
 * IP, team CVs), scored client-side into a plain readiness band with
 * specific next steps — never a probability of winning any named grant,
 * which nobody, including this quiz, can honestly claim to know.
 *
 * Entirely client-side, like src/pages/de-minimis.mjs: the answers are
 * personal to a real company (staff count, whether accounts exist), so
 * nothing here is sent anywhere, and there is no server-side scoring to keep
 * in sync with this file.
 *
 * English-only, like the rest of /startups/**.
 */
import { layout } from '../ui.mjs';

function breadcrumbs(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((it) => (it.href ? `<a href="${it.href}">${it.label}</a>` : `<span aria-current="page">${it.label}</span>`))
    .join('')}</nav>`;
}

/**
 * Each question is a single select. `weight` is added to the score when the
 * chosen option's own `w` is truthy-nonzero; `flag` (optional) names a
 * specific gap the results screen can link a next step to.
 */
const QUESTIONS = [
  {
    id: 'incorporated',
    q: 'Is the company formally incorporated?',
    options: [
      { v: 'yes', label: 'Yes, registered', w: 2 },
      { v: 'in_progress', label: 'In progress', w: 1 },
      { v: 'no', label: 'Not yet', w: 0, flag: 'incorporation' },
    ],
  },
  {
    id: 'age',
    q: 'How long has the company been trading?',
    options: [
      { v: 'lt1', label: 'Under 1 year', w: 1 },
      { v: '1to3', label: '1–3 years', w: 2 },
      { v: '3to5', label: '3–5 years', w: 2 },
      { v: 'gt5', label: 'Over 5 years', w: 1, flag: 'age_ceiling' },
    ],
  },
  {
    id: 'staff',
    q: 'How many people work at the company (including founders)?',
    options: [
      { v: '1to5', label: '1–5', w: 2 },
      { v: '6to20', label: '6–20', w: 2 },
      { v: '21to50', label: '21–50', w: 1 },
      { v: 'gt50', label: 'Over 50', w: 1, flag: 'headcount_ceiling' },
    ],
  },
  {
    id: 'rd',
    q: 'Does the company carry out R&D or technical development activity?',
    options: [
      { v: 'yes', label: 'Yes', w: 2 },
      { v: 'some', label: 'Some, not the main activity', w: 1 },
      { v: 'no', label: 'No', w: 0, flag: 'rd' },
    ],
  },
  {
    id: 'cofunding',
    q: 'Could the company fund a share of costs itself if a grant required co-funding?',
    options: [
      { v: 'yes', label: 'Yes', w: 2 },
      { v: 'maybe', label: 'Maybe, depends on the amount', w: 1 },
      { v: 'no', label: 'No', w: 0, flag: 'cofunding' },
    ],
  },
  {
    id: 'de_minimis',
    q: 'Has the company received other small public grants or tax breaks before?',
    options: [
      { v: 'no', label: 'No', w: 2 },
      { v: 'yes_tracked', label: 'Yes, and we track the total', w: 2 },
      { v: 'yes_untracked', label: "Yes, but we haven't tracked the total", w: 0, flag: 'de_minimis' },
    ],
  },
  {
    id: 'bank',
    q: 'Does the company have a business bank account in its own name?',
    options: [
      { v: 'yes', label: 'Yes', w: 2 },
      { v: 'no', label: 'Not yet', w: 0, flag: 'bank' },
    ],
  },
  {
    id: 'accounts',
    q: 'Does the company have at least one set of filed financial statements?',
    options: [
      { v: 'yes', label: 'Yes', w: 2 },
      { v: 'no', label: 'Not yet — too new, or not filed', w: 0, flag: 'accounts' },
    ],
  },
  {
    id: 'ip',
    q: 'Does the company own (not license) the IP behind its product?',
    options: [
      { v: 'yes', label: 'Yes', w: 2 },
      { v: 'partial', label: 'Partly — some licensed-in', w: 1 },
      { v: 'no', label: "No, or we haven't checked", w: 0, flag: 'ip' },
    ],
  },
  {
    id: 'cvs',
    q: 'Can the founding team show relevant CVs or track record for this venture?',
    options: [
      { v: 'yes', label: 'Yes, a strong fit', w: 2 },
      { v: 'some', label: 'Some relevant experience', w: 1 },
      { v: 'no', label: 'Not really', w: 0, flag: 'cvs' },
    ],
  },
];

const MAX_SCORE = QUESTIONS.reduce((n, q) => n + Math.max(...q.options.map((o) => o.w)), 0);

/** flag -> a specific, honest next step, each linking to a real page on this site. */
const NEXT_STEPS = {
  incorporation: 'Most grants require a registered legal entity before you apply — incorporating is usually the first blocking step.',
  age_ceiling: 'Many startup grants cap company age (often 3–5 years). Check each programme\'s own age limit rather than assuming — some have none.',
  headcount_ceiling: 'EU state-aid rules define SME size bands by headcount and turnover; above them you may fall out of "SME-only" programmes. Check the specific ceiling on each programme page.',
  rd: 'R&D grants specifically require R&D activity — if that is not what the company does, look at non-R&D instruments (vouchers, trade grants) instead.',
  cofunding: 'Co-funding requirements vary by programme — some are 100% funded, others require you to match a share. Filter for that before applying.',
  de_minimis: 'If the company has taken small public grants before without tracking the running total, check EU de minimis headroom before applying for another — a new award that pushes you over the ceiling can be disqualified in full, not trimmed.',
  bank: 'A business bank account in the company\'s name is usually required before a grant is paid out, even if not before applying.',
  accounts: 'Some programmes want at least one filed set of accounts; very early companies without any should look specifically for pre-revenue or first-year schemes.',
  ip: 'Funders often ask who owns the IP behind the product — get this documented before it becomes a diligence question.',
  cvs: 'A team-CV or track-record section is standard in most applications — prepare it in advance rather than under deadline pressure.',
};

/** flag -> the page on this site that helps close that specific gap. */
const NEXT_STEP_LINKS = {
  age_ceiling: { path: '/startups/check/', label: 'Check age limits on matching programmes' },
  headcount_ceiling: { path: '/startups/check/', label: 'Check size limits on matching programmes' },
  rd: { path: '/startups/check/', label: 'Find non-R&D programmes you match' },
  cofunding: { path: '/startups/check/', label: 'Compare co-funding across matching programmes' },
  de_minimis: { path: '/startups/de-minimis/', label: 'Work out your de minimis headroom' },
  accounts: { path: '/startups/closing-soon/', label: 'See what is open right now' },
};

export function renderReadinessPage({ BASE, LB, SB, SITE_URL }) {
  const links = Object.fromEntries(
    Object.entries(NEXT_STEP_LINKS).map(([k, v]) => [k, { href: `${SB()}${v.path}`, label: v.label }]),
  );
  const dataPayload = JSON.stringify({
    questions: QUESTIONS,
    nextSteps: NEXT_STEPS,
    nextStepLinks: links,
    maxScore: MAX_SCORE,
    base: SB(),
  }).replace(/</g, '\\u003c');

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([
    { label: 'Home', href: `${LB()}/` },
    { label: 'Startup grants', href: `${SB()}/startups/` },
    { label: 'Grant readiness quiz' },
  ])}
  <span class="eyebrow eyebrow-accent">For founders</span>
  <h1 style="max-width:22ch">Is your company ready to apply for a startup grant?</h1>
  <p class="lede" style="max-width:60ch">Ten short questions about the things funders actually check — incorporation,
  age, headcount, R&D activity, co-funding, prior state aid, banking, accounts, IP and your team. Runs entirely in
  your browser; nothing you answer is sent anywhere or saved.</p>

  <div class="card" id="readiness-app" style="margin-top:2rem" data-payload="readiness-data">
    <noscript><p><strong>This quiz needs JavaScript</strong> to score your answers in your browser.</p></noscript>
  </div>
  <script type="application/json" id="readiness-data">${dataPayload}</script>
  <script type="module" src="${BASE}/readiness.js"></script>

  <p class="tiny" style="margin-top:2rem;max-width:64ch">This is a rough self-check, not a decision by any funder — every
  real grant has its own eligibility rules, which this quiz does not check. Use <a class="link-underline" href="${SB()}/startups/check/">the
  full check</a> to match against actual programmes once you've closed the gaps below.</p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: 'en',
    altLangs: [],
    title: 'Grant readiness quiz for startups',
    description: 'A 10-question self-check on whether your company is ready to apply for startup grants — incorporation, age, R&D, co-funding, prior state aid, accounts, IP and team. Runs in your browser.',
    canonical: `${SITE_URL}/startups/readiness/`,
    audience: 'biz',
    body,
  });
}
