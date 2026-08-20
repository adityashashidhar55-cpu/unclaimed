/**
 * UNCLAIMED — client wizard + results.
 *
 * Vanilla ES modules, no framework, no build step, no network calls except
 * fetching the static programme JSON for the country you pick. Nothing you
 * type leaves the browser.
 */
import {
  match,
  formatMoney,
  periodSuffix,
  CATEGORY_LABEL,
  CIRCUMSTANCES,
  estimateShareText,
  DISCLAIMER,
} from './engine/matcher.js';
import { track } from './beacon.js';
import { T, wizardDict, translateTree, wizardLang, NUM, localePath, setHTML } from './wizard-i18n.js';
import { bindCheckout } from './app/checkout.js';
import { applyPlan, recordApplyConsent } from './app/unlock.js';

const BASE = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const app = document.getElementById('app');

/**
 * A link into the site, in the language the reader is already reading.
 *
 * BASE is computed from import.meta.url, and app.js is served from /app.js on
 * every locale — so BASE is always '' and prefixed nothing. Every link this
 * file rendered went to the English page, including the two controls that take
 * money: a French reader on /fr/check/ clicked the paywall and landed on
 * English pricing, while the static chrome three lines above linked to
 * /fr/pricing/. localePath() reads <html lang>, which is the only thing on the
 * page that knows.
 */
const href = (p) => `${BASE}${localePath(p)}`;

/**
 * String lookup for the client-rendered wizard.
 *
 * /check/ is drawn entirely in JS, so it cannot use the build-time translator
 * in src/i18n.mjs. Where the build has injected a dictionary onto the page it
 * is used; otherwise the English literal passed in is what renders. The
 * literal is the fallback deliberately — a translator that falls back to the
 * key prints "check.share.button" at the reader, which is how that class of
 * bug ships unnoticed.
 */
function t(key, english) {
  /* Two conventions used to live here: this one, keyed by a key name against
     window.__UNCLAIMED_I18N, and the build's, keyed by the exact English
     source string against <script id="i18n-wizard">. Nothing populated
     __UNCLAIMED_I18N, so this always returned `english` and the dictionary the
     build shipped was never read by anything. Both are now served by the same
     store: try the key, then the English string, then fall back to the English
     literal — never to the key. */
  const d = wizardDict();
  const byKey = typeof d[key] === 'string' && d[key] ? d[key] : null;
  return byKey ?? T(english);
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const S = {
  manifest: null,
  entry: null,
  data: null,
  step: 0,
  result: null,
  profile: {
    country_code: null,
    admin_area: null,
    status: null,
    age: null,
    income_band: null,
    income_annual: null,
    household_size: 1,
    children_count: 0,
    housing_tenure: null,
    nationality_group: null,
    residency_months: null,
    circumstances: [],
  },
};

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * "a", "a and b", "a, b and c" — parts are already-escaped HTML.
 *
 * The joiner is not " and " in six of the seven languages, and it is not even
 * a word in hi. Intl.ListFormat knows all of them and needs no dictionary
 * entry; the manual join is kept only for a runtime that lacks it.
 */
function listPhrase(parts) {
  if (parts.length <= 1) return parts[0] || '';
  try {
    return new Intl.ListFormat(wizardLang(), { style: 'long', type: 'conjunction' }).format(parts);
  } catch {
    return parts.join(', ');
  }
}

/* ---- URL state (shareable, no accounts) ---- */
/**
 * The answers, kept on the device.
 *
 * Deliberately the same shape the URL hash carries, and deliberately local:
 * an unsigned-in visitor's household details are nobody's business but theirs,
 * and the paid workspace on the server is a separate, opt-in thing.
 */
const PROFILE_KEY = 'unclaimed.check.profile.v1';

function saveProfile() {
  try {
    if (!S.profile || !S.profile.country_code) return;
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...S.profile, saved_at: Date.now() }));
  } catch {
    /* Private mode, or a full quota. The session still works; it just will not
       survive the round trip through sign-in, which is the pre-existing
       behaviour rather than a new failure. */
  }
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    /* Answers go stale. Income, household and status all change, and silently
       reusing a year-old answer is its own wrong result. */
    if (!p || Date.now() - (p.saved_at ?? 0) > 90 * 864e5) return null;
    delete p.saved_at;
    return p;
  } catch {
    return null;
  }
}

export function clearProfile() {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* Nothing to do. */
  }
}

