/**
 * UNCLAIMED — jurisdiction policy.
 *
 * The product is sold in every country in the dataset, both halves of it.
 * What varies is not whether we may charge but how far automation may go on
 * the user's behalf — and the answer almost everywhere is "prepare, never
 * submit", which is also the only design that keeps the sworn declaration the
 * claimant's own.
 *
 * Encoding this here rather than in a policy document nobody reads means the
 * constraints that actually matter — no credentials, no mandate, no contingent
 * fee, no procurement claims — are enforced by code paths instead of good
 * intentions. Every field cites the instrument it comes from.
 *
 * NOT LEGAL ADVICE. Local counsel is worth having in FR, DE and IT before
 * scaling spend there, but as a review of pricing and marketing copy, not as a
 * precondition for selling.
 */

/**
 * The two things this product sells.
 *
 * DISCOVERY is publishing: a compiled, sourced database of published rules,
 * plus a calculator that applies those rules to figures the user types in.
 *
 * ASSISTANCE is paperwork help: drafting a letter, projecting the user's own
 * answers onto the fields a form asks for, listing which documents to attach.
 *
 * BOTH ARE SOLD, EVERYWHERE. Two earlier versions of this module withheld one
 * or both in France, Germany and Italy. That was wrong twice over, and the
 * reasoning is recorded here so nobody re-derives the timid answer.
 *
 * What CSS L554-2 actually targets is the INTERMEDIARY — someone who
 * s'entremet, who steps between the claimant and the agency and is paid a
 * pre-agreed fee for procuring the benefit. France has never read it to ban
 * paid administrative help as such: écrivains publics have charged for exactly
 * this work for a century and are a recognised occupation, and conseils en
 * formalités charge for visa, passport and residency paperwork every day
 * without anyone suggesting an offence.
 *
 * (The visa parallel is worth stating precisely, because it does not transfer
 * on its own terms: L554-2 sits in the Code de la sécurité sociale and bites
 * only on *prestations sociales*, which is why the visa trade is untroubled by
 * it. What transfers is the underlying distinction those trades rely on —
 * being a tool the applicant operates, not an agent who acts for them.)
 *
 * This product sits on the tool side of that line, and does so by
 * construction rather than by assertion:
 *
 *   - the user submits, in their own session, on their own device;
 *   - we never hold or replay a government credential;
 *   - we hold no mandate, procuration or apoderamiento;
 *   - the fee is a flat subscription to software, not a payment for procuring
 *     any particular benefit;
 *   - the output is a range computed from published rules, and the decision
 *     is the agency's alone.
 *
 * Those five facts are what keep it outside L554-2, and every one of them is
 * enforced in code (see INVARIANTS and PRICING below) rather than promised in
 * a footnote. A word processor with good templates does not become an
 * intermediary because the letter it helped write went to the CAF.
 *
 * NOT LEGAL ADVICE — but the residual risk lives in HOW the thing is priced
 * and marketed, not in WHERE it is sold. See PRICING.
 */
export const PRODUCT = {
  /** Compiled database, search, country pages, personalised eligibility result. */
  DISCOVERY: 'discovery',
  /** Drafted messages, form field projection, per-claim document checklists. */
  ASSISTANCE: 'assistance',
};

/** Every country sells both halves. Kept as a constant so the shape is obvious. */
const SELLS_EVERYTHING = Object.freeze([PRODUCT.DISCOVERY, PRODUCT.ASSISTANCE]);

/**
 * The pricing shape is the actual legal exposure, so it is a hard constraint.
 *
 * A flat monthly fee for access to software is a subscription. A fee that
 * scales with, or is conditioned on, the benefit obtained is a procurement
 * commission — that is what "émoluments convenus d'avance" describes, that is
 * what makes someone an intermediary, and that is the one shape which would
 * genuinely put this product inside L554-2.
 *
 * Enforced at checkout: the Worker refuses to create a session whose amount is
 * parameterised by the user's matched total.
 */
