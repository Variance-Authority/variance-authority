// Scores recorded selection against seeded faults: a truth the recorder had no hand in.
//
// Phase 0 harness. For each seeded fault on a child commit's changed lines, the killers
// are the test classes that fail on the full suite with the fault and pass on the
// unmutated control (m0) run under the same load. Selection comes from score.json: the
// parent's record against the child's diff, which the fault sits inside.
//   escaped — a fault some test kills, and no selected (or forced) test kills
//   missed  — killing test classes left out of the selection
//
// Usage: node score-mutants.mjs <replay dir> <mutants dir>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [replay, mutants] = process.argv.slice(2);
const score = JSON.parse(readFileSync(join(replay, 'score.json'), 'utf8'));
const grains = ['method', 'shape', 'line', 'file', 'record', 'reach'];

function failed(dir) {
  const path = join(dir, 'status.tsv');
  if (!existsSync(path)) return null;
  return new Set(readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => l.split('\t')).filter((f) => Number(f[2]) + Number(f[3]) > 0).map((f) => f[0]));
}

const rows = [];
for (const child of readdirSync(mutants).filter((d) => /^[0-9a-f]{40}$/.test(d))) {
  const row = score.find((r) => child.startsWith(r.child));
  if (!row?.selected) continue;
  const dir = join(mutants, child);
  const control = failed(join(dir, 'm0'));
  if (!control) continue;
  for (const m of readdirSync(dir).filter((d) => /^m[1-9]\d*$/.test(d)).sort((a, b) => a.slice(1) - b.slice(1))) {
    const result = existsSync(join(dir, m, 'result.txt')) ? readFileSync(join(dir, m, 'result.txt'), 'utf8').split(' ')[0] : 'pending';
    const desc = readFileSync(join(dir, m, 'desc.txt'), 'utf8').trim().replace(/^.*\/lang3\//, '');
    const fails = failed(join(dir, m));
    if (result !== 'ran' || !fails) { rows.push({ child: row.child, m, desc, result }); continue; }
    const killers = [...fails].filter((t) => !control.has(t));
    const out = { child: row.child, m, desc, result, killers };
    for (const g of grains) {
      const sel = row.selected[g];
      if (!sel) { out[g] = null; continue; }
      const has = new Set([...sel, ...row.selected.forced]);
      out[g] = { missed: killers.filter((t) => !has.has(t)), escaped: killers.length > 0 && !killers.some((t) => has.has(t)), size: has.size };
    }
    rows.push(out);
  }
}
writeFileSync(join(mutants, 'score-mutants.json'), JSON.stringify(rows, null, 2));

console.log('child     fault                                                    killers | missed (escaped) m / s / l / f / R / r');
for (const r of rows) {
  const head = `${r.child} ${r.m.padEnd(3)} ${r.desc.slice(0, 52).padEnd(52)}`;
  if (!r.killers) { console.log(head, r.result); continue; }
  const cell = (g) => (r[g] ? `${r[g].missed.length}${r[g].escaped ? '!' : ''}` : '-');
  console.log(head, String(r.killers.length).padStart(7), '|', grains.map(cell).join(' / '));
}
const ran = rows.filter((r) => r.killers);
const killed = ran.filter((r) => r.killers.length);
console.log(`\n${rows.length} faults, ${ran.length} compiled and ran, ${killed.length} killed by some test, ${ran.length - killed.length} survived the whole suite`);
for (const g of grains) {
  const scored = killed.filter((r) => r[g]);
  const escaped = scored.filter((r) => r[g].escaped).length;
  const missed = scored.reduce((n, r) => n + r[g].missed.length, 0);
  const total = scored.reduce((n, r) => n + r.killers.length, 0);
  console.log(`${g.padEnd(6)} faults escaped ${escaped}/${scored.length}, killing tests missed ${missed}/${total}`);
}
