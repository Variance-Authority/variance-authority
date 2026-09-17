/**
 * The repository this script pretends to be, and the apparatus for watching it.
 *
 * Shared by every arm of {@link file://./snapshot-scale.mjs}, and separate from
 * them because the arms measure and this decides what is measured. The shape is
 * one place: eighty barrels over half a million leaves, five hundred utilities
 * every leaf reaches, and one root per test file — which is what makes a test's
 * closure forty thousand modules without any of it being written down.
 *
 * Nothing here imports the shipped code. A fixture that used the encoder would
 * be measuring the encoder.
 */

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

export {
  MODE,
  FILE,
  MODULES,
  TESTS,
  BLOCKS,
  CEILING,
  BARRELS,
  UTILS,
  PER_BARREL,
  COHORTS,
  RERAN,
  RERECORDED,
  mb,
  count,
  secs,
  watch,
  verdict,
  stream,
  pad,
  names,
  rerecorded,
  barrelGraph,
  sweep,
};
