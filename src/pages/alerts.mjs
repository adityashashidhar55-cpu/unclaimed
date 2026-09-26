/**
 * The deadline-alerts subscribe box.
 *
 * New file rather than another block inside src/build.mjs, on purpose — this
 * repo has several builders editing build.mjs at once, and a self-contained
 * component that build.mjs only calls (one import line, one call per page) is
 * a much smaller place to collide than a few hundred more lines inside an
 * already 4,000-line file.
 *
 * English-only, like the rest of /startups/* — see CLAUDE.md. No i18n keys
 * needed here.
 *
 * Plain inline <script>, not a module import from a separate .js asset: the
 * box does one small, self-contained thing (two fetches and some DOM), and
 * every other page's own script already reads that way inline. Wiring it
 * through the module-asset pipeline (see auth.js et al) would be more moving
 * parts for less code.
 */
import { esc, attr } from '../ui.mjs';

/**
 * @param {{
 *   jurisdiction?: string,               a single fixed cc — used on a country or programme page
 *   jurisdictionOptions?: {slug:string,name:string}[],  offered as a <select> when there is no fixed one
 *   audience: 'companies'|'individuals',
 *   heading?: string,
 * }} opts
 */
export function alertsSubscribeBox({ jurisdiction, jurisdictionOptions, audience, heading = 'Get a heads-up before deadlines close' }) {
  const cc = String(jurisdiction || '').toLowerCase();
  const boxId = `alerts-box-${cc || 'all'}-${audience}`;
  const hasOptions = !cc && Array.isArray(jurisdictionOptions) && jurisdictionOptions.length > 0;

  const picker = hasOptions
    ? `<label for="${boxId}-cc" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Jurisdiction</label>
       <select id="${boxId}-cc" name="jurisdiction" class="field" required>
         ${jurisdictionOptions.map((o) => `<option value="${attr(o.slug)}">${esc(o.name)}</option>`).join('')}
       </select>`
    : '';

  /* The whole slot — spacing, card and script — is one element, hidden until
     /api/alerts/status says alerts are configured. A wrapper with its own
     margin around a hidden card used to stay in the flow as a zero-height
     last child: 2rem of air with nothing in it, and it stopped the real last
     block from being :last-child, so that block's bottom margin hung above
     the footer. theme.css (.alerts-slot) carries the spacing and zeroes the
     margin of whatever sits directly before a slot that is still hidden. */
  return `
<div class="alerts-slot" data-alerts-slot hidden>
<div class="card" id="${boxId}" data-alerts-box data-jurisdiction="${attr(cc)}" data-audience="${attr(audience)}">
  <p class="eyebrow">Free</p>
  <h3 style="margin:.2rem 0 .4rem">${esc(heading)}</h3>
  <p class="small" style="margin:0 0 .9rem;max-width:52ch;color:var(--ink-3)">
    One email when a programme in your country closes in 2 weeks or 3 days, or newly opens. No spam,
    one click to stop. Covers every programme in the country you pick. Free covers one country; a paid plan can watch as many as you like.
  </p>
  <form data-alerts-form class="row" style="gap:.5rem;flex-wrap:wrap;align-items:center">
    <label for="${boxId}-email" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Email address</label>
    <input id="${boxId}-email" name="email" type="email" required placeholder="you@example.com"
      class="field" style="flex:1;min-width:14rem" autocomplete="email">
    ${picker}
    <button class="btn btn-primary" type="submit">Alert me</button>
  </form>
  <p class="small" data-alerts-msg role="status" aria-live="polite" style="margin:.6rem 0 0" hidden></p>
</div>
<script>
(() => {
  const box = document.getElementById(${JSON.stringify(boxId)});
  if (!box) return;
  const slot = box.closest('[data-alerts-slot]');
  fetch('/api/alerts/status').then((r) => r.json()).then((d) => {
    if (d && d.configured && slot) slot.hidden = false;
  }).catch(() => {});

  const form = box.querySelector('[data-alerts-form]');
  const msg = box.querySelector('[data-alerts-msg]');
  const say = (text) => { msg.textContent = text; msg.hidden = false; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = new FormData(form).get('email');
    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    try {
      const res = await fetch('/api/alerts/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          audience: box.dataset.audience,
          jurisdictions: [box.dataset.jurisdiction || new FormData(form).get('jurisdiction') || ''].filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        say('Check your inbox to confirm — one click and you\\'re set.');
        form.reset();
      } else if (data.error === 'jurisdiction_limit') {
        say('Free alerts cover one jurisdiction. A paid plan can watch more — sign in first if you have one.');
      } else if (data.error === 'too_many_requests') {
        say('Too many requests — try again in an hour.');
      } else {
        say('Something went wrong. Try again shortly.');
      }
    } catch {
      say('Something went wrong. Try again shortly.');
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
</script>
</div>`;
}
