/**
 * UNCLAIMED — EU de minimis state aid.
 *
 * Every figure here was read from the consolidated text of the regulation
 * cited, not from a secondary source. See docs/state-aid.md for the full
 * brief with quotes.
 *
 * Why a grants product must implement this rather than mention it:
 *
 * A founder who has taken €280,000 of small public aid in one Member State
 * over the last three years cannot take a €100,000 grant there. Not "can take
 * €20,000 of it" — Article 3(7) says the *whole* new award falls outside the
 * Regulation. Recommending that application is worse than recommending
 * nothing: it wastes weeks and, if the declaration is wrong, exposes the
 * company to recovery of aid it has already spent.
 *
 * Three details that aggregators routinely get wrong, all encoded below:
 *
 *   1. The three years are ROLLING, not fiscal. Regulation 1407/2013 used
 *      fiscal years; 2023/2831 replaced that with a rolling window (recital
 *      11). Code written against the old rule under-counts.
 *   2. The ceiling is PER MEMBER STATE. German aid and Spanish aid draw on
 *      separate €300,000 pots for the same company.
 *   3. "Single undertaking" is NOT the SME group test. Control-based links
 *      only — a fund holding 30% of two portfolio companies does not merge
 *      their de minimis pots, though it does affect both SME calculations.
 *      Conflating these is the single most common error in this area.
 *
 * Aid counts from the date the legal right is conferred, not the date of
 * payment (Article 3(3)), and at gross grant equivalent before tax
 * (Article 3(5)).
 *
 * NOT LEGAL ADVICE. The self-declaration is sworn by the company.
 */

/** Commission Regulation (EU) 2023/2831, Article 3(2). In force 1 Jan 2024. */
export const DE_MINIMIS_CEILING_EUR = 300_000;

/** Commission Regulation (EU) 2023/2832 — services of general economic interest. */
export const SGEI_CEILING_EUR = 750_000;

/** Article 3(2): "over any period of 3 years", assessed on a rolling basis. */
export const WINDOW_MONTHS = 36;

export const REGULATION = Object.freeze({
  general: {
    id: 'Commission Regulation (EU) 2023/2831',
    article: 'Art. 3(2)',
    ceiling_eur: DE_MINIMIS_CEILING_EUR,
    url: 'https://eur-lex.europa.eu/eli/reg/2023/2831',
    in_force_from: '2024-01-01',
    applies_until: '2030-12-31',
  },
  sgei: {
    id: 'Commission Regulation (EU) 2023/2832',
    article: 'Art. 3(2)',
    ceiling_eur: SGEI_CEILING_EUR,
    url: 'https://eur-lex.europa.eu/eli/reg/2023/2832',
  },
});

/**
 * Sectors excluded from de minimis entirely (Article 1). A company here
 * cannot use the general Regulation at all, whatever its headroom.
 */
export const EXCLUDED_ACTIVITIES = Object.freeze([
  'primary_fishery_aquaculture',
  'primary_agriculture',
  'export_aid',
  'domestic_over_imported_goods',
]);

const MS_MONTH = 30.44 * 24 * 60 * 60 * 1000;

/**
 * Aid inside the rolling window ending at `asOf`.
 *
 * `awards` is what the company declares: [{ granted_at, amount_eur,
 * member_state, kind }]. `granted_at` must be the date the legal right was
 * conferred — we say so in the UI, because founders reach for the payment
 * date and that is the wrong one.
 */
export function awardsInWindow(awards, asOf, memberState = null) {
  const cutoff = asOf - WINDOW_MONTHS * MS_MONTH;
  return (awards || []).filter((a) => {
    const t = typeof a.granted_at === 'number' ? a.granted_at : Date.parse(a.granted_at);
    if (Number.isNaN(t) || t < cutoff || t > asOf) return false;
    if (memberState && String(a.member_state || '').toLowerCase() !== memberState.toLowerCase()) return false;
    return true;
  });
}

/**
 * How much de minimis room is left in one Member State.
 *
 * Returns the used amount, the headroom, and — the bit that matters — the
 * date the oldest award drops out of the window, because a founder who is
 * €40,000 over today may be clear in four months and should be told so
 * rather than shown a dead end.
 */
export function headroom(awards, memberState, asOf = Date.now(), ceiling = DE_MINIMIS_CEILING_EUR) {
  const inWindow = awardsInWindow(awards, asOf, memberState);
  const used = inWindow.reduce((s, a) => s + (Number(a.amount_eur) || 0), 0);

  const oldest = inWindow
    .map((a) => (typeof a.granted_at === 'number' ? a.granted_at : Date.parse(a.granted_at)))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)[0];

  return {
    member_state: memberState,
    ceiling_eur: ceiling,
    used_eur: used,
    headroom_eur: Math.max(0, ceiling - used),
    over: used > ceiling,
    award_count: inWindow.length,
    /** When the oldest award leaves the rolling window and frees up room. */
    frees_up_at: oldest ? oldest + WINDOW_MONTHS * MS_MONTH : null,
    frees_up_eur: oldest
      ? inWindow
          .filter((a) => {
            const t = typeof a.granted_at === 'number' ? a.granted_at : Date.parse(a.granted_at);
            return t === oldest;
          })
          .reduce((s, a) => s + (Number(a.amount_eur) || 0), 0)
      : 0,
    basis: `${REGULATION.general.id} ${REGULATION.general.article}`,
  };
}

/**
 * Can this company take this specific award?
 *
 * Article 3(7) is the reason this returns a hard boolean rather than a
 * trimmed amount: if the new aid would breach the ceiling, the new aid does
 * not benefit from the Regulation at all. There is no partial award.
 */
