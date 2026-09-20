/**
 * What a *snapshot* costs at a repository's scale, through the code that ships.
 *
 * `crossings.mjs` measures the primitive. This measures the artifact: a real
 * FORMAT 8 file with two hundred thousand modules, one million six hundred
 * thousand regions and two thousand test files whose closures reach forty
 * thousand modules apiece — six hundred and seventy million region-test
 * crossings — and then the operation a run actually performs on it, which is
 * reading it, laying ten re-recorded modules over it, and writing it back.
 *
 *   node scripts/snapshot-scale.mjs journals [dir] [modules] [tests] [blocks]
 *   node scripts/snapshot-scale.mjs fold [dir] [modules] [tests] [blocks]
 *   node scripts/snapshot-scale.mjs record [-] [modules] [tests] [blocks]
 *   node scripts/snapshot-scale.mjs build [file] [modules] [tests] [blocks]
 *   node scripts/snapshot-scale.mjs layer [file]
 *   node scripts/snapshot-scale.mjs select [file]
 *
 * One mode per process, because resident size is what is being measured and it
 * does not fall back when a previous arm lets go.
 *
 * ## Why the fixture is written column to column
 *
 * `build` does not go through `encodeTestCoverage`. Not because the encoder
 * cannot write this file — it can, and `layer` proves the result is one the
 * shipped reader accepts — but because the encoder takes the logical model, and
 * the logical model of this repository is a `string[]` per region naming forty
 * thousand tests: six hundred and seventy million pointers, five and a half
 * gigabytes, before the encoder is called. That object model is the producer
 * side of the same problem and it is not what this script is measuring.
 *
 * A recording never builds that model either. It records the modules one run
 * touched, which is tens, and lays them over the file — which is `layer`, below,
 * and is the number that matters.
 */

