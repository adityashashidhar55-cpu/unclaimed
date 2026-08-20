/* data/ was written by more than one generation of extractor: some files indent
   by one space, some by two, forty of the startup files are minified outright,
   and a couple end without a newline. Reserialising with the wrong one rewrites
   13,000 lines for a one-word change and buries the edit nobody can then
   review. Detect the file's own shape and preserve it. */
import fs from 'node:fs';

export function readJson(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const m = raw.match(/^\{\r?\n( *)"/);
  return {
    data: JSON.parse(raw),
    indent: m ? m[1].length : 0,
    trailing: raw.endsWith('\n'),
    raw,
    path,
  };
}

export function serialize(doc) {
  return JSON.stringify(doc.data, null, doc.indent) + (doc.trailing ? '\n' : '');
}

export function writeJson(doc) {
  fs.writeFileSync(doc.path, serialize(doc));
}
