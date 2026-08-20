#!/usr/bin/env node
/**
 * Two halves of one silent failure class.
 *
 *   A class in the markup with no rule in the stylesheet renders as an
 *   unstyled div. `.hint--corrected` was added to a hint whenever the wizard
 *   silently rewrote someone's answer, and styled nowhere — so a corrected
 *   value was described in copy identical to the static help text beside it.
 *
 *   A rule in the stylesheet with no emitter anywhere is dead weight that
 *   reads as coverage. `.btn__spinner` and `@keyframes btn-spin` sat in
 *   theme.css for months with no caller, while all three pending paths in the
 *   product changed a label and nothing else.
 *
 * Neither errors. Nothing in CI noticed either one. So: every class emitted by
 * a client has a rule, and every non-modifier class defined has an emitter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = path.join(ROOT, 'src/theme.css');

let pass = 0;
let fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const css = fs.readFileSync(CSS, 'utf8');
/* Three stylesheets reach a browser: theme.css on the site, app.css in the
   installed app shell, dashboard.css in the workspace. A class is styled if
   ANY of them styles it; theme.css alone would report the whole app shell as
   unstyled, which is how a check like this gets muted instead of fixed. */
const allCss = [CSS, path.join(ROOT, 'src/pwa/app.css'), path.join(ROOT, 'src/pwa/dashboard.css')]
  .filter((f) => fs.existsSync(f))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
const definedAnywhere = new Set(
  [...allCss.replace(/\{[^{}]*\}/g, '{}').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]),
);

/* Selector text only — never declaration bodies. `content: '.foo'` and
   `font-family: 'Instrument Serif'` are not class definitions. */
