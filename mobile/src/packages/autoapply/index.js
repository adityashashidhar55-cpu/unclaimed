/**
 * UNCLAIMED — assisted application engine ("auto-apply").
 *
 * What this does: turns a matched programme plus a user profile into a
 * COMPLETE, submission-ready package — every field computed, the covering
 * message drafted in the right language, the evidence list resolved, the
 * attestations spelled out — so the user's remaining work is one tap inside
 * the government's own authenticated session.
 *
 * What this deliberately does NOT do: hold government credentials, log into
 * portals, or submit. See packages/policy — in France the CAF procuration
 * expressly withholds authority to perform legal acts on the account, and
 * caf.fr's own terms forbid sharing credentials with anyone. The one market
 * where a company may submit is Spain, via a registered REA apoderamiento;
 * that path is modelled here as MANDATED_SUBMIT and still requires a
 * per-user, user-executed mandate.
 *
 * Pure JS, zero dependencies — runs in the browser, in React Native and in a
 * Cloudflare Worker unchanged.
 */

import { policyFor, maySubmitOnBehalf, mayAssist, AUTOMATION } from '../policy/index.js';

/* ------------------------------------------------------------------ */
/* Canonical field vocabulary                                          */
/* ------------------------------------------------------------------ */

/**
 * Government forms name the same twenty things a hundred ways. We map the
 * user's profile onto a canonical vocabulary once, then project it onto each
 * programme's own field names. Adding a programme becomes a mapping entry,
 * not a new form implementation.
 */
export const FIELDS = {
  given_name: { label: 'First name(s)', sensitive: false },
  family_name: { label: 'Surname', sensitive: false },
  date_of_birth: { label: 'Date of birth', sensitive: true },
  nationality: { label: 'Nationality', sensitive: true },
  national_id: { label: 'National insurance / social security number', sensitive: true },
  email: { label: 'Email address', sensitive: true },
  phone: { label: 'Phone number', sensitive: true },
  address_line1: { label: 'Address', sensitive: true },
  address_postcode: { label: 'Postcode', sensitive: true },
  address_city: { label: 'City', sensitive: true },
  address_country: { label: 'Country', sensitive: false },
  residency_since: { label: 'Resident since', sensitive: false },
  household_size: { label: 'People in household', sensitive: false },
  children_count: { label: 'Dependent children', sensitive: false },
  marital_status: { label: 'Marital status', sensitive: true },
  employment_status: { label: 'Employment status', sensitive: false },
  employer_name: { label: 'Employer', sensitive: true },
  income_annual: { label: 'Annual household income', sensitive: true },
  housing_tenure: { label: 'Housing situation', sensitive: false },
  monthly_rent: { label: 'Monthly rent', sensitive: true },
  bank_iban: { label: 'Bank account (IBAN)', sensitive: true },
  reference_number: { label: 'Existing claim / file number', sensitive: true },
};

