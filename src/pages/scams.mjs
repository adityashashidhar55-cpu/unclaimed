/**
 * /scams/ — how to spot a fake grant offer, and where to report one.
 *
 * English-only, like /compare/ and /browse/: an acquisition/reference page,
 * not a surface a non-English reader arrives at directly through the wizard.
 *
 * Every reporting link below was checked with a live fetch on 2026-09-25 (see
 * FACTS_CHECKED) and is the destination as verified then — re-check before
 * changing a URL and bump the date.
 */
import { esc, disclaimerBar } from '../ui.mjs';

export const FACTS_CHECKED = '2026-09-25';

function breadcrumbs(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((it) => (it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span aria-current="page">${esc(it.label)}</span>`))
    .join('')}</nav>`;
}

function breadcrumbLd(origin, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.label,
      item: it.href ? `${origin}${it.href}` : undefined,
    })),
  };
}

/* Reporting bodies, verified live. `note` states exactly what was confirmed
   on the page fetched, so this list cannot silently drift into a claim about
   a site nobody re-checked. */
const REPORTING = [
  {
    country: 'United States',
    body: 'Federal Trade Commission — ReportFraud.ftc.gov',
    url: 'https://reportfraud.ftc.gov/',
    note: 'The FTC\'s official site for reporting fraud, scams and bad business practices, confirmed live on the .gov domain.',
  },
  {
    country: 'United Kingdom',
    body: 'Action Fraud (the UK\'s national fraud and cyber crime reporting centre)',
    url: 'https://www.actionfraud.police.uk/',
    note: 'Confirmed live. A newer Report Fraud service at reportfraud.police.uk also takes reports for England, Wales and Northern Ireland; in Scotland, report to Police Scotland on 101.',
  },
  {
    country: 'France',
    body: 'Cybermalveillance.gouv.fr (assistance and advice) and SignalConso (report a scam offer)',
    url: 'https://www.cybermalveillance.gouv.fr/',
    url2: 'https://signal.conso.gouv.fr/',
    note: 'Both are French government services, confirmed live; SignalConso is the DGCCRF\'s consumer-complaint portal.',
  },
  {
    country: 'European Union',
    body: 'OLAF — the European Anti-Fraud Office',
    url: 'https://anti-fraud.ec.europa.eu/olaf-and-you/report-fraud_en',
    note: 'Confirmed live: OLAF takes anonymous reports of fraud against EU funds, in any official EU language.',
  },
  {
    country: 'India',
    body: 'National Cyber Crime Reporting Portal',
    url: 'https://cybercrime.gov.in/',
    note: 'Confirmed live: the Indian government\'s portal for reporting cybercrime, including fraud, run by I4C.',
  },
];

