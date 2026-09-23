/**
 * What a repository's import graph says, before anything is instrumented.
 *
 * Selection does not need a journey. *Can this file affect this test* is a
 * question the static graph answers on its own, and instrumentation only ever
 * narrows the answer — it is never the authority for skipping a test
 * ([`selection-is-module-level`](../../../docs/context/)). So the reach factor
 * `R(m)` of the store is computable from source alone, and this computes it, at
 * whatever scale the repository actually is.
 *
 * Three numbers come out, and each answers a claim that has been made without
 * measurement:
 *
 * 1. **Closure size per test** — the *"some of my test files import forty
 *    thousand other project files"* number, counted rather than estimated.
 * 2. **Reach classes** — how many *distinct* module-to-test sets exist. This is
 *    `|R|`, the first factor, and it is obtained by refining a partition rather
 *    than by materializing the modules × tests matrix, so the memory is a
 *    handful of `Int32Array`s over modules and never the product.
 * 3. **What a selection-only index costs** — classes as bitmaps, plus one class
 *    id per module, run-length coded in path order because siblings share reach.
 *
 * Nothing here loads a journal, so it is the cheap half: run it on a repository
 * nobody has recorded yet and it still answers.
 *
 *   node packages/sense/scripts/reach-probe.mjs <root> [dir ...]
 */

import { scanRelations } from '../dist/scan.js';

const ROOT = process.argv[2] ?? process.cwd();
const DIRS = process.argv.length > 3 ? process.argv.slice(3) : ['packages', 'examples', 'cases', 'src', 'app', 'lib'];
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CEILING = Number(process.env.CEILING ?? 600) * 1_048_576;

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const rss = () => process.memoryUsage().rss;
let peak = rss();
const mark = () => { const now = rss(); if (now > peak) peak = now; };

const present = [];
for (const dir of DIRS) {
  try {
    const { statSync } = await import('node:fs');
    if (statSync(`${ROOT}/${dir}`).isDirectory()) present.push(dir);
  } catch { /* a directory this repository does not have is not an error */ }
}
if (present.length === 0) {
  console.error(`none of ${DIRS.join(', ')} exist under ${ROOT} — name the source directories as arguments`);
  process.exit(1);
}

console.log(`scanning ${present.join(', ')} under ${ROOT}`);
const records = await scanRelations({ root: ROOT, dirs: present });
mark();
const afterScan = rss();

/** Files, numbered. The id is the index into every array below. */
const idOf = new Map();
const nameOf = [];
const number = (file) => {
  const found = idOf.get(file);
  if (found !== undefined) return found;
  const id = nameOf.length;
  idOf.set(file, id);
  nameOf.push(file);
  return id;
};
for (const record of records) number(record.file);
for (const record of records) for (const edge of record.edges ?? []) number(edge.to);

const FILES = nameOf.length;
/** Compressed-sparse-row adjacency: heads, then the targets they index into. */
const head = new Int32Array(FILES + 1);
for (const record of records) head[idOf.get(record.file) + 1] = (record.edges ?? []).length;
for (let at = 0; at < FILES; at += 1) head[at + 1] += head[at];
const EDGES = head[FILES];
const to = new Int32Array(EDGES);
{
  const cursor = head.slice(0, FILES);
  for (const record of records) {
    const from = idOf.get(record.file);
    for (const edge of record.edges ?? []) to[cursor[from]++] = idOf.get(edge.to);
  }
}
mark();

const tests = [];
for (let at = 0; at < FILES; at += 1) if (TEST.test(nameOf[at])) tests.push(at);
const opaque = records.filter((record) => record.unknown !== undefined).length;
const afterGraph = rss();
// The scan's records are the largest thing here and nothing below reads them:
// the graph is the CSR arrays, and the names are already interned.
records.length = 0;
idOf.clear();
if (global.gc !== undefined) global.gc();
const afterRelease = rss();
const megabytes = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
console.log(`  rss: ${megabytes(afterScan)} after the scan, ${megabytes(afterGraph)} with the graph built, ${megabytes(afterRelease)} once the records are let go`);

console.log(`graph: ${FILES.toLocaleString()} files, ${EDGES.toLocaleString()} edges, ${tests.length.toLocaleString()} test files in ${since()}`);
if (opaque > 0) console.log(`  ${opaque.toLocaleString()} files whose own edges could not all be enumerated — counted with the edges they state, and none for the rest`);

/**
 * One test's forward closure, and how deep each module sat.
 *
 * Generation-stamped rather than cleared: a `Int32Array` of files holds the run
 * a file was last seen in, so the 200,000-entry scratch is paid for once for
 * the whole probe rather than once per test.
 */
const seen = new Int32Array(FILES).fill(-1);
const depth = new Int32Array(FILES);
const queue = new Int32Array(FILES);
/** classOf, refined test by test; the number of distinct values is |R|. */
let classOf = new Int32Array(FILES);
let classes = 1;
/** Per refinement, oldClass -> the class its members move to when in reach. */
let split = new Int32Array(1);
let splitRun = new Int32Array(1).fill(-1);

