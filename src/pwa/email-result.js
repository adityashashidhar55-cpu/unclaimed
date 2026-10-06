/**
 * "Email me this result" — the card both results screens share.
 *
 * The free check runs in the browser and stores nothing, which is a promise
 * worth keeping and also means every visitor who does not buy today is gone.
 * This is the opt-in bridge back, and it is exactly that: nothing is sent
 * anywhere until the visitor types an address and presses the button, and the
 * card says what happens to their answers in both cases (ticked / not).
 *
 * The browser sends the profile only; the server recomputes the free result
 * from it. A number typed into the request by a visitor is never what lands in
 * an inbox.
 */
import { T, wizardLang } from './wizard-i18n.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The card's markup. `audience` is 'household' or 'company'. */
export function emailResultCard(audience) {
  return `<section class="card no-print" id="email-result" data-audience="${esc(audience)}" style="margin-top:1rem;max-width:62ch;padding-block:1rem">
    <h3 style="margin:0 0 .3rem">${esc(T('Email me this result'))}</h3>
    <p class="small" style="margin:0 0 .6rem">${esc(T('We will send the headline figures, a link back to this result and how to unlock the full list. No account needed.'))}</p>
    <form data-email-result novalidate>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="flex:1 1 15rem;margin:0">
          <label for="er-email">${esc(T('Your email address'))}</label>
          <input id="er-email" name="email" type="email" inputmode="email" autocomplete="email" required>
        </div>
        <button class="btn btn-primary" type="submit">${esc(T('Email me this result'))}</button>
      </div>
      <label style="display:flex;gap:.6rem;align-items:flex-start;margin:.7rem 0 0;font-size:.9rem;line-height:1.4">
        <input id="er-consent" name="consent" type="checkbox" style="margin-top:.2rem;flex:none">
        <span>${esc(T('Also send me a few short follow-up emails: deadlines in my country, how to read this result, and a weekly note if it changes. One click to unsubscribe.'))}</span>
      </label>
      <p class="small" id="er-status" role="status" aria-live="polite" style="margin:.5rem 0 0"></p>
      <p class="tiny" style="margin:.5rem 0 0">${esc(T('If you tick the box, we keep your answers so we can re-run this check for you. If you do not, we send this one email and delete your answers straight away. Nothing leaves this device until you press the button.'))}</p>
    </form>
  </section>`;
}

/**
 * Wire the card. Called once per page by each wizard; delegated from the
 * document because the results screen is re-rendered wholesale.
 * `getProfile()` returns the answers as entered.
 */
export function bindEmailResult({ audience, getProfile }) {
  document.addEventListener('submit', async (ev) => {
    const form = ev.target.closest?.('form[data-email-result]');
    if (!form) return;
    ev.preventDefault();

    const status = form.querySelector('#er-status');
    const btn = form.querySelector('button[type=submit]');
    const email = form.querySelector('#er-email').value.trim();
    const consent = form.querySelector('#er-consent').checked;
    const say = (msg) => { if (status) status.textContent = msg; };

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      say(T('Enter a valid email address.'));
      form.querySelector('#er-email').focus();
      return;
    }

    btn.disabled = true;
    say(T('Sending…'));
    try {
      const res = await fetch('/api/results/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, audience, consent, profile: getProfile(), locale: wizardLang() }),
      });
      if (res.ok) {
        say(consent
          ? T('Sent. Check your inbox, and your spam folder. Follow-up emails are on; every one has an unsubscribe link.')
          : T('Sent. Check your inbox, and your spam folder.'));
        return;
      }
      if (res.status === 429) say(T('Too many requests. Try again in an hour.'));
      else if (res.status === 503) say(T('Email is not switched on yet. Please try again later.'));
      else if (res.status === 422) say(T('Enter a valid email address.'));
      else say(T('We could not send that just now. Try again in a minute.'));
    } catch {
      say(T('We could not send that just now. Try again in a minute.'));
    } finally {
      btn.disabled = false;
    }
  });
}
