// Compares two records of one commit, test class by test class.
//
// Phase 0 harness. The first record is the reference, usually the suite run in its
// usual order; the second is the same suite run again, or each class in its own JVM
// (record-maven.sh with -DreuseForks=false). A method the other run entered and the
// reference did not is `lost`: selecting from the reference would skip that class when
// the method changes. `gained` is the reverse. Files are compared the same way,
// because file is the grain that selects.
//
// Usage: node compare-records.mjs <reference record.jsonl> <other record.jsonl> [out.json]
import { readFileSync, writeFileSync } from 'node:fs';

const [refPath, otherPath, outPath] = process.argv.slice(2);

function load(path) {
  const owners = new Map();
  for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
    const row = JSON.parse(line);
    if (row.owner.startsWith('between')) continue;
    owners.set(row.owner, {
      methods: new Set(row.methods.map((m) => `${m.class}.${m.method}`)),
      files: new Set(row.methods.map((m) => m.file)),
    });
  }
  return owners;
}

const minus = (a, b) => [...a].filter((x) => !b.has(x));
const ref = load(refPath);
const other = load(otherPath);
const rows = [];
for (const owner of new Set([...ref.keys(), ...other.keys()])) {
  const r = ref.get(owner);
  const o = other.get(owner);
  if (!r || !o) {
    rows.push({ owner, only: r ? 'reference' : 'other' });
    continue;
  }
  const row = {
    owner,
    lostMethods: minus(o.methods, r.methods),
    gainedMethods: minus(r.methods, o.methods),
    lostFiles: minus(o.files, r.files),
    gainedFiles: minus(r.files, o.files),
  };
  if (row.lostMethods.length || row.gainedMethods.length) rows.push(row);
}
if (outPath) writeFileSync(outPath, JSON.stringify(rows, null, 2));

const both = [...ref.keys()].filter((k) => other.has(k)).length;
const differ = rows.filter((r) => !r.only);
const sum = (key) => differ.reduce((n, r) => n + r[key].length, 0);
console.log(`${both} test classes in both, ${differ.length} differ, ${rows.length - differ.length} in one record only`);
console.log(`methods: ${sum('lostMethods')} lost, ${sum('gainedMethods')} gained`);
console.log(`files:   ${sum('lostFiles')} lost, ${sum('gainedFiles')} gained`);
for (const r of rows) {
  if (r.only) { console.log(`\n${r.owner}: only in ${r.only}`); continue; }
  const short = (s) => s.replace(/^org\/apache\/commons\/lang3\//, '').replace(/^src\/main\/java\/org\/apache\/commons\/lang3\//, '');
  console.log(`\n${r.owner.replace(/^org\.apache\.commons\.lang3\./, '')}`);
  for (const f of r.lostFiles) console.log(`  lost file   ${short(f)}`);
  for (const f of r.gainedFiles) console.log(`  gained file ${short(f)}`);
  for (const m of r.lostMethods.slice(0, 8)) console.log(`  lost   ${short(m)}`);
  if (r.lostMethods.length > 8) console.log(`  ... ${r.lostMethods.length - 8} more lost`);
  for (const m of r.gainedMethods.slice(0, 8)) console.log(`  gained ${short(m)}`);
  if (r.gainedMethods.length > 8) console.log(`  ... ${r.gainedMethods.length - 8} more gained`);
}
