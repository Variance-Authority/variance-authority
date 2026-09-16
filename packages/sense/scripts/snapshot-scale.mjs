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
import { CrossingSets } from '../dist/test-selection/crossing-sets.js';
import { blob, column, sections, NO_OWNER } from '../dist/test-selection/format-layout.js';
import { layerTestCoverage } from '../dist/test-selection/format-layer.js';
import { openTestCoverage } from '../dist/test-selection/format-view.js';
import { selectTestFilesFromView } from '../dist/test-selection/select.js';
import { coverageModule, crossingsOf } from '../dist/test-selection/instrumented-modules.js';
import { foldCrossings } from '../dist/test-selection/crossing-fold.js';
import journalFormat from '../dist/test-selection/journal-format.cjs';
import { encodeTestCoverage } from '../dist/test-selection/format.js';

const MODE = process.argv[2] ?? 'build';
const FILE = process.argv[3] ?? '/tmp/variance-scale-snapshot.bin';
const MODULES = Number(process.argv[4] ?? 200_000);
const TESTS = Number(process.argv[5] ?? 2_000);
const BLOCKS = Number(process.argv[6] ?? 8);

/** What one operation may cost. Stated here so a regression is a failure. */
const CEILING = 600 * 1_048_576;

const BARRELS = 80;
const UTILS = 500;
/** Leaves per barrel: whatever is left once the barrels, utils and roots are out. */
const PER_BARREL = Math.floor((MODULES - BARRELS - UTILS - TESTS) / BARRELS);
const COHORTS = 16;
/** How many test files a run re-ran, and how many modules it re-recorded. */
const RERAN = 20;
const RERECORDED = 10;

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const count = (n) => n.toLocaleString();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

let peak = 0;
const watch = () => {
  const { rss } = process.memoryUsage();
  if (rss > peak) peak = rss;
  return rss;
};
const verdict = () => {
  watch();
  console.log(
    `\npeak rss ${mb(peak)} against a ${mb(CEILING)} ceiling — ${peak <= CEILING ? 'fits' : 'OVER'}`,
  );
};

const stream = (seed) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
};

/**
 * The names, laid out so that generating them in order *is* sorting them.
 *
 * The dictionary a snapshot holds is in code-unit order, and the encoder gets
 * there with a `Set` and a `sort` over every string in the model. Five million
 * strings is not what this script is measuring, so the fixture picks names whose
 * group prefixes already run `d < m < n < p < s < t < v` and whose numbers are
 * zero-padded to a fixed width — and then writes the blob by walking the groups.
 */
const pad = (value, width) => String(value).padStart(width, '0');
const names = (blocks) => {
  const digest = (at) => `d/${pad(at, 8)}`;
  const modulePath = (at) => `m/${pad(at, 7)}.ts`;
  const blockName = (at) => `n/${pad(at, 7)}`;
  const blockPath = (at) => `p/${at}`;
  const sourceDigest = (at) => `s/${pad(at, 7)}`;
  const testPath = (at) => `t/${pad(at, 7)}.test.ts`;
  const instrumentation = 'v1';
  const first = {
    digest: 0,
    modulePath: blocks,
    blockName: blocks + MODULES,
    blockPath: blocks + MODULES * 2,
    sourceDigest: blocks + MODULES * 2 + BLOCKS,
    testPath: blocks + MODULES * 3 + BLOCKS,
    instrumentation: blocks + MODULES * 3 + BLOCKS + TESTS,
  };
  return { digest, modulePath, blockName, blockPath, sourceDigest, testPath, instrumentation, first };
};

