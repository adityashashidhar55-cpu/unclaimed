/**
 * UNCLAIMED — document vault.
 *
 * The unglamorous half of auto-apply, and the half that actually helps most
 * people. Almost nobody fails to claim a benefit because the form was hard.
 * They fail because the form wanted a payslip, a proof of address and a birth
 * certificate, and finding all three at once was a Saturday afternoon they
 * never had. Then the next scheme wants the same three again.
 *
 * So: keep them once, know when they go stale, and know which of the twelve
 * things you are owed each one unlocks.
 *
 * Two design rules, both load-bearing:
 *
 * 1. THE SERVER CANNOT READ THE DOCUMENTS. Every file is encrypted on the
 *    user's device under a key derived from their passphrase. The server sees
 *    ciphertext, a type label, a size and two dates. It cannot decrypt, and
 *    neither can we. That is not a nicety for a product holding payslips,
 *    residence permits and disability decisions — a breach of a plaintext
 *    store of those would be catastrophic and unforgivable.
 *
 * 2. NO GOVERNMENT CREDENTIALS, EVER. The vault holds the user's own files.
 *    It never holds a portal login. Where a consented document rail exists
 *    (DigiLocker in India), documents arrive through it with per-fetch
 *    consent. Where none exists, the user uploads. See INVARIANTS in
 *    packages/policy.
 *
 * Zero dependencies. Crypto is injected so the same module runs in the
 * browser (WebCrypto), in the Worker (WebCrypto) and in React Native
 * (whatever provider that platform supplies).
 */

/* ------------------------------------------------------------------ */
/* Document taxonomy                                                   */
/* ------------------------------------------------------------------ */

/**
 * Canonical document types. The dataset's `documents_required[].doc` is free
 * text in a dozen languages; this is what we normalise it onto so that one
 * uploaded payslip can satisfy nine different schemes.
 *
 * `validity_months` is how long the document stays credible to an agency —
 * null means it never expires. These are the conventional windows agencies
 * apply, not statute, and they are deliberately conservative: telling someone
 * their payslip is stale when it isn't costs them a re-upload, whereas the
 * reverse costs them a rejected claim.
 */
export const DOC_TYPES = {
  id_proof: { validity_months: null, sensitivity: 'high', reusable: true },
  proof_of_address: { validity_months: 3, sensitivity: 'medium', reusable: true },
  income_proof: { validity_months: 3, sensitivity: 'high', reusable: true },
  tax_return: { validity_months: 12, sensitivity: 'high', reusable: true },
  bank_details: { validity_months: null, sensitivity: 'high', reusable: true },
  employment_contract: { validity_months: null, sensitivity: 'medium', reusable: true },
  tenancy_agreement: { validity_months: null, sensitivity: 'medium', reusable: true },
  utility_bill: { validity_months: 3, sensitivity: 'low', reusable: true },
  birth_certificate: { validity_months: null, sensitivity: 'medium', reusable: true },
  civil_status: { validity_months: 6, sensitivity: 'medium', reusable: true },
  residence_permit: { validity_months: null, sensitivity: 'high', reusable: true },
  student_enrolment: { validity_months: 12, sensitivity: 'low', reusable: true },
  childcare_invoice: { validity_months: 3, sensitivity: 'low', reusable: false },
  benefit_decision: { validity_months: 12, sensitivity: 'high', reusable: true },
  medical_evidence: { validity_months: null, sensitivity: 'high', reusable: true },
  application_form: { validity_months: null, sensitivity: 'low', reusable: false },
  social_registry: { validity_months: 12, sensitivity: 'high', reusable: true },
  jobseeker_registration: { validity_months: 3, sensitivity: 'medium', reusable: true },
  photo: { validity_months: 12, sensitivity: 'low', reusable: true },
  other: { validity_months: null, sensitivity: 'medium', reusable: false },
  /** Not a document at all — the scheme asks for nothing. Never a gap. */
  not_required: { validity_months: null, sensitivity: 'low', reusable: true },
};