const selectorText = css.replace(/\{[^{}]*\}/g, '{}');
const defined = new Set([...selectorText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

/* Every file a browser is served, plus the templates that write them. */
const emitters = [
  ...walk(path.join(ROOT, 'src')).filter((f) => /\.(js|mjs)$/.test(f)),
  ...walk(path.join(ROOT, 'dist')).filter((f) => /\.(js|html)$/.test(f)),
];

/* class="a b ${cond ? 'c' : 'd'}", classList.add('e'), className = 'f g'.
   Interpolations are skipped as a unit and their string literals picked up
   separately, so a conditional class name is not read as one long token. */
const emitted = new Map(); // class -> { file, soft }
/* `soft` marks a token lifted out of a `${...}` interpolation. Those are
   ambiguous by construction: `status--${d.urgency}` with a ternary of
   'closing' | 'soon' yields the bare words, which are enum VALUES and not
   class names. A soft token only counts as a finding when it is shaped like a
   class name — it carries a hyphen or a BEM separator. */
function note(cls, file, soft = false) {
  if (!cls || /^\$/.test(cls)) return;
  /* `status--${d.urgency}` leaves a bare `status--` behind once the
     interpolation is stripped. That is a prefix, not a class. */
  if (/(--|__|-)$/.test(cls)) return;
  const prev = emitted.get(cls);
  if (!prev) emitted.set(cls, { file: path.relative(ROOT, file), soft });
  else if (prev.soft && !soft) emitted.set(cls, { file: path.relative(ROOT, file), soft: false });
}
for (const file of emitters) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/class(?:Name)?=(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    /* Pull literals out of ${...} first, then strip the interpolations. */
    for (const inner of raw.matchAll(/\$\{[^}]*\}/g)) {
      for (const lit of inner[0].matchAll(/['"`]([a-zA-Z][\w -]*)['"`]/g)) {
        for (const c of lit[1].trim().split(/\s+/)) note(c, file, true);
      }
    }
    for (const c of raw.replace(/\$\{[^}]*\}/g, ' ').trim().split(/\s+/)) note(c, file);
  }
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(\s*['"]([\w-]+)['"]/g)) note(m[1], file);
}

/* Classes that are emitted today with no rule anywhere. Every one is a real
   defect and every one is recorded here rather than muted: an unstyled
   `.panel__head` is a heading row with no layout, and `.badge-good` on
   /admin/ is a badge that is not green. They are listed because the files
   that would have to change (src/pwa/app.css, src/pwa/dashboard.css) belong
   to a different owner in this round, not because they are acceptable.
   Anything NOT on this list fails the build, which is the point. */
const KNOWN_ORPHANS = new Set([
  'docs',        // src/app.js — the documents panel wrapper
  'results',     // src/app.js — the results-screen wrapper
  'steps',       // src/build.mjs — the numbered procedure list
  'badge-good',  // src/pwa/admin.js — subscription state chip
  'qlist',       // src/pwa/app.js — app-shell question list (app.css)
  'prow__main',  // src/pwa/app.js — app-shell programme row (app.css)
  'panel__head', // src/pwa/dashboard.js — workspace panel heading (dashboard.css)
  'table',       // src/pwa/dashboard.js — workspace table (dashboard.css)
]);

console.log('\nClasses and the rules that are supposed to style them\n');

/* ---- 1. Every emitted class has a rule ---------------------------- */
{
  /* Names owned by something other than theme.css: the dashboard and the app
     shell ship their own stylesheets, and a handful of hooks are selected by
     JS or by an external library rather than styled. */
  const orphans = [...emitted.entries()]
    .filter(([c]) => !definedAnywhere.has(c))
    /* State hooks are toggled by script and selected by a compound rule
       (`.card.is-open`), so they legitimately have no rule of their own. */
    .filter(([c]) => !/^(js-|is-|has-)/.test(c))
    .filter(([c, v]) => !v.soft || /[-_]/.test(c))
    .filter(([c]) => !KNOWN_ORPHANS.has(c));
  t(`every class a client emits has a rule in a shipped stylesheet (${emitted.size} classes seen)`,
    orphans.length === 0,
    orphans.slice(0, 25).map(([c, v]) => `.${c}  (${v.file})`).join('\n      '));
}

/* ---- 2. Every defined class has an emitter ------------------------ */
{
  /* A modifier is only ever written beside its base, and state/pseudo hooks
     are set by the browser or by other stylesheets. Those are not dead. */
  const emittedSet = new Set(emitted.keys());
  const dead = [...defined]
    .filter((c) => !emittedSet.has(c))
    .filter((c) => !/^(is-|has-|js-)/.test(c))
    /* Bases of a modifier that IS emitted, e.g. `.notice` when only
       `.notice--error` appears, and vice versa. */
    .filter((c) => {
      const base = c.split(/--|__/)[0];
      if (base !== c && emittedSet.has(base)) return false;
      for (const e of emittedSet) if (e.split(/--|__/)[0] === c) return false;
      return true;
    })
    /* Emitted by a stylesheet-adjacent surface this test does not read:
       the mobile app, the native shell, and the i18n locale modules. */
    .filter((c) => {
      for (const dir of ['mobile/src', 'native', 'src/i18n', 'public']) {
        for (const f of walk(path.join(ROOT, dir))) {
          if (!/\.(js|jsx|ts|tsx|mjs|html|css)$/.test(f)) continue;
          if (fs.readFileSync(f, 'utf8').includes(c)) return false;
        }
      }
      return true;
    });
  t(`every class defined in theme.css has an emitter (${defined.size} classes defined)`,
    dead.length === 0,
    dead.slice(0, 25).map((c) => `.${c}`).join('\n      '));
}

/* ---- 3. The three specific rules this test was written for -------- */
for (const cls of ['hint--corrected', 'progress-caption', 'btn__spinner']) {
  t(`.${cls} is both defined and emitted`, defined.has(cls) && emitted.has(cls),
    `defined=${defined.has(cls)} emitted=${emitted.has(cls)}`);
}

/* ---- 4. .btn centres its own label -------------------------------- */
{
  /* Measured properly in qa-screens.mjs. Here: the declaration exists at all,
     because `text-align: center` on a flex container is the thing that looked
     like a fix for two years. */
  const btnBlock = css.slice(css.indexOf('\n.btn {'), css.indexOf('}', css.indexOf('\n.btn {')));
  t('.btn declares justify-content, not just text-align', /justify-content\s*:\s*center/.test(btnBlock), btnBlock.trim());
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