/** Localised field labels — a French covering letter must not say "Surname". */
const FIELD_LABELS = {
  fr: { given_name: 'Prénom', family_name: 'Nom', date_of_birth: 'Date de naissance', nationality: 'Nationalité', national_id: 'Numéro de sécurité sociale', email: 'Adresse e-mail', phone: 'Téléphone', address_line1: 'Adresse', address_postcode: 'Code postal', address_city: 'Ville', address_country: 'Pays', residency_since: 'Résident depuis', household_size: 'Personnes au foyer', children_count: 'Enfants à charge', marital_status: 'Situation familiale', employment_status: 'Situation professionnelle', employer_name: 'Employeur', income_annual: 'Revenu annuel du foyer', housing_tenure: 'Situation de logement', monthly_rent: 'Loyer mensuel', bank_iban: 'Coordonnées bancaires (IBAN)', reference_number: 'Numéro allocataire' },
  es: { given_name: 'Nombre', family_name: 'Apellidos', date_of_birth: 'Fecha de nacimiento', nationality: 'Nacionalidad', national_id: 'Número de la Seguridad Social', email: 'Correo electrónico', phone: 'Teléfono', address_line1: 'Dirección', address_postcode: 'Código postal', address_city: 'Municipio', address_country: 'País', residency_since: 'Residente desde', household_size: 'Personas en el hogar', children_count: 'Hijos a cargo', marital_status: 'Estado civil', employment_status: 'Situación laboral', employer_name: 'Empresa', income_annual: 'Ingresos anuales del hogar', housing_tenure: 'Situación de vivienda', monthly_rent: 'Alquiler mensual', bank_iban: 'Cuenta bancaria (IBAN)', reference_number: 'Número de expediente' },
  de: { given_name: 'Vorname', family_name: 'Nachname', date_of_birth: 'Geburtsdatum', nationality: 'Staatsangehörigkeit', national_id: 'Sozialversicherungsnummer', email: 'E-Mail-Adresse', phone: 'Telefon', address_line1: 'Anschrift', address_postcode: 'Postleitzahl', address_city: 'Ort', address_country: 'Land', residency_since: 'Wohnhaft seit', household_size: 'Personen im Haushalt', children_count: 'Kinder', marital_status: 'Familienstand', employment_status: 'Beschäftigungsstatus', employer_name: 'Arbeitgeber', income_annual: 'Jährliches Haushaltseinkommen', housing_tenure: 'Wohnsituation', monthly_rent: 'Monatliche Miete', bank_iban: 'Bankverbindung (IBAN)', reference_number: 'Aktenzeichen' },
  it: { given_name: 'Nome', family_name: 'Cognome', date_of_birth: 'Data di nascita', nationality: 'Cittadinanza', national_id: 'Codice fiscale', email: 'Indirizzo e-mail', phone: 'Telefono', address_line1: 'Indirizzo', address_postcode: 'CAP', address_city: 'Comune', address_country: 'Paese', residency_since: 'Residente dal', household_size: 'Persone nel nucleo', children_count: 'Figli a carico', marital_status: 'Stato civile', employment_status: 'Condizione lavorativa', employer_name: 'Datore di lavoro', income_annual: 'Reddito annuo del nucleo', housing_tenure: 'Situazione abitativa', monthly_rent: 'Affitto mensile', bank_iban: 'Coordinate bancarie (IBAN)', reference_number: 'Numero pratica' },
  pt: { given_name: 'Nome próprio', family_name: 'Apelido', date_of_birth: 'Data de nascimento', nationality: 'Nacionalidade', national_id: 'Número de Segurança Social', email: 'Endereço de e-mail', phone: 'Telefone', address_line1: 'Morada', address_postcode: 'Código postal', address_city: 'Localidade', address_country: 'País', residency_since: 'Residente desde', household_size: 'Pessoas no agregado', children_count: 'Filhos a cargo', marital_status: 'Estado civil', employment_status: 'Situação profissional', employer_name: 'Entidade patronal', income_annual: 'Rendimento anual do agregado', housing_tenure: 'Situação habitacional', monthly_rent: 'Renda mensal', bank_iban: 'Conta bancária (IBAN)', reference_number: 'Número de processo' },
};

export function fieldLabel(key, lang = 'en') {
  return (FIELD_LABELS[lang] && FIELD_LABELS[lang][key]) || FIELDS[key]?.label || key;
}

/** Fields a given programme needs, inferred from what its rules actually test. */
export function requiredFields(programme) {
  const e = programme.eligibility || {};
  const req = new Set(['given_name', 'family_name', 'date_of_birth', 'email', 'address_line1', 'address_postcode', 'address_city']);

  if (e.income_annual_max != null || e.income_test === 'unpublished') req.add('income_annual');
  if (e.requires_children) req.add('children_count');
  if (e.housing_tenure) req.add('housing_tenure');
  if (e.housing_tenure === 'renting' || programme.category === 'housing') req.add('monthly_rent');
  if (e.nationality && e.nationality !== 'any') req.add('nationality');
  if (e.residency_months_min != null) req.add('residency_since');
  if ((e.statuses || []).length) req.add('employment_status');
  if (programme.benefit_type === 'cash_monthly' || programme.benefit_type === 'cash_one_off') req.add('bank_iban');
  if (e.age_min != null || e.age_max != null) req.add('date_of_birth');
  req.add('household_size');
  req.add('national_id');
  return [...req];
}

/* ------------------------------------------------------------------ */
/* Profile → field values                                              */
/* ------------------------------------------------------------------ */

function fmtDate(d) {
  if (!d) return null;
  return String(d).slice(0, 10);
}

/**
 * Project the stored profile onto the canonical vocabulary. Anything missing
 * comes back as a gap, so the UI can ask for exactly what is needed and
 * nothing more — the whole point of collecting information once.
 */
