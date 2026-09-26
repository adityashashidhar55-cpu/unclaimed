/**
 * UNCLAIMED — closing-soon pages, the grant calendar, and iCal deadline feeds.
 *
 * These are acquisition pages, not account features: a founder searching
 * "startup grants closing soon Germany 2026" or "EIC Accelerator deadline"
 * should land on a page that answers exactly that, sourced from the same
 * dataset and the same effectiveStatus()/deadlineState() derivation as every
 * other status on the site — never a second, hand-rolled notion of "soon".
 *
 * Kept in its own file (rather than growing src/build.mjs) so several people
 * can build pages in this codebase at once without colliding on the same
 * lines. build.mjs only calls in, links out, and passes context; all the
 * markup and the ICS format live here.
 *
 * Deliberately not gated behind the pricing teaseList() the other startup
 * list pages use. Those pages sell "browse the full catalogue"; these sell
 * nothing — they are the answer to a single time-boxed search, and hiding
 * most of the list behind a paywall would also hide it from the JSON-LD
 * ItemList and from Google, which is the one thing a page built for search
 * traffic cannot afford. If the owner wants these gated too, teaseList() is
 * a one-line change at each render call below.
 */
import { effectiveStatus, deadlineState, nextWindow } from '../../packages/deadlines/index.js';
import { esc, attr, layout, disclaimerBar } from '../ui.mjs';

const nf = (n) => new Intl.NumberFormat('en').format(n);
const money = (n, cur) =>
  n == null
    ? null
    : `${cur === 'GBP' ? '£' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : ''}${nf(n)}${
        cur && !['GBP', 'USD', 'EUR'].includes(cur) ? ' ' + cur : ''
      }`;

const DAY = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 120;
const CALENDAR_MONTHS = 6;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

/** Is this record open (or effectively open) with a real closing date ahead of us? */
function isClosingSoon(p, asOf, horizonMs) {
  const status = effectiveStatus(p, asOf);
  if (!['open', 'rolling', 'upcoming'].includes(status)) return false;
  const closes = p.closes_at ? Date.parse(p.closes_at) : null;
  return closes != null && !Number.isNaN(closes) && closes > asOf && closes <= asOf + horizonMs;
}

/** Does this record still have anything useful to say once it has no near deadline? */
function hasUsefulProjection(p, asOf) {
  const d = deadlineState(p, asOf);
  return d.at != null || (p.typical_months || []).length > 0 || !!p.reopen_note;
}

/** Programme page URL, on this site — never the funder's own link. */
const progUrl = (origin, base, p) => `${origin}${base}/startups/${p.country_code}/${p.slug}/`;

/* ------------------------------------------------------------------ */
/* Shared row renderers                                                */
/* ------------------------------------------------------------------ */

function amountLine(p) {
  const amt = p.amount_max ?? p.amount_min;
  return amt != null ? esc(money(amt, p.amount_currency)) : 'Amount not published';
}

/** A programme with a real, dated deadline within the horizon. */
function deadlineRow({ base, p, country, showCountry }) {
  const d = deadlineState(p);
  return `<article class="card">
  <div class="row-between">
    <h3 style="margin:0"><a href="${base}/startups/${esc(p.country_code)}/${esc(p.slug)}/">${esc(p.name_en)}</a></h3>
    <span class="status status--${d.urgency}" title="${attr(d.detail)}">${esc(d.headline)}</span>
  </div>
  <p class="small" style="margin:.5rem 0 0;color:var(--ink-3)">
    ${showCountry && country ? `${country.flag} ${esc(country.name)} · ` : ''}${esc(p.funder)}
  </p>
  <p style="margin:.5rem 0 0"><strong>${amountLine(p)}</strong></p>
</article>`;
}

/** A programme with no near deadline, shown by its next known or projected window. */
function projectionRow({ base, p, country, showCountry }) {
  const d = deadlineState(p);
  return `<article class="card">
  <div class="row-between">
    <h3 style="margin:0"><a href="${base}/startups/${esc(p.country_code)}/${esc(p.slug)}/">${esc(p.name_en)}</a></h3>
    <span class="status status--${d.urgency}" title="${attr(d.detail)}">${esc(d.headline)}</span>
  </div>
  <p class="small" style="margin:.5rem 0 0;color:var(--ink-3)">
    ${showCountry && country ? `${country.flag} ${esc(country.name)} · ` : ''}${esc(d.detail)}
  </p>
</article>`;
}