if (MODE === 'build') {
  const blocks = MODULES * BLOCKS;
  const name = names(blocks);
  const total = name.first.instrumentation + 1;

  // The graph, and the closures walked out of it. Same shape as `crossings.mjs`:
  // barrels re-exporting leaves is the mechanism that makes a test reach forty
  // thousand modules without one deep import.
  const next = stream(20250915);
  const utilAt = BARRELS;
  const leafAt = BARRELS + UTILS;
  const rootAt = leafAt + BARRELS * PER_BARREL;
  if (rootAt + TESTS > MODULES) throw new Error('module count too small for this shape');

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

  const words = (TESTS + 31) >>> 5;
  const reach = new Uint32Array(MODULES * words);
  const mark = new Uint32Array(MODULES);
  const frontier = new Uint32Array(MODULES);
  let stamp = 0;
  let pairs = 0;
  const walking = Date.now();
  for (let test = 0; test < TESTS; test += 1) {
    stamp += 1;
    const word = test >>> 5;
    const bit = 1 << (test & 31);
    let wrote = 0;
    let read = 0;
    const root = rootAt + test;
    frontier[wrote++] = root;
    mark[root] = stamp;
    while (read < wrote) {
      const at = frontier[read++];
      reach[at * words + word] |= bit;
      pairs += 1;
      for (let edge = head[at]; edge < head[at + 1]; edge += 1) {
        const to = edges[edge];
        if (mark[to] !== stamp) {
          mark[to] = stamp;
          frontier[wrote++] = to;
        }
      }
    }
  }
  watch();
  console.log(
    `graph: ${count(MODULES)} modules, ${count(edges.length)} edges, ` +
      `${count(TESTS)} closures in ${secs(Date.now() - walking)}, ` +
      `${count(pairs)} module-test pairs (${count(Math.round(pairs / TESTS))} per test)`,
  );
  console.log(`  as regions: ${count(pairs * BLOCKS)} crossings`);

  // The pool, and one id per region.
  const cohort = new Uint32Array(COHORTS * words);
  const cohortStream = stream(31337);
  for (let at = 0; at < cohort.length; at += 1) cohort[at] = (cohortStream() * 4294967296) >>> 0;
  const sets = new CrossingSets(TESTS);
  const blockSet = new Uint32Array(blocks);
  const scratch = new Uint32Array(TESTS);
  const interning = Date.now();
  for (let module = 0; module < MODULES; module += 1) {
    const base = module * words;
    for (let block = 0; block < BLOCKS; block += 1) {
      const mask = block === 0 ? -1 : ((module * 2654435761 + block) >>> 0) % COHORTS;
      let held = 0;
      for (let word = 0; word < words; word += 1) {
        let bits = reach[base + word];
        if (mask >= 0) bits &= cohort[mask * words + word];
        while (bits !== 0) {
          const low = 31 - Math.clz32(bits & -bits);
          scratch[held++] = (word << 5) + low;
          bits &= bits - 1;
        }
      }
      blockSet[module * BLOCKS + block] = sets.intern(scratch.subarray(0, held));
    }
    if ((module & 0x3fff) === 0) watch();
  }
  const pool = sets.pool();
  watch();
  console.log(
    `pool: ${count(sets.size)} distinct sets for ${count(blocks)} regions in ${secs(Date.now() - interning)}, ` +
      `${mb(pool.bytes.byteLength)} of containers`,
  );

  // The dictionary, written as bytes in the order the names already sort into.
  const lengths = new Uint32Array(total);
  const write = (at, value) => { lengths[at] = value.length; };
  for (let at = 0; at < blocks; at += 1) write(name.first.digest + at, name.digest(at));
  for (let at = 0; at < MODULES; at += 1) write(name.first.modulePath + at, name.modulePath(at));
  for (let at = 0; at < MODULES; at += 1) write(name.first.blockName + at, name.blockName(at));
  for (let at = 0; at < BLOCKS; at += 1) write(name.first.blockPath + at, name.blockPath(at));
  for (let at = 0; at < MODULES; at += 1) write(name.first.sourceDigest + at, name.sourceDigest(at));
  for (let at = 0; at < TESTS; at += 1) write(name.first.testPath + at, name.testPath(at));
  write(name.first.instrumentation, name.instrumentation);
  const stringOffsets = new Uint32Array(total + 1);
  for (let at = 0; at < total; at += 1) stringOffsets[at + 1] = stringOffsets[at] + lengths[at];
  const stringBlob = Buffer.allocUnsafe(stringOffsets[total]);
  const put = (at, value) => { stringBlob.write(value, stringOffsets[at], 'latin1'); };
  for (let at = 0; at < blocks; at += 1) put(name.first.digest + at, name.digest(at));
  for (let at = 0; at < MODULES; at += 1) put(name.first.modulePath + at, name.modulePath(at));
  for (let at = 0; at < MODULES; at += 1) put(name.first.blockName + at, name.blockName(at));
  for (let at = 0; at < BLOCKS; at += 1) put(name.first.blockPath + at, name.blockPath(at));
  for (let at = 0; at < MODULES; at += 1) put(name.first.sourceDigest + at, name.sourceDigest(at));
  for (let at = 0; at < TESTS; at += 1) put(name.first.testPath + at, name.testPath(at));
  put(name.first.instrumentation, name.instrumentation);
  watch();
  console.log(`dictionary: ${count(total)} strings, ${mb(stringBlob.length)} of bytes`);

  const moduleBlocks = new Uint32Array(MODULES + 1);
  for (let at = 0; at <= MODULES; at += 1) moduleBlocks[at] = at * BLOCKS;
  const modulePaths = Uint32Array.from({ length: MODULES }, (_, at) => name.first.modulePath + at);
  const moduleSource = Uint32Array.from({ length: MODULES }, (_, at) => name.first.sourceDigest + at);
  const moduleInstrumented = new Uint8Array(MODULES).fill(1);
  const blockOrdinal = new Uint32Array(blocks);
  const blockKind = new Uint8Array(blocks);
  const blockOwner = new Uint32Array(blocks);
  const blockDigest = new Uint32Array(blocks);
  const blockName = new Uint32Array(blocks);
  const blockPath = new Uint32Array(blocks);
  const blockStart = new Uint32Array(blocks);
  const blockEnd = new Uint32Array(blocks);
  const blockSource = new Uint8Array(blocks).fill(1);
  for (let module = 0; module < MODULES; module += 1) {
    for (let ordinal = 0; ordinal < BLOCKS; ordinal += 1) {
      const at = module * BLOCKS + ordinal;
      blockOrdinal[at] = ordinal;
      blockKind[at] = ordinal === 0 ? 0 : 2;
      blockOwner[at] = ordinal === 0 ? NO_OWNER : 0;
      blockDigest[at] = name.first.digest + at;
      blockName[at] = name.first.blockName + module;
      blockPath[at] = name.first.blockPath + ordinal;
      blockStart[at] = ordinal * 3 + 1;
      blockEnd[at] = ordinal * 3 + 3;
    }
  }
  const testPaths = Uint32Array.from({ length: TESTS }, (_, at) => name.first.testPath + at);
  watch();

  // The preconditions, which both shipped producers write as one entry per
  // module the test entered — its path and its source digest. Off by default,
  // because with them the columns alone are larger than the whole rest of the
  // file, which is the point the flag exists to show.
  let testPreconditions = new Uint32Array(TESTS + 1);
  let preconditionName = new Uint32Array(0);
  let preconditionDigest = new Uint32Array(0);
  if (process.env.PRECONDITIONS === '1') {
    const counted = Date.now();
    for (let module = 0; module < MODULES; module += 1) {
      const base = module * words;
      for (let word = 0; word < words; word += 1) {
        let bits = reach[base + word];
        while (bits !== 0) {
          const low = 31 - Math.clz32(bits & -bits);
          testPreconditions[(word << 5) + low + 1] += 1;
          bits &= bits - 1;
        }
      }
    }
    for (let test = 0; test < TESTS; test += 1) testPreconditions[test + 1] += testPreconditions[test];
    const entries = testPreconditions[TESTS];
    watch();
    preconditionName = new Uint32Array(entries);
    preconditionDigest = new Uint32Array(entries);
    watch();
    const at = testPreconditions.slice(0, TESTS);
    for (let module = 0; module < MODULES; module += 1) {
      const base = module * words;
      for (let word = 0; word < words; word += 1) {
        let bits = reach[base + word];
        while (bits !== 0) {
          const low = 31 - Math.clz32(bits & -bits);
          const test = (word << 5) + low;
          preconditionName[at[test]] = name.first.modulePath + module;
          preconditionDigest[at[test]] = name.first.sourceDigest + module;
          at[test] += 1;
          bits &= bits - 1;
        }
      }
      if ((module & 0x3fff) === 0) watch();
    }
    watch();
    console.log(
      `preconditions: ${count(entries)} entries ` +
        `(${count(Math.round(entries / TESTS))} per test), ` +
        `${mb(entries * 8)} of columns in ${secs(Date.now() - counted)}`,
    );
  }

  const written = Date.now();
  const bytes = sections({
    'strings.blob': blob(stringBlob, stringOffsets),
    'strings.off': column(stringOffsets),
    'snapshot.instrumentation': column(Uint32Array.of(name.first.instrumentation)),
    'snapshot.commit': column(new Uint32Array(0)),
    'tests.path': column(testPaths),
    'tests.complete': column(new Uint8Array(TESTS).fill(1)),
    'tests.preconditions': column(testPreconditions),
    'preconditions.name': column(preconditionName),
    'preconditions.digest': column(preconditionDigest),
    'modules.path': column(modulePaths),
    'modules.source': column(moduleSource),
    'modules.instrumented': column(moduleInstrumented),
    'modules.blocks': column(moduleBlocks),
    'blocks.ordinal': column(blockOrdinal),
    'blocks.kind': column(blockKind),
    'blocks.owner': column(blockOwner),
    'blocks.digest': column(blockDigest),
    'blocks.name': column(blockName),
    'blocks.path': column(blockPath),
    'blocks.start': column(blockStart),
    'blocks.end': column(blockEnd),
    'blocks.source': column(blockSource),
    'blocks.set': column(blockSet),
    'sets.blob': blob(pool.bytes, pool.offsets),
    'sets.off': column(pool.offsets),
    'blocks.loaded': column(new Uint32Array(blocks + 1)),
    'loaded.test': column(new Uint32Array(0)),
  });
  watch();
  writeFileSync(FILE, bytes);
  console.log(`written: ${mb(bytes.length)} to ${FILE} in ${secs(Date.now() - written)}`);
  verdict();
}