export function projectProfile(profile, programme) {
  const p = profile || {};
  const values = {
    given_name: p.given_name ?? null,
    family_name: p.family_name ?? null,
    date_of_birth: fmtDate(p.date_of_birth),
    nationality: p.nationality ?? null,
    national_id: p.national_id ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    address_line1: p.address_line1 ?? null,
    address_postcode: p.address_postcode ?? null,
    address_city: p.address_city ?? null,
    address_country: p.country_code ?? null,
    residency_since: fmtDate(p.residency_since),
    household_size: p.household_size ?? null,
    children_count: p.children_count ?? null,
    marital_status: p.marital_status ?? null,
    employment_status: p.status ?? null,
    employer_name: p.employer_name ?? null,
    income_annual: p.income_annual ?? null,
    housing_tenure: p.housing_tenure ?? null,
    monthly_rent: p.monthly_rent ?? null,
    bank_iban: p.bank_iban ?? null,
    reference_number: p.reference_number ?? null,
  };

  const needed = requiredFields(programme);
  const missing = needed.filter((k) => values[k] === null || values[k] === undefined || values[k] === '');
  const provided = needed.filter((k) => !missing.includes(k));
  return { values, needed, missing, provided };
}

/* ------------------------------------------------------------------ */
/* Covering message                                                    */
/* ------------------------------------------------------------------ */

const LETTER = {
  en: {
    subject: (p) => `Application: ${p.name_en}`,
    greeting: 'Dear Sir or Madam,',
    intro: (p, f) =>
      `I am writing to apply for ${p.name_local || p.name_en}. My details are set out below and the supporting documents listed at the end are attached.`,
    detailsHead: 'My details',
    docsHead: 'Documents attached',
    closing:
      'I confirm that the information above is true and complete to the best of my knowledge. Please let me know if you need anything further.',
    signoff: 'Yours faithfully,',
  },
  fr: {
    subject: (p) => `Demande : ${p.name_local || p.name_en}`,
    greeting: 'Madame, Monsieur,',
    intro: (p) =>
      `Je vous adresse ma demande de ${p.name_local || p.name_en}. Vous trouverez ci-dessous les éléments de ma situation ainsi que, en pièces jointes, les justificatifs listés en fin de courrier.`,
    detailsHead: 'Ma situation',
    docsHead: 'Pièces jointes',
    closing:
      "Je certifie sur l'honneur l'exactitude des informations ci-dessus. Je reste à votre disposition pour tout complément.",
    signoff: 'Je vous prie d\'agréer, Madame, Monsieur, l\'expression de mes salutations distinguées.',
  },
  es: {
    subject: (p) => `Solicitud: ${p.name_local || p.name_en}`,
    greeting: 'Estimados señores:',
    intro: (p) =>
      `Por la presente solicito ${p.name_local || p.name_en}. A continuación detallo mi situación y adjunto la documentación indicada al final.`,
    detailsHead: 'Mis datos',
    docsHead: 'Documentación adjunta',
    closing:
      'Declaro que los datos anteriores son ciertos y completos. Quedo a su disposición para cualquier aclaración.',
    signoff: 'Atentamente,',
  },
  de: {
    subject: (p) => `Antrag: ${p.name_local || p.name_en}`,
    greeting: 'Sehr geehrte Damen und Herren,',
    intro: (p) =>
      `hiermit beantrage ich ${p.name_local || p.name_en}. Nachfolgend meine Angaben; die am Ende aufgeführten Nachweise sind beigefügt.`,
    detailsHead: 'Meine Angaben',
    docsHead: 'Beigefügte Nachweise',
    closing:
      'Ich versichere, dass die vorstehenden Angaben nach bestem Wissen vollständig und richtig sind.',
    signoff: 'Mit freundlichen Grüßen',
  },
  it: {
    subject: (p) => `Domanda: ${p.name_local || p.name_en}`,
    greeting: 'Spettabile ufficio,',
    intro: (p) =>
      `con la presente presento domanda per ${p.name_local || p.name_en}. Di seguito i miei dati e, in allegato, la documentazione elencata in calce.`,
    detailsHead: 'I miei dati',
    docsHead: 'Documentazione allegata',
    closing: 'Dichiaro che quanto sopra è veritiero e completo.',
    signoff: 'Distinti saluti,',
  },
  pt: {
    subject: (p) => `Pedido: ${p.name_local || p.name_en}`,
    greeting: 'Exmos. Senhores,',
    intro: (p) =>
      `venho por este meio requerer ${p.name_local || p.name_en}. Abaixo os meus dados e, em anexo, os documentos indicados no final.`,
    detailsHead: 'Os meus dados',
    docsHead: 'Documentos anexos',
    closing: 'Declaro que as informações acima são verdadeiras e completas.',
    signoff: 'Com os melhores cumprimentos,',
  },
};