/* ------------------------------------------------------------------ */
/* /startups/closing-soon/  and  /startups/{cc}/closing-soon/          */
/* ------------------------------------------------------------------ */

function closingSoonBody({ base, TR, title, lede, crumbs, rows, laterRows, icsHref, calendarHref, browseHref, browseLabel, empty }) {
  return `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${crumbs}
  <span class="eyebrow eyebrow-accent">Deadlines</span>
  <h1 style="max-width:26ch">${esc(title)}</h1>
  <p class="lede" style="max-width:60ch">${lede}</p>

  <div class="hero__cta" style="margin-top:1.4rem">
    <a class="btn btn-primary" href="${icsHref}">${'Add to calendar (.ics)'}</a>
    <a class="btn" href="${calendarHref}">See the 6-month calendar</a>
  </div>

  ${
    rows.length
      ? `<h2 style="margin-top:2.6rem">Closing within ${HORIZON_DAYS} days</h2>
  <div class="grid grid-2" style="margin-top:1rem">${rows.join('')}</div>`
      : `<div class="callout" style="margin-top:2rem"><p>${esc(empty)}</p></div>`
  }

  ${
    laterRows.length
      ? `<h2 style="margin-top:2.6rem">Further ahead</h2>
  <div class="grid grid-2" style="margin-top:1rem">${laterRows.join('')}</div>`
      : ''
  }

  <p style="margin-top:2.5rem"><a class="link-underline" href="${browseHref}">${esc(browseLabel)}</a></p>
</section>`;
}

/**
 * The itemList JSON-LD in one place: the same shape for the global page,
 * every country page and the calendar, so a future field only has to change
 * here.
 */
function itemListLd(origin, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: it.url,
      name: it.name,
    })),
  };
}

/**
 * Builds every closing-soon / calendar / ICS page and returns the set of
 * country slugs that got a /startups/{cc}/closing-soon/ page, so build.mjs
 * can link to it (and only it) from each country page.
 */
export function buildClosingSoonPages({ STARTUP_MANIFEST, STARTUP_DATA, STARTUP_ALL, BUILD_NOW, BASE, ORIGIN, SITE_URL, page, write, TR }) {
  const countryBySlug = Object.fromEntries(STARTUP_MANIFEST.countries.map((c) => [c.slug, c]));
  const horizonMs = HORIZON_DAYS * DAY;
  const year = new Date(BUILD_NOW).getUTCFullYear();

  const closingSoonAll = STARTUP_ALL.filter((p) => isClosingSoon(p, BUILD_NOW, horizonMs))
    .sort((a, b) => Date.parse(a.closes_at) - Date.parse(b.closes_at));

  /* ---- /startups/closing-soon/ — every jurisdiction, one list ---- */
  {
    const rows = closingSoonAll.map((p) => deadlineRow({ base: BASE, p, country: countryBySlug[p.country_code], showCountry: true }));
    const byCountry = new Map();
    for (const p of closingSoonAll) byCountry.set(p.country_code, (byCountry.get(p.country_code) || 0) + 1);
    const jump = [...byCountry.keys()]
      .map((cc) => countryBySlug[cc])
      .filter(Boolean)
      .map((c) => `<a class="card card-link" href="${BASE}/startups/${esc(c.slug)}/closing-soon/">
        <div class="row-between"><strong>${c.flag} ${esc(c.name)}</strong><span class="small">${byCountry.get(c.slug)}</span></div>
      </a>`)
      .join('');

    const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: 'Home', href: `${BASE}/` }, { label: 'Startup grants', href: `${BASE}/startups/` }, { label: 'Closing soon' }])}
  <span class="eyebrow eyebrow-accent">Deadlines</span>
  <h1 style="max-width:26ch">Startup grants closing soon — ${year} deadlines</h1>
  <p class="lede" style="max-width:60ch">${nf(closingSoonAll.length)} programme${closingSoonAll.length === 1 ? '' : 's'} across
  ${byCountry.size} jurisdiction${byCountry.size === 1 ? '' : 's'} with a published closing date in the next ${HORIZON_DAYS} days —
  sourced from the same dataset as every programme page, re-checked on every build.</p>

  <div class="hero__cta" style="margin-top:1.4rem">
    <a class="btn btn-primary" href="${BASE}/startups/deadlines.ics">Add to calendar (.ics)</a>
    <a class="btn" href="${BASE}/startups/calendar/">See the 6-month calendar</a>
  </div>

  ${
    closingSoonAll.length
      ? `<h2 style="margin-top:2.6rem">Closing soonest</h2>
  <div class="grid grid-2" style="margin-top:1rem">${rows.join('')}</div>`
      : `<div class="callout" style="margin-top:2rem"><p>Nothing is closing in the next ${HORIZON_DAYS} days right now — check back, or see the 6-month calendar for what usually opens when.</p></div>`
  }

  ${jump ? `<h2 style="margin-top:2.6rem">By jurisdiction</h2><div class="grid grid-3" style="margin-top:1rem">${jump}</div>` : ''}

  <p style="margin-top:2.5rem"><a class="link-underline" href="${BASE}/startups/">Browse all ${nf(STARTUP_ALL.length)} startup programmes</a></p>
