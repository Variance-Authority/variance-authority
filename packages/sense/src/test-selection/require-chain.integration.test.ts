import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { coveringTests } from './reverse.js';

// Vitest runs a test's imports along two routes: its module runner, where Vite
// transforms each module, and Node itself. Every `require` a CommonJS module
// makes takes the second: Vite hands `src/index.cjs` a `require` of Node's, so
// `add.cjs`, `twice.cjs` and the `half` dependency reach no transform.
// `include` takes all four — `half` too, which the default would not — and all
// four are recorded, as the Jest seam records a `require` chain.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/require-chain-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const dependency = resolve(fixture, 'node_modules/half');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

// `node_modules` is ignored, so the dependency is written for the run.
beforeAll(async () => {
  await mkdir(dependency, { recursive: true });
  await writeFile(resolve(dependency, 'package.json'), '{ "name": "half", "main": "index.cjs" }\n');
  await writeFile(resolve(dependency, 'index.cjs'), 'function half(n) {\n  return n / 2;\n}\nmodule.exports = { half };\n');
  return () => rm(resolve(fixture, 'node_modules'), { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function record(pool: string) {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-require-chain-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: {
      ...process.env,
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      VARIANCE_AUTHORITY_CACHE: directory,
      REQUIRE_CHAIN_POOL: pool,
    },
  });
  return decodeExecutionIndex(await readFile(coverageFile));
}

describe('a CommonJS module that requires others under Vitest', () => {
  it.each(['forks', 'threads'])('records every file of the chain, and the case that entered each function, in %s', async (pool) => {
    const index = await record(pool);
    const readers = (file: string, line: number): readonly string[] =>
      coveringTests(index, { file: at(file), line }).map((test) => test.name).sort();

    expect(index.modules.map((module) => module.file).sort()).toEqual(
      ['node_modules/half/index.cjs', 'src/add.cjs', 'src/index.cjs', 'src/twice.cjs'].map(at),
    );
    // `return a + b;`, which both cases reach; `return add(n, n);`, which one does.
    expect(readers('src/add.cjs', 2)).toEqual(['adds', 'doubles']);
    expect(readers('src/twice.cjs', 4)).toEqual(['doubles']);
    expect(readers('node_modules/half/index.cjs', 2)).toEqual(['halves']);
  }, 30_000);

  // FIXME: `vmThreads` and `vmForks` evaluate test files in a context of their
  // own, where Node's loads report to no collector, so the chain goes unrecorded.
  it.todo('records the chain in vmThreads and vmForks — needs Node\'s loads in that context to report to the collector the test file reports to');
});
