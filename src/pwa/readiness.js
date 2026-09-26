/**
 * /startups/readiness/ quiz — client-only, no sibling imports so it can be
 * emitted anywhere (see build.mjs). Reads its questions/next-steps out of the
 * JSON island the page embeds (`#readiness-data`), the same shape
 * src/pages/readiness.mjs generates them from, so this file can never define
 * a question the page doesn't also show and vice versa.
 *
 * Nothing here is sent to a server: the whole run is a JSON blob parsed once,
 * an in-memory answers object, and DOM writes.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadData() {
  const el = document.getElementById('readiness-data');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function bandFor(score, maxScore) {
  const pct = maxScore > 0 ? score / maxScore : 0;
  if (pct >= 0.8) return { label: 'Ready to apply', tone: 'good' };
  if (pct >= 0.5) return { label: 'Almost ready', tone: 'warn' };
  return { label: 'Early — some gaps to close first', tone: 'bad' };
}

function mount(root, data) {
  const { questions, nextSteps, maxScore } = data;
  const links = data.nextStepLinks || {};
  const base = data.base || '';
  const answers = {};
  let step = 0;

  function questionHtml(i) {
    const q = questions[i];
    return `<div class="small" style="margin-bottom:1rem">Question ${i + 1} of ${questions.length}</div>
    <h2 id="rq-${i}" tabindex="-1" style="margin:0 0 1rem">${esc(q.q)}</h2>
    <div style="display:grid;gap:.6rem" role="radiogroup" aria-labelledby="rq-${i}">
      ${q.options
        .map(
          (o, j) => `<label class="card card-flat" style="display:flex;gap:.6rem;align-items:center;cursor:pointer;margin:0">
        <input type="radio" name="rq-${i}" value="${esc(o.v)}" ${answers[q.id] === o.v ? 'checked' : ''}>
        <span>${esc(o.label)}</span>
      </label>`,
        )
        .join('')}
    </div>
    <div class="row" style="margin-top:1.4rem;gap:.6rem">
      ${i > 0 ? '<button type="button" class="btn btn-sm" data-act="back">Back</button>' : ''}
      <button type="button" class="btn btn-sm btn-primary" data-act="next" disabled>${i === questions.length - 1 ? 'See my result' : 'Next'}</button>
    </div>`;
  }

  function resultHtml() {
    let score = 0;
    const flags = [];
    for (const q of questions) {
      const chosen = q.options.find((o) => o.v === answers[q.id]);
      if (chosen) {
        score += chosen.w || 0;
        if (chosen.flag) flags.push(chosen.flag);
      }
    }
    const band = bandFor(score, maxScore);
    const steps = flags
      .filter((f) => nextSteps[f])
      .map((f) => ({ text: nextSteps[f], link: links[f] || null }));

    return `<span class="eyebrow eyebrow-accent">Your result</span>
    <h2 id="rq-result" tabindex="-1" style="margin:.3rem 0 .6rem">${esc(band.label)}</h2>
    <p class="small" style="margin:0 0 1.2rem">${score} of ${maxScore} points across ${questions.length} questions.</p>
    ${
      steps.length
        ? `<h3>Specific next steps</h3><ul>${steps
            .map(
              (s) =>
                `<li>${esc(s.text)}${
                  s.link ? ` <a class="link-underline" href="${esc(s.link.href)}">${esc(s.link.label)} →</a>` : ''
                }</li>`,
            )
            .join('')}</ul>`
        : `<p>No specific gaps flagged by this quiz — that does not guarantee eligibility for any one programme, only that the common blockers this quiz checks are not showing up.</p>`
    }
    <div class="row" style="margin-top:1.2rem;gap:.6rem;flex-wrap:wrap">
      <a class="btn btn-sm" href="${esc(base)}/startups/check/">Check what you qualify for</a>
      <a class="btn btn-sm btn-ghost" href="${esc(base)}/startups/de-minimis/">De minimis headroom calculator</a>
      <a class="btn btn-sm btn-ghost" href="${esc(base)}/startups/closing-soon/">What's closing soon</a>
      <button type="button" class="btn btn-sm btn-ghost" data-act="restart">Start over</button>
    </div>`;
  }

  function render(focus = false) {
    root.innerHTML = step < questions.length ? questionHtml(step) : resultHtml();
    /* Move focus to the new heading so keyboard and screen-reader users land on
       the next question (or the result) instead of on a detached button. */
    if (focus) root.querySelector('h2[tabindex]')?.focus();
    if (step < questions.length) {
      const q = questions[step];
      const nextBtn = root.querySelector('[data-act="next"]');
      if (answers[q.id]) nextBtn.disabled = false;
      root.querySelectorAll(`input[name="rq-${step}"]`).forEach((input) => {
        input.addEventListener('change', () => {
          answers[q.id] = input.value;
          nextBtn.disabled = false;
        });
      });
      root.querySelector('[data-act="back"]')?.addEventListener('click', () => {
        step -= 1;
        render(true);
      });
      nextBtn.addEventListener('click', () => {
        step += 1;
        render(true);
      });
    } else {
      root.querySelector('[data-act="restart"]')?.addEventListener('click', () => {
        step = 0;
        for (const k of Object.keys(answers)) delete answers[k];
        render(true);
      });
    }
  }

  render();
}

const root = document.getElementById('readiness-app');
const data = loadData();
if (root && data) mount(root, data);
