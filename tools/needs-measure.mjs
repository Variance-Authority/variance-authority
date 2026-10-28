#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { asks, git, twinsOf, unitsIn } from './needs.mjs';
import { ROOT, isSource } from './owners.mjs';

/**
 * The results in journal entry 0077: how often `needs.mjs` names the function
 * a copy repeats, how often it speaks, and what the names it prints are. It
 * reads the hand labels in `needs-measure.json`: `copies`, each confirmed by
 * reading it and its `owner`; `judged`, pairs an earlier probe named; and
 * `sampled`, names this tool printed. A pair is `reuse`, `family` (the same
 * question, answered another way) or `unrelated`.
 *
 * `node tools/needs-measure.mjs`
 */

const LABELS = JSON.parse(readFileSync(new URL('./needs-measure.json', import.meta.url), 'utf8'));
const EVERY = 4;
const SAMPLED = 40;

// Units by blob, without their path: a blob is parsed once however many
// commits and paths hold it. A blob oxc cannot parse holds nothing, and is counted.
const read = new Map();
let unparsed = 0;

function unitsAt(commit, paths = []) {
  const rows = git(ROOT, ['ls-tree', '-r', commit, '--', ...paths])
    .split('\n')
    .filter((row) => row !== '')
    .map((row) => {
      const [meta, path] = row.split('\t');
      return { path, blob: meta.split(' ')[2] };
    })
    .filter(({ path }) => isSource(path));
  const missing = rows.filter(({ blob }) => !read.has(blob));
  if (missing.length > 0) {
    const out = git(ROOT, ['cat-file', '--batch'], { input: Buffer.from(missing.map(({ blob }) => `${blob}\n`).join('')), encoding: 'buffer' });
    let at = 0;
    for (const { path, blob } of missing) {
      const header = out.indexOf(10, at);
      const size = Number(out.subarray(at, header).toString().split(' ')[2]);
      const text = out.subarray(header + 1, header + 1 + size).toString('utf8');
      at = header + 1 + size + 1;
      try {
        read.set(blob, unitsIn(path, text).map(({ name, kind, line, bag }) => ({ name, kind, line, bag })));
      } catch {
        read.set(blob, []);
        unparsed += 1;
      }
    }
  }
  return rows.flatMap(({ path, blob }) => read.get(blob).map((unit) => ({ path, ...unit })));
}

const keyOf = ({ path, name }) => `${path}\0${name}`;
const share = (part, whole) => `${part}/${whole} (${whole === 0 ? 0 : Math.round((100 * part) / whole)}%)`;
const half = (id) => (createHash('sha1').update(id).digest()[0] & 1 ? 'odd' : 'even');

/** Whether the tool names an owner for any copy in the case, against the units at its base. */
function named(copy) {
  const existing = unitsAt(copy.base);
  const atHead = unitsAt(copy.head, [...new Set(copy.copy.map(({ path }) => path))]);
  const written = copy.copy.flatMap(({ path, name, line }) =>
    atHead
      .filter((unit) => unit.path === path && unit.name === name)
      .sort((left, right) => Math.abs(left.line - line) - Math.abs(right.line - line))
      .slice(0, 1),
  );
  const owners = new Set(copy.owner.map(keyOf));
  return twinsOf(written, existing).some(({ twins }) => twins.some((twin) => owners.has(keyOf(twin))));
}

// What the tool says at one change: the functions new at `head`, and their twins among the rest of `head`.
function at(base, head) {
  const before = new Map(unitsAt(base).map((unit) => [keyOf(unit), unit]));
  const units = unitsAt(head);
  const added = units.filter((unit) => !before.has(keyOf(unit)));
  return { added, twins: twinsOf(added, units.filter((unit) => before.has(keyOf(unit)))) };
}

const caught = LABELS.copies.map((copy) => ({ copy, named: named(copy) }));
const line = (label, rows) => `  ${label.padEnd(28)} ${share(rows.filter((row) => row.named).length, rows.length)}`;
const out = ['copies whose owner it names:', line('all', caught)];
for (const kind of [...new Set(LABELS.copies.map((copy) => copy.kind))].sort()) out.push(line(kind, caught.filter(({ copy }) => copy.kind === kind)));
for (const side of ['even', 'odd']) out.push(line(`function, ${side} half`, caught.filter(({ copy }) => copy.kind === 'function' && half(copy.id) === side)));
// `earlier` names the detectors that caught a copy before this one: `resemblance` (`clones.mjs`), `doors` (`owners.mjs`).
out.push(line('caught by an earlier one', caught.filter(({ copy }) => copy.earlier.length > 0)));
out.push(line('missed by every earlier one', caught.filter(({ copy }) => copy.earlier.length === 0)));

