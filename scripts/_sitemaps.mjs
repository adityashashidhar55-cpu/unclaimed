/** Concatenated text of sitemap.xml and every child sitemap it lists (dist/). */
import fs from 'node:fs';
import path from 'node:path';

export function readAllSitemaps(DIST) {
  const index = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
  const children = [...index.matchAll(/<loc>[^<]*\/([^/<]+\.xml)<\/loc>/g)].map((m) => m[1]);
  return [index, ...children.map((c) => fs.readFileSync(path.join(DIST, c), 'utf8'))].join('\n');
}