import { writeFileSync, readFileSync, statSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { layerTestCoverage } from '../dist/test-selection/format-layer.js';
import { openTestCoverage } from '../dist/test-selection/format-view.js';
import { selectTestFilesFromView } from '../dist/test-selection/select.js';
import { crossingsOf } from '../dist/test-selection/instrumented-modules.js';
import { coverageModule } from '../dist/test-selection/coverage-rows.js';
import { foldCrossings } from '../dist/test-selection/crossing-fold.js';
import journalFormat from '../dist/test-selection/journal-format.cjs';
import { encodeTestCoverage } from '../dist/test-selection/format.js';
import { buildSnapshot } from './snapshot-scale-build.mjs';
import {
  BARRELS,
  BLOCKS,
  FILE,
  MODE,
  MODULES,
  PER_BARREL,
  RERAN,
  RERECORDED,
  TESTS,
  UTILS,
  barrelGraph,
  count,
  mb,
  names,
  pad,
  rerecorded,
  secs,
  stream,
  sweep,
  verdict,
  watch,
} from './snapshot-scale-fixture.mjs';

if (MODE === 'build') buildSnapshot();


if (MODE === 'layer') {
  const previous = readFileSync(FILE);
  watch();
  console.log(`read: ${mb(statSync(FILE).size)} snapshot`);
  const current = rerecorded(MODULES * BLOCKS);
  const laying = Date.now();
  const out = layerTestCoverage(previous, current);
  watch();
  console.log(
    `layered: ${count(RERECORDED)} of ${count(MODULES)} modules re-recorded, ` +
      `${count(RERAN)} of ${count(TESTS)} tests re-run, in ${secs(Date.now() - laying)}`,
  );
  console.log(`  out: ${mb(out.length)}`);

  // It has to still be a snapshot, or the size is meaningless.
  const view = openTestCoverage(out);
  console.log(
    `  reads back: ${count(view.modulePath.length)} modules, ${count(view.blockSet.length)} regions, ` +
      `${count(view.crossings.size)} distinct sets`,
  );
  const re = view.crossings.members(view.blockSet.at((MODULES / 2) * BLOCKS));
  console.log(`  a re-recorded region names ${count(re.length)} tests`);
  const carried = view.crossings.members(view.blockSet.at(0));
  console.log(`  a carried region names ${count(carried.length)} tests`);
  verdict();
}

if (MODE === 'select') {
  const previous = readFileSync(FILE);
  const name = names(MODULES * BLOCKS);
  const view = openTestCoverage(previous);
  watch();
  // Five leaf modules changed: the question a run actually asks of the file.
  const changed = Array.from({ length: 5 }, (_, at) => name.modulePath(BARRELS + UTILS + at * 4_001));
  const diff = changed
    .map(
      (file) =>
        `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n` +
        `@@ -1,3 +1,3 @@\n-was\n+is\n context\n`,
    )
    .join('');
  const asking = Date.now();
  const chosen = selectTestFilesFromView(view, diff);
  watch();
  console.log(
    `selection: ${count(changed.length)} changed modules named ${count(chosen.length)} of ` +
      `${count(view.testPath.length)} tests in ${Date.now() - asking} ms`,
  );
  verdict();
}

/**
 * The other half: what a *run* costs before a byte of it reaches the file.
 *
 * `build` writes the snapshot through the columns. This arm goes the way the
 * shipped producer goes — journals, `crossingsOf`, the object model, the
 * encoder — and reports where that lands. It is here to be measured, not to
 * pass: the shape it is asked for is the shape a whole-suite run on this
 * repository has, and the growth is reported as a sweep so the number at the
 * end is a measurement rather than an extrapolation of one.
 */
if (MODE === 'record') {
  const name = names(MODULES * BLOCKS);
  const next = stream(20250915);
  const utilAt = BARRELS;
  const leafAt = BARRELS + UTILS;
  const rootAt = leafAt + BARRELS * PER_BARREL;
  const degree = new Uint32Array(MODULES);
  for (let barrel = 0; barrel < BARRELS; barrel += 1) degree[barrel] = PER_BARREL;
  for (let leaf = leafAt; leaf < rootAt; leaf += 1) degree[leaf] = 2;
  const rootDegree = new Uint32Array(TESTS);
  const rootFirst = new Uint32Array(TESTS);
  for (let test = 0; test < TESTS; test += 1) {
    rootDegree[test] = 1 + Math.floor(next() * 40);
    rootFirst[test] = Math.floor(next() * BARRELS);
    degree[rootAt + test] = rootDegree[test];
  }
  const head = new Uint32Array(MODULES + 1);
  for (let module = 0; module < MODULES; module += 1) head[module + 1] = head[module] + degree[module];
  const edges = new Uint32Array(head[MODULES]);
  const leafStream = stream(77);
  for (let barrel = 0; barrel < BARRELS; barrel += 1) {
    for (let step = 0; step < PER_BARREL; step += 1) {
      edges[head[barrel] + step] = leafAt + barrel * PER_BARREL + step;
    }
  }
  for (let leaf = leafAt; leaf < rootAt; leaf += 1) {
    edges[head[leaf]] = utilAt + Math.floor(leafStream() * UTILS);
    edges[head[leaf] + 1] = utilAt + Math.floor(leafStream() * UTILS);
  }
  for (let test = 0; test < TESTS; test += 1) {
    for (let step = 0; step < rootDegree[test]; step += 1) {
      edges[head[rootAt + test] + step] = (rootFirst[test] + step) % BARRELS;
    }
  }

  const ordinals = Array.from({ length: BLOCKS }, (_, at) => at);
  const mark = new Uint32Array(MODULES);
  const frontier = new Uint32Array(MODULES);
  let stamp = 0;
  /** One test's journal, as `readJournals` hands it over. */
  const journalOf = (test) => {
    stamp += 1;
    let wrote = 0;
    let read = 0;
    frontier[wrote++] = rootAt + test;
    mark[rootAt + test] = stamp;
    const modules = [];
    while (read < wrote) {
      const at = frontier[read++];
      modules.push({ id: name.modulePath(at), hits: ordinals, shared: [], loaded: [] });
      for (let edge = head[at]; edge < head[at + 1]; edge += 1) {
        const to = edges[edge];
        if (mark[to] !== stamp) {
          mark[to] = stamp;
          frontier[wrote++] = to;
        }
      }
    }
    return { testFile: name.testPath(test), modules };
  };

  const captured = new Map();
  const sweep = [];
  for (let share = TESTS; share >= 16; share = Math.floor(share / 4)) sweep.unshift(share);
  for (const ran of sweep) {
    const started = Date.now();
    const journals = [];
    let entries = 0;
    for (let test = 0; test < ran; test += 1) {
      const journal = journalOf(test);
      entries += journal.modules.length;
      journals.push(journal);
    }
    const held = watch();
    console.log(
      `\n${count(ran)} tests: ${count(entries)} journal module rows, ` +
        `${count(entries * BLOCKS)} crossings — rss ${mb(held)} after reading the journals`,
    );

    const crossings = crossingsOf(journals);
    console.log(`  after crossingsOf: rss ${mb(watch())}`);

    // Only the modules this run touched get a row, which at a whole-suite run
    // is every module it reached.
    for (const journal of journals) {
      for (const module of journal.modules) {
        if (captured.has(module.id)) continue;
        const at = Number(module.id.slice(2, 9));
        captured.set(module.id, {
          file: module.id,
          id: module.id,
          sourceDigest: name.sourceDigest(at),
          instrumented: true,
          blocks: ordinals.map((ordinal) => ({
            ordinal,
            kind: ordinal === 0 ? 'module' : 'branch',
            ...(ordinal === 0 ? {} : { owner: 0 }),
            digest: name.digest(at * BLOCKS + ordinal),
            name: name.blockName(at),
            path: name.blockPath(ordinal),
            startLine: ordinal * 3 + 1,
            endLine: ordinal * 3 + 3,
            source: true,
            testFiles: [],
          })),
        });
      }
    }
    const model = {
      version: 3,
      instrumentation: name.instrumentation,
      tests: Array.from({ length: ran }, (_, at) => ({
        file: name.testPath(at),
        complete: true,
        preconditions: [],
      })).sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0)),
      modules: [...captured]
        .map(([id, module]) =>
          coverageModule(module, (block) => [...(crossings.get(id)?.get(block.ordinal) ?? [])]),
        )
        .sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0)),
    };
    console.log(`  after the object model: rss ${mb(watch())}`);
    const encoded = encodeTestCoverage(model);
    console.log(
      `  after encodeTestCoverage: rss ${mb(watch())}, ${mb(encoded.length)} written, ` +
        `${secs(Date.now() - started)}`,
    );
  }
  verdict();
}



