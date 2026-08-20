# Translations

`en.mjs` is the source of truth. Every other file must define the same keys —
`scripts/test-i18n.mjs` fails the build on a missing one rather than letting it
fall back to English, because a silent fallback is exactly how `/fr/` ended up
with a French nav and an English page.

What is translated: everything we wrote. Interface, marketing copy, headings,
buttons, explanations, the methodology and privacy pages.

What is not, deliberately: anything a funder published. Programme names
(`name_local`), quoted source snippets, eligibility notes and document names
stay in the language the authority wrote them in. On a site whose entire claim
is accuracy, a machine-translated benefit rule is worse than an English one —
and the person will have to read the official page in that language anyway.
Every localised page says so, in `langNote`.

Values may be strings or functions of interpolated values. Keep the function
signature identical across languages; word order is free to change, which is
the reason they are functions rather than templates with numbered slots.

## `wizard` — the one section keyed by English, not by key name

`src/app.js` (the /check/ wizard) and `src/pwa/startup-check.js` (the company
one) build their screens from template literals with the English copy written
inline. They have no translator, and every locale loads the same `/app.js`, so
`/fr/check/` served a fully French shell around an entirely English wizard:
every question, option, hint, progress caption, bucket heading and disclaimer,
in six languages. `scripts/check-i18n.mjs` never caught it, because the strings
are injected client-side, after the file it reads was written.

The fix is a per-page JSON island. `wizardDict()` in `src/build.mjs` emits

```html
<script id="i18n-wizard" type="application/json">{ … }</script>
```

into the head of every `/check/` and `/startups/check/` page, from the `wizard`
object in this directory. **It is keyed by the exact English source string**,
not by an invented key name, so the wizard can call

```js
T('Where do you live?')
```

with the literal it already has. That has two consequences worth stating:

1. **The English copy is its own fallback.** A string with no entry renders in
   English, which is what every one of them did before this section existed —
   so a partial dictionary is a real improvement rather than a page full of
   printed key names. `en.mjs` therefore ships `wizard: {}`.
2. **Neither side has to agree a key list.** The generator and the wizard can
   be changed independently; the only contract is the English literal.

When you change a literal in `src/app.js`, change the key here in the same
commit. A stale key does not error — it silently stops matching, and the
string quietly reverts to English.

Strings carrying interpolated numbers (the progress caption, the bucket
counts) are not in the dictionary yet: they need a placeholder convention the
wizard also understands. They are the remaining half of finding **A22**.
