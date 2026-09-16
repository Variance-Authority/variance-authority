/**
 * What *answering* costs, on a snapshot already written.
 *
 * `snapshot-scale.mjs` builds the artifact and measures writing it. This
 * measures the only operation a developer waits on: a diff arrives, and the
 * reader says which test files it can leave unrun. Every arm takes a written
 * snapshot as its argument and opens it through the shipped reader, so nothing
 * here can measure a structure the product does not have.
 *
 *   node scripts/selection-scale.mjs band     <file> [max]     what a pull request costs
 *   node scripts/selection-scale.mjs hubs     <file>           what every file in the repository costs
 *   node scripts/selection-scale.mjs neighbours <file> [count] one subtree, file by file
 *   node scripts/selection-scale.mjs decode   <file>           what naming the answer costs
 *   node scripts/selection-scale.mjs reads    <file> [files]   how much of the file an answer opens
 *   node scripts/selection-scale.mjs regions  <file> [other]   the region shape, and whose it is
 *
 * Peak resident size is not `process.memoryUsage()`, which reports the moment it
 * was called. Take it from the operating system:
 *
 *   /usr/bin/time -l node scripts/selection-scale.mjs band {SNAPSHOT} 100
 *
 * ## Why a pull request is modelled two ways
 *
 * A diff of a hundred files is not one shape. The files a person changes are
 * adjacent — one feature, one subtree — and adjacent modules share most of their
 * audience, so the hundredth file adds almost nothing to what the first already
 * selected. A hundred files scattered evenly across the repository share nothing,
 * and each one brings its own audience. `clustered` is what pull requests look
 * like; `spread` is the worst a diff of that size can be shaped like, and the
 * distance between the two rows is the whole reason file count is a poor axis.
 */

import { openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { openCoverageFile } from '../dist/test-selection/coverage-file.js';
import { openTestCoverage } from '../dist/test-selection/format-view.js';
import { narrowByExecutionFromView } from '../dist/test-selection/select.js';

const MODE = process.argv[2] ?? 'band';
const FILE = process.argv[3];

if (FILE === undefined) {
  console.error('usage: node scripts/selection-scale.mjs <band|hubs|neighbours|decode|reads> <snapshot> [n]');
  process.exit(2);
}

const handle = openCoverageFile(FILE);
const view = handle.view;
const MODULES = view.modulePath.length;
const TESTS = view.testPath.length;

/** Where a clustered change starts: a third of the way in, away from both ends. */
const SUBTREE = Math.floor(MODULES / 3);

const mb = (bytes) => (bytes / 1_048_576).toFixed(0);

/**
 * `count` module paths, adjacent or strided.
 *
 * The dictionary is written in path order, so adjacent ordinals are neighbours in
 * one directory — which is what makes `clustered` a model of a pull request
 * rather than a lucky draw.
 */
function paths(count, shape) {
  const found = [];
  if (shape === 'spread') {
    const step = Math.max(1, Math.floor(MODULES / count));
    for (let at = 0; at < MODULES && found.length < count; at += step) {
      found.push(view.string(view.modulePath.at(at)));
    }
  } else {
    for (let at = SUBTREE; at < MODULES && found.length < count; at += 1) {
      found.push(view.string(view.modulePath.at(at)));
    }
  }
  return found;
}

/**
 * A comment-reflow commit: one added line per file.
 *
 * The cheapest diff that is still a diff. An added comment does not parse to a
 * binding, so the filter that drops inert text does not drop it, and each hunk
 * charges the regions around the gap it opened — which is the path every real
 * edit takes and the one worth timing.
 */
const reflow = (path) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n` +
  `@@ -3,2 +3,3 @@\n context\n+// reflowed\n context\n`;

function answer(changed) {
  const before = process.memoryUsage().rss;
  const started = process.hrtime.bigint();
  const narrowing = narrowByExecutionFromView(view, changed.map(reflow).join(''));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { narrowing, ms, rss: process.memoryUsage().rss - before };
}

if (MODE === 'band') {
  const max = Number(process.argv[4] ?? 100);
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500].filter((n) => n <= max && n <= MODULES);

  console.log(`${MODULES} modules x ${TESTS} tests`);
  console.log('');
  console.log('shape      files      ms   rss      run    skip   unread');
  for (const shape of ['clustered', 'spread']) {
    for (const count of steps) {
      const { narrowing, ms, rss } = answer(paths(count, shape));
      const run = narrowing.entered.length;
      const skip = narrowing.unread.length > 0 ? 0 : narrowing.whole.length - run;
      console.log(
        `${shape.padEnd(10)}${String(count).padStart(5)}` +
          `${ms.toFixed(1).padStart(8)}${(`${mb(rss)}M`).padStart(7)}` +
          `${String(run).padStart(8)}${String(skip).padStart(8)}${String(narrowing.unread.length).padStart(9)}`,
      );
    }
  }
} else if (MODE === 'hubs') {
  // One pass over every module, unioning the audiences of its regions. The mark
  // array is reused across modules and stamped with a generation rather than
  // cleared, so the whole scan allocates one array of `TESTS` and nothing else.
  const blocks = view.moduleBlocks.all();
  const mark = new Int32Array(TESTS);
  const cost = new Int32Array(MODULES);
  let generation = 0;

  const started = process.hrtime.bigint();
  for (let module = 0; module < MODULES; module += 1) {
    generation += 1;
    let audience = 0;
    for (let block = blocks[module]; block < blocks[module + 1]; block += 1) {
      const members = view.crossings.members(view.blockSet.at(block));
      for (let at = 0; at < members.length; at += 1) {
        const test = members[at];
        if (mark[test] !== generation) {
          mark[test] = generation;
          audience += 1;
        }
      }
    }
    cost[module] = audience;
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  const order = Array.from(cost.keys()).sort((a, b) => cost[b] - cost[a]);
  const share = (module) => (cost[module] * 100) / TESTS;
  const at = (quantile) => share(order[Math.floor(order.length * quantile)]).toFixed(1);
  const hubs = order.filter((module) => share(module) >= 50).length;

  console.log(`${MODULES} modules x ${TESTS} tests`);
  console.log(`one pass over the repository : ${ms.toFixed(0)} ms (${((ms * 1000) / MODULES).toFixed(1)} us per file)`);
  console.log(`resident                     : ${mb(process.memoryUsage().rss)} MB`);
  console.log(`share of the suite one file costs : p50 ${at(0.5)}%  p90 ${at(0.1)}%  p99 ${at(0.01)}%  worst ${share(order[0]).toFixed(1)}%`);
  console.log(`files costing half the suite or more : ${hubs} (${((hubs * 100) / MODULES).toFixed(1)}%)`);
  console.log('');
  console.log('worst:');
  for (const module of order.slice(0, 8)) {
    console.log(`  ${share(module).toFixed(0).padStart(3)}%  ${view.string(view.modulePath.at(module))}`);
  }
} else if (MODE === 'neighbours') {
  // The band table says a pull request of ten files costs more than one file.
  // This says which of the ten it was.
  const count = Number(process.argv[4] ?? 12);
  const changed = paths(count, 'clustered');
  let suite = 0;

  console.log('alone  cumulative  file');
  for (let at = 0; at < changed.length; at += 1) {
    const alone = answer([changed[at]]).narrowing;
    const together = answer(changed.slice(0, at + 1)).narrowing;
    suite = alone.whole.length;
    const share = (n) => `${String(Math.round((n * 100) / suite)).padStart(4)}%`;
    console.log(`${share(alone.entered.length)}       ${share(together.entered.length)}  ${changed[at]}`);
  }
  console.log('');
  console.log(`suite = ${suite} tests`);
} else if (MODE === 'decode') {
  // `whole` is the suite as paths. Naming a test costs a dictionary lookup and a
  // string; counting one costs a column read. The answer a caller needs decides
  // which of those it pays for.
  const started = process.hrtime.bigint();
  const named = [];
  for (let test = 0; test < TESTS; test += 1) {
    if (view.testComplete.at(test) === 1) named.push(view.string(view.testPath.at(test)));
  }
  const decoding = Number(process.hrtime.bigint() - started) / 1e6;

  const counting = process.hrtime.bigint();
  let ids = 0;
  for (let test = 0; test < TESTS; test += 1) {
    if (view.testComplete.at(test) === 1) ids += 1;
  }
  const counted = Number(process.hrtime.bigint() - counting) / 1e6;

  console.log(`the suite as paths : ${decoding.toFixed(1)} ms (${named.length} tests)`);
  console.log(`the suite as ids   : ${counted.toFixed(2)} ms (${ids} tests)`);
  console.log(`ratio              : ${(decoding / Math.max(counted, 0.0001)).toFixed(0)}x`);
} else if (MODE === 'reads') {
  // The file is opened through a door that counts. A column is a run of bytes at
  // an offset, so what an answer costs in I/O is the sum of the runs it touched —
  // which is the number to quote at anyone who has just multiplied two axes
  // together and decided the file cannot be read.
  const count = Number(process.argv[4] ?? 1);
  const changed = paths(count, 'clustered');
  const fd = openSync(FILE, 'r');
  const length = fstatSync(fd).size;
  let bytes = 0;
  let reads = 0;

  const counted = {
    length,
    read: (from, to) => {
      bytes += to - from;
      reads += 1;
      const out = new Uint8Array(to - from);
      let filled = 0;
      while (filled < out.length) {
        const got = readSync(fd, out, filled, out.length - filled, from + filled);
        if (got === 0) break;
        filled += got;
      }
      return out;
    },
  };

  const counting = openTestCoverage(counted);
  const opening = bytes;
  const openingReads = reads;
  const narrowing = narrowByExecutionFromView(counting, changed.map(reflow).join(''));

  console.log(`the file            : ${(length / 1_048_576).toFixed(1)} MB`);
  console.log(`opening it read     : ${(opening / 1024).toFixed(1)} KB in ${openingReads} reads`);
  console.log(`answering ${String(count).padStart(3)} files : ${((bytes - opening) / 1_048_576).toFixed(2)} MB in ${reads - openingReads} reads`);
  console.log(`                    : ${((bytes * 100) / length).toFixed(1)}% of the file`);
  console.log(`the answer          : run ${narrowing.entered.length}, skip ${narrowing.whole.length - narrowing.entered.length}`);
  closeSync(fd);
} else if (MODE === 'regions') {
  // The region axis is the one a reader cannot check by eye, and it is the one a
  // scale claim rides on: a snapshot's size is regions, not files. This prints the
  // distribution, and — given a second snapshot — how far the two shapes are apart.
  const shape = (v) => {
    const offsets = v.moduleBlocks.all();
    const modules = v.modulePath.length;
    const per = new Int32Array(modules);
    for (let module = 0; module < modules; module += 1) per[module] = offsets[module + 1] - offsets[module];
    return per;
  };
  const report = (name, per) => {
    const sorted = Array.from(per).sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const total = sorted.reduce((a, b) => a + b, 0);
    console.log(
      `${name.padEnd(22)}${String(per.length).padStart(8)} modules ${String(total).padStart(10)} regions` +
        `   mean ${(total / per.length).toFixed(1).padStart(5)}  p50 ${String(at(0.5)).padStart(3)}` +
        `  p90 ${String(at(0.9)).padStart(3)}  p99 ${String(at(0.99)).padStart(4)}  max ${sorted[sorted.length - 1]}`,
    );
    const counts = new Map();
    for (const x of per) counts.set(x, (counts.get(x) ?? 0) + 1);
    return counts;
  };

  const here = report('this snapshot', shape(view));
  const other = process.argv[4];
  if (other !== undefined) {
    const against = openCoverageFile(other);
    const theirs = report('against', shape(against.view));
    // Share per region-count, the two distributions side by side. A fixture drawn
    // from a real recording matches this table; one with a region count picked by
    // a constant does not, and no summary statistic makes that visible.
    const keys = [...new Set([...here.keys(), ...theirs.keys()])].sort((a, b) => a - b);
    const mine = [...here.values()].reduce((a, b) => a + b, 0);
    const yours = [...theirs.values()].reduce((a, b) => a + b, 0);
    console.log('');
    console.log('regions      this   against');
    let apart = 0;
    for (const key of keys) {
      const a = ((here.get(key) ?? 0) * 100) / mine;
      const b = ((theirs.get(key) ?? 0) * 100) / yours;
      apart += Math.abs(a - b);
      if (key <= 14) console.log(`${String(key).padStart(7)}${`${a.toFixed(2)}%`.padStart(10)}${`${b.toFixed(2)}%`.padStart(10)}`);
    }
    console.log('');
    console.log(`distinct region-counts: ${here.size} and ${theirs.size}`);
    console.log(`total variation distance: ${(apart / 2).toFixed(2)}%`);
    against.close();
  }
} else {
  console.error(`unknown mode: ${MODE}`);
  process.exit(2);
}

handle.close();