/** The ten modules a run re-recorded, as the logical model hands them over. */
function rerecorded(blocks) {
  const name = names(blocks);
  const ran = Array.from({ length: RERAN }, (_, at) => name.testPath(at * 97 % TESTS)).sort();
  const first = Math.floor(MODULES / 2);
  return {
    version: 3,
    instrumentation: name.instrumentation,
    tests: ran.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: Array.from({ length: RERECORDED }, (_, step) => {
      const module = first + step;
      return {
        file: name.modulePath(module),
        sourceDigest: name.sourceDigest(module),
        instrumented: true,
        blocks: Array.from({ length: BLOCKS }, (_, ordinal) => ({
          ordinal,
          kind: ordinal === 0 ? 'module' : 'branch',
          ...(ordinal === 0 ? {} : { owner: 0 }),
          digest: name.digest(module * BLOCKS + ordinal),
          name: name.blockName(module),
          path: name.blockPath(ordinal),
          startLine: ordinal * 3 + 1,
          endLine: ordinal * 3 + 3,
          source: true,
          testFiles: ran.filter((_, at) => (at + ordinal) % 3 === 0),
        })),
      };
    }),
  };
}

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

/** The import graph and its closures, which the journal arms need. */
function barrelGraph() {
  const next = stream(20250915);
  const utilAt = BARRELS;
  const leafAt = BARRELS + UTILS;
  const rootAt = leafAt + BARRELS * PER_BARREL;
  if (rootAt + TESTS > MODULES) throw new Error('module count too small for this shape');
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
  const mark = new Uint32Array(MODULES);
  const frontier = new Uint32Array(MODULES);
  let stamp = 0;
  /** Every module one test reached, by row, in the order it reached them. */
  return (test) => {
    stamp += 1;
    let wrote = 0;
    let read = 0;
    frontier[wrote++] = rootAt + test;
    mark[rootAt + test] = stamp;
    while (read < wrote) {
      const at = frontier[read++];
      for (let edge = head[at]; edge < head[at + 1]; edge += 1) {
        const to = edges[edge];
        if (mark[to] !== stamp) {
          mark[to] = stamp;
          frontier[wrote++] = to;
        }
      }
    }
    return frontier.subarray(0, wrote);
  };
}

/** Which test counts the sweeping arms report at, smallest first. */
const sweep = () => {
  if (process.env.WHOLE === '1') return [TESTS];
  const shares = [];
  for (let share = TESTS; share >= 16; share = Math.floor(share / 4)) shares.unshift(share);
  return shares;
};

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