/**
 * The frames a run's workers would have written, on disk, one file per test.
 *
 * This is what a run actually produces: the worker that ran one test file
 * encodes what it entered and drops the frame. Nothing here is the whole run,
 * and the arm exists so the two ways of reading a whole run back — `record` and
 * `fold` — are reading the same bytes.
 */
if (MODE === 'journals') {
  const directory = FILE === '/tmp/variance-scale-snapshot.bin' ? '/tmp/variance-scale-journals' : FILE;
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const closureOf = barrelGraph();
  const counters = new Uint32Array(BLOCKS).fill(1);
  const started = Date.now();
  let rows = 0;
  let bytes = 0;
  for (let test = 0; test < TESTS; test += 1) {
    const reached = closureOf(test);
    // Numbered ids, which is what a run that has met these files before writes.
    const frame = journalFormat.encodeJournal(
      `t/${pad(test, 7)}.test.ts`,
      new Map(Array.from(reached, (module) => [module, counters])),
    );
    rows += reached.length;
    bytes += frame.length;
    writeFileSync(`${directory}/${pad(test, 7)}.vajrn`, frame);
    if ((test & 0x3f) === 0) watch();
  }
  console.log(
    `journals: ${count(TESTS)} frames, ${count(rows)} module rows, ` +
      `${count(rows * BLOCKS)} crossings, ${mb(bytes)} on disk in ${secs(Date.now() - started)}`,
  );
  console.log(`  ${directory}`);
  verdict();
}

/**
 * The same runs read back as columns, which is the counterpart to `record`.
 *
 * `record` holds the run: every frame as rows, then a map of every crossing,
 * then the object model. `fold` holds a slice of the modules and reads the
 * frames again for the next slice.
 */
if (MODE === 'fold') {
  const directory = FILE === '/tmp/variance-scale-snapshot.bin' ? '/tmp/variance-scale-journals' : FILE;
  const name = names(MODULES * BLOCKS);
  const frames = readdirSync(directory)
    .filter((entry) => entry.endsWith('.vajrn'))
    .sort()
    .map((entry) => `${directory}/${entry}`);
  const moduleBlocks = new Uint32Array(MODULES + 1);
  for (let at = 0; at <= MODULES; at += 1) moduleBlocks[at] = at * BLOCKS;
  const budget = Number(process.argv[7] ?? 128) * 1_048_576;

  for (const ran of sweep()) {
    const testId = new Map();
    for (let at = 0; at < ran; at += 1) testId.set(name.testPath(at), at);
    let read = 0;
    let rows = 0;
    const replay = (visit) => {
      for (let test = 0; test < ran; test += 1) {
        const raw = readFileSync(frames[test]);
        read += raw.length;
        journalFormat.scanJournal(raw, visit);
      }
    };
    const started = Date.now();
    const folded = foldCrossings({
      replay,
      testId,
      rowOf: (id) => (typeof id === 'number' && id < MODULES ? id : undefined),
      moduleBlocks,
      budget,
    });
    const held = watch();
    console.log(
      `\n${count(ran)} tests: ${count(MODULES * BLOCKS)} regions folded in ` +
        `${secs(Date.now() - started)} — rss ${mb(held)}`,
    );
    console.log(
      `  ${folded.passes} passes over ${mb(read / folded.passes)} of frames ` +
        `(${mb(read)} read in all, budget ${mb(budget)} a slice)`,
    );
    console.log(
      `  pool: ${count(folded.enteredSets.size)} entered sets, ` +
        `${mb(folded.enteredSets.byteLength)}; ` +
        `${count(folded.loadedSets.size)} loaded sets, ${mb(folded.loadedSets.byteLength)}`,
    );
    void rows;
  }
  verdict();
}
