/**
 * The snapshot the benchmarks in this directory measure, built once.
 *
 * Two scripts ask different questions of the same index — `coverage.mjs` what
 * it costs in bytes and milliseconds, `native.mjs` which of those milliseconds
 * are already spent in native code — and a corpus written twice is two
 * repositories that drift into disagreeing about the answer.
 *
 * The modules are this repository's own, instrumented for real: the regions per
 * module, the line spans and the digests are the ones this source produces, and
 * a generated module would answer a question nobody asked. Only the scale and
 * the crossings are synthesized, and both are drawn from the shape a real
 * snapshot has — most of a test file's neighbours in path order, a few reaching
 * anywhere, one module in twenty-five entered by everything.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digestString } from '@variance-authority/core/format';
import { INSTRUMENTATION_ID, instrument } from '../dist/instrument/index.js';
import { coverageBlock } from '../dist/test-selection/instrumented-modules.js';
import { sourceLines } from '../dist/test-selection/source-lines.js';

/** Tests per module, from this repository's own snapshot: 343 test files over 852 modules. */
export const TEST_SHARE = 343 / 852;
/** Tests entering one module, tuned so the crossings per region land near the measured 13.2. */
const ENTERING = 13;
/** How far along the sorted test files a module's own suites sit. */
const WINDOW = 64;

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Every product file in the repository, transformed and instrumented.
 *
 * Types are stripped the way a bundler strips them before the probes land: the
 * transform runs on JavaScript, and handing it TypeScript would measure the
 * refusal path instead of the snapshot.
 */
export async function instrumentedSources(root = ROOT) {
  const { transformSync } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')));
  const built = [];
  for (const file of tracked(root)) {
    let code;
    try {
      code = transformSync(readFileSync(join(root, file), 'utf8'), {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
      }).code;
    } catch {
      continue;
    }
    const done = instrument(code, file, built.length);
    if (done === undefined) continue;
    const lineOf = sourceLines(code, undefined, file);
    built.push({
      file,
      sourceDigest: digestString(code),
      instrumented: true,
      blocks: done.blocks.map((block) => coverageBlock(code, block, lineOf)),
    });
  }
  return built;
}

/** The product source this repository tracks, without its tests or its declarations. */
export function tracked(root = ROOT) {
  return execFileSync('git', ['ls-files', 'packages/*/src/**/*.ts', 'packages/*/src/*.ts'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'));
}

/**
 * A snapshot of `count` modules, from sources `instrumentedSources` built.
 *
 * Returns the coverage and the test-path function beside it, because a caller
 * synthesizing a later run has to name the same test files this one did.
 */
export function corpusOf(count, built) {
  const tests = Math.max(2, Math.round(count * TEST_SHARE));
  // Padded, so a test file's rank in path order is its index here: the column
  // holds crossings as ordinals in that order, and a name that sorted differently
  // would model a locality the snapshot does not have.
  const testPath = (index) => `packages/generated/src/suite-${String(index).padStart(9, '0')}.test.ts`;

  /** Deterministic and irregular: a generator with a stride would flatter any delta codec. */
  const draws = (seed, drawCount, limit) => {
    let state = (seed * 2_654_435_761) >>> 0 || 1;
    const next = () => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5;
      state >>>= 0;
      return state;
    };
    const picked = new Set();
    // Most of a module's tests sit near it in path order, a few are anywhere: a
    // suite reaches its neighbours, and a handful of end-to-end files reach the
    // whole repository. Both are why the crossings of one region cluster.
    const near = Math.round((seed * tests) / Math.max(1, count));
    for (let drawn = 0; drawn < drawCount && picked.size < limit; drawn += 1) {
      const at =
        drawn % 5 === 4
          ? next() % tests
          : (near + (next() % WINDOW) - Math.floor(WINDOW / 2) + tests * 2) % tests;
      picked.add(at);
    }
    return [...picked].sort((left, right) => left - right);
  };

  /**
   * One synthesized module: this repository's regions under a distinct path, with
   * the tests that enter them drawn from a window around the module's own index.
   */
  const moduleAt = (index) => {
    const source = built[index % built.length];
    // Distinct text per module, so the digests are distinct too. Two hundred
    // thousand files are two hundred thousand different texts, and a repeated
    // digest would be interned once and answer a question about a repository
    // nobody has.
    const salt = index.toString(16).padStart(8, '0');
    const distinct = (digest) => digest.slice(0, 3) + salt + digest.slice(3 + salt.length);
    // One module in twenty-five is shared, and what is shared is entered by
    // everything: a snapshot whose regions all carry the same number of crossings
    // has no tail, and the tail is what a column has to survive.
    const entering = index % 25 === 0 ? ENTERING * 5 : ENTERING;
    const paths = draws(index + 1, entering, tests).map(testPath).sort();
    return {
      file: `packages/generated-${index}/src/${source.file}`,
      sourceDigest: distinct(source.sourceDigest),
      instrumented: true,
      blocks: source.blocks.map((block) => ({
        ...block,
        digest: distinct(block.digest),
        // A region deeper in a module is entered by fewer of the tests that
        // entered it at all; the root is entered by every one of them.
        testFiles: paths.slice(0, paths.length - (block.ordinal % 4)),
      })),
    };
  };

  const modules = [];
  for (let index = 0; index < count; index += 1) modules.push(moduleAt(index));
  const testFiles = [];
  for (let index = 0; index < tests; index += 1) {
    testFiles.push({ file: testPath(index), complete: true, preconditions: [] });
  }
  return {
    coverage: {
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      commit: 'a'.repeat(40),
      tests: testFiles,
      modules,
    },
    testPath,
  };
}
