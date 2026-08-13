/**
 * UNCLAIMED matcher engine.
 *
 * Pure JavaScript, zero dependencies, zero DOM access. Runs identically in
 * Node (static site generation) and in the browser (live wizard), which is
 * what guarantees the cross-platform consistency rule: every number a user
 * sees anywhere comes out of this file.
 *
 * Ported from the original TypeScript engine (legacy/src/engine/matcher.ts).
 */

export const DISCLAIMER =
  'This is a discovery tool, not legal, tax or financial advice. You appear to meet the published criteria — only the official body can confirm your entitlement. Always check the source page before applying.';

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

const STATUS_LABEL = {
  student: 'students',
  employee: 'employed people',
  self_employed: 'self-employed people',
  unemployed: 'people who are out of work',
  retired: 'retired people',
  parent: 'parents',
  jobseeker: 'jobseekers',
};

const TENURE_LABEL = {
  renting: 'renters',
  owner: 'homeowners',
  hosted: 'people living with family or friends',
  student_housing: 'people in student housing',
  homeless: 'people without a fixed home',
};

const NATIONALITY_LABEL = {
  citizen_or_pr: 'citizens or permanent residents',
  any_resident: 'legal residents',
  refugee_or_protected: 'refugees or people with protected status',
};

export const CATEGORY_LABEL = {
  business: 'Business & self-employment',
  education: 'Education & training',
  employment: 'Work & employment',
  energy: 'Energy & utilities',
  family: 'Family & children',
  health: 'Health & care',
  housing: 'Housing & rent',
  income_support: 'Income support',
  tax: 'Tax relief',
  transport: 'Transport',
};

export const BENEFIT_TYPE_LABEL = {
  cash_monthly: 'Monthly cash',
  cash_one_off: 'One-off payment',
  discount: 'Discount',
  free_slab: 'Free allowance',
  in_kind: 'In-kind support',
  tax_credit: 'Tax credit',
};