const labelled = new Set(LABELS.copies.flatMap((copy) => copy.copy.map((written) => `${copy.head}\0${keyOf(written)}`)));
const changesOnMain = git(ROOT, ['log', '--first-parent', '--reverse', '--format=%H %P', LABELS.tip])
  .split('\n')
  .filter((row) => row !== '')
  .map((row) => row.split(' ').filter((commit) => commit !== ''))
  .filter((commits) => commits.length > 1);
let asked = 0;
let spoke = 0;
let changes = 0;
const printed = [];
const at3 = ({ path, name, line }) => ({ path, name, line });
for (const [head, base] of changesOnMain.filter((_, index) => index % EVERY === 0)) {
  const { added, twins } = at(base, head);
  const unlabelled = (unit) => !labelled.has(`${head}\0${keyOf(unit)}`);
  asked += added.filter((unit) => unit.kind === 'function' && unlabelled(unit)).length;
  for (const { unit, twins: names } of twins.filter(({ unit }) => unlabelled(unit))) {
    spoke += 1;
    for (const twin of names) printed.push({ head, added: at3(unit), existing: at3(twin) });
  }
  changes += 1;
}
out.push(`new functions it names a neighbour for, on ${changes} of ${changesOnMain.length} changes:`, `  ${share(spoke, asked)}`);

// The names it printed there, in an order nobody chose, the SHA-1 of each pair; the first `SAMPLED` are read by hand.
const pairKey = ({ head, added, existing }) => `${head}\0${keyOf(added)}\0${keyOf(existing)}`;
const sample = printed
  .map((pair) => ({ pair, order: createHash('sha1').update(pairKey(pair)).digest('hex') }))
  .sort((left, right) => codeUnitOrder(left.order, right.order))
  .slice(0, SAMPLED)
  .map(({ pair }) => pair);
const verdictOf = new Map(LABELS.sampled.map((pair) => [pairKey(pair), pair.verdict]));
out.push(`names it printed: ${printed.length}; of ${sample.length} sampled, by verdict:`);
for (const verdict of ['reuse', 'family', 'unrelated']) {
  out.push(`  ${verdict.padEnd(28)} ${share(sample.filter((pair) => verdictOf.get(pairKey(pair)) === verdict).length, sample.length)}`);
}
for (const pair of sample.filter((pair) => !verdictOf.has(pairKey(pair)))) {
  out.push(`  not read: ${pair.head} ${pair.added.path}:${pair.added.line} ${pair.added.name} -> ${pair.existing.path}:${pair.existing.line} ${pair.existing.name}`);
}

// A judged pair is asked about only when its new unit is a function the tool asks about, and named when the
// tool names its neighbour against the tree at the change: a neighbour the change emptied into the new
// function, which now calls it, is no longer one to call.
const judged = { asked: 0, named: new Map(), quiet: new Map() };
for (const pair of LABELS.judged) {
  const { added, twins } = at(pair.base, pair.head);
  const unit = added.find((candidate) => keyOf(candidate) === keyOf(pair.added));
  if (unit === undefined || !asks(unit)) continue;
  judged.asked += 1;
  const found = twins.find((twin) => keyOf(twin.unit) === keyOf(pair.added));
  const tally = found?.twins.some((twin) => keyOf(twin) === keyOf(pair.existing)) ? judged.named : judged.quiet;
  tally.set(pair.verdict, (tally.get(pair.verdict) ?? 0) + 1);
}
const namedPairs = [...judged.named.values()].reduce((sum, count) => sum + count, 0);
out.push(`judged pairs: ${LABELS.judged.length}, of which it asks about ${judged.asked}; of those it names, by verdict:`);
for (const verdict of ['reuse', 'family', 'unrelated']) {
  out.push(`  ${verdict.padEnd(28)} ${share(judged.named.get(verdict) ?? 0, namedPairs)}, ${judged.quiet.get(verdict) ?? 0} more not named`);
}
out.push(`blobs oxc could not parse: ${unparsed}`);
process.stdout.write(`${out.join('\n')}\n`);
