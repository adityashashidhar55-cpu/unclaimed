/**
 * UNCLAIMED — jurisdiction policy.
 *
 * This module is the reason the product can ship. Monetisation and automation
 * are NOT globally uniform: several European legislatures have specifically
 * decided that helping someone obtain benefits must not be sold to them, and
 * that submitting on their behalf is a reserved activity.
 *
 * Encoding that here — rather than in a policy document nobody reads — means
 * the paywall and the auto-apply engine physically cannot do the wrong thing
 * in the wrong country. Every field below cites the instrument it comes from.
 *
 * NOT LEGAL ADVICE. Before launch, local counsel is required in at least FR
 * (L554-2), DE (RDG) and IT (patronato reservation). See docs/legal.md.
 */

/**
 * The two things this product sells. They are legally distinct and must be
 * gated separately — conflating them is the mistake this module used to make.
 *
 * DISCOVERY is publishing: a compiled, sourced database of published rules,
 * plus a calculator that applies those published rules to figures the user
 * types in. Selling reference material is not intermediation. Nobody is
 * "s'entremettre"-ing; no application is touched; the user is buying a book
 * that does arithmetic. No jurisdiction researched here prohibits selling it.
 *
 * ASSISTANCE is procurement: drafting the user's letter, projecting their
 * answers onto a specific agency's form, telling them which documents to
 * attach to which claim. This is done "en vue de faire obtenir le bénéfice"
 * and is where the French, German and Italian prohibitions actually bite.
 *
 * A disclaimer does not move the line. CSS L554-2 penalises taking
 * pre-agreed remuneration for the intermediation; it says nothing about
 * guaranteeing an outcome, so "we don't guarantee benefits" and "consult a
 * lawyer" do not cure it. What moves the line is not selling that service.
 */
export const PRODUCT = {
  /** Compiled database, search, country pages, personalised eligibility result. */
  DISCOVERY: 'discovery',
  /** Drafted messages, form field projection, per-claim document checklists. */
  ASSISTANCE: 'assistance',
};

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
    chargeable: [PRODUCT.DISCOVERY],
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
      'Sell the compiled database and the eligibility calculator: publishing reference material is not intermediation, and L554-2 addresses itself to someone who acts "en vue de faire obtenir" the benefit. Do NOT sell the application-preparation package here — drafting a claimant\'s letter for a fee is the conduct the article names. Mes Allocs charges in France today and ANAS has filed against it on exactly this theory; the case is the live test of where the line sits, so take French counsel before scaling revenue here.',
  },
  de: {
    chargeable: [PRODUCT.DISCOVERY],
    automation: AUTOMATION.PREPARE_ONLY,
    basis: [
      '§ 13(5) SGB X — authority must reject a representative providing Rechtsdienstleistungen contrary to the RDG.',
      'RDG — individual legal assessment in a concrete case is a reserved activity.',
      'BGH VIII ZR 285/18 (LexFox / wenigermiete.de, 27 Nov 2019) — read the RDG generously in favour of legal-tech: automated assessment against published criteria is not automatically a reserved Rechtsdienstleistung, and the RDG is to be applied with an eye to Art. 12 GG.',
    ],
    notes:
      'Weaker than it first looks. After LexFox a rules-based calculator over published criteria is defensible, so the database and the match are chargeable. The reserved act is individual legal assessment of a concrete case — which is closer to drafting someone\'s claim than to computing a threshold. Keep assistance free here until German counsel signs off.',
  },
  it: {
    chargeable: [PRODUCT.DISCOVERY],
    automation: AUTOMATION.DISCOVERY_ONLY,
    basis: [
      'Legge 152/2001 — the intermediary role for INPS applications is reserved to patronati, which must be non-profit.',
      'INPS Piattaforma intermediari is restricted to patronati and authorised intermediaries.',
      'Ministry of Labour caps patronato charges at €24 per service; core applications are free.',
    ],
    notes:
      'Legge 152/2001 reserves the INTERMEDIARY role, not the publishing of information. Selling the database is unaffected. No for-profit lane exists for the application itself — refer to a patronato and consider a referral partnership.',
  },
  es: {
    chargeable: [PRODUCT.DISCOVERY, PRODUCT.ASSISTANCE],
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
    chargeable: [PRODUCT.DISCOVERY],
    automation: AUTOMATION.PREPARE_ONLY,
    basis: ['Segurança Social Direta supports registered representações, but commercial third-party representation is unconfirmed.'],
    notes: 'UNRESOLVED. Do not extrapolate from Spain. Get Portuguese counsel before enabling billing.',
  },
  gb: {
    chargeable: [PRODUCT.DISCOVERY, PRODUCT.ASSISTANCE],
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
    chargeable: [PRODUCT.DISCOVERY, PRODUCT.ASSISTANCE],
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
    chargeable: [PRODUCT.DISCOVERY, PRODUCT.ASSISTANCE],
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

/** Countries with no explicit entry default to the cautious position. */
export const DEFAULT_POLICY = {
  chargeable: [PRODUCT.DISCOVERY, PRODUCT.ASSISTANCE],
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