</section>`;

    page(
      'startups/closing-soon/index.html',
      layout({
        base: BASE, linkBase: BASE, lang: 'en', tr: TR, altLangs: [],
        title: `Startup grants closing soon — ${year} deadlines`,
        description: `${nf(closingSoonAll.length)} startup grant and funding deadlines closing in the next ${HORIZON_DAYS} days, across ${byCountry.size} jurisdiction${byCountry.size === 1 ? '' : 's'}. Updated on every build, with a downloadable calendar feed.`,
        canonical: `${SITE_URL}/startups/closing-soon/`,
        audience: 'biz',
        jsonld: [
          breadcrumbLd(ORIGIN, [{ label: 'Home', href: `${BASE}/` }, { label: 'Startup grants', href: `${BASE}/startups/` }, { label: 'Closing soon' }]),
          itemListLd(ORIGIN, closingSoonAll.map((p) => ({ url: progUrl(ORIGIN, BASE, p), name: p.name_en }))),
        ],
        body,
      }),
    );
  }

  /* ---- /startups/{cc}/closing-soon/ — one per jurisdiction, or skipped ---- */
  const countriesWithPage = new Set();
  for (const c of STARTUP_MANIFEST.countries) {
    const programmes = STARTUP_DATA[c.slug].programmes;
    const closing = programmes
      .filter((p) => isClosingSoon(p, BUILD_NOW, horizonMs))
      .sort((a, b) => Date.parse(a.closes_at) - Date.parse(b.closes_at));
    const closingSlugs = new Set(closing.map((p) => p.slug));
    const projected = programmes
      .filter((p) => !closingSlugs.has(p.slug) && hasUsefulProjection(p, BUILD_NOW))
      .map((p) => ({ p, d: deadlineState(p, BUILD_NOW) }))
      .sort((a, b) => (a.d.at ?? Infinity) - (b.d.at ?? Infinity))
      .map(({ p }) => p)
      .slice(0, 40);

    /* Never an empty page: skip the jurisdiction entirely when there is
       neither a real deadline nor anything useful to project. */
    if (!closing.length && !projected.length) continue;
    countriesWithPage.add(c.slug);

    const rows = closing.map((p) => deadlineRow({ base: BASE, p, country: c, showCountry: false }));
    const laterRows = projected.map((p) => projectionRow({ base: BASE, p, country: c, showCountry: false }));

    const title = closing.length
      ? `Startup grants closing soon in ${c.name} — ${year}`
      : `Startup grant deadlines in ${c.name} — when programmes usually open`;
    const lede = closing.length
      ? `${nf(closing.length)} of ${nf(programmes.length)} programmes in ${esc(c.name)} have a published deadline in the next ${HORIZON_DAYS} days.`
      : `Nothing in ${esc(c.name)} has a published deadline in the next ${HORIZON_DAYS} days right now. Here is when the ${nf(projected.length)} that publish a pattern typically reopen.`;

    const body = closingSoonBody({
      base: BASE,
      TR,
      title,
      lede,
      crumbs: breadcrumbs([
        { label: 'Home', href: `${BASE}/` },
        { label: 'Startup grants', href: `${BASE}/startups/` },
        { label: c.name, href: `${BASE}/startups/${c.slug}/` },
        { label: 'Closing soon' },
      ]),
      rows,
      laterRows,
      icsHref: `${BASE}/startups/${c.slug}/deadlines.ics`,
      calendarHref: `${BASE}/startups/calendar/`,
      browseHref: `${BASE}/startups/${c.slug}/`,
      browseLabel: `Browse all ${nf(programmes.length)} programmes in ${c.name}`,
      empty: `Nothing in ${c.name} is closing in the next ${HORIZON_DAYS} days.`,
    });

    page(
      `startups/${c.slug}/closing-soon/index.html`,
      layout({
        base: BASE, linkBase: BASE, lang: 'en', tr: TR, altLangs: [],
        title,
        description: closing.length
          ? `${nf(closing.length)} startup grant deadlines closing soon in ${c.name}, ${year}. Dates, amounts and a downloadable calendar feed.`
          : `When startup grant programmes in ${c.name} typically open, projected from their own published patterns — plus a calendar feed to track it.`,
        canonical: `${SITE_URL}/startups/${c.slug}/closing-soon/`,
        audience: 'biz',
        jsonld: [
          breadcrumbLd(ORIGIN, [
            { label: 'Home', href: `${BASE}/` },
            { label: 'Startup grants', href: `${BASE}/startups/` },
            { label: c.name, href: `${BASE}/startups/${c.slug}/` },
            { label: 'Closing soon' },
          ]),
          itemListLd(ORIGIN, [...closing, ...projected].map((p) => ({ url: progUrl(ORIGIN, BASE, p), name: p.name_en }))),
        ],
        body,
      }),
    );
  }

  /* ---- /startups/calendar/ — the next six months ---- */
  {
    const months = [];
    const base = new Date(BUILD_NOW);
    for (let i = 0; i < CALENDAR_MONTHS; i++) {
      const y = base.getUTCFullYear();
      const m = base.getUTCMonth() + i;
      const start = Date.UTC(y, m, 1);
      const end = Date.UTC(y, m + 1, 1);
      months.push({ start, end, label: `${MONTH_NAMES[((m % 12) + 12) % 12]} ${new Date(start).getUTCFullYear()}` });
    }

    const knownAll = STARTUP_ALL.filter((p) => {
      const status = effectiveStatus(p, BUILD_NOW);
      if (!['open', 'rolling', 'upcoming'].includes(status)) return false;
      const closes = p.closes_at ? Date.parse(p.closes_at) : null;
      return closes != null && !Number.isNaN(closes) && closes > BUILD_NOW;
    });

    const monthSections = months.map(({ start, end, label }) => {
      const known = knownAll
        .filter((p) => { const t = Date.parse(p.closes_at); return t >= start && t < end; })
        .sort((a, b) => Date.parse(a.closes_at) - Date.parse(b.closes_at));

      const projected = STARTUP_ALL.filter((p) => {
        const status = effectiveStatus(p, BUILD_NOW);
        if (!['closed', 'paused'].includes(status)) return false;
        const w = nextWindow(p, BUILD_NOW);
        return w.basis === 'pattern' && w.at != null && w.at >= start && w.at < end;
      });

      const knownRows = known
        .map((p) => {
          const c = countryBySlug[p.country_code];
          const d = deadlineState(p, BUILD_NOW);
          return `<li><a href="${BASE}/startups/${esc(p.country_code)}/${esc(p.slug)}/">${esc(p.name_en)}</a>
            <span class="small" style="color:var(--ink-3)"> — ${c ? `${c.flag} ${esc(c.name)} · ` : ''}closes ${esc(new Date(Date.parse(p.closes_at)).toISOString().slice(0, 10))}</span>
            ${d.urgency === 'closing' ? '<span class="status status--closing" style="margin-left:.5rem">' + esc(d.headline) + '</span>' : ''}</li>`;
        })
        .join('');

      const projectedRows = projected
        .map((p) => {
          const c = countryBySlug[p.country_code];
          return `<li><a href="${BASE}/startups/${esc(p.country_code)}/${esc(p.slug)}/">${esc(p.name_en)}</a>
            <span class="small" style="color:var(--ink-3)"> — ${c ? `${c.flag} ${esc(c.name)} · ` : ''}usually opens around ${esc(label.split(' ')[0])}</span></li>`;
        })
        .join('');

      return `<div class="card" style="margin-top:1.2rem">
        <h2 style="margin-top:0">${esc(label)}</h2>
        ${
          known.length
            ? `<p class="small" style="margin:.4rem 0 .2rem"><strong>${nf(known.length)} known deadline${known.length === 1 ? '' : 's'}</strong></p><ul class="ticks">${knownRows}</ul>`
            : ''
        }
        ${
          projected.length
            ? `<p class="small" style="margin:1rem 0 .2rem"><strong>${nf(projected.length)} usually open${projected.length === 1 ? 's' : ''} around this month</strong> <span class="tiny">(projected from the funder's own pattern — not a confirmed date)</span></p><ul class="ticks">${projectedRows}</ul>`
            : ''
        }
        ${!known.length && !projected.length ? '<p class="small" style="color:var(--ink-3)">No known deadlines or typical windows land in this month.</p>' : ''}
      </div>`;
    });

    const totalKnown = knownAll.filter((p) => Date.parse(p.closes_at) < months[months.length - 1].end).length;

    const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: 'Home', href: `${BASE}/` }, { label: 'Startup grants', href: `${BASE}/startups/` }, { label: 'Calendar' }])}
  <span class="eyebrow eyebrow-accent">Deadlines</span>
  <h1 style="max-width:26ch">Startup grant deadlines — the next ${CALENDAR_MONTHS} months</h1>
  <p class="lede" style="max-width:60ch">Every published deadline from ${esc(months[0].label)} to ${esc(months[months.length - 1].label)},
  plus the windows programmes usually reopen in, labelled as a projection wherever it is one — never a date we invented.</p>

  <div class="hero__cta" style="margin-top:1.4rem">
    <a class="btn btn-primary" href="${BASE}/startups/deadlines.ics">Add the whole calendar (.ics)</a>
    <a class="btn" href="${BASE}/startups/closing-soon/">See what's closing soonest</a>
  </div>

  ${monthSections.join('')}

  <p style="margin-top:2.5rem"><a class="link-underline" href="${BASE}/startups/">Browse all ${nf(STARTUP_ALL.length)} startup programmes</a></p>
</section>`;

    page(
      'startups/calendar/index.html',
      layout({
        base: BASE, linkBase: BASE, lang: 'en', tr: TR, altLangs: [],
        title: `Startup grant deadlines calendar — ${months[0].label} to ${months[months.length - 1].label}`,
        description: `Month-by-month startup grant deadlines for the next ${CALENDAR_MONTHS} months, ${nf(totalKnown)} of them published dates, the rest labelled projections from each funder's own call pattern.`,
        canonical: `${SITE_URL}/startups/calendar/`,
        audience: 'biz',
        jsonld: [
          breadcrumbLd(ORIGIN, [{ label: 'Home', href: `${BASE}/` }, { label: 'Startup grants', href: `${BASE}/startups/` }, { label: 'Calendar' }]),
          itemListLd(
            ORIGIN,
            knownAll
              .filter((p) => Date.parse(p.closes_at) < months[months.length - 1].end)
              .sort((a, b) => Date.parse(a.closes_at) - Date.parse(b.closes_at))
              .map((p) => ({ url: progUrl(ORIGIN, BASE, p), name: `${p.name_en} deadline` })),
          ),
        ],
        body,
      }),
    );
  }

  /* ---- ICS feeds ---- */
  const icsEvents = knownEventsFor(STARTUP_ALL, BUILD_NOW, ORIGIN, BASE);
  write('startups/deadlines.ics', toStableICS(icsEvents, { name: 'Unclaimed — startup grant deadlines', now: BUILD_NOW }));
  for (const c of STARTUP_MANIFEST.countries) {
    const events = knownEventsFor(STARTUP_DATA[c.slug].programmes, BUILD_NOW, ORIGIN, BASE);
    write(`startups/${c.slug}/deadlines.ics`, toStableICS(events, { name: `Unclaimed — startup grant deadlines in ${c.name}`, now: BUILD_NOW }));
  }

  return {
    countriesWithPage,
    stats: {
      total: closingSoonAll.length,
      jurisdictions: new Set(closingSoonAll.map((p) => p.country_code)).size,
    },
  };
}