/** Human labels, in the languages the site ships. */
export const DOC_LABELS = {
  en: {
    id_proof: 'Proof of identity',
    proof_of_address: 'Proof of address',
    income_proof: 'Proof of income (payslip)',
    tax_return: 'Tax return or tax notice',
    bank_details: 'Bank account details',
    employment_contract: 'Employment contract',
    tenancy_agreement: 'Tenancy agreement',
    utility_bill: 'Utility bill',
    birth_certificate: 'Birth certificate',
    civil_status: 'Civil status / family record',
    residence_permit: 'Residence permit',
    student_enrolment: 'Proof of enrolment',
    childcare_invoice: 'Childcare invoice',
    benefit_decision: 'Benefit decision letter',
    medical_evidence: 'Medical evidence',
    photo: 'Photograph',
    application_form: 'Application form',
    jobseeker_registration: 'Jobseeker registration',
    social_registry: 'Social registry enrolment',
    not_required: 'No document required',
    other: 'Other document',
  },
  fr: {
    id_proof: "Pièce d'identité",
    proof_of_address: 'Justificatif de domicile',
    income_proof: 'Justificatif de revenus (bulletin de salaire)',
    tax_return: "Avis d'imposition",
    bank_details: 'RIB',
    employment_contract: 'Contrat de travail',
    tenancy_agreement: 'Bail / contrat de location',
    utility_bill: "Facture d'énergie",
    birth_certificate: 'Acte de naissance',
    civil_status: 'Livret de famille',
    residence_permit: 'Titre de séjour',
    student_enrolment: 'Certificat de scolarité',
    childcare_invoice: 'Facture de garde',
    benefit_decision: 'Notification de droits',
    medical_evidence: 'Justificatif médical',
    photo: 'Photographie',
    application_form: 'Formulaire de demande',
    jobseeker_registration: 'Inscription France Travail',
    social_registry: 'Inscription au registre social',
    not_required: 'Aucun document requis',
    other: 'Autre document',
  },
  es: {
    id_proof: 'Documento de identidad',
    proof_of_address: 'Certificado de empadronamiento',
    income_proof: 'Nómina',
    tax_return: 'Declaración de la renta',
    bank_details: 'Datos bancarios',
    employment_contract: 'Contrato de trabajo',
    tenancy_agreement: 'Contrato de alquiler',
    utility_bill: 'Factura de suministros',
    birth_certificate: 'Certificado de nacimiento',
    civil_status: 'Libro de familia',
    residence_permit: 'Permiso de residencia',
    student_enrolment: 'Matrícula',
    childcare_invoice: 'Factura de guardería',
    benefit_decision: 'Resolución de prestación',
    medical_evidence: 'Informe médico',
    photo: 'Fotografía',
    application_form: 'Formulario de solicitud',
    jobseeker_registration: 'Demanda de empleo',
    social_registry: 'Inscripción en registro social',
    not_required: 'No se requiere documento',
    other: 'Otro documento',
  },
  de: {
    id_proof: 'Ausweisdokument',
    proof_of_address: 'Meldebescheinigung',
    income_proof: 'Gehaltsabrechnung',
    tax_return: 'Steuerbescheid',
    bank_details: 'Bankverbindung',
    employment_contract: 'Arbeitsvertrag',
    tenancy_agreement: 'Mietvertrag',
    utility_bill: 'Energierechnung',
    birth_certificate: 'Geburtsurkunde',
    civil_status: 'Familienstandsnachweis',
    residence_permit: 'Aufenthaltstitel',
    student_enrolment: 'Immatrikulationsbescheinigung',
    childcare_invoice: 'Kinderbetreuungsrechnung',
    benefit_decision: 'Leistungsbescheid',
    medical_evidence: 'Ärztlicher Nachweis',
    photo: 'Lichtbild',
    application_form: 'Antragsformular',
    jobseeker_registration: 'Meldung als arbeitsuchend',
    social_registry: 'Sozialregister-Eintrag',
    not_required: 'Kein Dokument erforderlich',
    other: 'Sonstiges Dokument',
  },
  it: {
    id_proof: "Documento d'identità",
    proof_of_address: 'Certificato di residenza',
    income_proof: 'Busta paga',
    tax_return: 'Dichiarazione dei redditi',
    bank_details: 'Coordinate bancarie (IBAN)',
    employment_contract: 'Contratto di lavoro',
    tenancy_agreement: 'Contratto di locazione',
    utility_bill: 'Bolletta',
    birth_certificate: 'Certificato di nascita',
    civil_status: 'Stato di famiglia',
    residence_permit: 'Permesso di soggiorno',
    student_enrolment: 'Certificato di iscrizione',
    childcare_invoice: 'Fattura asilo nido',
    benefit_decision: 'Provvedimento di prestazione',
    medical_evidence: 'Certificato medico',
    photo: 'Fotografia',
    application_form: 'Modulo di domanda',
    jobseeker_registration: "Iscrizione al centro per l'impiego",
    social_registry: 'Iscrizione al registro sociale',
    not_required: 'Nessun documento richiesto',
    other: 'Altro documento',
  },
  pt: {
    id_proof: 'Documento de identificação',
    proof_of_address: 'Comprovativo de morada',
    income_proof: 'Recibo de vencimento',
    tax_return: 'Declaração de IRS',
    bank_details: 'Dados bancários (IBAN)',
    employment_contract: 'Contrato de trabalho',
    tenancy_agreement: 'Contrato de arrendamento',
    utility_bill: 'Fatura de serviços',
    birth_certificate: 'Certidão de nascimento',
    civil_status: 'Certidão de estado civil',
    residence_permit: 'Autorização de residência',
    student_enrolment: 'Comprovativo de matrícula',
    childcare_invoice: 'Fatura de creche',
    benefit_decision: 'Decisão de prestação',
    medical_evidence: 'Atestado médico',
    photo: 'Fotografia',
    application_form: 'Formulário de candidatura',
    jobseeker_registration: 'Inscrição no centro de emprego',
    social_registry: 'Inscrição no registo social',
    not_required: 'Nenhum documento necessário',
    other: 'Outro documento',
  },
};