export function scamsPage({ BASE, SITE_URL, ORIGIN, layout, TR }) {
  const crumbs = breadcrumbs([{ label: 'Home', href: `${BASE}/` }, { label: 'Grant scams' }]);

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell-narrow">
  ${crumbs}
  <span class="eyebrow eyebrow-accent">Safety</span>
  <h1 style="max-width:22ch">How to spot a fake grant offer</h1>
  <p class="lede">Every real programme on this site links to an official government or institutional source. Scammers
  copy that language — "government grant", "approved", "free money" — to sell you the opposite. The rule that catches
  almost all of them: <strong>no real government grant ever asks you to pay a fee to receive it.</strong></p>

  <div class="callout callout--sage" style="margin-top:1.6rem">
    <p><strong>The one-line test.</strong> If someone contacts you first — by phone, text, email or social media —
    claiming you have been "selected" for a grant, and asks for a processing fee, a tax payment, gift cards, or your
    bank login to "release the funds", it is a scam. A real grant application is something you go looking for, on the
    funder's own official page, and a genuine award never requires you to pay first.</p>
  </div>

  <h2 style="margin-top:2.6rem">Signs of a fake grant offer</h2>
  <ul class="ticks">
    <li><strong>They contacted you first.</strong> Government agencies and legitimate funders do not cold-call, text
    or DM people to offer them a grant out of nowhere.</li>
    <li><strong>Any request for money up front</strong> — an "administration fee", "tax", "insurance", gift cards, or
    a wire transfer — before you receive anything. This is the single most reliable signal.</li>
    <li><strong>Pressure to act immediately</strong>, or a claim the offer expires in hours. Real deadlines are
    published on the funder's own page, in advance, for everyone.</li>
    <li><strong>A request for your bank login, one-time passcode, or full card number</strong> to "verify" you or
    "release" the money. No legitimate funder needs your online banking password.</li>
    <li><strong>The sender's address doesn't match the agency it claims to be.</strong> A message claiming to be from
    a national government body sent from a free email address (Gmail, Outlook, WhatsApp) rather than that body's own
    domain is a red flag.</li>
    <li><strong>It cannot be found on the funder's own official page.</strong> Search the programme name plus the
    funder's name yourself, on the funder's own domain — never through a link the message gave you.</li>
  </ul>

  <h2 style="margin-top:2.6rem">What to do</h2>
  <ul class="ticks">
    <li>Do not click the link, call the number, or reply. Look up the funder's official contact details independently
    and ask them directly whether the offer is real.</li>
    <li>Do not send money, gift cards, cryptocurrency, or your bank details to anyone claiming to release a grant.</li>
    <li>If you already paid or shared bank details, contact your bank immediately and report it to the agencies
    below.</li>
    <li>Report it — reporting does not just help you, it helps the agency warn the next person and, over time, take
    the operation down.</li>
  </ul>

  <h2 style="margin-top:2.6rem">Report it — official channels by country</h2>
  <p class="small" style="color:var(--ink-3)">Verified live on ${esc(FACTS_CHECKED)}. If a link below has moved, the
  agency's own government domain will still be findable by searching its name.</p>
  <div class="grid grid-2" style="margin-top:1rem">
    ${REPORTING.map(
      (r) => `<article class="card">
      <h3 style="margin:0">${esc(r.country)}</h3>
      <p class="small" style="margin:.4rem 0 .6rem;color:var(--ink-3)">${esc(r.body)}</p>
      <p style="margin:0"><a class="link-underline" href="${esc(r.url)}" rel="nofollow noopener" target="_blank">${esc(r.url)}</a></p>
      ${r.url2 ? `<p style="margin:.3rem 0 0"><a class="link-underline" href="${esc(r.url2)}" rel="nofollow noopener" target="_blank">${esc(r.url2)}</a></p>` : ''}
      <p class="tiny" style="margin-top:.6rem">${esc(r.note)}</p>
    </article>`,
    ).join('')}
  </div>

  <div class="callout" style="margin-top:2.6rem">
    <p><strong>How this site is different.</strong> Programme pages here point you to the funder's own official
    source and show when the record was last checked, and this product never asks you to pay a fee to "release" a grant — the free
    check is free, and the paid plans are a flat subscription you choose to buy, stated up front on
    <a class="link-underline" href="${BASE}/pricing/">/pricing/</a>, never a condition of getting money that is
    already yours.</p>
  </div>

  <p style="margin-top:2.5rem"><a class="link-underline" href="${BASE}/trust/">Read how we handle your data — Trust, privacy & AI</a></p>
</section>`;

  return layout({
    base: BASE, linkBase: BASE, lang: 'en', tr: TR, altLangs: [],
    title: 'How to spot a grant scam — and where to report one',
    description: 'No real government grant asks for a fee. How to spot a fake grant offer, and the official fraud-reporting channels for the US, UK, France, the EU and India, verified live.',
    canonical: `${SITE_URL}/scams/`,
    jsonld: [breadcrumbLd(ORIGIN, [{ label: 'Home', href: `${BASE}/` }, { label: 'Grant scams' }])],
    body,
  });
}