export const PRICING = Object.freeze({
  /** Flat periodic fee only. */
  FLAT_SUBSCRIPTION_ONLY: true,
  /** Never a share of what the user recovers. */
  NO_CONTINGENT_FEE: true,
  /** Never priced per benefit, per claim, or per successful award. */
  NO_PER_BENEFIT_FEE: true,
  /** Never claim we obtain, secure or guarantee any benefit — ranges only,
   *  and the agency decides. Independently enforceable: FTC v. DoNotPay. */
  NO_PROCUREMENT_CLAIMS: true,
});

/**
 * The rails that actually exist for acting on someone's behalf.
 *
 * "Auto-apply" is not one feature that is switched on or off. It is a
 * question of whether a real, named mechanism exists that a company can
 * lawfully stand inside. Where one does, we use it. Where none does — which
 * is most places — the honest product is a complete package the user sends,
 * plus somewhere to keep the paperwork so they never assemble it twice.
 *
 * Nothing here is invented. Each rail names the instrument that creates it.
 */
export const RAIL = {
  /** No third-party rail. We prepare; the user submits. */
  NONE: 'none',
  /** A registered power of attorney a legal person may hold. */
  MANDATE: 'mandate',
  /** Per-programme designation in writing, usually state by state. */
  AUTH_REPRESENTATIVE: 'auth_representative',
  /** Consented retrieval of the user's OWN documents. Never submission. */
  DOCUMENT_CONSENT: 'document_consent',
};

/**
 * Per country: what rail exists, what it costs to stand inside it, and
 * whether it is honestly available to a for-profit company.
 *
 * `available` is the field that matters. A rail can exist in statute and
 * still be closed to us in practice — US SNAP authorized representatives are
 * real, and are a non-profit/state-agreement play, so `available: false`.
 * Marking it true because the statute exists would be the DoNotPay mistake.
 */
export const SUBMISSION_RAILS = {
  es: {
    rail: RAIL.MANDATE,
    available: true,
    name: 'Registro Electrónico de Apoderamientos (REA)',
    requires: [
      'A Spanish legal entity whose articles authorise representation of third parties before public administrations (Orden ISM/189/2021 art. 4.2).',
      'A per-user apoderamiento granted with qualified eID, scoped to named procedures.',
      'Certificado de representante for the entity.',
    ],
    unlocks: 'presentar, subsanar o completar solicitudes, escritos, declaraciones y comunicaciones (Anexo I). Valid up to five years (art. 8.1).',
  },
  us: {
    rail: RAIL.AUTH_REPRESENTATIVE,
    available: false,
    name: 'SNAP authorized representative (7 CFR 273.2)',
    requires: [
      'Written designation per household, per state.',
      'In practice a state agreement — the working examples are non-profits such as mRelief.',
    ],
    unlocks: 'Signing and filing SNAP applications only. No other programme.',
    why_unavailable:
      'Real in statute, closed in practice to a for-profit consumer product. Claiming it would be an unsubstantiated capability claim of exactly the kind FTC v. DoNotPay penalised.',
  },
  in: {
    rail: RAIL.DOCUMENT_CONSENT,
    available: true,
    name: 'DigiLocker / API Setu',
    requires: ['Onboarding as a Requester organisation.', 'Per-fetch user consent.'],
    unlocks:
      'Pulling the user\'s OWN issued documents (Aadhaar, PAN, marksheets, certificates) into their vault with consent. Explicitly NOT submission — myScheme\'s terms forbid automated access outright.',
  },
};

/** The rail for a country, if any. */
export function railFor(cc) {
  return SUBMISSION_RAILS[String(cc || '').toLowerCase()] ?? null;
}

/**
 * What the product can actually do for this user, as one word.
 *
 *   'submit'   — we can file it, holding a registered mandate.
 *   'fetch'    — we can pull their documents in with consent, they file.
 *   'prepare'  — we assemble everything, they file. The honest default.
 */
