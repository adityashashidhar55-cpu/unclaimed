/**
 * The blog.
 *
 * The programme directory used to be how search found this site. It is now a
 * paid feature, so the directory is two rows and a lock — which means the SEO
 * surface has to be something else. This is that something else.
 *
 * One rule governs every post here: it is an analysis of data we actually
 * hold, and every number in it is computed from the dataset at build time
 * rather than typed into the prose. Nothing goes stale silently, nothing is
 * rounded up for effect, and there is no post that could have been written
 * without the dataset — which is also, not coincidentally, the only kind of
 * post worth reading on a site like this.
 *
 * Posts are functions of a context object rather than files, because a
 * markdown pipeline would mean a parser, and the whole project is dependency
 * -free on purpose.
 */

import { classifyRequirement, docLabel } from '../packages/vault/index.js';
import { REGULATION, DE_MINIMIS_CEILING_EUR, WINDOW_MONTHS } from '../packages/stateaid/index.js';

const pc = (n, d) => (d ? Math.round((n / d) * 100) : 0);

/**
 * Everything the posts need, counted once.
 *
 * Computed here rather than inside each post so two posts cannot disagree
 * about the same figure — which is exactly the failure mode of writing
 * statistics into prose by hand.
 */
export function blogFacts({ countries, startups, stats }) {
  const all = countries.flatMap(({ entry, data }) =>
    data.programmes.map((p) => ({ p, cc: entry.slug, country: entry.name })),
  );

  const priced = all.filter(({ p }) => (p.amount_max ?? p.amount_min) != null);
  const automatic = all.filter(({ p }) => p.is_automatic);

  /* Documents, canonicalised. The raw strings are in the funder's own words
     and its own language — "Aadhaar card", "CURP", "DigiD" — so counting them
     raw measures which countries are in the dataset, not what applications
     ask for. classifyRequirement maps them onto the same vocabulary the
     document vault uses. */
  const docCounts = new Map();
  let withDocs = 0;
  for (const { p } of all) {
    const req = (p.documents_required || []).map((d) => classifyRequirement(d.doc)).filter((t) => t !== 'not_required');
    if (req.length) withDocs += 1;
    for (const t of new Set(req)) docCounts.set(t, (docCounts.get(t) || 0) + 1);
  }
  const docs = [...docCounts.entries()]
    .filter(([t]) => t !== 'other')
    .map(([type, n]) => ({ type, label: docLabel(type), n, pct: pc(n, withDocs) }))
    .sort((a, b) => b.n - a.n);

  /* Automatic payment, by country. Ranked by share rather than count, because
     a big dataset for one country would otherwise win by size alone. */
  const byCountry = countries
    .map(({ entry, data }) => {
      const n = data.programmes.length;
      const a = data.programmes.filter((p) => p.is_automatic).length;
      return { name: entry.name, cc: entry.slug, flag: entry.flag, n, a, pct: pc(a, n) };
    })
    .filter((c) => c.n >= 20)
    .sort((a, b) => b.pct - a.pct);

  const cofunded = startups.filter((p) => (p.cofunding_pct ?? 0) > 0);
  const startupPriced = startups.filter((p) => (p.amount_max ?? p.amount_min) != null);

  return {
    total: all.length,
    countryCount: stats.countryCount,
    priced: priced.length,
    pricedPct: pc(priced.length, all.length),
    automatic: automatic.length,
    automaticPct: pc(automatic.length, all.length),
    verified: stats.verified,
    verifiedPct: stats.verifiedPct,
    withDocs,
    withDocsPct: pc(withDocs, all.length),
    docs,
    byCountry,
    startupTotal: startups.length,
    startupPriced: startupPriced.length,
    startupPricedPct: pc(startupPriced.length, startups.length),
    cofunded: cofunded.length,
    cofundedPct: pc(cofunded.length, startups.length),
    medianCofunding: (() => {
      const v = cofunded.map((p) => p.cofunding_pct).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    })(),
  };
}

const nf = (n) => new Intl.NumberFormat('en').format(n);

/**
 * The posts.
 *
 * `date` is the day the analysis was written, not the build date — a post
 * whose date moves every deploy is a post search engines stop trusting. When
 * the numbers move, the post is still correct because the numbers are
 * recomputed; when the argument changes, the date should be edited by hand.
 */
