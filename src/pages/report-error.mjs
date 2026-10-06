/**
 * /report-error/ — "this programme page is wrong".
 *
 * Linked from the source block of every programme page (household and company)
 * with the record already named in the query string, so the reader says what is
 * wrong, not which page they were on. Posts to POST /api/report-issue, which
 * stores into D1 table issue_reports (migration 0016) — the same queue the MCP
 * report_issue tool now feeds — and answers with a reference the reader can quote.
 *
 * One static page for ~6,600 programme pages: a link costs a page nothing, an
 * inline form on each would be 6,600 copies of the same markup.
 *
 * English-only, like /help/expert/ and /scams/: the link text beside it on each
 * programme page is translated; this form is a reference surface. noindex — a
 * form with no content is not something to rank.
 */
import { layout } from '../ui.mjs';

export function renderReportErrorPage({ BASE, LB, SITE_URL }) {
  const body = `
<section class="section-tight shell-narrow">
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${LB()}/">Home</a><span aria-current="page">Report an error</span></nav>
  <span class="eyebrow eyebrow-accent">Corrections</span>
  <h1 style="max-width:24ch">Report an error</h1>
  <p class="lede" style="max-width:60ch">Found a wrong amount, a dead link, a rule or a deadline that has moved? Tell us
  what is wrong and, if you can, point to the official page that shows it. Every report is read by a person, and a
  confirmed correction is made on the record and dated.</p>

  <form class="card" id="issue-form" style="margin-top:1.6rem;display:grid;gap:.8rem;max-width:36rem" novalidate>
    <p class="small" id="issue-about" style="margin:0" hidden>About: <strong id="issue-about-name"></strong></p>
    <input type="hidden" id="issue-slug" name="slug">
    <input type="hidden" id="issue-country" name="country_code">
    <input type="hidden" id="issue-audience" name="audience">
    <label for="issue-slug-visible" id="issue-slug-row" hidden>Programme<input id="issue-slug-visible" class="field" maxlength="200" placeholder="e.g. gb/some-programme"></label>
    <label for="issue-type">What is wrong?
      <select id="issue-type" name="issue_type" class="field">
        <option value="wrong_amount">The amount is wrong</option>
        <option value="dead_link">A link is dead or goes to the wrong page</option>
        <option value="rule_changed">An eligibility rule has changed</option>
        <option value="wrong_deadline">The deadline or opening date is wrong</option>
        <option value="other" selected>Something else (for example, it no longer exists)</option>
      </select>
    </label>
    <label for="issue-description">What is wrong, in your own words
      <textarea id="issue-description" name="description" class="field" rows="4" maxlength="2000" required></textarea>
    </label>
    <label for="issue-suggested">What should it say instead? (optional)<input id="issue-suggested" name="suggested" class="field" maxlength="1000"></label>
    <label for="issue-evidence">Link to the official page that shows it (optional)<input id="issue-evidence" name="evidence_url" type="url" class="field" maxlength="500" placeholder="https://"></label>
    <label for="issue-contact">Your email, only if you want to hear when it is fixed (optional)<input id="issue-contact" name="reporter_contact" type="email" class="field" maxlength="254" autocomplete="email"></label>
    <div aria-hidden="true" style="position:absolute;left:-9999px;height:0;overflow:hidden">
      <label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
    </div>
    <button class="btn btn-primary" type="submit">Send report</button>
    <p class="small" role="status" aria-live="polite" id="issue-msg" hidden></p>
    <p class="tiny" style="margin:0">We keep what you type here and a short, one-way fingerprint of your connection to spot flooding.
    Nothing is shown publicly. This form is not for applications or personal questions about a claim.</p>
  </form>

  <script>
  (() => {
    const qs = new URLSearchParams(location.search);
    const $ = (id) => document.getElementById(id);
    const slug = (qs.get('slug') || '').slice(0, 200);
    $('issue-slug').value = slug;
    $('issue-country').value = (qs.get('country') || slug.split('/')[0] || '').slice(0, 8);
    $('issue-audience').value = qs.get('audience') || '';
    if (slug) { $('issue-about').hidden = false; $('issue-about-name').textContent = slug; }
    else { $('issue-slug-row').hidden = false; }
    const form = $('issue-form');
    const msg = $('issue-msg');
    const say = (t) => { msg.textContent = t; msg.hidden = false; };
    const WHY = {
      description_required: 'Please say what is wrong, in a sentence or two.',
      slug_required: 'Please name the programme (for example gb/some-programme).',
      invalid_slug: 'That programme name has characters we cannot use.',
      invalid_evidence_url: 'The link must start with http:// or https://.',
      invalid_contact: 'That email address does not look right.',
      too_many_requests: 'Too many reports from this connection. Try again in an hour.',
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!slug) $('issue-slug').value = $('issue-slug-visible').value.trim();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      payload.page_url = document.referrer || '';
      payload.locale = (document.documentElement.lang || '').slice(0, 8);
      try {
        const res = await fetch('/api/report-issue', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) { say('Thank you — reference ' + (data.reference || '') + '. A person will read it.'); form.reset(); }
        else if (res.status === 503) say('Reporting is not available just yet. Please try again shortly.');
        else say(WHY[data.error] || 'Something went wrong. Please try again shortly.');
      } catch { say('Something went wrong. Please try again shortly.'); }
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
    title: 'Report an error — Unclaimed',
    description: 'Tell us a programme page is wrong, out of date or has a dead link. A person reads every report.',
    canonical: `${SITE_URL}/report-error/`,
    head: '<meta name="robots" content="noindex,follow">',
    body,
  });
}

