/**
 * Record totals, computed from data/ — the one place that knows how.
 *
 * Several tests and documents used to carry these numbers as literals
 * (`sMan.total === 1641`, "3,858 in the whole corpus", a STORE.md listing that
 * said "we track 236 closed programmes"). Every one of them was true on the day
 * it was typed and false the day a record was added, retired or merged — and a
 * verification run does exactly that to hundreds of records at once. So the
 * number now comes from here, and the places that must STATE a number
 * (native/STORE.md, docs/DEMO.md, the manifests) are rewritten from here by
 * scripts/regen-counts.mjs rather than edited by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDatasets } from './record-schema.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every dataset file, parsed: [{kind, rel, slug, doc}] — slug is the file stem. */
export function loadDatasets(root = ROOT) {
  const out = [];
  for (const d of listDatasets(root)) {
    const doc = JSON.parse(fs.readFileSync(d.abs, 'utf8'));
    if (!Array.isArray(doc.programmes)) continue;
    out.push({ kind: d.kind, rel: d.rel, slug: path.basename(d.rel, '.json'), doc });
  }
  return out;
}

const priced = (p) => p.amount_min != null || p.amount_max != null;

export function computeCounts(root = ROOT) {
  const sets = loadDatasets(root);
  const h = sets.filter((s) => s.kind === 'household');
  const c = sets.filter((s) => s.kind === 'company');
  const sum = (list, f) => list.reduce((n, s) => n + s.doc.programmes.filter(f).length, 0);
  const verified = (p) => p.verification_status === 'verified';

  const perCountry = {};
  for (const s of c) {
    const P = s.doc.programmes;
    perCountry[s.slug] = {
      count: P.length,
      verified: P.filter(verified).length,
      priced: P.filter(priced).length,
      open: P.filter((p) => p.status === 'open' || p.status === 'rolling').length,
      closed: P.filter((p) => p.status === 'closed').length,
    };
  }
  return {
    household: {
      total: sum(h, () => true),
      verified: sum(h, verified),
      countries: h.length,
    },
    company: {
      total: sum(c, () => true),
      verified: sum(c, verified),
      closed: sum(c, (p) => p.status === 'closed'),
      jurisdictions: c.length,
      perCountry,
    },
    /* The listing's "jurisdictions" is the union of file stems across both
       datasets — a country with household data and no company file still counts. */
    jurisdictions: new Set(sets.map((s) => s.slug)).size,
    total: sum(sets, () => true),
    closed: sum(sets, (p) => p.status === 'closed'),
  };
}

export const fmt = (n) => n.toLocaleString('en-US');
export const roundTo = (n, step) => Math.round(n / step) * step;