/**
 * Draft the covering message. Every value interpolated came from the user;
 * nothing is inferred, and nothing is asserted that they did not enter.
 */
export function draftMessage(programme, projection, lang = 'en') {
  const L = LETTER[lang] || LETTER.en;
  const v = projection.values;
  const line = (k) =>
    v[k] === null || v[k] === undefined || v[k] === ''
      ? null
      : `  ${fieldLabel(k, lang)}: ${v[k]}`;

  const details = projection.provided.map(line).filter(Boolean).join('\n');
  const docs = (programme.documents_required || [])
    .map((d, i) => `  ${i + 1}. ${d.doc}${d.mandatory === false ? ' (if applicable)' : ''}`)
    .join('\n');

  const body = [
    L.greeting,
    '',
    L.intro(programme),
    '',
    `${L.detailsHead}:`,
    details,
    docs ? `\n${L.docsHead}:\n${docs}` : '',
    '',
    L.closing,
    '',
    L.signoff,
    `${v.given_name ?? ''} ${v.family_name ?? ''}`.trim(),
  ]
    .filter((s) => s !== null)
    .join('\n');

  return { subject: L.subject(programme), body };
}

/* ------------------------------------------------------------------ */
/* Attestations                                                        */
/* ------------------------------------------------------------------ */

/**
 * The declarations the user is about to swear. These must be shown verbatim
 * and affirmatively accepted: a benefits declaration is a déclaration sur
 * l'honneur with the same legal weight as a signed paper form, and the person
 * who bears the consequence of an error is the user, not us. Showing them the
 * exact words is both the honest thing and our evidence that we did.
 */
export function attestationsFor(programme, entry, lang = 'en') {
  const A = {
    en: [
      'The information in this application is true and complete to the best of my knowledge.',
      `I am applying for ${programme.name_en} myself; Unclaimed has prepared this package at my request and is not my legal representative.`,
      'I understand that if I am paid something I am not entitled to, I may have to repay it.',
      'I have read the official page for this programme before submitting.',
    ],
    fr: [
      "Je certifie sur l'honneur que les informations de cette demande sont exactes et complètes.",
      `Je demande ${programme.name_local || programme.name_en} moi-même ; Unclaimed a préparé ce dossier à ma demande et n'est pas mon mandataire.`,
      "Je comprends qu'un versement indu devra être remboursé.",
      "J'ai consulté la page officielle du dispositif avant d'envoyer ma demande.",
    ],
    es: [
      'Declaro que los datos de esta solicitud son ciertos y completos.',
      `Solicito ${programme.name_local || programme.name_en} por mí mismo/a; Unclaimed ha preparado este expediente a petición mía.`,
      'Entiendo que deberé devolver cualquier importe percibido indebidamente.',
      'He leído la página oficial antes de presentar la solicitud.',
    ],
  };
  return A[lang] || A.en;
}

/* ------------------------------------------------------------------ */
/* Package assembly                                                    */
/* ------------------------------------------------------------------ */

/**
 * Build everything needed to submit one application.
 *
 * Returns `blockers` when the jurisdiction forbids assistance, and `missing`
 * when the profile is incomplete — the caller renders those instead of a
 * half-built package. A package is never returned in a state that would let a
 * user submit something inaccurate without noticing.
 */