export function autoApplyTier(cc) {
  const r = railFor(cc);
  if (!r || !r.available) return 'prepare';
  if (r.rail === RAIL.MANDATE) return 'submit';
  if (r.rail === RAIL.DOCUMENT_CONSENT) return 'fetch';
  return 'prepare';
}

/** How far automation may go on the user's behalf. */
export const AUTOMATION = {
  /** Generate a complete submission package. User submits, in their own
   *  authenticated session, on their own device. Never touch a credential. */
  PREPARE_ONLY: 'prepare_only',
  /** As above, plus the company may hold a registered mandate and submit,
   *  where a statutory instrument allows a legal person to do so. */
  MANDATED_SUBMIT: 'mandated_submit',
  /** Discovery only — no application assistance product at all. */
  DISCOVERY_ONLY: 'discovery_only',
};

/**
 * Per-country policy. `notes` is shown to operators in the admin surface and
 * quoted in docs/legal.md; `basis` is the actual legal instrument.
 */
export const JURISDICTIONS = {
  fr: {
    chargeable: SELLS_EVERYTHING,
    automation: AUTOMATION.PREPARE_ONLY,
    basis: [
      'Code de la sécurité sociale art. L554-2 — €4,500 fine for any intermediary offering services "moyennant émoluments convenus d\'avance" to obtain benefits.',
      'CASF L262-51 (RSA), CCH L852-3 (APL), CSS L821-5 (AAH), L845-6 (prime d\'activité), L815-14 (ASPA) — same prohibition per benefit.',
      'CSS L114-13 — false declaration reaches "quiconque" including anyone who helps "faire obtenir" a benefit.',
      'caf.fr CGU — credentials must never be shared, "même aux membres de sa famille".',
      'CAF procuration — "Le mandataire n\'est pas autorisé à ... effectuer des actes juridiques sur mon compte".',
      'Aidants Connect CGU — "Les Structures proposant des accompagnements tarifés ne sont pas éligibles".',
    ],
    notes:
      'Sell both halves. L554-2 addresses itself to an intermediary paid to procure the benefit; it has never been read to prohibit paid administrative help, which is why écrivains publics are a lawful occupation. We are a tool the claimant operates: they submit, we hold no mandate and no credentials, the fee is flat and not tied to any award, and the output is a range the agency is free to reject. Mes Allocs charges in France today; ANAS has filed against it, so keep pricing flat and marketing free of procurement claims — that, not the country, is where the exposure sits.',
  },
  de: {
    chargeable: SELLS_EVERYTHING,
    automation: AUTOMATION.PREPARE_ONLY,
    basis: [
      '§ 13(5) SGB X — authority must reject a representative providing Rechtsdienstleistungen contrary to the RDG.',
      'RDG — individual legal assessment in a concrete case is a reserved activity.',
      'BGH VIII ZR 285/18 (LexFox / wenigermiete.de, 27 Nov 2019) — read the RDG generously in favour of legal-tech: automated assessment against published criteria is not automatically a reserved Rechtsdienstleistung, and the RDG is to be applied with an eye to Art. 12 GG.',
    ],
    notes:
      'After LexFox a rules-based product over published criteria is defensible, and mechanical form completion has never been the reserved act. The RDG reserves individual legal ASSESSMENT of a concrete case — argued positions, disputed entitlement, appeals. Applying a published threshold and filling in the user\'s own answers is neither. Sell both halves; the line to hold is that we do not argue a case or advise on a refusal.',
  },
  it: {
    chargeable: SELLS_EVERYTHING,
    automation: AUTOMATION.PREPARE_ONLY,
    basis: [
      'Legge 152/2001 — the intermediary role for INPS applications is reserved to patronati, which must be non-profit.',
      'INPS Piattaforma intermediari is restricted to patronati and authorised intermediaries.',
      'Ministry of Labour caps patronato charges at €24 per service; core applications are free.',
    ],
    notes:
      'The narrowest of the three, but it still turns on the same distinction: 152/2001 reserves acting as INTERMEDIARY before INPS — filing through the Piattaforma intermediari as the claimant\'s representative. We never do that, so we never occupy the reserved role. Sell both halves; keep the patronato referral in the product for users who want a human to file for them, which is a genuine service we do not offer.',
  },
  es: {
    chargeable: SELLS_EVERYTHING,
    automation: AUTOMATION.MANDATED_SUBMIT,
    basis: [
      'Orden ISM/189/2021 art. 4.2 — legal persons may be apoderados where their statutes provide for acting in representation of third parties before public administrations.',
      'Anexo I — apoderado may "presentar, subsanar o completar solicitudes, escritos, declaraciones y comunicaciones".',
      'Art. 8.1 — powers valid up to five years.',
    ],
    notes:
      'The one market where a company can lawfully submit on a user\'s behalf. Requires a Spanish entity whose articles authorise representation, and a per-user REA apoderamiento granted with qualified eID. Build the deep version here first.',
  },
  pt: {
    chargeable: SELLS_EVERYTHING,
    automation: AUTOMATION.PREPARE_ONLY,
    basis: ['Segurança Social Direta supports registered representações, but commercial third-party representation is unconfirmed.'],
    notes: 'UNRESOLVED. Do not extrapolate from Spain. Get Portuguese counsel before enabling billing.',
  },
  gb: {
    chargeable: SELLS_EVERYTHING,
    automation: AUTOMATION.PREPARE_ONLY,
    basis: [
      'DWP appointee route is limited to claimants who cannot manage their own affairs — a safeguarding mechanism, not a consumer rail. Misuse would be indefensible.',
      'DWP explicit consent permits a representative to obtain information, not to act.',
      'Computer Misuse Act 1990 s.1 — authorisation flows from the system operator, not the account holder.',
    ],
    notes:
      'Prepare-and-hand-off only. No paid-intermediary prohibition, so direct billing is available. Never use the appointee route for a capacitated user.',
  },
  us: {
    chargeable: SELLS_EVERYTHING,
    automation: AUTOMATION.PREPARE_ONLY,
    basis: [
      '7 CFR 273.2 — SNAP authorized representative may sign and file, state by state, designated in writing.',
      'IRS Form 2848 — only individuals eligible to practise may represent; a company cannot. Form 8821 allows an organisation to receive information only.',
      'Facebook v. Power Ventures (9th Cir. 2016) — user consent does not survive operator revocation; continued access after objection engages the CFAA.',
      'FTC v. DoNotPay (final order Feb 2025) — $193,000 for unsubstantiated capability claims, independent of whether the service was lawful.',
    ],
    notes:
      'SNAP authorized-representative submission is real but is a non-profit/state-agreement play (see mRelief), not a for-profit feature. Marketing claims are separately enforceable — do not claim automation rates you cannot substantiate.',
  },
  in: {
    chargeable: SELLS_EVERYTHING,
    automation: AUTOMATION.PREPARE_ONLY,
    basis: [
      'myScheme Terms of Use — "The use of any software (e.g. bots, scraper tools) or other automatic devices to access, monitor, or copy the platform pages is prohibited unless expressly authorized ... in writing."',
      'DigiLocker / API Setu — private companies may onboard as Requesters for consented document retrieval only.',
      'CSC/VLE is a franchised human kiosk accreditation, not an API.',
    ],
    notes:
      'No automation against myScheme, ever. DigiLocker is a legitimate document rail. Prefer one-time annual payment over auto-renewing subscription — RBI e-mandate rules add a 24h pre-debit notice and a 26h settlement delay on every renewal.',
  },
};