export function canAccept({ programme, awards, memberState, asOf = Date.now(), amountEur = null }) {
  const e = programme?.eligibility || {};
  if (!e.de_minimis) {
    return { applies: false, allowed: true, reason: 'not_de_minimis' };
  }

  const ceiling = e.sgei ? SGEI_CEILING_EUR : DE_MINIMIS_CEILING_EUR;
  const room = headroom(awards, memberState, asOf, ceiling);

  /* Unpriced programmes are common and we will not invent a figure — flag
     that the ceiling applies and let the founder check against the offer. */
  const value = amountEur ?? programme.amount_max ?? programme.amount_min ?? null;
  if (value == null) {
    return {
      applies: true,
      allowed: null,
      reason: 'amount_unpublished',
      headroom_eur: room.headroom_eur,
      message: `This is de minimis aid. You have €${room.headroom_eur.toLocaleString('en')} of headroom in the last 3 years — check the offer against it before signing.`,
      room,
    };
  }

  const allowed = value <= room.headroom_eur;
  return {
    applies: true,
    allowed,
    reason: allowed ? 'within_ceiling' : 'would_breach_ceiling',
    value_eur: value,
    headroom_eur: room.headroom_eur,
    message: allowed
      ? `De minimis aid. Uses €${value.toLocaleString('en')} of your €${room.headroom_eur.toLocaleString('en')} remaining headroom.`
      : `This award would breach your de minimis ceiling. You have €${room.headroom_eur.toLocaleString('en')} of headroom and this is €${value.toLocaleString('en')}. Under Art. 3(7) the whole award falls outside the Regulation — it is not reduced to fit.${room.frees_up_at ? ` €${room.frees_up_eur.toLocaleString('en')} frees up on ${new Date(room.frees_up_at).toISOString().slice(0, 10)}.` : ''}`,
    room,
  };
}

/**
 * Apply the ceiling across a whole match result, so the plan a founder sees
 * is one they can actually execute rather than a list that silently exceeds
 * what they may lawfully take.
 *
 * Programmes are consumed in descending value: taking the €200,000 grant and
 * losing the €50,000 one beats the reverse. This is a greedy pass, which is
 * optimal here because the constraint is a single scalar budget.
 */
export function planWithinCeiling(matches, { awards, memberState, asOf = Date.now() }) {
  const room = headroom(awards, memberState, asOf);
  let remaining = room.headroom_eur;

  const affordable = [];
  const blocked = [];
  const unaffected = [];

  const deMinimis = matches.filter((m) => m.programme?.eligibility?.de_minimis);
  const rest = matches.filter((m) => !m.programme?.eligibility?.de_minimis);
  unaffected.push(...rest);

  for (const m of deMinimis.sort(
    (a, b) => (b.programme.amount_max ?? 0) - (a.programme.amount_max ?? 0),
  )) {
    const value = m.programme.amount_max ?? m.programme.amount_min ?? null;
    if (value == null) {
      affordable.push({ ...m, de_minimis_note: 'Amount unpublished — check against your headroom.' });
      continue;
    }
    if (value <= remaining) {
      remaining -= value;
      affordable.push({ ...m, de_minimis_uses_eur: value });
    } else {
      blocked.push({ ...m, de_minimis_shortfall_eur: value - remaining });
    }
  }

  return {
    room,
    remaining_after_eur: remaining,
    affordable,
    blocked,
    unaffected,
    note:
      blocked.length > 0
        ? 'Some awards are excluded because your de minimis ceiling would be breached. Under Art. 3(7) an award that breaches the ceiling is disqualified in full, not trimmed.'
        : null,
  };
}

/**
 * The declaration a founder must sign. Article 7(4) requires the granting
 * authority to obtain it in writing before awarding, and it remains live
 * until the national register covers a full three years — not before 2029.
 *
 * We produce the text and capture the affirmation. We never sign it: this is
 * a statement of fact about the company, sworn by the company.
 */
export function declarationText(awards, memberState, asOf = Date.now(), lang = 'en') {
  const room = headroom(awards, memberState, asOf);
  const listed = awardsInWindow(awards, asOf, memberState)
    .map((a) => `  - ${a.funder || 'Unnamed body'}: €${Number(a.amount_eur).toLocaleString('en')} (${String(a.granted_at).slice(0, 10)})`)
    .join('\n');

  const T = {
    en: {
      head: 'De minimis declaration',
      body: `I confirm that, over the three years preceding this application, the single undertaking to which this company belongs has received the following de minimis aid in ${(memberState || '').toUpperCase()}:`,
      none: 'I confirm that the single undertaking to which this company belongs has received no de minimis aid in the three years preceding this application.',
      total: `Total declared: €${room.used_eur.toLocaleString('en')} of the €${room.ceiling_eur.toLocaleString('en')} ceiling.`,
      undertaking:
        'I understand that "single undertaking" includes every enterprise linked to this one by control, directly or indirectly, and that aid is counted from the date the legal right to receive it was conferred, not the date of payment.',
      truth: 'I declare that this is complete and accurate to the best of my knowledge.',
    },
  };
  const t = T[lang] || T.en;

  return {
    title: t.head,
    text: [
      room.award_count ? t.body : t.none,
      listed || null,
      room.award_count ? t.total : null,
      t.undertaking,
      t.truth,
    ]
      .filter(Boolean)
      .join('\n\n'),
    basis: REGULATION.general,
    /* Never pre-ticked. The founder affirms this themselves. */
    affirmed: false,
  };
}