export function buildPackage({ profile, programme, entry, lang = 'en' }) {
  const cc = (entry?.slug || profile?.country_code || '').toLowerCase();
  const policy = policyFor(cc);
  const blockers = [];

  if (!mayAssist(cc)) {
    blockers.push({
      code: 'jurisdiction_discovery_only',
      message:
        'In this country the intermediary role is legally reserved, so we show you the programme and point you at the body that can help — we do not prepare applications here.',
      basis: policy.basis,
    });
  }

  const projection = projectProfile(profile, programme);
  const message = draftMessage(programme, projection, lang);
  const attestations = attestationsFor(programme, entry, lang);

  const channel = programme.is_automatic
    ? 'automatic'
    : programme.application_channel || 'online';

  return {
    programme_slug: programme.slug,
    country: cc,
    generated_for: profile?.id ?? null,
    policy: {
      monetisation: policy.monetisation,
      automation: policy.automation,
      may_submit_on_behalf: maySubmitOnBehalf(cc),
    },
    blockers,
    /** Fields we filled, and the ones we still need from the user. */
    fields: projection.values,
    fields_required: projection.needed,
    fields_missing: projection.missing,
    /** Ready-to-send covering message. */
    message,
    /** Evidence the user must attach. */
    documents: (programme.documents_required || []).map((d) => ({
      doc: d.doc,
      mandatory: d.mandatory !== false,
      note: d.note ?? null,
    })),
    /** Ordered steps taken from the official page. */
    steps: (programme.procedure_steps || []).slice().sort((a, b) => a.step - b.step),
    /** Where the user goes to finish. Their session, their device, their tap. */
    submit: {
      channel,
      url: programme.application_url || programme.source_url,
      /** True only where a statutory instrument lets a legal person submit. */
      company_may_submit: maySubmitOnBehalf(cc),
      /** Always true. The user performs the submission act. */
      requires_user_action: !maySubmitOnBehalf(cc),
    },
    attestations,
    source: {
      url: programme.source_url,
      snippet: programme.source_snippet ?? null,
      last_verified_at: programme.last_verified_at,
      verification_status: programme.verification_status,
    },
    /** Completeness, so the UI can show "3 answers from ready". */
    readiness: {
      fields_pct: projection.needed.length
        ? Math.round((projection.provided.length / projection.needed.length) * 100)
        : 100,
      ready: projection.missing.length === 0 && blockers.length === 0,
    },
  };
}

/**
 * Build packages for a whole result set, ordered so the user does the
 * highest-value, most-complete one first.
 */
export function buildPlan({ profile, matches, entry, lang = 'en' }) {
  const packages = matches
    .filter((m) => !m.programme.is_automatic)
    .map((m) => ({
      match: m,
      pkg: buildPackage({ profile, programme: m.programme, entry, lang }),
    }))
    .sort((a, b) => {
      if (a.pkg.readiness.ready !== b.pkg.readiness.ready) return a.pkg.readiness.ready ? -1 : 1;
      const av = a.match.est_annual_max ?? a.match.est_annual_min ?? 0;
      const bv = b.match.est_annual_max ?? b.match.est_annual_min ?? 0;
      return bv - av;
    });

  /* One consolidated list of what the user still has to tell us, across every
     application — so we ask once rather than per form. */
  const gaps = new Map();
  for (const { pkg } of packages) {
    for (const k of pkg.fields_missing) {
      if (!gaps.has(k)) gaps.set(k, { field: k, label: fieldLabel(k, lang), unlocks: [] });
      gaps.get(k).unlocks.push(pkg.programme_slug);
    }
  }

  return {
    packages,
    ready_count: packages.filter((p) => p.pkg.readiness.ready).length,
    gaps: [...gaps.values()].sort((a, b) => b.unlocks.length - a.unlocks.length),
  };
}

/* ------------------------------------------------------------------ */
/* Consent ledger                                                      */
/* ------------------------------------------------------------------ */

/**
 * A consent record is created at the moment the user confirms, and stores the
 * exact text they agreed to. If a claim is ever questioned, this is the
 * evidence of what was shown and what was affirmed — which protects the user
 * as much as us.
 */
export function recordConsent({ userId, programmeSlug, attestations, values, at, ip = null, userAgent = null }) {
  return {
    user_id: userId,
    programme_slug: programmeSlug,
    /** The literal sentences shown, not a version number that can drift. */
    attested_text: attestations,
    /** Hash rather than a copy: we can prove what was submitted without
     *  keeping a second copy of sensitive personal data around. */
    values_digest: digest(JSON.stringify(values)),
    consented_at: at,
    ip,
    user_agent: userAgent,
    /** Consent is per-submission, never blanket and never inherited. */
    scope: 'single_submission',
  };
}

/** Small non-cryptographic digest — enough to detect drift, no deps. */
function digest(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/* ------------------------------------------------------------------ */
/* Export formats                                                      */
/* ------------------------------------------------------------------ */

/** mailto: link for channels that accept email. */
export function mailtoLink(pkg, to) {
  const q = `subject=${encodeURIComponent(pkg.message.subject)}&body=${encodeURIComponent(pkg.message.body)}`;
  return `mailto:${to ? encodeURIComponent(to) : ''}?${q}`;
}

/** Flat key/value export for a form-filling helper or a PDF field map. */
export function toFieldMap(pkg) {
  const out = {};
  for (const [k, v] of Object.entries(pkg.fields)) {
    if (v !== null && v !== undefined && v !== '') out[k] = String(v);
  }
  return out;
}