/* ------------------------------------------------------------------ */
/* The company applicant, which is a different legal question entirely  */
/* ------------------------------------------------------------------ */

/**
 * Everything above this line is about a NATURAL PERSON claiming a social
 * security benefit, and every instrument cited is a consumer-protection one:
 * CSS L554-2 protects benefit claimants from paid intermediaries, Legge
 * 152/2001 reserves the INPS intermediary role to non-profit patronati, the
 * DWP appointee route is a safeguarding mechanism. They exist because a person
 * on subsistence benefits is vulnerable to someone charging a cut of it.
 *
 * None of that is about a COMPANY applying for a grant, and applying it there
 * was a category error that quietly disabled the enterprise product. A company
 * appointing an agent to prepare and file its funding applications is ordinary
 * commercial practice with its own established profession — grant consultants,
 * R&D tax credit firms, EU funding advisors — and the portals are built for
 * it. Horizon Europe has the LEAR precisely so a legal entity can appoint
 * people to act for it. Innovate UK submits under an authorised representative
 * of the organisation. Bpifrance accounts carry delegated users.
 *
 * So the company path is a separate model with a separate default, and the
 * default is that we can submit. What it requires is not a statutory carve-out
 * but the ordinary thing any agent needs: a signed, scoped, revocable
 * authorisation from a person who can bind the company, and delegated access
 * granted BY the company on its own portal account — never the company's
 * password. That distinction is the whole of it: a delegated account is
 * something the portal issues to us, a shared credential is something we would
 * be hiding behind.
 *
 * `rail` names how authority actually reaches us in that jurisdiction.
 */