const closureSizes = [];
const depthHistogram = new Int32Array(64);
let deepest = 0;
let crossings = 0;

for (let run = 0; run < tests.length; run += 1) {
  const test = tests[run];
  let read = 0;
  let write = 0;
  queue[write++] = test;
  seen[test] = run;
  depth[test] = 0;

  while (read < write) {
    const at = queue[read++];
    const next = depth[at] + 1;
    for (let edge = head[at]; edge < head[at + 1]; edge += 1) {
      const target = to[edge];
      if (seen[target] === run) continue;
      seen[target] = run;
      depth[target] = next;
      queue[write++] = target;
    }
  }
  closureSizes.push(write);
  crossings += write;

  // Refine: every module this test reaches leaves its class for a fresh one.
  // The partition after every test has one class per distinct reach set, and
  // the matrix that would have held them was never allocated.
  if (split.length < classes * 2 + 2) {
    split = new Int32Array(classes * 2 + 2);
    splitRun = new Int32Array(classes * 2 + 2).fill(-1);
  }
  for (let index = 0; index < write; index += 1) {
    const at = queue[index];
    const from = classOf[at];
    if (splitRun[from] !== run) {
      splitRun[from] = run;
      split[from] = classes;
      classes += 1;
      if (split.length < classes + 2) {
        const grownSplit = new Int32Array(classes * 2);
        grownSplit.set(split);
        split = grownSplit;
        const grownRun = new Int32Array(classes * 2).fill(-1);
        grownRun.set(splitRun);
        splitRun = grownRun;
      }
    }
    classOf[at] = split[from];
    const level = depth[at] > 63 ? 63 : depth[at];
    depthHistogram[level] += 1;
    if (depth[at] > deepest) deepest = depth[at];
  }
  if (run % 200 === 199) mark();
}
mark();

// Classes are sparse after refinement — renumber so the count is the count.
// Into a scratch array, never in place: refinement ids and dense ids share one
// number line, so writing `classOf[at]` as we go lets a later file read a slot
// an earlier one already rewrote and collapse onto its class. In place this
// undercounts, and it undercounts silently.
{
  const dense = new Map();
  const denseOf = new Int32Array(FILES);
  for (let at = 0; at < FILES; at += 1) {
    const was = classOf[at];
    let now = dense.get(was);
    if (now === undefined) { now = dense.size; dense.set(was, now); }
    denseOf[at] = now;
  }
  classOf = denseOf;
  classes = dense.size;
}
mark();

const sorted = [...closureSizes].sort((left, right) => left - right);
const at = (share) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]);
const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const pct = (part, whole) => (whole === 0 ? '0.0' : ((part / whole) * 100).toFixed(1));

console.log();
console.log(`what a test reaches`);
console.log(`  ${crossings.toLocaleString()} module-test pairs in all — the relation written out literally`);
console.log(`  closure: ${at(0)} min, ${at(0.5)} median, ${at(0.9)} p90, ${at(0.99)} p99, ${sorted[sorted.length - 1] ?? 0} max of ${FILES.toLocaleString()} files`);
console.log(`  deepest module sat ${deepest} hops from a test file`);
let carried = 0;
for (let level = 0; level <= Math.min(deepest, 20); level += 1) {
  carried += depthHistogram[level];
  if (level <= 12 || level === Math.min(deepest, 20)) {
    console.log(`    depth ${String(level).padStart(2)}: ${String(depthHistogram[level]).padStart(12, ' ')} pairs, ${pct(carried, crossings)}% of the relation within reach`);
  }
}

console.log();
console.log(`the reach factor`);
console.log(`  ${classes.toLocaleString()} distinct reach sets over ${FILES.toLocaleString()} files`);
console.log(`  ${(FILES / Math.max(classes, 1)).toFixed(0)} files a class on average`);

let runs = 1;
for (let index = 1; index < FILES; index += 1) if (classOf[index] !== classOf[index - 1]) runs += 1;
const WORDS = (tests.length + 31) >>> 5;
const bitmaps = classes * WORDS * 4;
const column = Math.min(FILES * 4, runs * 8);
console.log(`  ${runs.toLocaleString()} runs in path order — ${pct(runs, FILES)}% of the files start a new class`);
console.log();
console.log(`a selection-only index`);
console.log(`  ${mb(bitmaps)} of class bitmaps (${classes.toLocaleString()} x ${tests.length} bits)`);
console.log(`  ${mb(column)} of class ids (${runs.toLocaleString()} runs beat ${FILES.toLocaleString()} flat entries)`);
console.log(`  ${mb(bitmaps + column)} in all, against ${mb(crossings * 8)} for the pairs written out`);
console.log();
console.log(`peak rss ${(peak / 1_048_576).toFixed(1)} MB against a ${(CEILING / 1_048_576).toFixed(0)} MB ceiling — ${peak <= CEILING ? 'fits' : 'OVER'}   ${since()}`);
