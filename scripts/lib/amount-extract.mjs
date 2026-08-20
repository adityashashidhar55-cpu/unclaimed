/**
 * Strict payment-figure extractor for amount_note.
 *
 * 123 records state a plain payment figure in amount_note while amount_min and
 * amount_max are both null — so the number the paywall sells is printed for
 * free two panels down the same page. dist/nz/family/best-start/ says
 * "What this pays — Locked" over a free source block reading "$73 a week".
 *
 * Only 49 of the 123 are safe to lift, and the difference is context: a great
 * many of the rest state an INCOME TEST cap ("if your household earns under
 * £16,190"), a property value, or a revenue threshold, and writing that into
 * amount_max would tell a reader the means test is the payment. So the filter
 * is deliberately narrow — a payment verb or phrase, a currency, a number, a
 * period — and anything near an income/threshold/property word is refused.
 *
 * Exported so scripts/test-amounts.mjs can assert the same rule the migration
 * applied, rather than a second, kinder copy of it.
 */

const CURRENCY = String.raw`(?:[€£$₹¥]|EUR|GBP|USD|AUD|NZD|CAD|SGD|CHF|SEK|PLN|ZAR|INR|JPY|KRW|MXN|BRL|AED|R\$|Rs\.?|kr|zł)`;
const NUM = String.raw`\d{1,3}(?:[.,  ]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;

/** Words that mean the number beside them is a TEST, not a payment. */
const DISQUALIFY =
  /\b(income|earn(?:s|ings|ed)?|revenue|turnover|threshold|means[- ]test|capital|savings|assets?|property value|house price|rateable|valuation|salary|wage|below|under £?[\d]|if you (?:earn|have)|limit|average|cost|costs|price|fee|charge|you pay|plan)\b/i;

/** The note has to describe money CHANGING HANDS TO the reader. Without this
    the extractor lifted the £30 annual PRICE of a Senior Railcard as if the
    railcard paid you £30 a year. */
const PAYMENT_WORD =
  /\b(pays?|paid|payment|payments|rebate|allowance|grant|credit|benefit|bursary|voucher|supplement|worth|pension|subsid(?:y|ies)|refund|reimburs)/i;

/** A payment, said as a payment. */
const LEAD =
  String.raw`(?:pays?|paid|payment of|worth|up to|around|about|approximately|a flat|flat rate of|standard rate of|rate of|receive|gives?|grant of|allowance of|benefit of|weekly payment of|maximum of|maximum)`;

const PERIODS = [
  [/^\s*(?:per|a|each|every)[\s-]+week\b/i, 'weekly'],
  [/^\s*(?:per|a|each|every)[\s-]+fortnight\b/i, 'fortnightly'],
  [/^\s*(?:per|a|each|every)[\s-]+(?:month|mo)\b/i, 'monthly'],
  [/^\s*(?:per|a|each|every)[\s-]+(?:year|annum)\b/i, 'annual'],
  [/^\s*\/\s*week\b/i, 'weekly'],
  [/^\s*\/\s*fortnight\b/i, 'fortnightly'],
  [/^\s*\/\s*month\b/i, 'monthly'],
  [/^\s*\/\s*(?:year|yr)\b/i, 'annual'],
  [/^\s*(?:weekly|a week)\b/i, 'weekly'],
  [/^\s*(?:fortnightly)\b/i, 'fortnightly'],
  [/^\s*(?:monthly)\b/i, 'monthly'],
  [/^\s*(?:annually|per annum|a year)\b/i, 'annual'],
];

function toNumber(raw) {
  let t = raw.replace(/[  ]/g, '');
  /* 1.234,56 vs 1,234.56. A separator followed by exactly three digits is a
     thousands separator whichever character it is — reading "$4,200" as 4.2
     is how an extractor turns a CAD 4,200 student grant into four dollars
     twenty, which is a wrong number nobody would ever think to query. */
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma > lastDot ? ',' : '.';
    const other = sep === ',' ? '.' : ',';
    const tailLen = t.length - t.lastIndexOf(sep) - 1;
    t = t.split(other).join('');
    t = tailLen === 3 ? t.split(sep).join('') : t.replace(sep, '.');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * @returns {{value:number, period:string, currency:string|null, phrase:string}|null}
 */
export function extractPayment(note) {
  if (typeof note !== 'string' || !note) return null;
  if (!PAYMENT_WORD.test(note)) return null;
  /* A currency is required. Without one the extractor read "up to 4 per year"
     — four LPG cylinders — as a payment of four. */
  const re = new RegExp(String.raw`\b${LEAD}\s+(${CURRENCY})\s?(${NUM})`, 'gi');
  for (const m of note.matchAll(re)) {
    const window = note.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40);
    if (DISQUALIFY.test(window)) continue;
    const tail = note.slice(m.index + m[0].length);
    const hit = PERIODS.find(([rx]) => rx.test(tail));
    if (!hit) continue;
    const value = toNumber(m[2]);
    if (value == null || value <= 0) continue;
    return { value, period: hit[1], currency: m[1], phrase: m[0].trim() };
  }
  return null;
}

/* A percentage in a startup record is not always an aid intensity. USDA
   "guarantees up to 80% of a commercial lender's loan" and the British
   Business Bank "taking up to 30%" of an equity round are both percentages and
   neither is money you have to match — writing 100−N into cofunding_pct there
   would put "You must co-fund 20%" on a page about a loan guarantee. Only
   grant-shaped aid gets a co-funding figure. */
const NOT_AID_INTENSITY =
  /\b(guarantee[sd]?|guaranteeing|equity|co-?invest|stake|shareholding|interest rate|of (?:a |the )?(?:commercial )?lender)/i;

/**
 * Aid-intensity / co-funding rate stated in prose.
 *
 * The exclusion is scoped to the ~120 characters around the percentage, not to
 * the whole note: at-ffg-basisprogramm says "up to 70% of project costs" in
 * one clause and "loan repayment falls due five years after" in the next, and
 * a whole-note test threw the good clause away with the irrelevant one.
 */
export function extractAidIntensity(text) {
  if (typeof text !== 'string' || !text) return null;
  const patterns = [
    /\bup to (\d{1,3})\s?% (?:of|as (?:a )?(?:non-repayable )?grant)\b/i,
    /\bup to (\d{1,3})\s?% (?:funding|support|grant|subsidy|aid)\b/i,
    /\baid intensit(?:y|ies) of (?:up to )?(\d{1,3})\s?%/i,
    /\bfunds? (?:up to )?(\d{1,3})\s?%/i,
    /\bco-?funding rate (?:of )?(\d{1,3})\s?%/i,
    /\bcovers? (?:up to )?(\d{1,3})\s?% of\b/i,
    /\b(\d{1,3})\s?% of (?:the )?(?:eligible|project|total) costs?\b/i,
    /\bgrant (?:rate|intensity) of (\d{1,3})\s?%/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (!m) continue;
    const window = text.slice(Math.max(0, m.index - 70), m.index + m[0].length + 50);
    if (NOT_AID_INTENSITY.test(window)) continue;
    const pct = Number(m[1]);
    /* 100% aid is not co-funding, and 0% is not a rate. Both are noise. */
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) continue;
    return pct;
  }
  return null;
}
