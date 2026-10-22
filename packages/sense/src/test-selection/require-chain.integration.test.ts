import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { coveringTests } from './reverse.js';

// Vitest runs a test's imports along two routes: its module runner, where Vite
// transforms each module, and Node itself. Every `require` a CommonJS module
// makes takes the second: Vite hands `src/index.cjs` a `require` of Node's, so
// `add.cjs` and `twice.cjs` reach no transform. `include` takes all three, and
// all three are recorded, as the Jest seam records a `require` chain.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/require-chain-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function record() {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-require-chain-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  return decodeExecutionIndex(await readFile(coverageFile));
}

describe('a CommonJS module that requires others under Vitest', () => {
  it('records every file of the chain, and the case that entered each function', async () => {
    const index = await record();
    const readers = (file: string, line: number): readonly string[] =>
      coveringTests(index, { file: at(file), line }).map((test) => test.name).sort();

    expect(index.modules.map((module) => module.file).sort()).toEqual(
      ['src/add.cjs', 'src/index.cjs', 'src/twice.cjs'].map(at),
    );
    // `return a + b;`, which both cases reach; `return add(n, n);`, which one does.
    expect(readers('src/add.cjs', 2)).toEqual(['adds', 'doubles']);
    expect(readers('src/twice.cjs', 4)).toEqual(['doubles']);
  }, 30_000);
});
