# DATA SPEC — Global Benefits Dataset (read fully before writing any file)

You are curating ONE country's file: `/mnt/agents/output/data/{COUNTRY_CODE}.json`
(ISO-3166 alpha-2, e.g. `us.json`, `fr.json`, `in.json`).

## Hard rules
1. **Only REAL programmes.** Every record must be a real, currently-existing government,
   institutional, or well-known private/semi-private scheme. Official names only.
2. **`source_url` must be an official page** (government / institution / provider domain).
   If you are not sure of the exact deep link, use the official portal or programme landing
   page URL — NEVER invent a plausible-looking URL path.
3. **At least 50 programmes** per country, spread across AT LEAST 6 of these categories:
   `housing | income_support | health | transport | energy | education | family | employment | tax | business`
4. **admin_level mix**: mostly `national`; include major `region`/`state`/`city` schemes and
   notable `private` perks (student bank offers, transport concession cards, utility social
   tariffs, telecom low-income plans).
5. **Verify via web search at least 15 flagship programmes** (the biggest, best-known ones).
   For those set `verification_status: "verified"`. For the rest set `"auto_extracted"`.
6. `source_snippet`: a short VERBATIM phrase from the official page when you found it via
   search; otherwise a faithful one-sentence gist of the published rule. Never invent figures
   inside a verbatim quote.
7. `last_verified_at`: "2026-08-12" for all records.
8. Amounts: use published figures. If the amount depends on circumstances, set min/max to
   null and explain in `amount_note`. Never guess numbers.
9. Output MUST be valid JSON. After writing, run
   `python3 -c "import json; d=json.load(open('/mnt/agents/output/data/{CC}.json')); print(len(d['programmes']))"`
   and confirm it parses and has >= 50 programmes.

## File shape
```json
{
  "country_code": "FR",
  "country_name": "France",
  "currency": "EUR",
  "language": "fr",
  "programmes": [ { ...record... } ]
}
```

## Record shape (every field required; use null where unknown — do not omit keys)
```json
{
  "slug": "apl-housing-aid",
  "name_local": "Aide personnalisée au logement (APL)",
  "name_en": "Personalised Housing Allowance (APL)",
  "admin_level": "national",
  "admin_area": null,
  "funder": "Caisse d'allocations familiales (CAF)",
  "category": "housing",
  "benefit_type": "cash_monthly",
  "amount_min": null,
  "amount_max": null,
  "amount_currency": "EUR",
  "amount_period": "monthly",
  "amount_note": "Depends on rent, household size and income",
  "is_automatic": false,
  "application_url": "https://www.caf.fr/...",
  "application_channel": "online",
  "deadline_type": "rolling",
  "deadline_note": null,
  "procedure_steps": [
    {"step": 1, "detail": "Create a CAF account online", "url": "https://..."}
  ],
  "documents_required": [
    {"doc": "Rental agreement (bail)", "mandatory": true, "note": null}
  ],
  "eligibility": {
    "statuses": [],
    "age_min": null,
    "age_max": null,
    "income_annual_max": null,
    "income_note": "Income-tested; ceiling depends on household composition and location",
    "requires_children": false,
    "gender": "any",
    "nationality": "any_resident",
    "residency_months_min": null,
    "housing_tenure": "renting",
    "student_required": false,
    "admin_areas": []
  },
  "source_url": "https://www.caf.fr/...",
  "source_snippet": "...",
  "last_verified_at": "2026-08-12",
  "verification_status": "verified"
}
```

## Field vocabularies (use EXACTLY these values)
- `admin_level`: `national | region | state | city | private`
- `category`: `housing | income_support | health | transport | energy | education | family | employment | tax | business`
- `benefit_type`: `cash_monthly | cash_one_off | tax_credit | discount | in_kind | free_slab`
- `amount_period`: `monthly | annual | one_off`
- `application_channel`: `online | in_person | post | via_employer | automatic`
- `deadline_type`: `rolling | annual | window | none`
- `eligibility.statuses`: subset of `["student","employee","self_employed","unemployed","retired","parent","jobseeker"]`; EMPTY ARRAY = any status
- `eligibility.nationality`: `any | citizen_or_pr | any_resident | refugee_or_protected`
- `eligibility.gender`: `any | female | male` — set `female` for women-only schemes
  (e.g. India's Ladki Bahin/Gruha Lakshmi, widow pensions open to all genders stay `any`).
  REQUIRED on every record; default `any`.
- `eligibility.income_annual_max`: for EVERY means-tested programme you MUST research and
  set the published threshold — annualized, per household, in local currency. If the
  published rule is monthly/per-capita/per-family-member, convert and document the
  conversion in `income_note`. Only leave null when the programme genuinely has no
  income test. A means-tested record with a null income rule is a DATA BUG.
- `eligibility.housing_tenure`: null (any) or one of `renting | owner | hosted | student_housing | homeless`
- `eligibility.admin_areas`: [] = nationwide; else list of matching state/region/city names (use the SAME spelling users will pick from, e.g. "California", "Île-de-France", "Karnataka")
- `eligibility.income_annual_max`: household annual income ceiling in LOCAL currency (number) or null
- `eligibility.requires_children`: true only if a child in household is a hard requirement
- `eligibility.student_required`: true only if being a student is a hard requirement

## Quality bar
Think like a local advisor: include the programmes a resident would actually miss —
social tariffs, transport concessions, tax credits, family allowances, student grants,
housing aid, energy subsidies, unemployment supports, small-business grants, health
subsidies. This database is the product; thin or generic data is a failed deliverable.