export function docLabel(type, lang = 'en') {
  return (DOC_LABELS[lang] || DOC_LABELS.en)[type] || DOC_LABELS.en[type] || type;
}

/**
 * Multilingual patterns mapping free-text requirements onto canonical types.
 *
 * Order matters: the first match wins, so the more specific patterns come
 * first. `tax_return` must beat `income_proof` because "avis d'imposition"
 * contains neither "salaire" nor "payslip" but "impôt" alone would otherwise
 * be ambiguous.
 */
const PATTERNS = [
  /* Nothing is required. Must come first, and must not be treated as a gap:
     "Ingen ansökan krävs" on an automatic Swedish scheme means there is no
     paperwork, not that the user is missing paperwork. */
  ['not_required', /^\s*(none|n\/?a|not applicable|no documents?( required)?|none required|automatic|ingen ans[öo]kan kr[äa]vs|inga handlingar|keine|aucun(e)? pi[èe]ce|nessun documento|ninguno|nenhum|brak)( \(automatic\))?\s*\.?\s*$/i],
  ['not_required', /(?<![a-zA-Z])(no (application|documents?) (is |are )?(required|needed)|awarded automatically|paid automatically|automatically assessed|kein antrag erforderlich|pas de d[ée]marche|nessuna domanda|no es necesario solicitar)/i],

  /* Income and tax — tax before income, because a tax notice IS income
     evidence and the more specific label is more useful. */
  ['tax_return', /(?<![a-zA-Z])(tax (return|notice|assessment|statement|certificate)|avis d'?imposition|d[ée]claration de revenus|steuerbescheid|einkommensteuer|declaraci[oó]n de la renta|dichiarazione dei redditi|modello (unico|730)|cud\b|pit-\d|declara[çc][ãa]o de irs|form 16|itr\b|notice of assessment|源泉徴収票|ingen ans[öo]kan|no application)(?![a-zA-Z])/i],
  ['income_proof', /(?<![a-zA-Z])(payslip|pay slip|wage slip|salary slip|proof of income|income (statement|certificate|details|proof|and asset)|means (test|assessment)|earnings statement|bulletin de (salaire|paie)|fiche de paie|justificatif de (revenus|ressources)|gehaltsabrechnung|lohnabrechnung|verdienstbescheinigung|einkommensnachweis|n[oó]mina|justificante de ingresos|busta paga|isee|recibo de vencimento|comprovativo de rendimentos|inkomensgegevens|inkomstenverklaring|inkomstuppgifter|zaświadczenie o dochodach|dochodach|소득|급여명세|(household|family|annual|gross|net|total) income|income (information|estimate|evidence)|proof of (household |family )?income|proof of resources|estimate of income|소득 증빙|income ?\/ ?tax|tax ?\/ ?income)(?![a-zA-Z])/i],

  /* Identity — includes the national identifiers people are asked to quote,
     since the vault holds the card or letter that evidences them. */
  ['id_proof', /(?<![a-zA-Z])(identity|identification|identity document|id card|id proof|photo id|passport|proof of age|national id|smart id|residence card|pi[èe]ce d'?identit[ée]|carte nationale|cni\b|ausweis|personalausweis|reisepass|lichtbildausweis|dni\b|nie\b|nif\b|documento de identidad|identificaci[oó]n oficial|curp|documento d'?identit[àa]|carta d'?identit[àa]|codice fiscale|cart[ãa]o de cidad[ãa]o|dowód osobisty|tożsamości|identiteitsbewijs|digid|bsn\b|legitimation|personbevis|aadhaar|pan card|emirates id|pps number|national insurance number|ni number|social insurance number|social security number|ssn\b|mykad|본인확인|신분증|주민등록증|本人確認|age proof|documento d[i'] ?identit[àa]?|ird number|eherkenning|tax file number|tfn\b|nino\b|cpf\b)(?![a-zA-Z])/i],

  /* Address and residence */
  ['proof_of_address', /(?<![a-zA-Z])(proof of (address|residence)|address proof|residence certificate|residency proof|proof of living|justificatif de domicile|attestation de domicile|meldebescheinigung|wohnsitz|anmeldung|empadronamiento|certificado de (residencia|empadronamiento)|comprobante de domicilio|certificato di residenza|comprovativo de morada|atestado de resid[êe]ncia|zameldowania|uittreksel brp|adresbewijs|folkbokf[öo]ring|住民票|주민등록등본)(?![a-zA-Z])/i],
  ['residence_permit', /(?<![a-zA-Z])(residence permit|resident permit|right to reside|settled status|visa\b|titre de s[ée]jour|carte de s[ée]jour|r[ée]c[ée]piss[ée]|aufenthaltstitel|aufenthaltserlaubnis|niederlassungserlaubnis|permiso de residencia|tarjeta de residencia|permesso di soggiorno|autoriza[çc][ãa]o de resid[êe]ncia|karta pobytu|verblijfsvergunning|uppeh[åa]llstillst[åa]nd)(?![a-zA-Z])/i],

  /* Money in */
  ['bank_details', /(?<![a-zA-Z])(bank (details|account|statement|mandate|book)|account details|iban|sort code|direct debit|rib\b|relev[ée] d'?identit[ée] bancaire|bankverbindung|kontoauszug|kontonummer|datos bancarios|certificado de titularidad|coordinate bancarie|dados banc[áa]rios|numer konta|rekeningnummer|bankkonto|cancelled cheque|passbook|금융정보|금융정보|통장사본|bankbook)(?![a-zA-Z])/i],

  /* Housing */
  ['tenancy_agreement', /(?<![a-zA-Z])(tenancy|lease|rental (agreement|contract)|rent (book|receipt|statement)|proof of rent|landlord|bail\b|contrat de location|quittance de loyer|mietvertrag|mietbescheinigung|contrato de alquiler|contrato de arrendamiento|contratto di locazione|contratto di affitto|contrato de arrendamento|umowa najmu|huurcontract|hyreskontrakt)(?![a-zA-Z])/i],
  ['utility_bill', /(?<![a-zA-Z])(utility bill|energy bill|electricity bill|gas bill|water bill|heating (bill|cost)|facture (d'?[ée]nergie|d'?[ée]lectricit[ée]|d'?eau|de gaz)|energierechnung|stromrechnung|heizkosten|factura de (luz|gas|agua|suministros)|bolletta|fatura de (luz|[áa]gua|servi[çc]os)|rachunek za|energierekening|elr[äa]kning|electricity account|energy account)(?![a-zA-Z])/i],

  /* Work and study */
  ['employment_contract', /(?<![a-zA-Z])(employment (contract|certificate|letter)|contract of employment|work contract|employer (letter|certificate|statement|declaration)|proof of employment|contrat de travail|attestation (de l'?)?employeur|arbeitsvertrag|arbeitgeberbescheinigung|besch[äa]ftigungsnachweis|contrato de trabajo|vida laboral|contratto di lavoro|contrato de trabalho|umowa o prac|werkgeversverklaring|anst[äa]llningsbevis|record of employment|roe\b|separation certificate)(?![a-zA-Z])/i],
  ['student_enrolment', /(?<![a-zA-Z])(enrol?ment|student (card|status|certificate|id)|matriculation|proof of study|certificat de scolarit[ée]|attestation d'?inscription|carte [ée]tudiant|immatrikulation|studienbescheinigung|schulbescheinigung|matr[íi]cula|certificado de estudios|certificato di iscrizione|libretto universitario|comprovativo de matr[íi]cula|legitymacja|zaświadczenie ze szkoły|inschrijvingsbewijs|studieintyg)(?![a-zA-Z])/i],

  /* Family and civil status */
  ['birth_certificate', /(?<![a-zA-Z])(birth certificate|certificate of birth|acte de naissance|extrait de naissance|geburtsurkunde|certificado de nacimiento|certificato di nascita|certid[ãa]o de nascimento|akt urodzenia|geboorteakte|f[öo]delsebevis|出生証明|acta de nacimiento)(?![a-zA-Z])/i],
  ['civil_status', /(?<![a-zA-Z])(civil status|marriage certificate|death certificate|divorce (decree|certificate)|family (record|book|composition|certificate)|household (composition|registration)|livret de famille|composition familiale|acte de (mariage|d[ée]c[èe]s)|familienstand|heiratsurkunde|sterbeurkunde|haushaltsbescheinigung|libro de familia|certificado de (matrimonio|defunci[oó]n)|stato di famiglia|certificato di (matrimonio|morte)|certid[ãa]o de (casamento|[óo]bito)|estado civil|akt małżeństwa|huwelijksakte|familjebevis)(?![a-zA-Z])/i],
  ['childcare_invoice', /(?<![a-zA-Z])(childcare|child care|nursery|creche|cr[èe]che|day ?care|after ?school|childminder|facture de garde|assistante maternelle|frais de garde|kinderbetreuung|kita\b|betreuungsvertrag|guarder[íi]a|escuela infantil|asilo nido|retta|creche|fatura de creche|żłobek|przedszkol|kinderopvang|f[öo]rskol|barnomsorg)(?![a-zA-Z])/i],

  /* Health and disability */
  ['medical_evidence', /(?<![a-zA-Z])(medical|doctor'?s? (note|letter|certificate)|disability (assessment|certificate|decision|card|registration)|health certificate|fit note|sick note|hospital (report|letter)|certificat m[ée]dical|justificatif m[ée]dical|carte d'?invalidit[ée]|mdph|[äa]rztlich|attest\b|schwerbehinderten|pflegegrad|informe m[ée]dico|certificado de discapacidad|certificato medico|verbale di invalidit[àa]|atestado m[ée]dico|orzeczenie o niepełnosprawno|zaświadczenie lekarskie|medische verklaring|l[äa]karintyg|장애인등록)(?![a-zA-Z])/i],

  /* Existing entitlements */
  ['benefit_decision', /(?<![a-zA-Z])(benefit (decision|award|letter|notice|statement)|award letter|entitlement letter|decision letter|concession card|pension statement|notification de droits|attestation de (paiement|droits)|leistungsbescheid|rentenbescheid|bescheid\b|resoluci[oó]n de prestaci[oó]n|certificado de prestaciones|provvedimento di prestazione|decis[ãa]o de presta[çc][ãa]o|decyzja o przyznaniu|toekenningsbeschikking|beslut om|ccb registration|centrelink|concession|social welfare payment|familienbeihilfe|qualifying payment)(?![a-zA-Z])/i],
  ['social_registry', /(?<![a-zA-Z])(cad[úu]nico|cadastro [úu]nico|social registry|nis\b|registro social|carte famille nombreuse|ration card)(?![a-zA-Z])/i],

  ['application_form', /(?<![a-zA-Z])(application form|claim form|completed form|formulaire de demande|antragsformular|formulario de solicitud|modulo di domanda|formul[áa]rio de candidatura|wniosek\b|aanvraagformulier|ans[öo]kningsblankett|신청서)(?![a-zA-Z])/i],
  ['jobseeker_registration', /(?<![a-zA-Z])(jobseeker|job seeker|registered (as )?unemployed|employment service registration|inscription (à )?p[ôo]le emploi|france travail|arbeitslos(meldung)?|arbeitssuchend|demanda de empleo|darde|inskrivning hos arbetsf[öo]rmedlingen|arbetsf[öo]rmedlingen|centro per l'?impiego|did\b)(?![a-zA-Z])/i],
  ['photo', /(?<![a-zA-Z])(photograph|passport photo|passport-sized|photo d'?identit[ée]|lichtbild|passbild|fotograf[íi]a|fotografia|zdj[eę]cie|pasfoto)(?![a-zA-Z])/i],
];

/**
 * Normalise a free-text requirement onto a canonical type.
 * Returns 'other' rather than guessing — an unknown requirement should show
 * up as "we don't recognise this one, here's what the agency wrote".
 */
export function classifyRequirement(text) {
  const s = String(text || '');
  for (const [type, re] of PATTERNS) if (re.test(s)) return type;
  return 'other';
}

/* ------------------------------------------------------------------ */
/* Holdings, expiry and coverage                                       */
/* ------------------------------------------------------------------ */

const MS_MONTH = 30 * 24 * 60 * 60 * 1000;

/**
 * When a held document stops being credible. `issued_at` is what the agency
 * cares about — not when it was uploaded.
 */
export function expiresAt(holding) {
  const spec = DOC_TYPES[holding?.type];
  if (!spec || spec.validity_months == null) return null;
  const issued = holding.issued_at ?? holding.created_at;
  if (!issued) return null;
  return issued + spec.validity_months * MS_MONTH;
}

export function isExpired(holding, asOf) {
  const exp = expiresAt(holding);
  return exp != null && exp < asOf;
}

/** Within 30 days of going stale — worth nudging before a claim depends on it. */
export function isExpiringSoon(holding, asOf) {
  const exp = expiresAt(holding);
  return exp != null && exp >= asOf && exp - asOf < MS_MONTH;
}

/**
 * What the user has versus what one programme wants.
 *
 * `asOf` is passed in rather than read from the clock so this is pure and
 * testable, and so the Worker and the client always agree.
 */
export function coverageFor(programme, holdings, asOf) {
  const required = (programme?.documents_required || [])
    .map((d) => ({
      doc: d.doc,
      mandatory: d.mandatory !== false,
      note: d.note ?? null,
      type: classifyRequirement(d.doc),
    }))
    /* "None" / "Ingen ansökan krävs" is the scheme saying it wants nothing.
       Counting it as an outstanding document would tell someone on an
       automatic payment that they are missing paperwork. */
    .filter((r) => r.type !== 'not_required');

  const usable = (holdings || []).filter((h) => !isExpired(h, asOf));
  const have = new Set(usable.map((h) => h.type));

  const satisfied = required.filter((r) => r.type !== 'other' && have.has(r.type));
  const missing = required.filter((r) => r.type === 'other' || !have.has(r.type));
  const stale = required
    .map((r) => (holdings || []).find((h) => h.type === r.type && isExpired(h, asOf)))
    .filter(Boolean);

  const mandatoryMissing = missing.filter((r) => r.mandatory);

  return {
    required,
    satisfied,
    missing,
    /** Held but out of date — a different problem from never having had it. */
    stale,
    ready: mandatoryMissing.length === 0,
    pct: required.length ? Math.round((satisfied.length / required.length) * 100) : 100,
  };
}

/**
 * The reason the vault exists, computed across every claim at once.
 *
 * Sorted by how many applications each missing document unblocks, so the UI
 * can say "upload one payslip, finish four claims" instead of showing twelve
 * separate checklists. This is the same consolidation idea as buildPlan's
 * `gaps`, but for evidence rather than answers.
 */
export function documentPlan(programmes, holdings, asOf, lang = 'en') {
  const unlocks = new Map();
  let ready = 0;

  for (const p of programmes || []) {
    const cov = coverageFor(p, holdings, asOf);
    if (cov.ready) ready += 1;
    for (const r of cov.missing) {
      if (!r.mandatory) continue;
      /* Recognised types merge — one payslip really does satisfy nine
         schemes. Unrecognised ones must NOT: they are different documents
         that happen to share a fallback label, and merging them would claim
         a reuse that does not exist. Key those by their own text. */
      const key = r.type === 'other' ? `other:${r.doc.trim().toLowerCase()}` : r.type;
      const cur = unlocks.get(key) || {
        type: r.type,
        label: r.type === 'other' ? r.doc.trim() : docLabel(r.type, lang),
        programmes: [],
        verbatim: new Set(),
      };
      cur.programmes.push(p.name_local || p.name_en || p.slug);
      cur.verbatim.add(r.doc);
      unlocks.set(key, cur);
    }
  }

  const gaps = [...unlocks.values()]
    .map((g) => ({
      type: g.type,
      label: g.label,
      unlocks_count: g.programmes.length,
      unlocks: g.programmes.slice(0, 8),
      /** What the agencies actually called it, so the user recognises it. */
      also_known_as: [...g.verbatim].slice(0, 4),
      recognised: g.type !== 'other',
    }))
    .sort((a, b) => b.unlocks_count - a.unlocks_count);

  return {
    total: (programmes || []).length,
    ready,
    gaps,
    expiring_soon: (holdings || [])
      .filter((h) => isExpiringSoon(h, asOf))
      .map((h) => ({ id: h.id, type: h.type, label: docLabel(h.type, lang), expires_at: expiresAt(h) })),
  };
}

/* ------------------------------------------------------------------ */
/* Encryption — the server never holds a key or a plaintext            */
/* ------------------------------------------------------------------ */

/**
 * Envelope encryption.
 *
 * Each document gets a random data key (DEK). The DEK is wrapped under a key
 * derived from the user's passphrase (KEK). We store the wrapped DEK next to
 * the ciphertext and never the KEK, so:
 *
 *   - changing the passphrase rewraps N small keys, not N large files;
 *   - a single document can later be shared by handing over one DEK;
 *   - the server, holding both wrapped DEK and ciphertext, still has nothing.
 *
 * 600,000 PBKDF2 iterations follows OWASP's 2023 guidance for PBKDF2-HMAC-
 * SHA256. Argon2id would be better and is not available without a dependency.
 *
 * `provider` is `{ subtle, getRandomValues }` — WebCrypto in the browser and
 * the Worker, and whatever React Native supplies on device.
 */
export const KDF_ITERATIONS = 600_000;

export function createVaultCrypto(provider) {
  const subtle = provider?.subtle;
  const random = provider?.getRandomValues?.bind(provider);
  if (!subtle || !random) {
    throw new Error('vault: a crypto provider with subtle and getRandomValues is required');
  }

  const bytes = (n) => random(new Uint8Array(n));

  /** Passphrase → wrapping key. Salt is per user, stored alongside. */
  async function deriveKek(passphrase, salt) {
    const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
      'deriveKey',
    ]);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    );
  }

  /** Encrypt one document. Returns everything the server may hold. */
  async function encryptDocument(plaintext, kek) {
    const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = bytes(12);
    const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, dek, plaintext));
    const wrapIv = bytes(12);
    const wrappedKey = new Uint8Array(
      await subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv: wrapIv }),
    );
    return { ciphertext, iv, wrappedKey, wrapIv };
  }

  async function decryptDocument(envelope, kek) {
    const dek = await subtle.unwrapKey(
      'raw',
      envelope.wrappedKey,
      kek,
      { name: 'AES-GCM', iv: envelope.wrapIv },
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    return new Uint8Array(
      await subtle.decrypt({ name: 'AES-GCM', iv: envelope.iv }, dek, envelope.ciphertext),
    );
  }

  async function digest(data) {
    const h = new Uint8Array(await subtle.digest('SHA-256', data));
    return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  return { deriveKek, encryptDocument, decryptDocument, digest, newSalt: () => bytes(16) };
}

/* ------------------------------------------------------------------ */
/* Server-side metadata contract                                       */
/* ------------------------------------------------------------------ */

/**
 * Exactly what the server is allowed to store about a document.
 *
 * Deliberately NOT the filename: "AAH_refus_2024.pdf" or
 * "divorce_settlement.pdf" leaks the thing we just went to the trouble of
 * encrypting. The user sees their own label, decrypted client-side, held in
 * the encrypted blob's own header.
 */
export function metadataFor({ id, type, bytes, issuedAt, createdAt, checksum }) {
  if (!DOC_TYPES[type]) throw new Error(`vault: unknown document type ${type}`);
  return {
    id,
    type,
    bytes,
    issued_at: issuedAt ?? createdAt,
    created_at: createdAt,
    expires_at: expiresAt({ type, issued_at: issuedAt, created_at: createdAt }),
    checksum,
  };
}

/** Fields that must never reach the server. Asserted in the test suite. */
export const NEVER_STORED_SERVER_SIDE = Object.freeze([
  'filename',
  'plaintext',
  'passphrase',
  'kek',
  'dek',
  'notes',
]);

/* ------------------------------------------------------------------ */
/* Transfer                                                            */
/* ------------------------------------------------------------------ */

/**
 * A manifest for handing evidence to one agency.
 *
 * The user downloads, checks and attaches. We do not transmit anything to an
 * agency ourselves — that would be the submission act, and outside Spain we
 * do not perform it. The manifest exists so the user can see, in one screen,
 * exactly which files this claim needs and which they already hold.
 */
export function buildTransferBundle({ programme, holdings, asOf, lang = 'en' }) {
  const cov = coverageFor(programme, holdings, asOf);
  const byType = new Map((holdings || []).map((h) => [h.type, h]));

  return {
    programme: programme.name_local || programme.name_en,
    application_url: programme.application_url || programme.source_url,
    ready: cov.ready,
    include: cov.satisfied.map((r) => {
      const h = byType.get(r.type);
      return {
        type: r.type,
        label: docLabel(r.type, lang),
        requested_as: r.doc,
        document_id: h?.id ?? null,
        checksum: h?.checksum ?? null,
        expires_at: h ? expiresAt(h) : null,
      };
    }),
    still_needed: cov.missing.map((r) => ({
      type: r.type,
      label: docLabel(r.type, lang),
      requested_as: r.doc,
      mandatory: r.mandatory,
      note: r.note,
    })),
    /** Said plainly, because it is the thing people get wrong. */
    delivery: 'You attach these yourself, in your own session with the agency. We never send them for you.',
  };
}
