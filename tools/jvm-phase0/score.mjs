// Scores recorded selection against the next commit's own recording.
//
// Phase 0 harness. For each first-parent pair (parent -> child):
//   selected  — from the parent's record, at method, shape, line and file grain, and
//               by `variance reach` from the static graph;
//   forced    — test classes whose own file changed, that the parent never recorded, or whose
//               parent row names a class it could not resolve to a file (`unknown`);
//   truth     — test classes whose *child* record enters a changed method (new side),
//               plus any test class that failed in the child.
// A miss is a truth test class that a grain neither selected nor forced. A method with no
// line table has no span, so any change to its file charges it.
//
// Usage: node score.mjs <replay dir> <reach clone> <variance bin> [test source root]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDiff } from './diff.mjs';

const [replay, reachClone, varianceBin, testRoot = 'src/test/java'] = process.argv.slice(2);
const order = readFileSync(join(replay, 'order.txt'), 'utf8').trim().split('\n');

function loadRecord(sha) {
  const path = join(replay, sha, 'record.jsonl');
  if (!existsSync(path)) return null;
  const tests = new Map();
  tests.incomplete = new Set();
  for (const text of readFileSync(path, 'utf8').trim().split('\n')) {
    if (!text) continue;
    const row = JSON.parse(text);
    if (row.owner.startsWith('between')) {
      if (row.methods.length) tests.set(`<spill:${row.owner}>`, row.methods);
      continue;
    }
    tests.set(row.owner, row.methods);
    if (row.unknown?.length) tests.incomplete.add(row.owner);
  }
  return tests;
}

function failed(sha) {
  const path = join(replay, sha, 'status.tsv');
  if (!existsSync(path)) return new Set();
  return new Set(readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => l.split('\t')).filter((f) => Number(f[2]) + Number(f[3]) > 0).map((f) => f[0]));
}

/** A method is charged when a changed line falls in its span, or an insertion lands inside or against it. */
function methodHit(m, lines, inserts) {
  if (m.first < 0) return true;
  for (const l of lines) if (l >= m.first && l <= m.last) return true;
  for (const k of inserts) if (k >= m.first && k <= m.last + 1) return true;
  return false;
}

function lineHit(m, lines, inserts) {
  if (!m.lines.length) return true;
  for (const l of m.lines) if (lines.has(l) || inserts.has(l) || inserts.has(l + 1)) return true;
  return false;
}

/**
 * Files whose change reaches outside every method and constructor body on the old side:
 * a member added or removed, a field, an initializer, the hierarchy. Dispatch can observe
 * that from any method of the class, so every test that entered the file is charged.
 */
function shapeChanged(diff, members) {
  const out = new Set();
  if (!members) return out;
  for (const f of diff.values()) {
    const spans = members[f.oldPath];
    if (!spans) continue;
    const inside = (l) => spans.some(([a, b]) => l >= a && l <= b);
    const insideInsert = (k) => spans.some(([a, b]) => k > a && k <= b);
    if ([...f.oldCode].some((l) => !inside(l)) || [...f.oldCodeInserts].some((k) => !insideInsert(k))) out.add(f.oldPath);
  }
  return out;
}

function select(record, diff, side, shape = new Set()) {
  const out = { method: new Set(), line: new Set(), file: new Set(), shape: new Set() };
  for (const [test, methods] of record) {
    if (test.startsWith('<spill')) continue;
    for (const m of methods) {
      const f = diff.get(m.file) ?? [...diff.values()].find((d) => d.oldPath === m.file);
      if (!f) continue;
      const lines = side === 'old' ? f.oldLines : f.newLines;
      const inserts = side === 'old' ? f.oldInserts : f.newInserts;
      out.file.add(test);
      if (methodHit(m, lines, inserts)) out.method.add(test);
      if (methodHit(m, lines, inserts) || shape.has(f.oldPath)) out.shape.add(test);
      if (lineHit(m, lines, inserts)) out.line.add(test);
    }
  }
  return out;
}

