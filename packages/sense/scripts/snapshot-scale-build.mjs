/**
 * Write the fixture snapshot, column by column.
 *
 * The one arm of {@link file://./snapshot-scale.mjs} that does not go through
 * the shipped encoder, and the reason is in that file's header: the encoder
 * takes the logical model, and the logical model of this repository is five and
 * a half gigabytes of strings before the encoder is called. Everything here
 * writes the columns the encoder would have written, and `layer` proves the
 * result is a file the shipped reader accepts.
 *
 * It is its own module because it is half the script and it is called once.
 */

import { writeFileSync, statSync } from 'node:fs';
import { CrossingSets } from '../dist/test-selection/crossing-sets.js';
import { blob, column, sections, NO_OWNER } from '../dist/test-selection/format-layout.js';
import {
  BARRELS,
  BLOCKS,
  COHORTS,
  FILE,
  MODULES,
  PER_BARREL,
  TESTS,
  UTILS,
  count,
  mb,
  names,
  secs,
  stream,
  verdict,
  watch,
} from './snapshot-scale-fixture.mjs';

/** Write the snapshot the other arms read. */
export function buildSnapshot() {
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
