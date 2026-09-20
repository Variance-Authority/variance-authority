#!/usr/bin/env node

/**
 * How many tests stand behind each region, beside what a line counter says.
 *
 * A coverage percentage answers one question: was this line executed at all.
 * The record answers a second one it has no unit for — *by whom*, and *how
 * many* — because every region it holds carries the test files that entered it.
 * A region with four witnesses and a region with one are the same green line to
 * a counter and are not the same evidence.
 *
 * This prints both readings side by side, per package, so the disagreement is
 * visible rather than argued. It measures nothing itself: it reads two files
 * that two commands already wrote.
 *
 *   yarn test            # the record, under our probes
 *   yarn test:coverage   # coverage/coverage-summary.json, under V8's counters
 *   node packages/sense/scripts/witnesses.mjs
 *
 * Both readings have to come from the same working tree. They are separate runs
 * of the same suite and neither notices if the other is stale.
 *
 * Columns. `v8 lines` is the provider's line percentage over the package's
 * files, `entered` the share of the record's regions that any test reached,
 * `medWit` the median number of tests behind a region, and `1-wit` the share of
 * regions resting on exactly one. The last is the column a counter cannot
 * produce and the one worth reading first: it is where a suite is one deleted
 * test away from a blind spot it will not report.
 *
 * Two grains, two populations, and they do not have to agree. The counter sees
 * every file it was pointed at, including ones no test ever loaded; the record
 * holds a row only for a module some run actually imported, which is why a
 * package can read 100% here and still be a package whose regions are missing
 * from the record entirely. Pass a path prefix to list those regions one by one
 * instead of the summary.
 */
import { readFileSync } from 'node:fs';
import { readTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';

const root = process.cwd();
const prefix = process.argv[2];
const coverage = await readTestCoverage(testCoverageFile(root));

const shortenTest = (file) => file.replace(/^.*\/src\//, '').replace(/\.(test|spec)\.[cm]?[jt]sx?$/, '');

if (prefix) {
  const modules = coverage.modules
    .filter((module) => module.file.startsWith(prefix))
    .sort((a, b) => a.file.localeCompare(b.file));

  for (const module of modules) {
    console.log(`\n=== ${module.file}  (${module.blocks.length} regions)`);
    for (const block of module.blocks) {
      const witnesses = (block.testFiles ?? []).map(shortenTest);
      const extent = `${block.startLine}-${block.endLine}`.padStart(9);
      console.log(
        `${extent} ${block.kind.padEnd(13)}${(block.name || '·').padEnd(24)} ${witnesses.join(', ') || '— nobody'}`,
      );
    }
  }
  console.log(`\n${modules.length} modules, ${coverage.tests.length} test files in the record`);
  process.exit(0);
}

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const packageOf = (file) => /packages\/([^/]+)\//.exec(file)?.[1];
const rows = new Map();
const row = (name) =>
  rows.get(name) ?? (rows.set(name, { regions: 0, entered: 0, witnesses: [], covered: 0, lines: 0 }), rows.get(name));

for (const module of coverage.modules) {
  const name = /^packages\/([^/]+)\/src\//.exec(module.file)?.[1];
  if (!name || /\.(test|check|measure)\.[cm]?[jt]sx?$/.test(module.file)) continue;
  const into = row(name);
  for (const block of module.blocks) {
    const count = (block.testFiles ?? []).length;
    into.regions += 1;
    if (count > 0) into.entered += 1;
    into.witnesses.push(count);
  }
}
for (const [file, file_] of Object.entries(summary)) {
  const name = file === 'total' ? undefined : packageOf(file);
  if (!name) continue;
  const into = row(name);
  into.covered += file_.lines.covered;
  into.lines += file_.lines.total;
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const share = (n, of) => (of ? (100 * n) / of : Number.NaN);
const fmt = (value, digits = 1) =>
  (Number.isNaN(value) ? '—' : `${value.toFixed(digits)}%`).padStart(7);

const table = [...rows]
  .map(([name, it]) => ({
    name,
    v8: share(it.covered, it.lines),
    entered: share(it.entered, it.regions),
    regions: it.regions,
    median: median(it.witnesses),
    alone: share(it.witnesses.filter((n) => n === 1).length, it.regions),
  }))
  .sort((a, b) => a.v8 - b.v8);

console.log(' v8 lines  entered  regions  medWit    1-wit  package');
for (const it of table) {
  console.log(
    `${fmt(it.v8)}  ${fmt(it.entered)}  ${String(it.regions).padStart(7)}  ${String(it.median).padStart(6)}  ${fmt(it.alone, 0)}  ${it.name}`,
  );
}

// Whether one reading predicts the other, over the packages large enough for a
// rank to mean anything. Entering a line and being witnessed more than once are
// different properties, and this is the number that says how different.
const ranked = table.filter((it) => !Number.isNaN(it.v8) && it.regions >= 50);
const ranks = (values) => {
  const order = values.map((value, index) => [value, index]).sort((a, b) => a[0] - b[0]);
  const out = [];
  order.forEach(([, index], place) => (out[index] = place));
  return out;
};
const spearman = (a, b) => {
  const [x, y] = [ranks(a), ranks(b)];
  const mean = (x.length - 1) / 2;
  const top = x.reduce((sum, value, i) => sum + (value - mean) * (y[i] - mean), 0);
  const bottom = Math.sqrt(
    x.reduce((sum, value) => sum + (value - mean) ** 2, 0) *
      y.reduce((sum, value) => sum + (value - mean) ** 2, 0),
  );
  return top / bottom;
};
const column = (key) => ranked.map((it) => it[key]);
const total = table.reduce((sum, it) => sum + it.regions, 0);

console.log(`\n${summary.total.lines.pct}% of lines, ${total} regions, ${ranked.length} packages ranked`);
for (const key of ['entered', 'median', 'alone']) {
  console.log(`  spearman(v8 lines, ${key.padEnd(7)}) = ${spearman(column('v8'), column(key)).toFixed(2)}`);
}