const fqcn = (path) => path.slice(testRoot.length + 1).replace(/\.(java|kt)$/, '').replaceAll('/', '.');

function reach(parent, child) {
  execFileSync('git', ['-C', reachClone, 'checkout', '-q', '--detach', child]);
  try {
    const out = execFileSync('node', [varianceBin, 'reach', '--since', parent], { cwd: reachClone, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, tests: new Set(out.split('\n').filter((p) => p.startsWith(testRoot + '/')).map(fqcn)) };
  } catch (e) {
    return { ok: false, status: e.status, stderr: String(e.stderr).trim().split('\n').slice(-2).join(' | ') };
  }
}

const rows = [];
for (let i = 1; i < order.length; i++) {
  const parent = order[i - 1];
  const child = order[i];
  const before = loadRecord(parent);
  const after = loadRecord(child);
  if (!before || !after) {
    rows.push({ child: child.slice(0, 9), skipped: 'no record' });
    continue;
  }
  const diff = parseDiff(readFileSync(join(replay, child, 'diff.patch'), 'utf8'));
  const javaMain = [...diff.keys()].filter((p) => /\.(java|kt)$/.test(p) && !p.startsWith(testRoot + '/'));
  const other = [...diff.keys()].filter((p) => !/\.(java|kt)$/.test(p));
  const forced = new Set([...diff.keys()].filter((p) => p.startsWith(testRoot + '/')).map(fqcn));
  for (const t of after.keys()) if (!before.has(t) && !t.startsWith('<spill')) forced.add(t);
  for (const t of before.incomplete) forced.add(t);
  const membersPath = join(replay, child, 'members.json');
  const shape = shapeChanged(diff, existsSync(membersPath) ? JSON.parse(readFileSync(membersPath, 'utf8')) : null);
  const sel = select(before, diff, 'old', shape);
  const truth = select(after, diff, 'new').method;
  for (const t of failed(child)) truth.add(t);
  for (const t of truth) if (t.startsWith('<spill')) truth.delete(t);
  const r = reach(parent, child);
  const miss = (s) => [...truth].filter((t) => !s.has(t) && !forced.has(t));
  const all = [...after.keys()].filter((t) => !t.startsWith('<spill')).length;
  const spill = [...after.keys()].filter((t) => t.startsWith('<spill')).length;
  rows.push({
    child: child.slice(0, 9),
    javaMain: javaMain.length,
    other: other.join(' '),
    all,
    forced: forced.size,
    incomplete: before.incomplete.size,
    truth: truth.size,
    method: sel.method.size,
    shape: sel.shape.size,
    shapeFiles: [...shape],
    line: sel.line.size,
    file: sel.file.size,
    reach: r.ok ? r.tests.size : `refused ${r.status}`,
    missMethod: miss(sel.method),
    missShape: miss(sel.shape),
    missLine: miss(sel.line),
    missFile: miss(sel.file),
    missReach: r.ok ? miss(r.tests) : null,
    reachNote: r.ok ? undefined : r.stderr,
    spill,
    selected: { forced: [...forced], method: [...sel.method], shape: [...sel.shape], line: [...sel.line], file: [...sel.file], reach: r.ok ? [...r.tests] : null },
  });
}
writeFileSync(join(replay, 'score.json'), JSON.stringify(rows, null, 2));
const pad = (v, n) => String(v).padStart(n);
console.log('child      main  all forced truth method shape  line  file reach | miss m/s/l/f/r   other');
for (const r of rows) {
  if (r.skipped) { console.log(r.child, r.skipped); continue; }
  console.log(r.child, pad(r.javaMain, 4), pad(r.all, 4), pad(r.forced, 6), pad(r.truth, 5), pad(r.method, 6), pad(r.shape, 5), pad(r.line, 5), pad(r.file, 5), pad(r.reach, 5),
    '|', `${r.missMethod.length}/${r.missShape.length}/${r.missLine.length}/${r.missFile.length}/${r.missReach?.length ?? '-'}`, '  ', r.other.slice(0, 60));
}