function listAnd(items) {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export function formatMoney(n, currency, locale) {
  try {
    return new Intl.NumberFormat(locale ?? 'en', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${new Intl.NumberFormat(locale ?? 'en', { maximumFractionDigits: 0 }).format(n)}`;
  }
}

export function periodSuffix(period) {
  if (period === 'monthly') return '/mo';
  if (period === 'annual') return '/yr';
  return ' one-off';
}

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

/**
 * Many monthly benefits are explicitly time-limited in their own published
 * note ("pays 60% of salary for up to 3 months per claim"). Multiplying those
 * by twelve invents money: it turned a UAE unemployment payment worth at most
 * ~AED 60,000 into a AED 240,000/yr headline. Where the record states a
 * duration, we honour it.
 */
export function monthsPayable(p) {
  const note = `${p.amount_note ?? ''} ${p.deadline_note ?? ''}`;
  const m = note.match(/\b(?:up to|maximum of|max\.?|for)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(month|week)s?\b/i);
  if (!m) return 12;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1].toLowerCase()];
  if (!n) return 12;
  const months = m[2].toLowerCase() === 'week' ? n / 4.345 : n;
  return Math.min(12, Math.max(0, months));
}

function annualize(amount, period, p) {
  if (amount === null || amount === undefined) return null;
  if (period !== 'monthly') return amount;
  return Math.round(amount * (p ? monthsPayable(p) : 12));
}

/**
 * Some programmes are credit facilities or capital ceilings (loan schemes,
 * business capital grants) whose headline maximum is not money-in-pocket.
 * Counting those in a "money on the table per year" total overstates it, so
 * they are excluded from the headline figure and reported separately.
 * This is the fix for limitation #2 in the original status doc.
 */
const CAPITAL_HINTS =
  /\b(loan|credit facility|mudra|collateral|repay|interest subsid|guarantee|capital subsid|term loan|working capital|mortgage|borrow)\b/i;

export function isCapitalCeiling(p) {
  if (p.category === 'business' && (p.amount_max ?? 0) > 0 && p.amount_period === 'one_off') {
    const text = `${p.name_en} ${p.name_local} ${p.amount_note ?? ''}`;
    if (CAPITAL_HINTS.test(text)) return true;
  }
  const text = `${p.name_en} ${p.name_local} ${p.amount_note ?? ''}`;
  // Tax-sheltered savings and pension wrappers publish a *contribution* ceiling,
  // not a payment. Counting Japan's NISA allowance as claimable money told a
  // pensioner they could claim millions of yen they would have to deposit first.
  if (
    p.benefit_type === 'tax_credit' &&
    /投資枠|掛金上限|非課税限度|contribution (limit|cap|ceiling|allowance)|investment (limit|allowance|cap|ceiling)|you can (invest|contribute|pay in)|deposit up to/i.test(
      `${p.amount_note ?? ''}`,
    )
  ) {
    return true;
  }
  return /\b(loans?|microcredit|micro-credit|credit facilit|term loan|working capital|mortgage guarantee|repayable advance)\b/i.test(text);
}

/* ------------------------------------------------------------------ */
/* Unmodelled qualifying circumstances                                 */
/* ------------------------------------------------------------------ */

/**
 * The dataset's eligibility object models nine attributes. Plenty of real
 * programmes are gated on something it does not model — disability, caring,
 * sickness, a new baby, bereavement, military service. Those records carry no
 * rule that can fail, so a naive matcher marks them "eligible" for everybody
 * and inflates the headline total with money almost nobody in the room can get.
 *
 * Rather than invent data, we detect the gate from the record's own published
 * text and route those programmes into a separate `conditional` bucket unless
 * the user has said the circumstance applies to them. They are never counted
 * in the headline figure.
 */
export const CIRCUMSTANCES = [
  {
    id: 'disability',
    label: 'I have a disability or long-term health condition',
    short: 'disability or long-term condition',
    re: /\b(disab|disabilit|personal independence payment|\bPIP\b|attendance allowance|disability living|\bDLA\b|invalidity|invalidez|incapacit|behinderung|handicap|wheelchair|blind|deaf|visually impaired|hearing impaired|impairment|discapacidad|disabilit[àa]|invalidité|handicapé)/i,
  },
  {
    id: 'carer',
    label: 'I care unpaid for someone who is ill, elderly or disabled',
    short: 'unpaid carer',
    re: /\b(carer|caregiver|caring for|care allowance|pflegegeld|aidant|cuidador|badante|care leave)\b/i,
  },
  {
    id: 'sickness',
    label: "I'm off work sick, or recovering from illness or injury",
    short: 'off work sick or injured',
    re: /\b(sick pay|sickness benefit|sickness allowance|illness benefit|injury benefit|incapacity benefit|krankengeld|arbeitsunfähig|indemnité journalière|baja por enfermedad)\b/i,
  },
  {
    id: 'newbaby',
    label: "I'm pregnant, or have a baby or newly adopted child",
    short: 'pregnancy, new baby or adoption',
    re: /\b(maternity|paternity|parental (leave|allowance|benefit|pay)|pregnan|newborn|new born|birth grant|baby bonus|adoption (grant|allowance|pay)|elterngeld|mutterschaft|congé parental|maternidad|natalidad)\b/i,
  },
  {
    id: 'bereavement',
    label: "I've recently lost a partner or close family member",
    short: 'recent bereavement',
    re: /\b(bereave|widow|widower|funeral|survivor'?s? (pension|benefit|allowance)|death grant|orphan|hinterbliebenen|viudedad|pension de r[ée]version)\b/i,
  },
  {
    id: 'veteran',
    label: "I'm a veteran or served in the armed forces",
    short: 'armed-forces service',
    re: /\b(veteran|war pension|armed forces|ex-service|military service|anciens combattants)\b/i,
  },
];

/** Which unmodelled circumstance, if any, this programme is gated on. */
export function circumstanceTags(p) {
  // Names only, deliberately. Matching on the source snippet or amount note
  // produced false positives (a childcare credit mentioning disabled children
  // is not a disability programme), and a false positive here hides money the
  // user really can claim — the more damaging of the two errors.
  const text = `${p.name_en} ${p.name_local}`;
  return CIRCUMSTANCES.filter((c) => c.re.test(text)).map((c) => c.id);
}


/**
 * A published income ceiling is very often the threshold for the MAXIMUM award,
 * not the point at which entitlement stops — France's APL record says so in its
 * own note: "Above these ceilings the aid tapers rather than stops". Treating
 * every ceiling as a hard cut-off told a person on EUR 9,000/yr that they did
 * not qualify for APL, ALS or RSA. That is worse than useless; it is wrong.
 *
 * Where the record's own note describes a taper, and the user is within reach
 * of the ceiling, we return a `taper` verdict instead of a failure: "you may
 * still get a reduced amount — check".
 */
const TAPER_HINTS =
  /\b(taper|tapers|reduced (rate|amount|award)|degressiv|d[ée]gressi|sliding scale|scale[sd]? (down|with)|partial (award|payment|rate)|decreases? (with|as)|gradually|progressively|proportional|abattement|se r[ée]duit|maximum (award|rate|amount)|full (award|rate) (up to|below)|depends on (income|resources)|means-tested on a scale)\b/i;

function tapers(e, income) {
  if (e.income_annual_max == null || !e.income_note) return false;
  if (!TAPER_HINTS.test(e.income_note)) return false;
  // Within 3x the published ceiling. Beyond that, a taper claim is a guess.
  return income <= e.income_annual_max * 3;
}

/** Strip any HTML from data-sourced text before it is interpolated. */
function esc0(s) {
  return String(s ?? '').replace(/[<>]/g, '');
}

/* ------------------------------------------------------------------ */
/* Rule evaluation                                                     */
/* ------------------------------------------------------------------ */

function evalProgramme(p, profile, entry) {
  const e = p.eligibility;
  const verdicts = [];
  const country = entry.name;

  // 1. Geography
  if (e.admin_areas && e.admin_areas.length > 0) {
    if (profile.admin_area === null || profile.admin_area === undefined) {
      verdicts.push({
        outcome: 'unknown',
        attribute: 'admin_area',
        sentence: `This programme is only available in ${listAnd(e.admin_areas)}`,
        question: `Which part of ${country} do you live in?`,
      });
    } else if (e.admin_areas.includes(profile.admin_area)) {
      verdicts.push({
        outcome: 'pass',
        attribute: 'admin_area',
        sentence: `You live in ${profile.admin_area}, where this programme runs`,
        question: null,
      });
    } else {
      verdicts.push({
        outcome: 'fail',
        attribute: 'admin_area',
        sentence: `This programme is only available in ${listAnd(e.admin_areas)}`,
        question: null,
      });
    }
  }

  // 2. Status
  if (e.statuses && e.statuses.length > 0) {
    if (e.statuses.includes(profile.status)) {
      verdicts.push({
        outcome: 'pass',
        attribute: 'status',
        sentence: 'Your work or life status qualifies',
        question: null,
      });
    } else {
      verdicts.push({
        outcome: 'fail',
        attribute: 'status',
        sentence: `This programme is for ${listAnd(e.statuses.map((s) => STATUS_LABEL[s] ?? s))}`,
        question: null,
      });
    }
  }

  // 3. Student requirement
  if (e.student_required) {
    const ok = profile.status === 'student';
    verdicts.push({
      outcome: ok ? 'pass' : 'fail',
      attribute: 'student_required',
      sentence: ok ? 'You are a student, as required' : 'This programme requires you to be a student',
      question: null,
    });
  }

  // 4. Age
  if (e.age_min !== null || e.age_max !== null) {
    const range =
      e.age_min !== null && e.age_max !== null
        ? `ages ${e.age_min}–${e.age_max}`
        : e.age_min !== null
          ? `people aged ${e.age_min} or over`
          : `people aged ${e.age_max} or under`;
    if (profile.age === null || profile.age === undefined) {
      verdicts.push({
        outcome: 'unknown',
        attribute: 'age',
        sentence: `This programme is for ${range}`,
        question: 'What is your age?',
      });
    } else {
      const ok =
        (e.age_min === null || profile.age >= e.age_min) &&
        (e.age_max === null || profile.age <= e.age_max);
      verdicts.push({
        outcome: ok ? 'pass' : 'fail',
        attribute: 'age',
        sentence: ok
          ? `Your age (${profile.age}) fits the published age rules`
          : `This programme is for ${range}`,
        question: null,
      });
    }
  }

  // 5. Income
  if (e.income_annual_max !== null && e.income_annual_max !== undefined) {
    const maxFmt = formatMoney(e.income_annual_max, p.amount_currency ?? entry.currency);
    const ruleSentence = `This programme requires household income under ${maxFmt}/year`;
    if (profile.income_annual !== null && profile.income_annual !== undefined) {
      const ok = profile.income_annual <= e.income_annual_max;
      verdicts.push({
        outcome: ok ? 'pass' : tapers(e, profile.income_annual) ? 'taper' : 'fail',
        attribute: 'income',
        sentence: ok
          ? `Your household income is under the ${maxFmt}/year threshold`
          : tapers(e, profile.income_annual)
            ? `${maxFmt}/year is the ceiling for the <em>maximum</em> award, not a cut-off. ${esc0(e.income_note)}`
            : `Your household income exceeds the ${maxFmt}/year threshold`,
        question: null,
      });
    } else if (profile.income_band !== null && profile.income_band !== undefined) {
      const band = (entry.income_bands || []).find((b) => b.id === profile.income_band);
      if (!band) {
        verdicts.push({
          outcome: 'unknown',
          attribute: 'income',
          sentence: ruleSentence,
          question: 'What is your exact annual household income?',
        });
      } else if (band.max !== null && band.max <= e.income_annual_max) {
        verdicts.push({
          outcome: 'pass',
          attribute: 'income',
          sentence: `Your income band is entirely under the ${maxFmt}/year threshold`,
          question: null,
        });
      } else if (band.min >= e.income_annual_max) {
        const t = tapers(e, band.min);
        verdicts.push({
          outcome: t ? 'taper' : 'fail',
          attribute: 'income',
          sentence: t
            ? `${maxFmt}/year is the ceiling for the <em>maximum</em> award, not a cut-off. ${esc0(e.income_note)}`
            : `Your income band starts above the ${maxFmt}/year threshold`,
          question: null,
        });
      } else {
        verdicts.push({
          outcome: 'unknown',
          attribute: 'income',
          sentence: ruleSentence,
          question: `What is your exact annual household income? The threshold is ${maxFmt}/year`,
        });
      }
    } else {
      verdicts.push({
        outcome: 'unknown',
        attribute: 'income',
        sentence: ruleSentence,
        question: 'What is your exact annual household income?',
      });
    }
  }

  // 6. Children
  if (e.requires_children) {
    const n = profile.children_count ?? 0;
    verdicts.push({
      outcome: n > 0 ? 'pass' : 'fail',
      attribute: 'children',
      sentence:
        n > 0
          ? n === 1
            ? 'You have a child in your household'
            : `You have ${n} children in your household`
          : 'This programme requires at least one child in your household',
      question: null,
    });
  }

  // 7. Nationality / residency status
  if (e.nationality && e.nationality !== 'any') {
    const req = e.nationality;
    if (!profile.nationality_group) {
      verdicts.push({
        outcome: 'unknown',
        attribute: 'nationality',
        sentence: `This programme is for ${NATIONALITY_LABEL[req] ?? req}`,
        question: `What is your residency status in ${country}?`,
      });
    } else {
      const g = profile.nationality_group;
      const satisfied =
        (g === 'citizen_or_pr' && (req === 'citizen_or_pr' || req === 'any_resident')) ||
        (g === 'any_resident' && req === 'any_resident') ||
        (g === 'refugee_or_protected' && (req === 'refugee_or_protected' || req === 'any_resident'));
      verdicts.push({
        outcome: satisfied ? 'pass' : 'fail',
        attribute: 'nationality',
        sentence: satisfied
          ? 'Your residency status qualifies'
          : `This programme is for ${NATIONALITY_LABEL[req] ?? req}`,
        question: null,
      });
    }
  }

  // 8. Residency length
  if (e.residency_months_min !== null && e.residency_months_min !== undefined) {
    if (profile.residency_months === null || profile.residency_months === undefined) {
      verdicts.push({
        outcome: 'unknown',
        attribute: 'residency_months',
        sentence: `This programme requires at least ${e.residency_months_min} months of residence`,
        question: `How many months have you lived in ${country}?`,
      });
    } else if (profile.residency_months >= e.residency_months_min) {
      verdicts.push({
        outcome: 'pass',
        attribute: 'residency_months',
        sentence: `You meet the ${e.residency_months_min}-month residence requirement`,
        question: null,
      });
    } else {
      verdicts.push({
        outcome: 'fail',
        attribute: 'residency_months',
        sentence: `This programme requires at least ${e.residency_months_min} months of residence — you have ${profile.residency_months}`,
        question: null,
      });
    }
  }

  // 9. Housing tenure
  if (e.housing_tenure) {
    if (!profile.housing_tenure) {
      verdicts.push({
        outcome: 'unknown',
        attribute: 'housing_tenure',
        sentence: `This programme is only for ${TENURE_LABEL[e.housing_tenure] ?? e.housing_tenure}`,
        question: 'What is your housing situation?',
      });
    } else if (profile.housing_tenure === e.housing_tenure) {
      verdicts.push({
        outcome: 'pass',
        attribute: 'housing_tenure',
        sentence: 'Your housing situation qualifies',
        question: null,
      });
    } else {
      verdicts.push({
        outcome: 'fail',
        attribute: 'housing_tenure',
        sentence: `This programme is only for ${TENURE_LABEL[e.housing_tenure] ?? e.housing_tenure}`,
        question: null,
      });
    }
  }

  return verdicts;
}

/* ------------------------------------------------------------------ */
/* Matcher                                                             */
/* ------------------------------------------------------------------ */

export function match(profile, countryData, manifestEntry) {
  const eligible = [];
  const needsOne = [];
  const notEligible = [];
  const conditional = [];
  const tapered = [];
  const claimed = new Set(profile.circumstances || []);
  let dataAsOf = '';

  for (const p of countryData.programmes) {
    if (p.verification_status === 'stale') continue;
    if (p.last_verified_at > dataAsOf) dataAsOf = p.last_verified_at;

    const verdicts = evalProgramme(p, profile, manifestEntry);
    const failed = verdicts.filter((v) => v.outcome === 'fail');
    const tapering = verdicts.filter((v) => v.outcome === 'taper');
    const unknown = verdicts.filter((v) => v.outcome === 'unknown');
    const met = verdicts.filter((v) => v.outcome === 'pass').map((v) => v.sentence);

    const m = {
      programme: p,
      rules_met: met,
      rules_failed: failed.map((v) => v.sentence),
      blocking_question: null,
      blocking_attribute: null,
      est_annual_min: annualize(p.amount_min, p.amount_period, p),
      est_annual_max: annualize(p.amount_max, p.amount_period, p),
      is_capital: isCapitalCeiling(p),
      circumstances: circumstanceTags(p),
    };

    // A gate we cannot evaluate from the answers given. Never counted as a
    // match, never counted in the total — surfaced as "only if this is you".
    const unmet = m.circumstances.filter((c) => !claimed.has(c));
    if (failed.length > 0) {
      notEligible.push(m);
    } else if (tapering.length > 0) {
      m.taper_note = tapering[0].sentence;
      m.condition_ids = unmet;
      tapered.push(m);
    } else if (unmet.length > 0) {
      m.condition_ids = unmet;
      m.condition_label = unmet
        .map((id) => CIRCUMSTANCES.find((c) => c.id === id)?.short || id)
        .join(' or ');
      conditional.push(m);
    } else if (unknown.length > 0) {
      m.blocking_question = unknown[0].question;
      m.blocking_attribute = unknown[0].attribute;
      needsOne.push(m);
    } else {
      if (m.circumstances.length) {
        m.rules_met = [
          ...m.rules_met,
          `You told us this applies to you: ${m.circumstances
            .map((id) => CIRCUMSTANCES.find((c) => c.id === id)?.short || id)
            .join(', ')}`,
        ];
      }
      eligible.push(m);
    }
  }

  // Headline value: eligible bucket, cash-equivalent programmes only.
  let totalMin = 0;
  let totalMax = 0;
  let verifiedMin = 0;
  let verifiedMax = 0;
  let capitalMax = 0;
  let unpricedCount = 0;
  for (const m of eligible) {
    if (m.is_capital) {
      capitalMax += m.est_annual_max ?? 0;
      continue;
    }
    if ((m.est_annual_max ?? 0) === 0 && (m.est_annual_min ?? 0) === 0) unpricedCount += 1;
    totalMin += m.est_annual_min ?? 0;
    totalMax += m.est_annual_max ?? 0;
    if (m.programme.verification_status === 'verified') {
      verifiedMin += m.est_annual_min ?? 0;
      verifiedMax += m.est_annual_max ?? 0;
    }
  }

  const currency = countryData.currency;
  const verifiedCount = countryData.programmes.filter((p) => p.verification_status === 'verified').length;

  // When nothing matches, say WHY rather than rendering a blank page. Migrant
  // workers in Singapore and India currently fail every record on citizenship;
  // the reason is already in the data and is far more useful than a zero.
  let blockers = null;
  if (eligible.length === 0 && conditional.length === 0 && tapered.length === 0) {
    const counts = {};
    // Count every failing rule, not just the first — a programme can be blocked
    // on nationality AND age, and the user needs to see both.
    for (const m of notEligible) {
      for (const reason of new Set(m.rules_failed)) counts[reason] = (counts[reason] || 0) + 1;
    }
    blockers = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => ({ reason, count }));
  }

  // Sort each bucket so the most useful thing is at the top: biggest known
  // money first, then verified, then everything else.
  // Rank by usefulness to THIS person, not by raw headline amount. Sorting
  // purely by amount put a EUR 15,000 business microcredit at the top of an
  // unemployed person's list and a start-up loan at the top of a single
  // parent's — technically the biggest number, obviously not the best advice.
  const wantsBusiness = profile.status === 'self_employed' || profile.status === 'employee';
  const tier = (m) => {
    if (m.is_capital) return 2; // borrowing, not income
    if (m.programme.category === 'business' && !wantsBusiness) return 2;
    if (m.programme.category === 'business') return 1;
    return 0;
  };
  const byValue = (a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    const av = a.est_annual_max ?? a.est_annual_min ?? 0;
    const bv = b.est_annual_max ?? b.est_annual_min ?? 0;
    if (bv !== av) return bv - av;
    const av2 = a.programme.verification_status === 'verified' ? 1 : 0;
    const bv2 = b.programme.verification_status === 'verified' ? 1 : 0;
    return bv2 - av2;
  };
  eligible.sort(byValue);
  needsOne.sort(byValue);
  notEligible.sort(byValue);
  conditional.sort(byValue);
  tapered.sort(byValue);

  let conditionalMax = 0;
  for (const m of conditional) conditionalMax += m.est_annual_max ?? 0;

  return {
    eligible,
    needs_one_more_answer: needsOne,
    not_eligible: notEligible,
    conditional,
    conditional_max: conditionalMax,
    tapered,
    blockers,
    total_min: totalMin,
    total_max: totalMax,
    capital_max: capitalMax,
    unpriced_count: unpricedCount,
    currency,
    verified_total_min: verifiedMin,
    verified_total_max: verifiedMax,
    coverage_note: `Matched your answers against ${countryData.programmes.length} programmes in ${countryData.country_name} — ${verifiedCount} human-verified, the rest auto-extracted from official sources.`,
    data_as_of: dataAsOf,
    disclaimer: DISCLAIMER,
  };
}

export function estimateShareText(result, countryName) {
  const { total_min: min, total_max: max, currency } = result;
  const n = result.eligible.length;
  if (n === 0) {
    return `I checked ${countryName} for unclaimed grants and benefits — see what you're owed.`;
  }
  const what = n === 1 ? '1 programme' : `${n} programmes`;
  if (max > min && min === 0) {
    return `I found up to ${formatMoney(max, currency)}/yr in unclaimed support in ${countryName} — ${what}. Check yours.`;
  }
  if (max > min) {
    return `I found ${formatMoney(min, currency)}–${formatMoney(max, currency)}/yr in unclaimed support in ${countryName} — ${what}. Check yours.`;
  }
  if (max > 0) {
    return `I found ${formatMoney(max, currency)}/yr in unclaimed support in ${countryName} — ${what}. Check yours.`;
  }
  return `I found ${what} I may be entitled to in ${countryName}. Check yours.`;
}
