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
