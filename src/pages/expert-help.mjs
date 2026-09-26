/**
 * "Get expert help" — the handoff to involve-consulting.com, the owner's
 * separate paid consulting business (see CLAUDE.md, "works in parallel to
 * involve-consulting.com"). Unclaimed itself stays free-to-check and
 * self-serve; this is an honest, opt-in referral for someone who wants a
 * human to review their application, not a feature of the free product.
 *
 * New file, not a block in build.mjs, for the same reason src/pages/alerts.mjs
 * and src/pages/de-minimis.mjs are their own files: several builders edit
 * build.mjs at once, and a self-contained component build.mjs only imports and
 * calls is a smaller place to collide.
 *
 * English-only: the CTA is inserted on /startups/** (already English-only)
 * and inside the two client-rendered wizards (app.js, startup-check.js),
 * neither of which is translated today (see wizard-i18n.js's own header
 * comment) — so there is no localised surface this needs i18n keys on.
 *
 * Flat-fee referral only. Nothing here quotes a price or a percentage, and
 * nothing here should ever be changed to a success fee or commission —
 * packages/policy/index.js's ban on contingent fees for the underlying
 * product applies to this referral too.
 */
import { esc, attr, layout } from '../ui.mjs';

/**
 * The CTA block itself, dropped onto company results, company programme
 * pages, and the application brief.
 *
 * @param {{ base: string, audience: 'company'|'household', programmeSlug?: string, country?: string, compact?: boolean }} opts
 */
export function expertHelpCta({ base, audience, programmeSlug = '', country = '', compact = false }) {
  const params = new URLSearchParams();
  if (audience) params.set('audience', audience);
  if (programmeSlug) params.set('programme', programmeSlug);
  if (country) params.set('country', country);
  const qs = params.toString();
  const href = `${base}/help/expert/${qs ? `?${qs}` : ''}`;

  return `
<div class="card${compact ? ' card-flat' : ''}" style="margin-top:${compact ? '1.2rem' : '2rem'};border-style:dashed">
  <p class="eyebrow">Paid, separate from Unclaimed</p>
  <h3 style="margin:.2rem 0 .4rem">Want a human to review your application?</h3>
  <p class="small" style="margin:0 0 .8rem;max-width:56ch;color:var(--ink-3)">Involve Consulting can help — a paid
  expert-review service run by the same person behind Unclaimed, entirely separate from this free check. A flat fee,
  agreed up front; never a cut of what you receive.</p>
  <a class="btn btn-sm" href="${attr(href)}">Talk to Involve Consulting</a>
</div>`;
}

/**
 * /help/expert/ — the lead form. Prefills name/email/country/programme from
 * the query string the CTA links carry (?audience=&programme=&country=), all
 * read client-side so this stays a single static page.
 */
export function renderExpertHelpPage({ BASE, LB, SITE_URL }) {
  const body = `
<section class="section-tight shell-narrow">
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${LB()}/">Home</a><span aria-current="page">Get expert help</span></nav>
  <span class="eyebrow eyebrow-accent">Paid — separate from Unclaimed</span>
  <h1 style="max-width:24ch">Talk to Involve Consulting</h1>
  <p class="lede" style="max-width:60ch">Unclaimed's eligibility check is free. If you want a person to look at your
  specific application — which grants fit, whether your documents hold up, how to word the tricky parts — Involve
  Consulting is a separate paid service run by the same person behind this site. It is a flat fee agreed with you up
  front, never a percentage of anything you receive. You can read about the service first at
  <a class="link-underline" href="https://involve-consulting.com/" rel="noopener">involve-consulting.com</a>.</p>

  <div class="callout" style="margin-top:1.2rem">
    <p><strong>What this is not:</strong> Unclaimed does not share your answers with Involve Consulting, does not take
    a cut of any award, and this form does not submit an application on your behalf — it only asks Involve Consulting
    to get in touch.</p>
  </div>

  <form class="card" id="lead-form" style="margin-top:2rem;display:grid;gap:.8rem;max-width:34rem">
    <label for="lead-name">Name<input id="lead-name" name="name" class="field" required maxlength="200" autocomplete="name"></label>
    <label for="lead-email">Email<input id="lead-email" name="email" type="email" class="field" required maxlength="254" autocomplete="email"></label>
    <label for="lead-country">Country (optional)<input id="lead-country" name="country" class="field" maxlength="8" placeholder="e.g. gb"></label>
    <input type="hidden" id="lead-programme" name="programme_slug">
    <input type="hidden" id="lead-audience" name="audience">
    <label for="lead-message">What are you applying for? (optional)<textarea id="lead-message" name="message" class="field" rows="4" maxlength="2000"></textarea></label>
    <label style="display:flex;gap:.5rem;align-items:flex-start;font-size:.9rem">
      <input type="checkbox" id="lead-consent" name="consent" required style="margin-top:.2rem">
      <span>I agree to be contacted by Involve Consulting about this. I understand this is a paid service, separate
      from Unclaimed, at a flat fee — never a percentage of any grant.</span>
    </label>
    <button class="btn btn-primary" type="submit">Send</button>
    <p class="small" role="status" aria-live="polite" id="lead-msg" hidden></p>
  </form>

  <script>
  (() => {
    const qs = new URLSearchParams(location.search);
    const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    set('lead-country', qs.get('country'));
    set('lead-programme', qs.get('programme'));
    set('lead-audience', qs.get('audience'));
    const form = document.getElementById('lead-form');
    const msg = document.getElementById('lead-msg');
    const say = (t) => { msg.textContent = t; msg.hidden = false; };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      const fd = new FormData(form);
      try {
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: fd.get('name'), email: fd.get('email'), country: fd.get('country'),
            programme_slug: fd.get('programme_slug'), audience: fd.get('audience'),
            message: fd.get('message'), consent: fd.get('consent') === 'on',
          }),
        });
        if (res.ok) { say("Sent — Involve Consulting will reach out by email."); form.reset(); }
        else {
          const data = await res.json().catch(() => ({}));
          say(data.error === 'too_many_requests' ? 'Too many requests — try again in an hour.' : 'Something went wrong. Try again shortly.');
        }
      } catch { say('Something went wrong. Try again shortly.'); }
      finally { btn.disabled = false; }
    });
  })();
  </script>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: 'en',
    altLangs: [],
    title: 'Get expert help — Involve Consulting',
    description: 'A paid, flat-fee expert review of your grant or benefit application from Involve Consulting — a separate service from Unclaimed’s free check.',
    canonical: `${SITE_URL}/help/expert/`,
    body,
  });
}