function encodeState() {
  const json = JSON.stringify(S.profile);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeState(s) {
  try {
    const json = decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

/* The first element of each row is the value the DATA speaks and is never
   translated; the two after it are copy, and they are wrapped here rather than
   at the render site so that a tool reading this file can see that they are
   translatable — an entry whose key exists nowhere a reader can find it is how
   three quarters of the last dictionary became unreachable. */
const STATUSES = [
  ['employee', T('Working for an employer'), T('Full-time, part-time or on a contract')],
  ['self_employed', T('Self-employed or freelance'), T('Including sole traders and small business owners')],
  ['student', T('Studying'), T('School, college or university')],
  ['unemployed', T('Out of work'), T('Between jobs, not currently looking or unable to work')],
  ['jobseeker', T('Actively looking for work'), T('Registered or searching')],
  ['retired', T('Retired'), T('Drawing a pension or past retirement age')],
  ['parent', T('At home with children'), T('Full-time caring, not in paid work')],
];

const TENURES = [
  ['renting', T('I rent'), T('Private landlord or social housing')],
  ['owner', T('I own my home'), T('With or without a mortgage')],
  ['hosted', T('I live with family or friends'), T("I don't pay a formal rent")],
  ['student_housing', T('Student accommodation'), T('Halls, dorms or campus housing')],
  ['homeless', T('I have no fixed home'), T('Temporary, emergency or no accommodation')],
];

const NATIONALITY = [
  ['citizen_or_pr', T('Citizen or permanent resident'), T('Unlocks the most programmes')],
  ['any_resident', T('Legal resident on a visa or permit'), T('Work, study, family or other permit')],
  ['refugee_or_protected', T('Refugee or protected status'), T('Asylum, humanitarian or subsidiary protection')],
];

/**
 * The steps, in order.
 *
 * The region step used to be spliced in only once a country was chosen, so the
 * caption read "Step 1 of 6" and then "Step 2 of 7" on the very first click,
 * and the rail visibly grew a segment underneath it. A progress indicator that
 * moves its own goalposts is worse than none: it tells the reader the thing is
 * longer than they were promised, at the exact moment they have committed.
 *
 * So the denominator is fixed. The region step is always in the list, and is
 * marked skipped — not removed — for a country that has no regions, which is
 * the only honest way to keep the count constant.
 */
function steps() {
  return ['country', 'region', 'status', 'circumstances', 'household', 'income', 'housing'];
}

/** Steps that exist in the list but cannot be answered for this country. */
function stepSkipped(name) {
  return name === 'region' && !(S.entry && (S.entry.regions || []).length);
}

/** The next step index that is actually answerable, walking in `dir`. */
function nextStep(from, dir) {
  const st = steps();
  let i = from + dir;
  while (i > 0 && i < st.length && stepSkipped(st[i])) i += dir;
  return Math.max(0, Math.min(st.length - 1, i));
}

/* ------------------------------------------------------------------ */
/* Render helpers                                                      */
/* ------------------------------------------------------------------ */

function rail() {
  const st = steps();
  /* Number the steps a person can actually SEE.
     Singapore's manifest has no regions, so the region step is skipped — and
     the counter, which numbered the raw list, went "Step 1 of 7" then
     "Step 3 of 7" in one click and never showed step 2. The rail's segments
     stay honest by only drawing the visible ones, so the dots and the words
     agree instead of the words apologising for the dots.

     But "visible" is only knowable once a country is. On the country step
     S.entry is still null, so stepSkipped('region') answered true for
     EVERYONE and the caption read "Step 1 of 6", then "Step 2 of 7" the
     instant a reader picked any of the 24 countries that do have regions.
     A denominator that moves under the reader is the defect this function
     exists to prevent, so on the first screen we do not state one: the flow
     length is genuinely unknown until the first answer, and guessing it and
     then correcting it is worse than waiting one click. The dots assume the
     region step is there, because for 24 of 25 countries it is. */
  const unknown = !S.entry;
  const visible = unknown ? st : st.filter((name) => !stepSkipped(name));
  const total = visible.length;
  const shownIndex = Math.max(0, visible.indexOf(st[S.step]));
  const now = shownIndex + 1;
  const secs = Math.max(1, (total - shownIndex) * 15);
  const label = unknown
    ? T('About {secs} seconds · nothing is saved to a server', { secs: NUM(secs) })
    : T('Step {n} of {total}', { n: NUM(now), total: NUM(total) });
  return `<div class="progress-rail" role="progressbar" aria-valuenow="${now}" aria-valuemin="1"${
    unknown ? '' : ` aria-valuemax="${total}"`
  } aria-label="${esc(label)}">
    ${visible.map((_, i) => `<span class="${i < shownIndex ? 'done' : i === shownIndex ? 'current' : ''}"></span>`).join('')}
  </div>
  <p class="tiny progress-caption">${esc(
    unknown
      ? T('About {secs} seconds · nothing is saved to a server', { secs: NUM(secs) })
      : T('Step {n} of {total} · about {secs} seconds left · nothing is saved to a server', {
        n: NUM(now),
        total: NUM(total),
        secs: NUM(secs),
      }),
  )}</p>`;
}

/**
 * One choice tile.
 *
 * The accessible name is set explicitly and the visible text hidden from the
 * accessibility tree, because otherwise the name is the concatenated text
 * content — "Working for an employerFull-time, part-time or on a contract",
 * read aloud as one word. The earlier fix put the two spans in a column, which
 * changed how it looks and not one thing about how it is announced.
 */
function optButton(value, label, sub, field) {
  const on = S.profile[field] === value;
  /* The accessible name is composed from the TRANSLATED halves, not from the
     English ones. It used to be `${label}, ${sub}` built before translateTree
     ran, so a screen-reader user on /fr/check/ heard the option in English
     while a sighted reader beside them read French. `{label}, {sub}` carries
     no words of its own, so it needs no entry — the two halves are already
     keys. */
  const name = sub ? T('{label}, {sub}', { label: T(label), sub: T(sub) }) : T(label);
  /* Four different behaviours used to wear one appearance: region and status
     commit and advance, circumstances toggle, income commits and advances, and
     housing toggles two independent groups. A tile that moves you on gets a
     chevron so it does not look like a tile that only ticks. */
  const go = field === 'admin_area' || field === 'status' || field === 'income_band';
  return `<button class="opt${go ? ' opt--go' : ''}" type="button" aria-pressed="${on}" aria-label="${esc(name)}" data-field="${field}" data-value="${esc(value)}">
    <span aria-hidden="true">${esc(T(label))}${sub ? `<span class="opt__sub">${esc(T(sub))}</span>` : ''}</span>
  </button>`;
}

function navRow({ back = true, next = null, skip = null } = {}) {
  return `<div class="wizard-nav">
    ${back && S.step > 0 ? `<button class="btn btn-ghost btn-sm" type="button" data-act="back">${esc(T('← Back'))}</button>` : '<span></span>'}
    <span class="row">
      ${skip ? `<button class="btn btn-ghost btn-sm" type="button" data-act="skip">${esc(T(skip))}</button>` : ''}
      ${next ? `<button class="btn btn-primary" type="button" data-act="next">${esc(T(next))}</button>` : ''}
    </span>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Step views                                                          */
/* ------------------------------------------------------------------ */

function viewCountry() {
  const cs = S.manifest.countries.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="wizard-step">
    ${rail()}
    <h1 class="q">${esc(T('Where do you live?'))}</h1>
    <p class="q-why">${esc(T('Benefits are national. We only load the country you pick — nothing else is downloaded.'))}</p>
    <div class="field"><label for="csearch" id="csearch-label">${esc(T('Search {n} countries', { n: NUM(cs.length) }))}</label>
      <input id="csearch" type="search" placeholder="${esc(T('Start typing…'))}" autocomplete="country-name"
        aria-describedby="csearch-count"><span class="tiny" id="csearch-count" aria-live="polite">${esc(T('{n} of {total} shown', { n: NUM(cs.length), total: NUM(cs.length) }))}</span></div>
    <div class="opts" id="clist">
      ${cs
        .map(
          (c) =>
            (() => {
              /* One sentence, translated once, used twice. The visible
                 sub-label was translated and the aria-label was composed in
                 English from the same numbers one line above it, so the
                 country picker announced in English on a French page. */
              const sub = T('{n} programmes · {v} verified', { n: NUM(c.programme_count), v: NUM(c.verified_count) });
              return `<button class="opt" type="button" data-act="country" data-cc="${c.slug}" data-name="${esc(c.name.toLowerCase())}"
              aria-label="${esc(T('{label}, {sub}', { label: c.name, sub }))}">
              <span aria-hidden="true" style="font-size:1.3rem;line-height:1">${c.flag}</span>
              <span aria-hidden="true">${esc(c.name)}<span class="opt__sub">${esc(sub)}</span></span>
            </button>`;
            })(),
        )
        .join('')}
    </div>
    <!-- Filtering to nothing used to leave this screen completely blank with
         the label still claiming 25 countries: no result, no explanation, no
         way to tell a broken search from a real absence. -->
    <!-- The heading was three nodes — "No country matches “", the query, and a
         closing quote — so it could never whole-node match anything and the
         empty state shouted in English on a French page. One key, one token,
         written by the search handler through T(). -->
    <div class="dash__empty" id="clist-empty" hidden>
      <h2 id="clist-empty-h"></h2>
      <p class="small">${esc(T('The dataset covers {n} countries so far — yours may simply not be in it yet.', { n: NUM(cs.length) }))}</p>
      <p class="btn-row"><button class="btn btn-sm" type="button" data-act="csearch-clear">${esc(T('Clear the search'))}</button>
      <a class="btn btn-sm btn-ghost" href="https://github.com/adityashashidhar55-cpu/unclaimed/issues/new?title=Country+request">${esc(T('Request one'))}</a></p>
    </div>
    <!-- Coming back here with a country already chosen used to leave the
         screen with no nav at all: the only way forward was to click the
         country again. Same dead end as the status step. -->
    ${S.entry ? navRow({ back: false, next: T('Continue with {country}', { country: S.entry.name }) }) : ''}
    <!-- One sentence with the link as a token, not three text nodes around an
         anchor. Split like that, none of the three could ever match a key. -->
    <div class="callout" style="margin-top:1.5rem"><p class="small" style="margin:0">${T(
      "Your country isn't listed? The dataset covers {n} countries so far. {link} — it's a data job, not a code job.",
      {
        n: NUM(cs.length),
        link: `<a class="link-underline" href="https://github.com/adityashashidhar55-cpu/unclaimed/issues/new?title=Country+request">${esc(T('Request one'))}</a>`,
      },
    )}</p></div>
  </div>`;
}

function viewRegion() {
  const regions = S.entry.regions || [];
  return `<div class="wizard-step">
    ${rail()}
    <h1 class="q">${esc(T('Which part of {country}?', { country: S.entry.name }))}</h1>
    <p class="q-why">${esc(T('Regional and city schemes are the ones people miss most — council tax reductions, local transport concessions, regional housing grants.'))}</p>
    <div class="opts">
      ${regions.map((r) => optButton(r, r, null, 'admin_area')).join('')}
    </div>
    ${navRow({ skip: T('Somewhere else / not sure') })}
  </div>`;
}

function viewStatus() {
  return `<div class="wizard-step">
    ${rail()}
    <h1 class="q">${esc(T('What best describes you right now?'))}</h1>
    <p class="q-why">${esc(T('Most programmes are written around a life situation rather than a job title. Pick the closest one — you can go back and try another.'))}</p>
    <div class="opts">${STATUSES.map(([v, l, s]) => optButton(v, l, s, 'status')).join('')}</div>
    <!-- navRow({}) rendered Back and nothing else, so arriving here via Back —
         with your answer already selected — was a dead end: the only way
         forward was to re-answer a question you had already answered. -->
    ${navRow({ next: S.profile.status ? T('Continue') : null })}
  </div>`;
}

function viewCircumstances() {
  const on = new Set(S.profile.circumstances || []);
  return `<div class="wizard-step">
    ${rail()}
    <h1 class="q">${esc(T('Does any of this describe you?'))}</h1>
    <p class="q-why">${esc(T('These are the situations that unlock the largest payments almost everywhere — and the ones a generic benefits list will never ask about. Tick all that apply, or none. Your answers stay in this browser; there is no server to send them to.'))}</p>
    <div class="opts">
      ${CIRCUMSTANCES.map(
        (c) => `<button class="opt" type="button" aria-pressed="${on.has(c.id)}" data-multi="circumstances" data-value="${esc(c.id)}">
        <span class="opt__key" aria-hidden="true">${on.has(c.id) ? '✓' : '☐'}</span>
        <span>${esc(T(c.label))}</span>
      </button>`,
      ).join('')}
    </div>
    <p class="tiny" style="margin-bottom:1.5rem">${esc(T('If you tick nothing, programmes that depend on these situations are kept out of your total and listed separately, rather than being counted as money you can claim. That is the difference between a real estimate and an inflated one.'))}</p>
    ${navRow({ next: T('Continue'), skip: T('None of these') })}
  </div>`;
}

function viewHousehold() {
  const p = S.profile;
  return `<div class="wizard-step">
    ${rail()}
    <h1 class="q">${esc(T('Your household'))}</h1>
    <p class="q-why">${esc(T('Age gates and child-related payments are two of the biggest sources of missed money.'))}</p>
    <div class="field-row">
      <div class="field"><label for="age">${esc(T('Your age'))}</label>
        <input id="age" type="number" inputmode="numeric" min="0" max="120" value="${p.age ?? ''}" placeholder="${esc(T('e.g. {v}', { v: NUM(34) }))}">
        <div class="hint">${esc(T("Leave blank if you'd rather not say — we'll flag age-gated programmes instead of ruling them out."))}</div>
      </div>
      <div class="field"><label for="hh">${esc(T('People in your household'))}</label>
        <input id="hh" type="number" inputmode="numeric" min="1" max="20" value="${p.household_size}">
        <div class="hint">${esc(T('Including you.'))}</div>
      </div>
    </div>
    <div class="field"><label for="kids">${esc(T('Dependent children'))}</label>
      <input id="kids" type="number" inputmode="numeric" min="0" max="15" value="${p.children_count}">
      <div class="hint">${esc(T('Under 18, or older if still in full-time education or dependent on you.'))}</div>
    </div>
    ${navRow({ next: T('Continue') })}
  </div>`;
}

function viewIncome() {
  const bands = S.entry.income_bands || [];
  const cur = S.entry.currency;
  /* money(), not formatMoney(): the income step is the one place a figure was
     still formatted the English way on a localised page — "£8,800" on
     /fr/check/, a screen away from a results hero that says "2 000 £". */
  const fmt = (n) => money(n, cur);
  return `<div class="wizard-step">
    ${rail()}
    <h1 class="q">${esc(T('Roughly what does your household earn?'))}</h1>
    <p class="q-why">${esc(T('We ask because most support is means-tested — income is the single rule that decides the most programmes. It stays in your browser. Pick a band, or give an exact figure for sharper matching.'))}</p>
    <div class="opts">
      ${bands
        .map((b) =>
          optButton(
            b.id,
            b.max === null
              ? T('Over {v}', { v: fmt(b.min) })
              : b.min === 0
                ? T('Under {v}', { v: fmt(b.max) })
                : T('{lo} – {hi}', { lo: fmt(b.min), hi: fmt(b.max) }),
            T('per year, before tax, everyone in the household'),
            'income_band',
          ),
        )
        .join('')}
    </div>
    <details class="fold" style="margin-bottom:1.5rem"><summary>${esc(T('Give an exact figure instead (sharper results)'))}</summary>
      <div class="field" style="margin-top:1rem"><label for="inc">${esc(T('Annual household income in {currency}', { currency: cur }))}</label>
        <!-- "e.g. 42000" is a figure in a currency, so it is neither English
             nor language-free: a Hindi reader groups it differently and a
             French one does not put the symbol first. -->
        <input id="inc" type="number" inputmode="numeric" min="0" value="${S.profile.income_annual ?? ''}" placeholder="${esc(T('e.g. {v}', { v: NUM(42000) }))}">
        <div class="hint">${esc(T('An exact figure turns "needs one more answer" into a straight yes or no on income-tested schemes.'))}</div>
      </div>
    </details>
    <!-- No Continue here. The income tiles commit and advance on click, so the
         only state in which this button could ever be pressed was "no band
         selected" — which is exactly what the skip beside it already says,
         twice, in two different words. -->
    ${navRow({ skip: T("I'd rather not say") })}
  </div>`;
}

function viewHousing() {
  return `<div class="wizard-step">
    ${rail()}
    <h1 class="q">${esc(T('Housing and residency'))}</h1>
    <p class="q-why">${esc(T('Housing support is the largest unclaimed category almost everywhere. Residency status decides what a country will pay a non-citizen.'))}</p>
    <h2 class="h-eyebrow" style="margin-top:1.5rem">${esc(T('Your housing situation'))}</h2>
    <div class="opts">${TENURES.map(([v, l, s]) => optButton(v, l, s, 'housing_tenure')).join('')}</div>
    <h2 class="h-eyebrow" style="margin-top:2rem">${esc(T('Your status in {country}', { country: S.entry.name }))}</h2>
    <div class="opts">${NATIONALITY.map(([v, l, s]) => optButton(v, l, s, 'nationality_group')).join('')}</div>
    <div class="field" style="margin-top:1.5rem"><label for="res">${esc(T('How many months have you lived in {country}?', { country: S.entry.name }))}</label>
      <input id="res" type="number" inputmode="numeric" min="0" value="${S.profile.residency_months ?? ''}" placeholder="${esc(T('Leave blank if unsure'))}">
      <div class="hint">${esc(T('Some programmes have a minimum residence period. Blank means we flag them rather than rule them out.'))}</div>
    </div>
    ${navRow({ next: T('See what I can claim →') })}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* The wall                                                            */
/*                                                                     */
/* This wizard used to render every matched programme to anyone who    */
/* finished the questions — the whole paid product, free, on the page. */
/* The total stays free because it is the honest teaser and it is what */
/* gets someone to care. The list is what is being sold.               */
/*                                                                     */
/* Entitlement is asked of the server, never assumed. If the API is    */
/* unreachable the answer is "not entitled": guessing generously here  */
/* hands the paid list to anyone who blocks a request.                 */
/* ------------------------------------------------------------------ */

let ENTITLED = false;
/* Signed in but not paying is its own state, and the reason this page had a
   dead end in it. The old code tracked entitlement alone, so it could only
   ever offer "sign in to unlock" — including to someone who had signed in
   twenty seconds earlier and had nowhere left to click. */
let SIGNED_IN = false;

async function refreshEntitlement() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) { ENTITLED = false; SIGNED_IN = false; return; }
    const data = await res.json();
    ENTITLED = !!data?.entitlement?.entitled;
    SIGNED_IN = !!data?.signed_in;
  } catch {
    /* Offline. Assume the least generous answer for the gate and the least
       confusing one for the button: an unreachable API is not a signed-in
       user, and offering checkout to someone we cannot identify ends at a
       401 they cannot act on. */
    ENTITLED = false;
    SIGNED_IN = false;
  }
}

/**
 * A bucket, or the wall in its place.
 *
 * Takes a thunk rather than a string so the programme markup is never built
 * for an unentitled viewer — nothing to find in the DOM, nothing to un-hide.
 */
/* Only the first locked bucket on the results screen argues for the plan.
   
   There are six of these down one page, and every one carried the full pitch —
   so a signed-out visitor met the identical "Sign in to unlock" and "See
   pricing" pair six times, plus the one in the masthead. It reads as a page
   that is mostly wall, and it is the "sign in appears twice" complaint,
   understated by four. The later buckets say what is behind them and stop. */
let gatedShown = 0;

/* What each locked panel is actually withholding, and what it is called.
   
   Three of these used to run down one page with character-for-character
   identical copy — "Unlock to see which ones, what each pays, what documents
   they want and when they close." — over four identical bars whether the
   bucket held 4, 34 or 8 records. A wall that cannot tell you what is behind
   it is indistinguishable from a wall with nothing behind it.

   Both halves are keyed by a bucket ID rather than composed from an English
   noun phrase. The heading used to be `${count} ${noun}` — a number glued to a
   fragment, which can never whole-node match a dictionary entry and which, in
   German, does not even put the number in that position. One key per bucket,
   with the count as a token and both plural forms in the key, is the whole
   sentence and it survives translation. */
const BUCKETS = {
  apply: {
    head: (n) => T('one={n} programme you can apply for|other={n} programmes you can apply for', { n: NUM(n) }, n),
    lock: T('which ones, what each pays, what documents they want and when they close'),
  },
  auto: {
    head: (n) => T('one={n} programme you should already be getting|other={n} programmes you should already be getting', { n: NUM(n) }, n),
    lock: T('which ones, what each pays, what documents they want and when they close'),
  },
  taper: {
    head: (n) => T('one={n} programme at a reduced amount|other={n} programmes at a reduced amount', { n: NUM(n) }, n),
    lock: T('how much of each one you would still get'),
  },
  conditional: {
    head: (n) => T('one={n} programme that depends on your circumstances|other={n} programmes that depend on your circumstances', { n: NUM(n) }, n),
    lock: T('which circumstance each one turns on'),
  },
  needs: {
    head: (n) => T('one={n} programme that needs one more answer|other={n} programmes that need one more answer', { n: NUM(n) }, n),
    lock: T('which single answer opens each one'),
  },
  rights: {
    head: (n) => T('one={n} right you already have|other={n} rights you already have', { n: NUM(n) }, n),
    lock: T('which rights they are and how to use them'),
  },
  paperwork: {
    head: (n) => T('one={n} document to gather and deadline to keep|other={n} documents to gather and deadlines to keep', { n: NUM(n) }, n),
    lock: T('which documents unlock which programmes, and what closes when'),
  },
  documents: {
    head: (n) => T('one={n} document to gather|other={n} documents to gather', { n: NUM(n) }, n),
    lock: T('which documents unlock which programmes'),
  },
  deadlines: {
    head: (n) => T('one={n} deadline to keep|other={n} deadlines to keep', { n: NUM(n) }, n),
    lock: T('what closes when'),
  },
};

function gated(count, kind, buildHtml) {
  /* The zero guard sits ABOVE the entitled branch, not below it.
     With it below, a paying reader with nothing in a bucket got the heading,
     the count "0 programmes" and the reassuring blurb over an empty list,
     while the free reader — who hit the guard — got nothing at all. The paid
     view was visibly worse than the free one, on the screen being sold. */
  if (!count) return '';
  if (ENTITLED) return buildHtml();
  const first = gatedShown === 0;
  gatedShown += 1;
  const b = BUCKETS[kind] || BUCKETS.apply;
  /* Every redacted row carries `withheld`, and the first one carries the lock
     chip, exactly as src/ui.mjs's lockedRows() does on the static pages. This
     screen emitted bare `<div class="locked__row">`, so the one place where
     redaction IS the product had zero `.locked__row__lock` elements,
     selectable grey bars, and nothing tying it to the vocabulary the rest of
     the site uses. theme.css:1079 states the contract; test-gating.mjs
     enforces it now. */
  return `<section class="bucket locked-bucket">
    <div class="bucket__head"><h2>${esc(b.head(count))}</h2>${
      first ? '' : `<a class="bucket__unlock" href="${href('/pricing/')}">${esc(T('Unlock →'))}</a>`
    }</div>
    <p class="small">${esc(T('Unlock to see {what}.', { what: b.lock }))}</p>
    <div class="locked__rows" aria-hidden="true">
      ${Array.from(
        { length: Math.min(count, 4) },
        (_, i) =>
          `<div class="locked__row withheld">${
            first && i === 0 ? `<span class="locked__row__lock">${esc(T('Locked'))}</span>` : ''
          }</div>`,
      ).join('')}
    </div>
    ${
      !first
        ? ''
        : SIGNED_IN
          /* No figure on this button. data-plan="auto" resolves server-side
             from the account type, and for a business session it resolves to
             business_annual — so a "€50 a year" label was a €490 checkout.
             The client cannot know the price until the plan is resolved, so
             it does not claim one. */
          ? `<p class="btn-row"><button class="btn btn-primary" type="button" data-checkout data-plan="auto">${esc(T('Unlock the full list'))}</button>
             <a class="btn" href="${href('/pricing/')}">${esc(T('See all plans and prices'))}</a></p>
           <p class="tiny">${esc(T('Your plan and its price are shown before you pay. Cancel any time.'))}</p>`
          /* `next` used to be the hardcoded English '/check/', so a French
             reader who signed in to unlock was returned to the ENGLISH wizard
             with their answers gone — the answers live in the fragment, which
             a hardcoded path does not carry. Send them back to the page they
             are standing on, hash and all. */
          : `<p class="btn-row"><a class="btn btn-primary" href="${esc(href('/account/'))}?next=${encodeURIComponent(
              location.pathname + location.hash,
            )}&plan=auto">${esc(T('Sign in to unlock'))}</a>
             <a class="btn" href="${href('/pricing/')}">${esc(T('See pricing'))}</a></p>
           <p class="tiny">${esc(T('Email and a six-digit code. No password to forget.'))}</p>`
    }
  </section>`;
}

/* Deadline enums, in words.
   
   The meta line rendered `deadline_note || deadline_type` and the badge
   rendered `deadline_type`, so a programme with no note printed the raw enum
   twice in one row — "Winter Fuel Payment / annual" with a badge also reading
   "annual". Across data/*.json the two values a reader actually meets here are
   `annual` (301 records) and `window` (219), and neither means anything to
   anyone. Same treatment every other enum gets in unlock.js's VALUE_LABEL. */
const DEADLINE_LABEL = {
  annual: [T('Once a year'), T('Yearly')],
  window: [T('Open in application windows'), T('In windows')],
  cutoff: [T('One cut-off date'), T('Cut-off')],
  annual_call: [T('An annual call for applications'), T('Annual call')],
  irregular: [T('Opens irregularly — check the source'), T('Irregular')],
  fixed_date: [T('A fixed date each year'), T('Fixed date')],
  closed: [T('Closed to new applications'), T('Closed')],
  rolling: [T('Open all year'), T('Rolling')],
  none: [T('No deadline'), T('No deadline')],
};

function deadlineWords(type) {
  return DEADLINE_LABEL[type] || [null, null];
}

/* Matcher attribute names, in the words the question used. */
const ATTR_LABEL = {
  nationality: T('your residency status'),
  age: T('your age'),
  income: T('your household income'),
  income_annual_max: T('your household income'),
  admin_area: T('your region'),
  household: T('who lives with you'),
  housing_tenure: T('your housing'),
  status: T('your work status'),
  residency_months: T('how long you have lived there'),
  /* The wizard does not ask this yet by design (see matcher.js rule 2b), so a
     sex-restricted programme lands in 'needs one more answer' with a label a
     reader can act on rather than a raw field name. */
  gender: T('whether a women-only or men-only scheme applies to you'),
};

/* formatMoney has taken a locale since it was written and neither caller ever
   passed one, so every figure on both wizards was grouped and placed the
   English way in all seven languages — "€3,082,500" on a French page, where
   the convention is "3 082 500 €", and comma grouping on the Hindi one, where
   the grouping itself is different. */
function money(n, cur) {
  return formatMoney(n, cur, wizardLang());
}

function progCard(m, kind) {
  const p = m.programme;
  const cur = p.amount_currency || S.data.currency;
  let amt = null;
  if (p.amount_min != null || p.amount_max != null) {
    /* "/yr", "/mo", " one-off" — three words of English glued to every
       amount on the page, from a matcher helper with no translator. */
    const suf = T(periodSuffix(p.amount_period));
    amt =
      p.amount_min != null && p.amount_max != null && p.amount_min !== p.amount_max
        ? `${money(p.amount_min, cur)}–${money(p.amount_max, cur)}${suf}`
        : `${money(p.amount_max ?? p.amount_min, cur)}${suf}`;
  }
  /* Renamed from `href`, which now names the locale-aware link helper — and
     routed through it: /fr/check/ for a French reader checking France linked
     to the English /fr/… programme page while /fr/fr/… exists. */
  const url = href(`/${S.entry.slug}/${p.category}/${p.slug}/`);
  const verified =
    p.verification_status === 'verified'
      /* 'Verified' had no entry while its negative did, so the two halves of
         one control rendered in two languages on the same card. */
      ? `<span class="badge badge-verified">${esc(T('Verified'))}</span>`
      : `<span class="badge badge-auto">${esc(T('Not human-checked'))}</span>`;

  let why = '';
  /* The sentences inside these blocks come out of src/engine/matcher.js as
     finished English prose, so T() can only reach the ones the dictionary
     names exactly. It is called on them anyway — the matcher returning keys
     and vars instead of prose is the other half of this fix, and when it
     lands these call sites already translate. */
  if (kind === 'eligible' && m.rules_met.length) {
    why = `<div class="why"><strong>${esc(T('Why you match:'))}</strong><ul>${m.rules_met.slice(0, 4).map((r) => `<li>${esc(T(r))}</li>`).join('')}</ul></div>`;
  } else if (kind === 'maybe' && m.blocking_question) {
    why = `<div class="why why--ask"><strong>${esc(T('One thing missing:'))}</strong> ${esc(T(m.blocking_question))}
      <div style="margin-top:.6rem"><button class="btn btn-ghost btn-sm" type="button" data-act="answer" data-attr="${esc(m.blocking_attribute)}">${esc(T('Answer this now'))}</button></div></div>`;
  } else if (kind === 'no' && m.rules_failed.length) {
    why = `<div class="why why--fail"><strong>${esc(T('Why not:'))}</strong> ${esc(T(m.rules_failed[0]))}</div>`;
  } else if (kind === 'taper') {
    why = `<div class="why why--ask"><strong>${esc(T('Above the maximum-award ceiling, but probably not ruled out:'))}</strong>
      ${esc(T(m.taper_note))}<br><span class="tiny">${esc(T("We can't compute your reduced amount — the authority does that. Use their calculator on the official page."))}</span></div>`;
  } else if (kind === 'conditional') {
    why = `<div class="why why--ask"><strong>${esc(T('Only if this is you:'))}</strong> ${esc(T(m.condition_label))}.
      ${esc(T("You didn't tell us it applies, so we've kept it out of your total."))}
      <!-- The card names the exact circumstance and the button used to throw it
           away: data-attr was the hardcoded string "circumstance", so all 20
           conditional cards mapped to the same generic step and clicking one
           landed you on #s=3 with the named circumstance still off. The tags
           are on the match already (condition_ids); emit them. -->
      <div style="margin-top:.6rem"><button class="btn btn-ghost btn-sm" type="button" data-act="answer" data-attr="circumstance"
        data-circ="${esc((m.condition_ids || []).join(','))}">${esc(T('This does apply to me'))}</button></div></div>`;
  }

  return `<article class="card prog-card">
    <div class="prog-card__head">
      <div style="min-width:0">
        <h3 class="prog-card__title"><a href="${url}" style="text-decoration:none">${esc(p.name_en)}</a></h3>
        <p class="prog-card__sub">${esc(p.name_local !== p.name_en ? p.name_local + ' · ' : '')}${esc(p.funder)}</p>
      </div>
      <div class="prog-card__value">
        ${amt ? `<div class="prog-card__amount">${esc(amt)}</div>` : `<div class="tiny">${esc(T('Amount depends on you'))}</div>`}
      </div>
    </div>
    ${why}
    ${m.stale_note ? `<p class="tiny notice">${esc(T(m.stale_note))}</p>` : ''}
    <div class="prog-card__meta">
      ${verified}
      ${p.is_automatic ? `<span class="badge badge-auto-apply">${esc(T('Automatic — no application'))}</span>` : `<span class="badge badge-action">${esc(T('You must apply'))}</span>`}
      ${m.is_capital ? `<span class="badge badge-neutral" title="${esc(T('Borrowing capacity, not money in pocket — excluded from your total'))}">${esc(T('Loan or credit — not counted'))}</span>` : ''}
      <span class="badge badge-neutral">${esc(T(CATEGORY_LABEL[p.category] || p.category))}</span>
      ${(p.documents_required || []).length ? `<span class="badge badge-neutral">${esc(T('one={n} document|other={n} documents', { n: NUM(p.documents_required.length) }, p.documents_required.length))}</span>` : ''}
      ${(p.procedure_steps || []).length ? `<span class="badge badge-neutral">${esc(T('one={n} step|other={n} steps', { n: NUM(p.procedure_steps.length) }, p.procedure_steps.length))}</span>` : ''}
    </div>
    <div class="row" style="margin-top:1rem">
      <!-- This literal used to carry the ampersand pre-escaped as an HTML
           entity, so the build shipped the escaped form as the dictionary key
           while the browser renders the text node with a bare ampersand. The
           lookup could never hit — on the most repeated control on the paid
           screen, in six languages, with correct translations shipped for all
           six. Write the ampersand once and let esc() escape it. -->
      <a class="btn btn-sm btn-ghost" href="${url}">${esc(T('Full rules & documents'))}</a>
      ${p.application_url ? `<a class="btn btn-sm" href="${esc(p.application_url)}" target="_blank" rel="nofollow noopener">${esc(T('Apply on official site'))}</a>` : ''}
    </div>
  </article>`;
}


/**
 * Real document lists say the same thing twenty ways ("National Insurance
 * number", "National Insurance number (for DWP benefit verification)"). Keying
 * the checklist on the raw string produced 37 rows of which exactly 1 was
 * shared — a wall, not a plan. Map to a small set of real-world documents first.
 */
const DOC_BUCKETS = [
  [/passport|national id|identity card|photo id|\bid card|aadhaar|residence permit|visa|carte de s[ée]jour|personalausweis/i, T('Photo ID or residence permit')],
  [/proof of address|utility bill|address proof|justificatif de domicile|meldebescheinigung|council tax bill/i, T('Proof of address')],
  [/payslip|proof of income|income (statement|certificate|proof)|salary|p60|avis d.imp[oô]t|einkommensnachweis|earnings/i, T('Proof of income (payslips or tax statement)')],
  [/tax (return|number|reference|identification)|utr\b|tax id|pan card|steuer|num[ée]ro fiscal|social security number|ssn\b|national insurance/i, T('Tax or social-security number')],
  [/bank (details|account|statement)|iban|\brib\b|sort code|void cheque|passbook/i, T('Bank details')],
  [/tenancy|rental agreement|lease|rent (book|receipt|certificate)|\bbail\b|mietvertrag|attestation de loyer|landlord/i, T('Tenancy agreement or rent proof')],
  [/mortgage|title deed|property (deed|document|tax)|ownership/i, T('Property ownership documents')],
  [/birth certificate|child.s? (birth|id)|acte de naissance|geburtsurkunde/i, T('Birth certificate(s)')],
  [/marriage|civil partnership|divorce|livret de famille/i, T('Marriage or family status certificate')],
  [/medical|doctor|health (certificate|record)|diagnosis|disability (assessment|certificate)|occupational therapist|fit note|sick note/i, T('Medical or assessment evidence')],
  [/enrol|student (id|card|certificate)|matriculation|immatrikulation|certificat de scolarit|proof of study|school/i, T('Proof of study or enrolment')],
  [/employment contract|job (offer|contract)|employer (letter|certificate)|p45|termination|redundancy|dismissal/i, T('Employment or termination documents')],
  [/business (plan|registration|licence|license)|company (registration|number)|vat|gst|siret|trade licence|udyam/i, T('Business registration documents')],
  [/energy bill|electricity|gas bill|meter|water bill|supplier/i, T('Recent energy or water bill')],
  [/photo(graph)?s?\b|passport-size/i, T('Passport-size photograph')],
];

/**
 * A stable key and a readable label.
 *
 * The KEY is what the tick is stored under, so it must not move when the
 * interface language does — a reader who ticks four boxes on /fr/check/ and
 * comes back on /check/ must find them ticked. The label is copy and is
 * translated; the key is the bucket's position, which is not.
 */
function canonicalDoc(doc) {
  for (let i = 0; i < DOC_BUCKETS.length; i += 1) {
    const [re, label] = DOC_BUCKETS[i];
    if (re.test(doc)) return [`bucket:${i}`, label];
  }
  const key = doc.trim().toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return [key, doc];
}

/* ------------------------------------------------------------------ */
/* The document checklist                                              */
/*                                                                     */
/* The copy under these boxes said "Ticks are stored in this browser   */
/* only" and /pricing/ sells "a document checklist per claim". There   */
/* was no change listener and no storage key: `data-doc` appeared      */
/* exactly once in this file, in the markup. Every tick was gone on    */
/* the next re-render, which the results screen does on its own when   */
/* entitlement resolves — so most ticks did not survive ten seconds.   */
/* ------------------------------------------------------------------ */
const DOCS_KEY = 'unclaimed.check.docs.v1';

function docTicks() {
  try {
    return JSON.parse(localStorage.getItem(DOCS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function docTickKey(doc) {
  return `${S.profile.country_code || '??'}|${doc}`;
}

function restoreDocTicks() {
  const boxes = document.querySelectorAll('input[data-doc]');
  if (!boxes.length) return;
  const store = docTicks();
  boxes.forEach((el) => {
    el.checked = store[docTickKey(el.dataset.doc)] === true;
    el.addEventListener('change', () => {
      const next = docTicks();
      if (el.checked) next[docTickKey(el.dataset.doc)] = true;
      else delete next[docTickKey(el.dataset.doc)];
      try {
        localStorage.setItem(DOCS_KEY, JSON.stringify(next));
      } catch {
        /* Storage is full or blocked. The tick still shows for this render;
           the copy below is the only thing that would then be wrong, and it
           is wrong in the direction of promising less. */
      }
    });
  });
}

/** Rows for the checklist, shared with the code that has to count them. */
function documentRows(r) {
  const map = new Map();
  for (const m of r.eligible) {
    for (const d of m.programme.documents_required || []) {
      const [key, canonical] = canonicalDoc(d.doc);
      if (!map.has(key)) map.set(key, { id: key, doc: canonical, unlocks: [], mandatory: false, raw: new Set() });
      map.get(key).raw.add(d.doc);
      const rec = map.get(key);
      rec.unlocks.push(m.programme.name_en);
      if (d.mandatory !== false) rec.mandatory = true;
    }
  }
  return [...map.values()].sort((a, b) => b.unlocks.length - a.unlocks.length);
}

/** Programmes with a deadline that is actually a deadline. */
function datedProgrammes(r) {
  return r.eligible.filter(
    (m) => m.programme.deadline_type && !['none', 'rolling'].includes(m.programme.deadline_type),
  );
}

function documentPlan(r) {
  const rows = documentRows(r);
  if (!rows.length) return '';
  const top = rows.filter((x) => x.unlocks.length > 1).length;
  return `<section class="bucket" id="documents">
    <div class="bucket__head"><h2>${esc(T('Your document checklist'))}</h2><span class="bucket__count">${esc(
      T('one={n} document unlocks {p} programmes|other={n} documents unlock {p} programmes', { n: NUM(rows.length), p: NUM(r.eligible.length) }, rows.length),
    )}</span></div>
    <!-- One sentence, one key: the emphasis is a token inside it rather than
         an inline <strong> that splits the paragraph into three text nodes,
         none of which can match anything. -->
    <p class="small" style="max-width:60ch">${
      top
        ? T('Gathered once, reused everywhere. {emph} — start with those. Ticks are stored in this browser only.', {
            emph: `<strong>${esc(T('one={n} of these is needed by more than one programme|other={n} of these are needed by more than one programme', { n: NUM(top) }, top))}</strong>`,
          })
        : esc(T('Gathered once, reused everywhere. Ticks are stored in this browser only.'))
    }</p>
    <ul class="docs" style="margin-top:1rem">
      ${rows
        .map(
          (x, i) => `<li>
        <input type="checkbox" id="pd-${i}" data-doc="${esc(x.id)}">
        <!-- data-doc carries the stable bucket id, not the label: the tick
             is stored under it, and a storage key that moves with the
             interface language loses every tick made in another one. -->
        <label for="pd-${i}"><strong>${esc(x.doc)}</strong>${x.mandatory ? '' : ` <span class="badge badge-neutral">${esc(T('if applicable'))}</span>`}
        <span class="tiny" style="display:block">${esc(
          T('Unlocks {n}: {names}', {
            n: NUM(x.unlocks.length),
            names: x.unlocks.slice(0, 3).join(', ') + (x.unlocks.length > 3 ? T(' +{n} more', { n: NUM(x.unlocks.length - 3) }) : ''),
          }),
        )}</span></label>
      </li>`,
        )
        .join('')}
    </ul>
  </section>`;
}

/** Programmes with a real deadline → .ics calendar export. */
function deadlineSection(r) {
  const dated = datedProgrammes(r);
  if (!dated.length) return '';
  return `<section class="bucket" id="deadlines">
    <div class="bucket__head"><h2>${esc(T('Deadlines'))}</h2><span class="bucket__count">${esc(T('{n} time-limited', { n: NUM(dated.length) }))}</span></div>
    <p class="small">${esc(T('Most support is rolling — you can apply any time. These are not.'))}</p>
    <div class="list-rows">
      ${dated
        .map(
          (m) => {
            const [sentence, short] = deadlineWords(m.programme.deadline_type);
            const meta = m.programme.deadline_note ? T(m.programme.deadline_note) : sentence;
            const badge = short || null;
            return `<div class="list-row">
        <span><span class="list-row__name">${esc(m.programme.name_en)}</span>
        ${meta ? `<span class="list-row__meta">${esc(meta)}</span>` : ''}</span>
        ${badge && badge !== meta ? `<span class="list-row__right"><span class="badge badge-neutral">${esc(badge)}</span></span>` : ''}
      </div>`;
          },
        )
        .join('')}
    </div>
    <p style="margin-top:1rem"><button class="btn btn-ghost btn-sm" type="button" data-act="ics">${esc(T('Add reminders to my calendar (.ics)'))}</button></p>
  </section>`;
}

/** Nothing matched. Explain why, using the reasons already in the data. */
function viewNoMatches() {
  const r = S.result;
  const prExtra = r.not_eligible.filter(
    (m) => m.rules_failed.some((x) => /citizens or permanent residents/i.test(x)),
  ).length;
  const n = S.data.programmes.length;
  /* This screen is the one that has to earn a second attempt, and it was
     French frame around an English argument: the two headings were keys and
     every sentence between them carried a number, so none of them could ever
     match. One key per sentence, with the counts as tokens. */
  return `<div class="results" style="max-width:none">
    <section class="result-hero">
      <span class="eyebrow">${esc(S.entry.flag)} ${esc(S.entry.name)} · ${esc(T('matched against {n} programmes', { n: NUM(n) }))}</span>
      <h1 class="figure" style="font-size:clamp(2rem,5vw,3.4rem);color:var(--ink)">${esc(T("Nothing matched — and that's worth knowing why"))}</h1>
      <p class="small" style="color:var(--ink-3);max-width:60ch;margin-top:1.5rem">${esc(
        T(
          'A blank result is usually a rule about who a country pays, not a bug. Here is exactly what blocked you, counted from the {n} {country} programmes we hold.',
          { n: NUM(n), country: S.entry.name },
        ),
      )}</p>
      <div class="row" style="margin-top:2rem">
        <button class="btn btn-sm" type="button" data-act="restart">${esc(T('Change my answers'))}</button>
        <button class="btn btn-sm" type="button" data-act="start-over">${esc(T('Start again in another country'))}</button>
        <a class="btn btn-sm btn-ghost" href="${href(`/${S.entry.slug}/`)}">${esc(T('Browse all {n} anyway', { n: NUM(n) }))}</a>
      </div>
    </section>

    <section class="bucket">
      <div class="bucket__head"><h2>${esc(T('What blocked you'))}</h2></div>
      <div class="list-rows">
        ${(r.blockers || [])
          .map(
            (b) => `<div class="list-row">
          <span><span class="list-row__name">${esc(T(b.reason))}</span></span>
          <span class="list-row__right"><span class="list-row__amount">${esc(NUM(b.count))}</span><span class="tiny">${esc(T('programmes'))}</span></span>
        </div>`,
          )
          .join('')}
      </div>
    </section>

    ${
      prExtra
        ? `<div class="callout callout--terracotta" style="margin-top:2rem">
      <p>${T(
        '{emph} If you are on a path to PR, that is the single change that unlocks the most money here — worth knowing years in advance rather than discovering it afterwards.',
        {
          emph: `<strong>${esc(
            T('one={n} of these opens up with permanent residence or citizenship.|other={n} of these open up with permanent residence or citizenship.', { n: NUM(prExtra) }, prExtra),
          )}</strong>`,
        },
      )}</p>
    </div>`
        : ''
    }

    <div class="callout callout--sage" style="margin-top:1.5rem">
      <p>${T('{emph} Residence-based welfare is only part of the picture. Employment law usually gives you things regardless of nationality — end-of-service payments, statutory leave, wage protection, mandatory insurance. Several are catalogued here:', {
        emph: `<strong>${esc(T('Look at statutory entitlements instead.'))}</strong>`,
      })}</p>
      <p style="margin-bottom:0"><a class="link-underline" href="${href(`/${S.entry.slug}/employment/`)}">${esc(
        T('Work & employment entitlements in {country}', { country: S.entry.name }),
      )}</a></p>
    </div>

    ${ENTITLED
      ? `<details class="fold" style="margin-top:2.5rem">
      <summary>${esc(T('Show all {n} programmes and the rule each one failed on', { n: NUM(r.not_eligible.length) }))}</summary>
      <div class="bucket-list" style="margin-top:1rem">${r.not_eligible.slice(0, 40).map((m) => progCard(m, 'no')).join('')}</div>
    </details>`
      : ''}
    <p class="tiny" style="margin-top:1.5rem">${esc(T(r.disclaimer || DISCLAIMER))} ${esc(T('Data as of {date}.', { date: r.data_as_of }))}</p>
  </div>`;
}

/**
 * The "you don't qualify for these" list, or the reasons behind it.
 *
 * Names are stripped from the public dataset, so for an unentitled visitor
 * every one of these cards renders with an empty title and an empty funder —
 * forty blank boxes, which reads as a broken page rather than as a paywall.
 * The failing RULE is not paid content and is genuinely the useful half here
 * ("what would have to change"), so the free version is the rules, counted.
 */
function ruledOutBlock(r) {
  if (!r.not_eligible.length) return '';
  if (ENTITLED) {
    return `<details class="fold" style="margin-top:3rem">
    <summary>${esc(T("Show the {n} programmes you don't qualify for, and why", { n: NUM(r.not_eligible.length) }))}</summary>
    <p class="small" style="margin-top:1rem">${esc(T('Worth a scan: circumstances change, and the failing rule tells you what would have to change.'))}</p>
    <div class="bucket-list" style="margin-top:1rem">${r.not_eligible.slice(0, 40).map((m) => progCard(m, 'no')).join('')}</div>
    ${r.not_eligible.length > 40 ? `<p class="small">${T('Showing {shown} of {n}. {link}.', {
      shown: NUM(40),
      n: NUM(r.not_eligible.length),
      link: `<a class="link-underline" href="${href(`/${S.entry.slug}/`)}">${esc(T('Browse all {n} programmes in {country}', { n: NUM(S.data.programmes.length), country: S.entry.name }))}</a>`,
    })}</p>` : ''}
  </details>`;
  }

  const counts = {};
  for (const m of r.not_eligible) {
    for (const reason of new Set(m.rules_failed)) counts[reason] = (counts[reason] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!top.length) return '';

  return `<details class="fold" style="margin-top:3rem">
    <summary>${esc(T('Why {n} programmes ruled you out', { n: NUM(r.not_eligible.length) }))}</summary>
    <p class="small" style="margin-top:1rem">${esc(T('The rules are free — which programmes they belong to is not. Circumstances change, and this is the list of what would have to.'))}</p>
    <div class="list-rows">
      ${top
        .map(
          ([reason, count]) => `<div class="list-row">
        <span><span class="list-row__name">${esc(T(reason))}</span></span>
        <span class="list-row__right"><span class="list-row__amount">${esc(NUM(count))}</span><span class="tiny">${esc(T('programmes'))}</span></span>
      </div>`,
        )
        .join('')}
    </div>
  </details>`;
}

function viewResults() {
  const r = S.result;
  if (r.eligible.length === 0 && r.conditional.length === 0 && (r.tapered || []).length === 0) {
    return viewNoMatches();
  }
  const cur = r.currency;
  const auto = r.eligible.filter((m) => m.programme.is_automatic);
  const apply = r.eligible.filter((m) => !m.programme.is_automatic);
  // Eligible programmes whose amount the authority calculates — these count as
  // zero in the headline, so name the biggest ones rather than hiding them.
  /* Names are stripped from the public dataset, so `name_en` is empty for
     everyone who has not paid — which used to render as "Yours include , ,
     and 7 more". Fall back to what the free record does carry: the category.
     A free reader gets "two housing payments and a disability payment", which
     is true, useful, and gives nothing away. */
  const unpricedAll = r.eligible
    .filter((m) => !m.is_capital && m.programme.amount_min == null && m.programme.amount_max == null)
    .sort((a, b) => {
      const rank = (m) => (m.programme.verification_status === 'verified' ? 0 : 1);
      return rank(a) - rank(b);
    });
  const unpricedTop = unpricedAll
    .slice(0, 3)
    .map((m) => m.programme.name_en)
    .filter(Boolean);
  /* Distinct categories, biggest group first, at most three. */
  const unpricedKinds = (() => {
    const n = new Map();
    for (const m of unpricedAll) {
      const k = T(CATEGORY_LABEL[m.programme.category] || m.programme.category);
      if (k) n.set(k, (n.get(k) || 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  })();

  /* Two units, two figures. The matcher now totals recurring money and
     paid-once money separately (see matcher.js), because this caption says
     "per year" and a one-off housing grant is not per year. When there is
     only one-off money the one-off figure IS the hero — the alternative was
     a headline of nothing over a page full of grants. */
  const perYear =
    r.total_max > 0
      ? r.total_min > 0 && r.total_min !== r.total_max
        ? `${money(r.total_min, cur)}–${money(r.total_max, cur)}`
        : T('up to {v}', { v: money(r.total_max, cur) })
      : null;
  const oneOff =
    (r.one_off_max ?? 0) > 0
      ? r.one_off_min > 0 && r.one_off_min !== r.one_off_max
        ? `${money(r.one_off_min, cur)}–${money(r.one_off_max, cur)}`
        : T('up to {v}', { v: money(r.one_off_max, cur) })
      : null;
  const headline = perYear ?? oneOff;
  const headlineIsPerYear = perYear != null;
  const headlineCount = headlineIsPerYear ? (r.recurring_count ?? 0) : (r.one_off_count ?? 0);

  /* Nothing qualifies YET, but things are pending on a question that was
     skipped. "0 programmes" is not the answer, it is the absence of one, and
     a reader who takes it as the answer closes the tab still not claiming.
     Same rule as the app: never report a confident zero over an open question. */
  const pending = r.eligible.length === 0 ? r.needs_one_more_answer.length : 0;
  const blockers = pending
    ? [...new Set(r.needs_one_more_answer.map((m) => m.blocking_attribute).filter(Boolean))]
        .map((a) => ATTR_LABEL[a] ?? T(a))
        .slice(0, 2)
    : [];

  return `<div class="results" style="max-width:none">
  <section class="result-hero">
    <span class="eyebrow">${esc(S.entry.flag)} ${esc(S.entry.name)} · ${esc(T('matched against {n} programmes', { n: NUM(S.data.programmes.length) }))}</span>
    <!-- The payoff screen used to render its headline as a <p>, so a document
         that finally had something to say had no h1 at all and its headings
         started at H2 — while the wizard steps it came from each had one. The
         figure IS the heading here, so it is marked up as one, in --ink: the
         hero is not a secondary note. -->
    <!-- Every sentence in this hero carries a number, and a count spliced
         into a template literal with a bare "s" on the end is not a text node
         any dictionary can match. That is why the whole payoff screen rendered
         in English on /fr/check/ while the questions that led to it were
         French. One key per sentence, counts as tokens, plurals in the key. -->
    ${
      pending
        ? `<h1 class="figure" style="font-size:clamp(2rem,6vw,3.6rem);color:var(--ink)">${esc(
            blockers.length === 1
              ? T('one={n} programme is waiting on one answer|other={n} programmes are waiting on one answer', { n: NUM(pending) }, pending)
              : blockers.length
                ? T('one={n} programme is waiting on {q} answers|other={n} programmes are waiting on {q} answers', { n: NUM(pending), q: NUM(blockers.length) }, pending)
                : T('one={n} programme is waiting on an answer|other={n} programmes are waiting on an answer', { n: NUM(pending) }, pending),
          )}</h1>
           <p class="figure-unit" style="margin-top:1rem">${esc(
             blockers.length
               ? T("We can't put a number on it yet — these are the questions that decide it.")
               : T("We can't put a number on it yet — one question decides it."),
           )}</p>
           ${
             blockers.length
               ? `<p class="row" style="margin-top:1rem;gap:.5rem">${blockers
                   .map((b) => `<span class="badge badge-neutral">${esc(b)}</span>`)
                   .join('')}</p>`
               : ''
           }
           <p style="margin-top:1.4rem"><button class="btn btn-primary" type="button" data-act="restart">${esc(
             blockers.length === 1 ? T('Answer it now') : T('Answer them now'),
           )}</button></p>`
        : headline
          ? `<h1 class="figure" style="color:var(--ink)">${esc(headline)}</h1>
           <p class="figure-unit" style="margin-top:1rem">${esc(
             headlineIsPerYear
               ? T('one=per year in published ceilings across {n} programme you appear to qualify for|other=per year in published ceilings across {n} programmes you appear to qualify for', { n: NUM(headlineCount) }, headlineCount)
               : T('one=paid once in published ceilings across {n} programme you appear to qualify for|other=paid once in published ceilings across {n} programmes you appear to qualify for', { n: NUM(headlineCount) }, headlineCount),
           )}</p>
           ${
             headlineIsPerYear && oneOff
               ? `<p class="figure-unit" style="margin-top:.6rem">${T(
                   'one={emph} across {n} programme paid once rather than every year — not included in the figure above.|other={emph} across {n} programmes paid once rather than every year — not included in the figure above.',
                   {
                     emph: `<strong style="color:var(--ink)">${esc(T('plus {v} one-off', { v: oneOff }))}</strong>`,
                     n: NUM(r.one_off_count),
                   },
                   r.one_off_count,
                 )}</p>`
               : ''
           }
           ${
             r.unpriced_count
               ? `<p class="figure-unit" style="margin-top:.6rem">${esc(
                   T('one={n} further match publishes no figure at all and counts as zero in both.|other={n} further matches publish no figure at all and count as zero in both.', { n: NUM(r.unpriced_count) }, r.unpriced_count),
                 )}</p>`
               : ''
           }`
          : `<h1 class="figure" style="font-size:clamp(2.2rem,7vw,4.5rem);color:var(--ink)">${esc(
              T('one={n} programme|other={n} programmes', { n: NUM(r.eligible.length) }, r.eligible.length),
            )}</h1>
           <p class="figure-unit" style="margin-top:1rem">${esc(T('you appear to qualify for'))}</p>`
    }
    <!-- The breakdown has to account for every programme it says it matched
         against. It omitted the taper bucket, so it summed to 113 of 114 and
         showed the missing record separately two lines down. -->
    <p class="small" style="color:var(--ink-3);max-width:60ch;margin-top:1.5rem">
      ${esc(
        T(
          "{a} eligible · {b} at a reduced amount · {c} statutory rights rather than payments · {d} need one more answer · {e} depend on a circumstance you didn't claim · {f} ruled out.",
          {
            a: NUM(r.eligible.length),
            b: NUM((r.tapered || []).length),
            c: NUM((r.rights || []).length),
            d: NUM(r.needs_one_more_answer.length),
            e: NUM(r.conditional.length),
            f: NUM(r.not_eligible.length),
          },
        ),
      )}
      ${r.capital_max > 0 ? esc(T('A further {v} in loan and credit ceilings is excluded, because borrowing is not income.', { v: money(r.capital_max, cur) })) : ''}
    </p>
    ${
      unpricedAll.length
        ? `<div style="position:relative;margin-top:1.5rem;padding:1rem 1.2rem;border:1px solid var(--line-2);border-radius:10px;background:var(--paper-2)">
        <!-- Five sentences that used to be one paragraph glued together with
             two inline <strong>s and three counts: nine text nodes, not one of
             which could match a key. The lead-in was the only French line on
             the entire French results screen for exactly that reason. -->
        <p class="small" style="color:var(--ink-2);margin:0;max-width:62ch">${T(
          'one={lead} {n} of your matches publishes no fixed amount — the authority calculates it from your circumstances — so it {zero} here. It is often the largest payment of all.|other={lead} {n} of your matches publish no fixed amount — the authority calculates it from your circumstances — so they {zero} here. They are often the largest payments of all.',
          {
            lead: `<strong style="color:var(--terracotta)">${esc(T('The figure above is not your real total.'))}</strong>`,
            n: NUM(r.unpriced_count),
            /* The emphasis covers the whole clause rather than the bare word:
               "zero" is the same word in several of these languages, and a
               one-word token is a poor unit of translation anywhere. */
            zero: `<strong>${esc(T('one=counts as zero|other=count as zero', {}, r.unpriced_count))}</strong>`,
          },
          r.unpriced_count,
        )}${
          unpricedTop.length
            ? ' ' +
              T('Yours include {names}.', {
                names:
                  listPhrase(unpricedTop.map((n) => `<strong style="color:var(--ink)">${esc(n)}</strong>`)) +
                  (r.unpriced_count > unpricedTop.length
                    ? T(' and {n} more', { n: NUM(r.unpriced_count - unpricedTop.length) })
                    : ''),
              })
            : unpricedKinds.length
              /* The name-based branch above has an "and N more" tail; this
                 one sliced to three categories and did not, so the sentence
                 said "6 of your matches ... Yours are" and then enumerated
                 four. Every enumerated list has to sum to its own total. */
              ? (() => {
                  const shown = unpricedKinds.reduce((a, [, n]) => a + n, 0);
                  const rest = unpricedAll.length - shown;
                  return (
                    ' ' +
                    T('Yours are {names}.', {
                      names:
                        listPhrase(
                          unpricedKinds.map(
                            ([label, n]) =>
                              `<strong style="color:var(--ink)">${esc(
                                /* Not lower-cased: `label` is now the
                                   translated category name, and German nouns
                                   do not lose their capital because they
                                   landed mid-sentence. */
                                T('one={n} {kind} payment|other={n} {kind} payments', { n: NUM(n), kind: label }, n),
                              )}</strong>`,
                          ),
                        ) + (rest > 0 ? T('one= and {n} other|other= and {n} others', { n: NUM(rest) }, rest) : ''),
                    })
                  );
                })()
              : ''
        } ${esc(T('We would rather show you a small honest number than a big invented one.'))}</p>
      </div>`
        : ''
    }
    <div class="row no-print" style="margin-top:2rem">
      <!-- "Copy my result link" said nothing about what the link carries.
           The fragment holds the whole profile — status, exact income,
           household, and any circumstance ticked, including a self-declared
           disability — base64'd, which reads as encryption to a reader who has
           been told on every step that nothing is saved to a server. -->
      <button class="btn btn-sm" type="button" data-act="share"
        aria-describedby="share-what">${esc(t('check.share.button', 'Copy a link that contains my answers'))}</button>
      <button class="btn btn-sm btn-ghost" type="button" onclick="window.print()">${esc(T('Print / save as PDF'))}</button>
      <button class="btn btn-sm btn-ghost" type="button" data-act="restart">${esc(T('Change my answers'))}</button>
      <button class="btn btn-sm btn-ghost" type="button" data-act="start-over">${esc(T('Another country'))}</button>
    </div>
    <p class="tiny" id="share-what" style="margin-top:.6rem">${esc(
      t(
        'check.share.what',
        'Anyone with that link sees the answers you gave — where you live, your age, your household, your income and anything you ticked.',
      ),
    )}</p>
  </section>

  <!-- With nothing eligible yet, these three tiles are three zeroes, and the
       middle one is set in terracotta: a red 0 is the first thing the eye
       lands on, on the screen the whole product exists to produce. When the
       real answer is "answer two more questions", the instruction is the hero
       and the tiles are not rendered at all. -->
  ${pending ? '' : `<div class="grid grid-3" style="margin-top:2rem">
    <div class="card card-flat"><div class="figure-sm">${esc(NUM(auto.length))}</div><p class="small" style="margin:.4rem 0 0">${T('{emph} If you\'re not getting these, the authority is missing a detail about you — worth one phone call.', { emph: `<strong>${esc(T('Should arrive automatically.'))}</strong>` })}</p></div>
    <!-- The one number here that represents claimable money was painted in
         --terracotta, which everywhere else on this site means failure:
         .notice--error, .ticks--no li::before, .status--closing. The two
         zeroes beside it were neutral ink, so the eye landed on a red figure
         on the screen the whole product exists to produce. -->
    <div class="card card-flat"><div class="figure-sm"${apply.length ? ' style="color:var(--green)"' : ''}>${esc(NUM(apply.length))}</div><p class="small" style="margin:.4rem 0 0">${T('{emph} Nobody will prompt you. This is where the unclaimed money actually is.', { emph: `<strong>${esc(T('Need an application.'))}</strong>` })}</p></div>
    <div class="card card-flat"><div class="figure-sm">${esc(NUM(r.eligible.filter((m) => m.programme.verification_status === 'verified').length))}</div><p class="small" style="margin:.4rem 0 0">${T('{emph} A researcher confirmed these against the official page.', { emph: `<strong>${esc(T('Human-verified matches.'))}</strong>` })}</p></div>
  </div>`}

  <!-- Auto-apply. The Worker has served POST /api/apply/plan and
       /api/apply/consent since the feature landed, packages/autoapply is the
       largest tested module in the repo, and until now no shipped client asked
       for either route: "we prepare the application" was sold, built, tested,
       and unreachable. scripts/test-reachability.mjs is the guard. -->
  ${
    ENTITLED && r.eligible.length
      ? `<section class="bucket" id="prepare">
    <div class="bucket__head"><h2>${esc(T('Prepare these applications'))}</h2><span class="bucket__count">${esc(T('one={n} programme|other={n} programmes', { n: NUM(r.eligible.length) }, r.eligible.length))}</span></div>
    <p class="small" style="max-width:62ch">${esc(T('We fill what we can from the answers you already gave, list the documents each one still needs, and hand you a pack per programme. Nothing is sent anywhere on your behalf until you say so.'))}</p>
    <p class="btn-row"><button class="btn btn-primary" type="button" data-act="prepare">${esc(T('Prepare my applications'))}</button></p>
    <div id="prepare-out" role="status" aria-live="polite"></div>
  </section>`
      : ''
  }

  ${gated(apply.length, 'apply', () => `<section class="bucket">
    <div class="bucket__head"><h2>${esc(T('Apply for these'))}</h2><span class="bucket__count">${esc(T('one={n} programme · nobody will remind you|other={n} programmes · nobody will remind you', { n: NUM(apply.length) }, apply.length))}</span></div>
    <div class="bucket-list">${apply.map((m) => progCard(m, 'eligible')).join('')}</div>
  </section>`)}

  ${gated(auto.length, 'auto', () => `<section class="bucket">
    <div class="bucket__head"><h2>${esc(T('You should already be getting these'))}</h2><span class="bucket__count">${esc(T('{n} automatic', { n: NUM(auto.length) }))}</span></div>
    <p class="small">${esc(T('No application needed — but "automatic" assumes the authority has your correct details. If one of these isn\'t reaching you, that is the gap worth chasing.'))}</p>
    <div class="bucket-list" style="margin-top:1rem">${auto.map((m) => progCard(m, 'eligible')).join('')}</div>
  </section>`)}

  ${gated((r.tapered || []).length, 'taper', () => `<section class="bucket">
    <div class="bucket__head"><h2>${esc(T('Reduced amount, probably still yours'))}</h2><span class="bucket__count">${esc(T('one={n} programme|other={n} programmes', { n: NUM(r.tapered.length) }, r.tapered.length))}</span></div>
    <p class="small" style="max-width:62ch">${T('Your income is above the published ceiling — but that ceiling is the threshold for the {emph} award, and each of these records says in its own words that the payment tapers rather than stops. A tool that treated the ceiling as a cut-off would tell you "no" here. We\'d rather tell you "probably less, go and check".', { emph: `<em>${esc(T('maximum'))}</em>` })}</p>
    <div class="bucket-list" style="margin-top:1rem">${r.tapered.slice(0, 15).map((m) => progCard(m, 'taper')).join('')}</div>
  </section>`)}

  ${gated(r.conditional.length, 'conditional', () => `<section class="bucket">
    <div class="bucket__head"><h2>${esc(T('Only if this is you'))}</h2><span class="bucket__count">${esc(T('one={n} programme|other={n} programmes', { n: NUM(r.conditional.length) }, r.conditional.length))}${
      r.conditional_max > 0 ? esc(T(' · {v} not counted', { v: money(r.conditional_max, cur) })) : ''
    }</span></div>
    <p class="small" style="max-width:62ch">${T("These depend on a situation you didn't tell us about — a disability, caring for someone, being off sick, a new baby, a bereavement, military service. They pass every other rule you gave us. {emph}, because counting money you probably can't get is how these tools end up useless. If one of them describes you, it's likely the biggest thing on this page.", { emph: `<strong>${esc(T('They are deliberately excluded from your headline figure'))}</strong>` })}</p>
    <div class="bucket-list" style="margin-top:1rem">${r.conditional.slice(0, 20).map((m) => progCard(m, 'conditional')).join('')}</div>
    ${r.conditional.length > 20 ? `<p class="small">${esc(T('Showing {shown} of {n}.', { shown: NUM(20), n: NUM(r.conditional.length) }))}</p>` : ''}
  </section>`)}

  <!-- This bucket used to be labelled with the programme count, so eight
       eligible programmes read as "8 documents and deadlines" — a count of one
       thing wearing the name of another. Count what is in the bucket. -->
  ${(() => {
    const docs = documentRows(r).length;
    const dated = datedProgrammes(r).length;
    const n = docs + dated;
    const kind = docs && dated ? 'paperwork' : docs ? 'documents' : 'deadlines';
    return gated(n, kind, () => documentPlan(r) + deadlineSection(r));
  })()}

  <!-- The matcher has always computed a rights bucket — statutory
       entitlements like 90 days' sick leave or a wage-protection scheme, which
       are not payments you apply for — and nothing on this screen rendered it.
       Seven AE records for one persona, computed and dropped, which is also
       why the breakdown above never summed to the number beside it. -->
  ${gated((r.rights || []).length, 'rights', () => `<section class="bucket">
    <div class="bucket__head"><h2>${esc(T('Rights you already have'))}</h2><span class="bucket__count">${esc(T('{n} · nothing to claim', { n: NUM(r.rights.length) }))}</span></div>
    <p class="small" style="max-width:62ch">${esc(T('These are not payments and there is no application. They are things the law already entitles you to, and they are kept out of your total for that reason — but they are worth knowing about, because the commonest way to lose one is not to know it exists.'))}</p>
    <div class="bucket-list" style="margin-top:1rem">${r.rights.slice(0, 20).map((m) => progCard(m, 'eligible')).join('')}</div>
  </section>`)}

  ${gated(r.needs_one_more_answer.length, 'needs', () => `<section class="bucket">
    <div class="bucket__head"><h2>${esc(T('One answer away'))}</h2><span class="bucket__count">${esc(T('one={n} programme|other={n} programmes', { n: NUM(r.needs_one_more_answer.length) }, r.needs_one_more_answer.length))}</span></div>
    <p class="small">${esc(T('You pass everything we can test. Each of these needs one more detail — answer it and it moves bucket immediately.'))}</p>
    <div class="bucket-list" style="margin-top:1rem">${r.needs_one_more_answer.slice(0, 25).map((m) => progCard(m, 'maybe')).join('')}</div>
  </section>`)}

  ${ruledOutBlock(r)}

  <div class="callout" style="margin-top:3rem">
    <p>${T("{emph} {note} The figure sums published maximums for the programmes you're eligible for. Means-tested schemes taper, so treat it as a ceiling of what is on the table — and remember programmes with no published amount counted as zero.", {
      emph: `<strong>${esc(T('What this number is.'))}</strong>`,
      note: esc(T(r.coverage_note)),
    })}</p>
    <p style="margin-bottom:0"><a class="link-underline" href="${href('/methodology/')}">${esc(T("How this is calculated and what's wrong with it"))}</a></p>
  </div>
  <p class="tiny" style="margin-top:1.5rem">${esc(T(r.disclaimer || DISCLAIMER))} ${esc(T('Data as of {date}.', { date: r.data_as_of }))}</p>
</div>`;
}

/* ------------------------------------------------------------------ */
/* ICS export                                                          */
/* ------------------------------------------------------------------ */

function buildIcs() {
  const dated = S.result.eligible.filter(
    (m) => m.programme.deadline_type && !['none', 'rolling'].includes(m.programme.deadline_type),
  );
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Unclaimed//EN', 'CALSCALE:GREGORIAN'];
  dated.forEach((m, i) => {
    const p = m.programme;
    // No parsed date in the data — schedule a review reminder 30 days out.
    const d = new Date(Date.now() + (30 + i) * 86400000);
    const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:unclaimed-${S.entry.slug}-${p.slug}@unclaimed`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:Apply: ${p.name_en}`,
      `DESCRIPTION:${(p.deadline_note || p.deadline_type || '').replace(/\n/g, ' ')}\\n\\nFunder: ${p.funder}\\nOfficial page: ${p.application_url || p.source_url}\\n\\nReminder created by Unclaimed. Check the official page for the exact deadline.`,
      `URL:${p.application_url || p.source_url}`,
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `unclaimed-${S.entry.slug}-deadlines.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */

/* One beacon per funnel step, fired from the one place that knows which step
   is on screen. Scattering track() calls through the click handlers is how a
   funnel ends up counting the Back button. */
function trackStep(st) {
  const i = S.step;
  track('check_start');
  if (i >= 1) track('country', { country: S.profile.country_code });
  if (i >= 2) track('answers_1', { country: S.profile.country_code });
  if (i >= Math.ceil(st.length / 2)) track('answers_half', { country: S.profile.country_code });
}

async function render() {
  /* Reset here, not only in compute(): the results screen re-renders on its
     own (entitlement resolving, a circumstance being claimed) and the counter
     has to start from zero each time or the pitch disappears entirely. */
  gatedShown = 0;
  const st = steps();
  if (S.result) {
    /* Ask before drawing: rendering the list and then hiding it would put the
       whole paid product one devtools panel away. */
    await refreshEntitlement();
    track('answers_done', { country: S.profile.country_code });
    track('result', { country: S.profile.country_code });
    if (!ENTITLED) track('paywall_seen', { country: S.profile.country_code });
    app.innerHTML = viewResults();
  } else {
    /* A step in the list that this country cannot answer (region, where the
       country has none) is stepped over rather than dropped, so the
       denominator the reader was shown stays true. */
    if (stepSkipped(st[S.step])) S.step = nextStep(S.step, 1);
    trackStep(st);
    const which = st[S.step];
    app.innerHTML =
      which === 'country'
        ? viewCountry()
        : which === 'region'
          ? viewRegion()
          : which === 'status'
            ? viewStatus()
            : which === 'circumstances'
              ? viewCircumstances()
              : which === 'household'
              ? viewHousehold()
                : which === 'income'
                  ? viewIncome()
                  : viewHousing();
  }
  /* Every step view is an English template literal. Translate the rendered
     subtree once, here, at the single point both branches above converge —
     rather than wrapping sixty literals and missing the sixty-first. */
  translateTree(app);
  app.classList.toggle('wizard', !S.result);
  window.scrollTo({ top: 0, behavior: 'instant' });
  syncHistory();
  restoreDocTicks();

  const search = document.getElementById('csearch');
  if (search) {
    search.focus();
    const empty = document.getElementById('clist-empty');
    const count = document.getElementById('csearch-count');
    const apply = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      document.querySelectorAll('#clist .opt').forEach((el) => {
        const hit = el.dataset.name.includes(q);
        el.style.display = hit ? '' : 'none';
        if (hit) shown += 1;
      });
      /* Either a list or an explanation, never neither. */
      if (empty) {
        empty.hidden = shown !== 0;
        /* Written after translateTree() has already run, so it is written
           through T() rather than left for a walk that will never come. */
        const h = document.getElementById('clist-empty-h');
        if (h) h.textContent = T('No country matches “{q}”', { q: search.value.trim() });
      }
      const total = document.querySelectorAll('#clist .opt').length;
      if (count) count.textContent = T('{n} of {total} shown', { n: NUM(shown), total: NUM(total) });
    };
    search.addEventListener('input', apply);
    apply();
  }
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/*                                                                     */
/* The wizard used to leave location.hash alone entirely, so history    */
/* stayed at length 2 through the whole flow: the browser's Back button */
/* left the site from step 6, and a reload after "Change my answers"    */
/* silently reverted to the result the hash still described. One entry  */
/* per step makes Back mean what it looks like it means.                */
/* ------------------------------------------------------------------ */
/* Set by "Change my answers", read once by boot.
   sessionStorage, not localStorage: a restart is about this tab and this
   moment, and a stale flag surviving a week would drop a returning reader
   back into the questions for no reason they could see. */
const RESTART_KEY = 'unclaimed.check.restarted';
function markRestarted() {
  try { sessionStorage.setItem(RESTART_KEY, '1'); } catch { /* private mode */ }
}
function readRestarted() {
  try { return sessionStorage.getItem(RESTART_KEY) === '1'; } catch { return false; }
}
function clearRestarted() {
  try { sessionStorage.removeItem(RESTART_KEY); } catch { /* private mode */ }
}

let lastHistoryKey = null;

function syncHistory() {
  const key = S.result ? 'result' : `step-${S.step}`;
  if (key === lastHistoryKey) return;
  const first = lastHistoryKey === null;
  lastHistoryKey = key;
  try {
    /* Build the result URL here rather than reusing location.href.
       At the moment this runs the hash is still `#s=6` — the housing step —
       so the result entry was pushed AS the housing entry, and compute() then
       replaceState'd it to `#r=…`. The housing entry was overwritten and a
       duplicate #r entry left behind: from the result, one Back press changed
       nothing observable, the second landed on #s=5, and #s=6 was unreachable
       however many times you pressed. */
    const url = S.result ? `${location.pathname}#r=${encodeState()}` : `${location.pathname}#s=${S.step}`;
    if (first) history.replaceState({ key }, '', url);
    else history.pushState({ key }, '', url);
  } catch {
    /* Non-navigable context (a test harness, an embedded view). The wizard's
       own Back button still works; only the browser's is degraded. */
  }
}

window.addEventListener('popstate', () => {
  const m = location.hash.match(/^#s=(\d+)$/);
  if (!m) return;
  const want = Math.max(0, Math.min(steps().length - 1, Number(m[1])));
  if (S.result) S.result = null;
  S.step = want;
  lastHistoryKey = `step-${want}`;
  render();
});

/**
 * Load a country's dataset. Returns false when the country is not one we have,
 * having already reset the wizard to its first step.
 *
 * The find() below used to be dereferenced unguarded, so a hash naming a
 * country that does not exist — /check/#r=<base64 of {"country_code":"ZZ"}>,
 * which is one stale shared link — threw a TypeError out of an async handler
 * and left #app empty. A white screen with no heading and no control: the only
 * way out was editing the URL. Anything that comes from a URL is attacker- and
 * accident-shaped, so it gets a guard, not a dereference.
 */
async function loadCountry(cc) {
  const entry = S.manifest?.countries?.find((c) => c.slug === cc);
  if (!entry) {
    S.entry = null;
    S.data = null;
    S.result = null;
    S.step = 0;
    S.profile.country_code = null;
    clearProfile();
    /* The hash is what put us here; leaving it in place means a reload lands
       back on the same dead state. */
    try {
      history.replaceState(null, '', location.pathname);
    } catch {
      /* Non-navigable context. The reset above still holds. */
    }
    render();
    return false;
  }
  S.entry = entry;
  S.profile.country_code = entry.country_code;
  const res = await fetch(`${BASE}/api/v1/programmes/${cc}.json`);
  if (!res.ok) {
    S.data = null;
    S.result = null;
    S.step = 0;
    render();
    return false;
  }
  S.data = await res.json();
  return true;
}

/**
 * Read the numeric fields off the current step.
 *
 * These inputs carry min and max, and none of them is inside a <form>, so the
 * browser enforces nothing: age 999, household size -3 and 88 children were
 * all read straight through Number(), persisted, and turned into a confident
 * verdict. A number a person cannot mean is not an answer, so it is clamped to
 * the range the input itself declares and the correction is said out loud —
 * silently rewriting someone's answer is its own dishonesty.
 */
const clampNotes = [];

function readInputs() {
  clampNotes.length = 0;
  const g = (id) => {
    const el = document.getElementById(id);
    if (!el) return undefined;
    if (el.value.trim() === '') return null;
    const raw = Number(el.value);
    if (!Number.isFinite(raw)) return null;
    const lo = el.min === '' ? -Infinity : Number(el.min);
    const hi = el.max === '' ? Infinity : Number(el.max);
    const v = Math.min(hi, Math.max(lo, raw));
    if (v !== raw) {
      el.value = String(v);
      const label = el.parentElement?.querySelector('label')?.textContent?.trim() || id;
      clampNotes.push({ id, from: raw, to: v, label });
      const hint = el.parentElement?.querySelector('.hint');
      if (hint) {
        hint.textContent = T('We read that as {v} — the allowed range here is {lo} to {hi}.', {
          v: NUM(v),
          lo: NUM(el.min || 0),
          hi: el.max === '' ? T('no maximum') : NUM(el.max),
        });
        /* `.hint--corrected` was added here and styled nowhere, so a value the
           wizard had silently rewritten was described in copy identical to the
           static help text beside it — and the input reported aria-invalid
           null and aria-describedby null, so a screen reader was told nothing
           at all. Both ends of that are fixed: theme.css has the rule, and the
           field now announces itself. */
        if (!hint.id) hint.id = `${id}-hint`;
        hint.classList.add('hint--corrected');
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', hint.id);
      }
    } else {
      el.removeAttribute('aria-invalid');
      el.parentElement?.querySelector('.hint')?.classList.remove('hint--corrected');
    }
    return v;
  };
  const age = g('age');
  if (age !== undefined) S.profile.age = age;
  const hh = g('hh');
  if (hh !== undefined) S.profile.household_size = hh ?? 1;
  const kids = g('kids');
  if (kids !== undefined) S.profile.children_count = kids ?? 0;
  const inc = g('inc');
  if (inc !== undefined) S.profile.income_annual = inc;
  const res = g('res');
  if (res !== undefined) S.profile.residency_months = res;
}

function compute() {
  gatedShown = 0;
  clearRestarted();
  S.result = match(S.profile, S.data, S.entry);
  /* The history entry for the result is pushed by syncHistory(), which render()
     calls below. Rewriting the URL here is what used to clobber the step the
     reader came from. */
  /* Both, on every result. The hash is for sharing and for the back button;
     the local copy is what survives the trip to /account/ and back. */
  saveProfile();
  render();
}

function advance() {
  readInputs();
  saveProfile();
  /* Something was out of range. Stay put and say so, rather than moving on
     with a number the reader did not type. */
  if (clampNotes.length) {
    /* An arrow pair — "99 → 20" — names neither the field nor the reason. */
    const n = clampNotes
      .map((c) => {
        const v = { label: c.label, from: NUM(c.from), to: NUM(c.to) };
        return c.to < c.from
          ? T('{label} from {from} to {to} — {to} is the maximum', v)
          : T('{label} from {from} to {to} — {to} is the minimum', v);
      })
      .join('; ');
    const el = document.querySelector('.wizard-nav');
    if (el) {
      let note = document.getElementById('clamp-note');
      if (!note) {
        note = document.createElement('p');
        note.id = 'clamp-note';
        note.className = 'small notice notice--error';
        note.setAttribute('role', 'status');
        el.parentElement.insertBefore(note, el);
      }
      note.textContent = T('We changed {what}. Check it, then continue.', { what: n });
    }
    clampNotes.length = 0;
    return;
  }
  const st = steps();
  if (S.step >= st.length - 1) compute();
  else {
    S.step = nextStep(S.step, 1);
    render();
  }
}

/**
 * Render the pack that POST /api/apply/plan returns.
 *
 * Deliberately plain: this is the artefact a subscriber paid for, so every
 * field it shows is one the Worker actually sent. Where the pack has nothing
 * to say — no gaps, no documents — the section is not rendered rather than
 * rendered empty, because an empty "Documents" heading reads as a failure.
 */
function renderPlanPack(plan) {
  const packs = plan?.packages || [];
  if (!packs.length) {
    return `<p class="small" style="margin-top:1rem">${esc(
      t('check.prepare.empty', 'Nothing here needs an application from you — every match is paid automatically.'),
    )}</p>`;
  }
  const gaps = plan.gaps || [];
  const head = `<p class="small" style="margin-top:1rem">${T(
    'one={emph} pack is ready to send.|other={emph} packs are ready to send.',
    { emph: `<strong>${esc(T('{ready} of {total}', { ready: NUM(plan.ready_count), total: NUM(packs.length) }))}</strong>` },
    packs.length,
  )}${
    gaps.length
      ? ' ' +
        esc(
          T('one={n} answer still missing: {list}.|other={n} answers still missing: {list}.', {
            n: NUM(gaps.length),
            list: gaps.slice(0, 6).map((g) => T(g.label || g.field)).join(', '),
          }, gaps.length),
        )
      : ''
  }</p>`;
  const body = packs
    .map((pkg) => {
      const docs = (pkg.documents || []).filter((d) => d.mandatory);
      const steps = pkg.steps || [];
      const url = pkg.submit?.url;
      return `<div class="card card-flat" style="margin-top:1rem">
      <div class="list-row__name"><strong>${esc(pkg.programme_slug)}</strong>
        <span class="badge ${pkg.readiness?.ready ? 'badge-auto-apply' : 'badge-neutral'}">${esc(
          pkg.readiness?.ready ? T('ready to send') : T('{pct}% filled', { pct: NUM(pkg.readiness?.fields_pct ?? 0) }),
        )}</span></div>
      ${(pkg.blockers || []).length ? `<p class="small notice notice--error" style="margin-top:.6rem">${esc(T(pkg.blockers[0].message))}</p>` : ''}
      ${pkg.message ? `<p class="small" style="margin-top:.6rem;white-space:pre-wrap">${esc(pkg.message)}</p>` : ''}
      ${
        (pkg.fields_missing || []).length
          ? `<p class="tiny" style="margin-top:.6rem">${esc(T('Still needs from you: {list}', { list: pkg.fields_missing.map((f) => T(f)).join(', ') }))}</p>`
          : ''
      }
      ${
        docs.length
          ? `<p class="tiny" style="margin-top:.6rem">${esc(T('Documents to attach: {list}', { list: docs.map((d) => T(d.doc)).join(', ') }))}</p>`
          : ''
      }
      ${
        steps.length
          ? `<ol class="small" style="margin-top:.6rem">${steps
              .map((st) => `<li>${esc(st.detail)}</li>`)
              .join('')}</ol>`
          : ''
      }
      ${
        (pkg.attestations || []).length
          ? `<div class="notice" style="margin-top:.8rem">
              <p class="tiny" style="margin:0">${esc(T('By continuing you declare:'))}</p>
              <ul class="small" style="margin:.4rem 0 0">${pkg.attestations
                .map((a) => `<li>${esc(typeof a === 'string' ? a : a.text || a.statement || '')}</li>`)
                .join('')}</ul>
              <p class="btn-row" style="margin-top:.6rem"><button class="btn btn-sm" type="button"
                data-act="consent" data-slug="${esc(pkg.programme_slug)}">${esc(T('Record my declaration'))}</button></p>
            </div>`
          : ''
      }
      ${
        url
          ? `<p class="btn-row" style="margin-top:.8rem"><a class="btn btn-sm" href="${esc(
              url,
            )}" target="_blank" rel="noopener">${esc(T('Open the official form'))}</a></p>`
          : ''
      }
    </div>`;
    })
    .join('');
  return head + body;
}

app.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button, a[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === 'country') {
    btn.textContent = T('Loading…');
    if (!(await loadCountry(btn.dataset.cc))) return;
    S.step = 1;
    render();
    return;
  }
  if (btn.dataset.multi) {
    const key = btn.dataset.multi;
    const v = btn.dataset.value;
    const cur = new Set(S.profile[key] || []);
    cur.has(v) ? cur.delete(v) : cur.add(v);
    S.profile[key] = [...cur];
    render();
    return;
  }
  if (btn.dataset.field) {
    S.profile[btn.dataset.field] = btn.dataset.value;
    // Single-choice steps advance immediately; the housing step has two groups.
    const st = steps()[S.step];
    if (st === 'region' || st === 'status' || st === 'income') {
      setTimeout(advance, 130);
    } else {
      render();
    }
    return;
  }
  if (act === 'back') {
    readInputs();
    S.step = nextStep(S.step, -1);
    render();
    return;
  }
  if (act === 'next') return advance();
  if (act === 'skip') {
    const st = steps()[S.step];
    if (st === 'region') S.profile.admin_area = null;
    if (st === 'circumstances') S.profile.circumstances = [];
    if (st === 'income') {
      S.profile.income_band = null;
      S.profile.income_annual = null;
    }
    S.step = nextStep(S.step, 1);
    render();
    return;
  }
  if (act === 'csearch-clear') {
    const el = document.getElementById('csearch');
    if (el) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    }
    return;
  }
  if (act === 'restart') {
    /* Step 1, not 0, so "change my answers" keeps the country and drops you at
       the first real question. */
    S.result = null;
    S.step = nextStep(0, 1);
    /* The hash still described the result we just left. Boot reads the hash
       before anything else, so without this a reload silently undid the very
       thing the button is named after. */
    try {
      history.replaceState(null, '', location.pathname);
    } catch {
      /* Non-navigable context. */
    }
    lastHistoryKey = null;
    markRestarted();
    render();
    return;
  }
  /* Start completely over, country included.
     
     "Change my answers" went to step 1, which is the region question — so the
     country was the one answer you could never change. Combined with the
     profile now being remembered between visits, a person who picked the wrong
     country once was stuck in it permanently, with no control anywhere on the
     page to escape. That is the dead end reported as "there is no way I can go
     back to choosing another set of answers". */
  if (act === 'start-over') {
    clearProfile();
    S.result = null;
    S.profile = {};
    S.data = null;
    S.entry = null;
    S.step = 0;
    history.replaceState(null, '', location.pathname);
    render();
    return;
  }
  if (act === 'answer') {
    const attrMap = { income: 'income', age: 'household', admin_area: 'region', housing_tenure: 'housing', nationality: 'housing', residency_months: 'housing', status: 'status', circumstance: 'circumstances' };
    const target = attrMap[btn.dataset.attr] || 'housing';
    /* "This does apply to me" now means it. The circumstance the card named is
       turned on and the result recomputed, rather than dumping the reader on
       the circumstances step with that option still unticked — which is what
       every one of these buttons did, because the tag was discarded at render
       time. Ticking is still visible: the reader lands back on the result with
       the programme moved out of "depends on your circumstances". */
    const circ = (btn.dataset.circ || '').split(',').filter(Boolean);
    if (circ.length && S.data && S.entry) {
      const set = new Set(S.profile.circumstances || []);
      for (const c of circ) set.add(c);
      S.profile.circumstances = [...set];
      saveProfile();
      compute();
      return;
    }
    S.result = null;
    S.step = Math.max(0, steps().indexOf(target));
    render();
    return;
  }
  /* "Prepare my applications" — the only paid-only control on this screen.
     It rendered from the day auto-apply shipped and had no branch here, so an
     entitled subscriber clicked it, no /api/* request left the browser, and
     #prepare-out stayed empty. Nothing errored; the moat was simply not
     wired to its own button. */
  if (act === 'prepare') {
    const out = document.getElementById('prepare-out');
    if (!out) return;
    const label = btn.textContent;
    btn.disabled = true;
    /* Every write below goes through setHTML/T. translateTree() ran once, at
       render time, and never again — so a string written here was English in
       all six locales however good its translation was. Two of these shipped
       correct French and rendered English for exactly that reason. */
    btn.innerHTML = `<span class="btn__spinner" aria-hidden="true"></span>${esc(T('Preparing…'))}`;
    setHTML(out, `<p class="small" style="margin-top:1rem">${esc(
      t('check.prepare.pending', 'Building your packs — this reads every match, so give it a moment.'),
    )}</p>`);
    const done = () => {
      btn.disabled = false;
      btn.textContent = label;
    };
    let r;
    try {
      r = await applyPlan(S.profile, document.documentElement.lang || 'en');
    } catch {
      /* Offline or the Worker is unreachable. Say so; a silent no-op is the
         bug this branch exists to end. */
      setHTML(out, `<p class="small notice notice--error" role="alert" style="margin-top:1rem">${esc(
        t('check.prepare.offline', "We couldn't reach the server. Check your connection and try again."),
      )}</p>`);
      done();
      return;
    }
    if (!r.ok) {
      const msg =
        r.status === 401
          ? t('check.prepare.signin', 'Sign in to prepare your applications.')
          : r.status === 402
            ? t('check.prepare.paywall', 'Preparing applications is part of a paid plan.')
            : T(r.data?.message || r.data?.error || '') || t('check.prepare.error', 'Something went wrong preparing your pack.');
      setHTML(out, `<p class="small notice notice--error" role="alert" style="margin-top:1rem">${esc(msg)}</p>`);
      done();
      return;
    }
    S.plan = r.data;
    /* The whole prepared-applications pack — the most expensive surface on the
       site — was written straight into the DOM after the one translateTree()
       call, so it was 100% English in all six locales no matter what the
       dictionary held. */
    setHTML(out, renderPlanPack(r.data));
    done();
    return;
  }
  /* The declaration that has to exist before a pack is acted on. Sold,
     stored by the Worker since auto-apply landed, and until now asked for by
     nothing. */
  if (act === 'consent') {
    const slug = btn.dataset.slug;
    const pkg = (S.plan?.packages || []).find((x) => x.programme_slug === slug);
    if (!pkg) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn__spinner" aria-hidden="true"></span>${esc(T('Recording…'))}`;
    let r;
    try {
      r = await recordApplyConsent({
        programmeSlug: slug,
        country: S.profile.country_code,
        attestations: (pkg.attestations || []).map((a) => (typeof a === 'string' ? a : a.text || a.statement || '')),
        values: pkg.fields || {},
      });
    } catch {
      r = { ok: false, data: {} };
    }
    btn.disabled = false;
    btn.textContent = r.ok ? T('Declaration recorded ✓') : label;
    if (!r.ok) {
      const p = document.createElement('p');
      p.className = 'small notice notice--error';
      p.setAttribute('role', 'alert');
      p.textContent = T(r.data?.message || r.data?.error || '') || T("We couldn't record that — try again.");
      btn.parentElement.insertAdjacentElement('afterend', p);
    }
    return;
  }
  if (act === 'ics') return buildIcs();
  if (act === 'share') {
    const url = `${location.origin}${location.pathname}#r=${encodeState()}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Unclaimed', text: estimateShareText(S.result, S.entry.name), url });
      } else {
        await navigator.clipboard.writeText(url);
        const label = t('check.share.button', 'Copy a link that contains my answers');
        btn.textContent = T('Link copied ✓');
        setTimeout(() => (btn.textContent = label), 2200);
      }
    } catch {
      /* user dismissed */
    }
  }
});

// A shared result link pasted while /check/ is already open changes only the
// hash, which does not re-run the module. Without this the recipient sees the
// wizard's first step instead of the result they were sent.
window.addEventListener('hashchange', async () => {
  const h = location.hash.match(/r=([A-Za-z0-9_-]+)/);
  if (!h) return;
  const p = decodeState(h[1]);
  if (!p || !p.country_code) return;
  if (S.result && encodeState() === h[1]) return;
  Object.assign(S.profile, p);
  if (!(await loadCountry(String(p.country_code).toLowerCase()))) return;
  compute();
});

/* ---- boot ---- */
bindCheckout(document);

(async () => {
  S.manifest = await (await fetch(`${BASE}/api/v1/countries.json`)).json();

  const hash = location.hash.match(/r=([A-Za-z0-9_-]+)/);
  const qc = new URLSearchParams(location.search).get('country');

  if (hash) {
    const p = decodeState(hash[1]);
    if (p && p.country_code) {
      Object.assign(S.profile, p);
      saveProfile();
      if (!(await loadCountry(String(p.country_code).toLowerCase()))) return;
      compute();
      return;
    }
  }

  /* Nothing in the URL — but this browser may have answered already.
     
     Signing in navigates away to /account/ and back, and the answers lived
     ONLY in the location hash, so every one of them was gone by the time the
     user returned: country, age, income, household, all of it, re-entered from
     scratch immediately after proving who they are. That is the single worst
     moment in the product to throw work away, because it happens to exactly
     the people who have decided to pay. */
  const saved = loadProfile();
  if (saved && saved.country_code) {
    Object.assign(S.profile, saved);
    if (!(await loadCountry(String(saved.country_code).toLowerCase()))) return;
    /* Restore the answers, but NOT the finished result, if the URL says the
       reader is mid-wizard.
       "Change my answers" clears the hash and drops you at #s=1. Re-answer one
       question, reload, and this branch used to run compute() unconditionally
       — throwing you onto a finished result computed from a half-re-answered
       profile, which is the exact thing the button had just undone. The
       restart handler already clears the hash for this reason; boot has to
       read it. */
    const step = location.hash.match(/^#s=(\d+)$/);
    if (step) {
      S.step = Math.max(0, Math.min(steps().length - 1, Number(step[1])));
      if (stepSkipped(steps()[S.step])) S.step = nextStep(S.step, 1);
      lastHistoryKey = `step-${S.step}`;
      render();
      return;
    }
    /* "Change my answers" clears the hash, so an empty hash on its own cannot
       tell a restart from the /account/ round trip — and that round trip is
       the whole reason the profile is saved. A one-shot flag says which. */
    if (readRestarted()) {
      clearRestarted();
      S.step = nextStep(0, 1);
      render();
      return;
    }
    compute();
    return;
  }
  if (qc && S.manifest.countries.some((c) => c.slug === qc)) {
    if (!(await loadCountry(qc))) return;
    S.step = 1;
  }
  render();
})();