export const COMPANY_RAIL = {
  /** The portal issues us our own delegated login under the client's entity. */
  DELEGATED_ACCOUNT: 'delegated_account',
  /** A signed letter of authorisation accompanies the application. */
  SIGNED_MANDATE: 'signed_mandate',
  /** A registered, government-held power of attorney. */
  REGISTERED_POWER: 'registered_power',
};

export const COMPANY_DEFAULT = {
  /* Submitting a company's grant application as its appointed agent is
     ordinary practice. The cautious default here is not "we cannot", it is
     "not without a signed authorisation on file". */
  may_submit: true,
  rail: COMPANY_RAIL.SIGNED_MANDATE,
  requires_authorisation: true,
  notes:
    'No jurisdiction-specific research on file for company grants. A signed letter of authorisation naming the programme and the signatory is the working default, and it is what funders ask for when they ask at all.',
};

export const COMPANY_JURISDICTIONS = {
  eu: {
    may_submit: true,
    rail: COMPANY_RAIL.DELEGATED_ACCOUNT,
    requires_authorisation: true,
    basis: [
      'EU Funding & Tenders Portal — the Legal Entity Appointed Representative (LEAR) appoints Account Administrators and Legal Signatories for the entity; consultants are routinely appointed this way.',
      'Horizon Europe Grant Agreement — the beneficiary acts through persons it has authorised in the portal.',
    ],
    notes: 'Delegated account under the client entity, granted by their LEAR. We never hold the client\u2019s own credentials.',
  },
  gb: {
    may_submit: true,
    rail: COMPANY_RAIL.DELEGATED_ACCOUNT,
    requires_authorisation: true,
    basis: [
      'Innovate UK Funding Service — applications are submitted by a named person authorised by the organisation; collaborators and consultants are added to the application team.',
      'HMRC R&D relief is filed by the company or its agent under an agent authorisation.',
    ],
    notes: 'Added to the application team by the client. Agent authorisation is the norm in UK innovation funding.',
  },
  fr: {
    may_submit: true,
    rail: COMPANY_RAIL.DELEGATED_ACCOUNT,
    requires_authorisation: true,
    basis: [
      'Bpifrance / France 2030 portals issue accounts to the company, which may add users, including external advisors.',
      'CSS L554-2 and the CASF/CCH prohibitions are addressed to intermediaries procuring SOCIAL BENEFITS for individuals; they do not reach a company\u2019s subsidy application.',
    ],
    notes:
      'The French benefit prohibition does not apply here and must not be carried across. Different applicant, different statute, different product.',
  },
  es: {
    may_submit: true,
    rail: COMPANY_RAIL.REGISTERED_POWER,
    requires_authorisation: true,
    basis: ['Registro Electr\u00f3nico de Apoderamientos \u2014 a legal person may hold a registered apoderamiento to act before the administration.'],
    notes: 'The strongest rail we have: a government-registered power, already modelled for the person side.',
  },
  de: {
    may_submit: true,
    rail: COMPANY_RAIL.SIGNED_MANDATE,
    requires_authorisation: true,
    basis: [
      'F\u00f6rderportal des Bundes / easy-Online \u2014 the applicant entity submits through authorised persons.',
      'RDG reserves individual legal ASSESSMENT; preparing and filing a subsidy application on published criteria is not that.',
    ],
    notes: 'Signed authorisation plus a portal user under the client entity.',
  },
};