/** Events worth putting in a calendar: a real, future, still-standing deadline. */
function knownEventsFor(programmes, asOf, origin, base) {
  return programmes
    .filter((p) => {
      const status = effectiveStatus(p, asOf);
      if (!['open', 'rolling', 'upcoming'].includes(status)) return false;
      const closes = p.closes_at ? Date.parse(p.closes_at) : null;
      return closes != null && !Number.isNaN(closes) && closes > asOf;
    })
    .map((p) => ({
      uid: `unclaimed-startup-${p.country_code}-${p.slug}@unclaimedgrant.com`,
      at: Date.parse(p.closes_at),
      title: `${p.name_en} closes`,
      body: `${p.funder}. ${p.amount_note ? String(p.amount_note).slice(0, 200) : ''}`.trim(),
      url: progUrl(origin, base, p),
    }));
}

/**
 * A stable-UID iCal export.
 *
 * packages/deadlines' toICS() is the general reminders export and keys its
 * UID on the event's position in the array plus its timestamp
 * (`unclaimed-${i}-${e.at}`). That is fine for a one-off "your reminders"
 * download, but these two feeds are re-generated on every build and meant to
 * be SUBSCRIBED to — a calendar app dedupes and updates by UID, and an index
 * that shifts whenever a programme is added or removed anywhere in the
 * dataset would make every event look new and re-notify. So each event here
 * carries its own UID (country + slug), independent of array position and of
 * every other event.
 */