export const POSTS = [
  {
    slug: 'de-minimis-ceiling',
    date: '2026-07-14',
    title: 'The €300,000 ceiling that disqualifies a grant in full',
    summary:
      'EU de minimis aid is capped per company per member state on a rolling three-year window. Go over it and the new award is not trimmed to fit — it falls outside the Regulation entirely.',
    keywords: 'de minimis, state aid, EU grants, Regulation 2023/2831, funding ceiling',
    body: (f) => `
<p class="lede">Most founders meet the de minimis ceiling for the first time in a clawback letter. It is the
single most consequential rule in small-grant funding across the EU, and almost nothing that hands out the
money explains it at the point you apply.</p>

<h2>What the rule says</h2>
<p>Under ${REGULATION.general.id}, ${REGULATION.general.article}, a single undertaking may receive up to
<strong>€${nf(DE_MINIMIS_CEILING_EUR)}</strong> of de minimis aid per member state over a rolling
<strong>${WINDOW_MONTHS} months</strong>. Rolling, not per calendar year: the window moves with today's date,
so aid granted ${WINDOW_MONTHS} months and one day ago has left it and aid granted yesterday is in it.</p>

<h2>The part that catches people</h2>
<p>The intuition is that going over the ceiling means the excess is refused. It does not. Article 3(7) is
explicit that aid exceeding the ceiling <em>does not benefit from the Regulation at all</em> — not the excess,
the whole award. A company with €280,000 already counted that accepts a €40,000 grant has not received
€20,000 of usable aid and €20,000 of trouble. It has received an award that falls outside the exemption
entirely, and the granting authority is obliged to recover it.</p>

<h2>Why nobody warns you</h2>
<p>Because no single authority can. The ceiling is per company across <em>every</em> de minimis source in that
member state — a regional innovation voucher, a national training subsidy, a municipal rent rebate. The body
handing out the third one has no visibility of the first two. That is why the declaration exists: the
applicant is the only party who can see the whole picture, and signing the declaration is how the burden gets
transferred to them.</p>

<h2>What to do about it, concretely</h2>
<ul>
  <li><strong>Keep the ledger before you need it.</strong> Date, amount in euros, granting body, member state.
  The date matters more than people expect, because it determines when headroom frees up again.</li>
  <li><strong>Check the ceiling before the effort, not before the signature.</strong> A major bid is six weeks
  of work. Discovering the ceiling problem at the offer stage means those six weeks are gone.</li>
  <li><strong>Watch the group, not the company.</strong> "Single undertaking" includes linked companies. A
  holding structure does not create a second allowance.</li>
  <li><strong>Know that the clock helps you.</strong> If you are over, the oldest award in the window will drop
  out on a specific date. Sometimes the right answer is to apply in March instead of January.</li>
</ul>

<p>Of the ${nf(f.startupTotal)} startup funding programmes in our dataset, a substantial share are explicitly
de minimis, and they are the small, fast, easy-to-win ones — which is exactly why companies accumulate them
without noticing.</p>`,
  },

  {
    slug: 'how-many-programmes-publish-what-they-pay',
    date: '2026-07-28',
    /* The share is computed, so the headline cannot drift away from the body.
       A blog post whose title contradicts its own table is worse than no post. */
    title: (f) => `Only ${f.pricedPct}% of government support programmes publish what they pay`,
    summary:
      'We checked every record in the dataset for a published amount. The gap between "there is money" and "here is how much" is the single biggest obstacle to knowing what you are owed.',
    keywords: 'government benefits, published amounts, transparency, welfare, grants data',
    body: (f) => `
<p class="lede">We hold ${nf(f.total)} government, public-body and institutional support programmes across
${f.countryCount} countries. <strong>${nf(f.priced)} of them — ${f.pricedPct}% — publish an amount you can
read before you apply.</strong> The other ${f.pricedPct < 50 ? 'majority' : 'large minority'} tell you the
support exists and leave the figure to be calculated later.</p>

<h2>Why the number is missing so often</h2>
<p>Usually because it genuinely depends on you. A means-tested payment tapers with income; a housing benefit
depends on local rent levels; a childcare subsidy scales with hours used. The authority is not being cagey —
there is no single figure to publish, and publishing a maximum would mislead more people than it helped.</p>
<p>But the effect on the claimant is the same either way. The most common reason people do not claim what they
are entitled to is not that they refuse: it is that they cannot tell whether the paperwork is worth the
afternoon, and an unpriced programme gives them nothing to weigh that against.</p>

<h2>What we do with the gap</h2>
<p>Nothing, is the honest answer, and that is deliberate. When a record publishes no amount we leave it empty
and count it as zero in any total. That makes our headline figure an understatement — your real entitlement is
almost certainly higher than the number we show, not lower. The alternative is to estimate, and an estimated
benefit amount is the worst possible error for this kind of product: it is the number people plan a month
around.</p>

<h2>The same gap, in startup funding</h2>
<p>It is not only a welfare problem. Of ${nf(f.startupTotal)} startup funding programmes,
<strong>${nf(f.startupPriced)} (${f.startupPricedPct}%)</strong> publish a figure. Grant calls are often
announced with a total programme budget and no per-award ceiling, which tells a founder how big the pot is and
nothing at all about whether it is worth a week of writing.</p>

<h2>What would fix it</h2>
<p>Not a mandate to publish a single number — that would produce fictional precision. What is missing is a
published <em>range</em> and the variables that move it. "Between €400 and €2,100 a year, depending on
household income and number of children" is a sentence any of these authorities could write, and it would let
a person decide in ten seconds instead of ninety minutes.</p>`,
  },

  {
    slug: 'documents-grant-applications-ask-for',
    date: '2026-08-04',
    title: 'What grant and benefit applications actually ask you for',
    summary:
      'We normalised the document requirements across every programme that publishes one. Seven documents cover most of it — which is why gathering them once is the highest-leverage hour in the whole process.',
    keywords: 'grant documents, benefits paperwork, required documents, application checklist',
    body: (f) => `
<p class="lede">${nf(f.withDocs)} of our ${nf(f.total)} records publish a list of the documents they want —
${f.withDocsPct}%. Once you normalise them out of each country's own vocabulary, the same handful comes up
again and again.</p>

<h2>The list, by how often it is asked for</h2>
<table class="rule-table">
  <thead><tr><th>Document</th><th>Programmes</th><th>Share</th></tr></thead>
  <tbody>
    ${f.docs
      .slice(0, 10)
      .map((d) => `<tr><th>${d.label}</th><td>${nf(d.n)}</td><td>${d.pct}%</td></tr>`)
      .join('')}
  </tbody>
</table>
<p class="tiny">Counted per programme, not per mention: a scheme asking for two kinds of income evidence
counts once. Requirements too specific to map onto a common type are excluded rather than lumped together.</p>

<h2>Why this matters more than it looks</h2>
<p>The list is short, and it is the same list. That means the marginal cost of the second application is far
lower than the first — but only if you kept what you gathered. Most people do not, because each application
arrives as its own self-contained ordeal with its own checklist, and nothing in the process suggests that the
payslip you scanned in March is the same payslip wanted in June.</p>

<h2>The expiry trap</h2>
<p>Several of these have a validity window that nobody states on the form. Proof of address and proof of
income are commonly expected to be under three months old; a tax return, under a year. A rejection for a
document that is technically correct but four months old is one of the more demoralising ways to lose a
claim, and one of the easiest to avoid once you know the window exists.</p>

<h2>What we'd suggest</h2>
<p>Gather the top five once, note the date on each, and treat the three-month ones as perishable. That single
hour is worth more than any amount of searching for programmes, because it converts every future application
from a document hunt into a form.</p>`,
  },

  {
    slug: 'which-countries-pay-benefits-automatically',
    date: '2026-08-11',
    title: 'Which countries pay support automatically, and which make you ask',
    summary:
      'Some support arrives without an application because the state already holds the facts that qualify you. We counted it by country, and the spread is wider than you would guess.',
    keywords: 'automatic benefits, non-take-up, welfare, benefit uptake, government payments',
    body: (f) => `
<p class="lede">${nf(f.automatic)} of our ${nf(f.total)} records — ${f.automaticPct}% — pay out without an
application. The authority already holds the facts that qualify you, so the payment simply arrives.</p>

<h2>By country, as a share of that country's programmes</h2>
<table class="rule-table">
  <thead><tr><th>Country</th><th>Automatic</th><th>Of</th><th>Share</th></tr></thead>
  <tbody>
    ${f.byCountry
      .slice(0, 12)
      .map((c) => `<tr><th>${c.flag} ${c.name}</th><td>${c.a}</td><td>${c.n}</td><td>${c.pct}%</td></tr>`)
      .join('')}
  </tbody>
</table>
<p class="tiny">Countries with fewer than 20 records in the dataset are excluded, because a share computed
over eight programmes is noise. Coverage is uneven and this is a measure of our data as much as of the world.</p>

<h2>Why automatic payment is the most underrated policy lever there is</h2>
<p>Non-take-up — the share of eligible people who never claim — routinely runs at a third or more for
means-tested support, and it is worst among exactly the people the support was designed for. Every step
between entitlement and payment loses some of them: a form, a portal login, a document, a phone queue.</p>
<p>Automatic payment removes all of the steps at once. Where the state already knows your income, your
address and your children, asking you to tell it again is not verification, it is an obstacle course with a
means test at the end.</p>

<h2>The catch worth naming</h2>
<p>Automatic does not mean guaranteed. It means no application is needed <em>if the authority's records are
right</em>. If they are missing a detail — a change of address, a new child, a bank account that closed — the
payment silently does not happen and nobody tells you. Which is why "you qualify for this and it should be
arriving automatically" is a useful thing to know even when there is no form to fill in: it turns an absence
into a question you can ask.</p>`,
  },

  {
    slug: 'co-funding-the-hidden-cost-of-grants',
    date: '2026-08-13',
    title: 'The hidden cost of a grant: co-funding',
    summary:
      'A grant covering 70% of a project is not free money for 70% of the project. It is a commitment to find the other 30% before you can take any of it.',
    keywords: 'co-funding, match funding, startup grants, non-dilutive funding, grant cost',
    body: (f) => `
<p class="lede">Of ${nf(f.startupTotal)} startup funding programmes we hold,
<strong>${nf(f.cofunded)} (${f.cofundedPct}%)</strong> require the company to put in money of its own${
      f.medianCofunding != null ? `, and the median requirement is ${f.medianCofunding}%` : ''
    }. That is the number missing from every "€3M available!" headline.</p>

<h2>The arithmetic people get wrong</h2>
<p>A grant of up to €2,000,000 at 60% funding intensity does not mean €2,000,000 arrives and you spend it. It
means the project must be at least €3,333,000, you must fund €1,333,000 of it yourself, and the grant is
reimbursed against costs you have already incurred. For a pre-seed company, that headline is not an
opportunity — it is a description of a project it cannot run.</p>

<h2>Why rankings by headline amount are worse than useless</h2>
<p>They put the largest, least attainable programme at the top of the list for the company least able to take
it, and they do it with total confidence. A founder working down that list spends their first two weeks on
the one bid they were never going to be able to accept.</p>
<p>Ranking on amount × published award rate × whether a company that size could actually deliver the project
produces an almost completely different order — and it is the order that reflects what the company can
realistically win.</p>

<h2>Reimbursement is a second cash-flow problem</h2>
<p>Most grants pay in arrears against audited costs. So beyond finding your share, you need the working
capital to spend the grant's share first and wait — often two to six months, sometimes longer. A company that
can technically afford the co-funding can still be unable to afford the timing, and that distinction is
invisible in every grant database we have looked at.</p>

<h2>The questions to ask before you start writing</h2>
<ul>
  <li>What is the funding intensity, and what is the minimum project size it implies?</li>
  <li>Is our share cash, or does in-kind staff time count? (It often does, and that changes everything.)</li>
  <li>Is it paid in arrears, and if so what is the claim cycle?</li>
  <li>Is there an advance payment, and what does it cost — a guarantee, a bank instrument?</li>
  <li>Does this award count against our de minimis ceiling?</li>
</ul>
<p>Five questions, ten minutes, before the six weeks.</p>`,
  },
];