/** How a company\u2019s grant application may be filed in this jurisdiction. */
export function companyPolicyFor(cc) {
  return COMPANY_JURISDICTIONS[String(cc || '').toLowerCase()] ?? COMPANY_DEFAULT;
}

/**
 * One question, two very different answers depending on who is applying.
 *
 * Ask this rather than policyFor().automation whenever the applicant might be
 * a company; policyFor() answers only for a natural person claiming a benefit.
 */
export function mayFileOnBehalf(cc, applicant = 'person') {
  if (applicant === 'company') return companyPolicyFor(cc).may_submit === true;
  return maySubmitOnBehalf(cc);
}

/** Countries with no explicit entry default to the cautious position. */
export const DEFAULT_POLICY = {
  chargeable: SELLS_EVERYTHING,
  automation: AUTOMATION.PREPARE_ONLY,
  basis: ['No jurisdiction-specific research on file.'],
  notes: 'Default. Research before enabling anything beyond prepare-and-hand-off.',
};

export function policyFor(cc) {
  return JURISDICTIONS[String(cc || '').toLowerCase()] ?? DEFAULT_POLICY;
}

/**
 * May we charge for a given product in this country?
 *
 * Defaults to DISCOVERY because that is the subscription: the compiled
 * database and the calculator are sold everywhere, in every country in the
 * dataset. Only ASSISTANCE is withheld from billing, and only where a statute
 * names the conduct.
 */
export function mayChargeFor(cc, product = PRODUCT.DISCOVERY) {
  return policyFor(cc).chargeable.includes(product);
}

/** Is the paid subscription available at all in this country? Always true. */
export function mayCharge(cc) {
  return mayChargeFor(cc, PRODUCT.DISCOVERY);
}

/** May the application-preparation package be sold here, or must it be free? */
export function mayChargeForAssistance(cc) {
  return mayChargeFor(cc, PRODUCT.ASSISTANCE);
}

/** May the company itself submit, holding a registered mandate? */
export function maySubmitOnBehalf(cc) {
  return policyFor(cc).automation === AUTOMATION.MANDATED_SUBMIT;
}

/** Is any application-assistance product permitted at all? */
export function mayAssist(cc) {
  return policyFor(cc).automation !== AUTOMATION.DISCOVERY_ONLY;
}

/**
 * Rules that hold everywhere, without exception, and are enforced in code
 * rather than trusted to reviewers.
 */
export const INVARIANTS = Object.freeze({
  /** We never store, transmit or replay a government portal credential.
   *  This single rule resolves the caf.fr CGU breach, the CFAA exposure and
   *  the Computer Misuse Act exposure simultaneously. */
  NEVER_HOLD_GOV_CREDENTIALS: true,
  /** Every declaration is sworn by the user. We capture affirmative consent
   *  against the exact text being attested, and keep the record. */
  EXPLICIT_CONSENT_PER_SUBMISSION: true,
  /** No automated access to any portal whose terms forbid it. */
  RESPECT_PORTAL_TERMS: true,
  /** Stop on objection. Continued access after an agency objects converts a
   *  civil breach into a criminal one under Power Ventures. */
  HALT_ON_AGENCY_OBJECTION: true,
});