function toStableICS(events, { name = 'Unclaimed deadlines', now = Date.now() } = {}) {
  const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dateOnly = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
  const esc = (s) => String(s ?? '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const dtstamp = stamp(now); // build time, so BUILD_NOW=... builds stay reproducible
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Unclaimed//Startup grant deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
  ];
  for (const e of events) {
    const startDay = dateOnly(e.at);
    const endDay = dateOnly(e.at + DAY); // DTEND is exclusive for all-day VEVENTs
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${startDay}`,
      `DTEND;VALUE=DATE:${endDay}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.body)}${e.url ? esc('\n' + e.url) : ''}`,
      `URL:${e.url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldICSLine).join('\r\n') + '\r\n';
}

/**
 * RFC 5545 §3.1: content lines must not exceed 75 octets; longer ones are
 * folded with CRLF + a single space. Counted in UTF-8 octets (funder names
 * carry accents, flags and CJK), and never split inside a multi-byte char.
 */
function foldICSLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // continuation lines spend one octet on the leading space
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/* ------------------------------------------------------------------ */
/* Small hooks for /startups/ and /startups/{cc}/                      */
/* ------------------------------------------------------------------ */

/** One promo block for the /startups/ index: how many are closing, and links out. */
export function closingSoonPromoBlock({ base, totalClosingSoon, jurisdictionCount }) {
  return `<div class="callout callout--sage" style="margin-top:1.2rem">
    <p><strong>${nf(totalClosingSoon)} programme${totalClosingSoon === 1 ? '' : 's'} closing within ${HORIZON_DAYS} days</strong>
    across ${nf(jurisdictionCount)} jurisdiction${jurisdictionCount === 1 ? '' : 's'}.
    <a class="link-underline" href="${base}/startups/closing-soon/">See what's closing soon</a> ·
    <a class="link-underline" href="${base}/startups/calendar/">6-month calendar</a> ·
    <a class="link-underline" href="${base}/startups/deadlines.ics">Add to calendar</a></p>
  </div>`;
}

/** The one line a country page gets, only when that country actually has the page. */
export function countryClosingSoonLink({ base, cc, has }) {
  if (!has) return '';
  return `<p style="margin-top:1rem"><a class="link-underline" href="${base}/startups/${esc(cc)}/closing-soon/">See what's closing soon in this jurisdiction</a> ·
  <a class="link-underline" href="${base}/startups/${esc(cc)}/deadlines.ics">Add to calendar</a></p>`;
}
