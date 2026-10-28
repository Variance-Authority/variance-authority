import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relationsOfFiles, type Relations } from '@variance-authority/core/relate';
import { scanRelations } from '../scan.js';
import { narrowByExecution } from './index.js';

/**
 * A file that declares `/// <depends path>` on a module reads the module's
 * text, not one of its names, so a change to any value in it reaches the file.
 *
 * `rate.ts` declares `RATE`. `charge.test.js` imports `charge`, which reads it.
 * `source.test.js` imports nothing from `rate.ts`: it reads the file from disk
 * and names it with a `/// <depends>` directive. `audit.ts` does the same with
 * `fee.ts`, and is a source file with a row of its own, which `audit.test.js`
 * loads.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/depends-reader-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const tests = (...names: string[]): string[] => names.map((name) => named(`test/${name}.test.js`));
const rate = named('src/rate.ts');
const fee = named('src/fee.ts');

let directory: string;
let coverageFile: string;
let relations: Relations;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-depends-reader-'));
  coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  relations = relationsOfFiles(await scanRelations({ root: repository, dirs: [relative(repository, fixture)] }));
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** The recorded text is the file on disk: the recording was made from it a moment ago. */
const sourceAt = (file: string): string | undefined => {
  const path = resolve(repository, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

/** The diff git writes for this edit, under the file's own name. */
async function edit(file: string, from: string, to: string): Promise<string> {
  const before = readFileSync(resolve(repository, file), 'utf8');
  expect(before).toContain(from);
  const after = resolve(directory, 'after.ts');
  await writeFile(after, before.replace(from, to));
  const diff = await execute('git', ['diff', '--no-index', '--', resolve(repository, file), after]).then(
    () => '',
    (error: { stdout: string }) => error.stdout,
  );
  return diff
    .split('\n')
    .map((line) => (line.startsWith('--- ') ? `--- a/${file}` : line.startsWith('+++ ') ? `+++ b/${file}` : line))
    .join('\n');
}

describe('a file that declares it reads a module', () => {
  it('is reached by a change to any value the module declares', async () => {
    const narrowing = await narrowByExecution(coverageFile, await edit(rate, 'RATE = 3', 'RATE = 4'), {
      relations,
      sourceAt,
    });
    expect(narrowing.entered).toEqual(tests('charge', 'source'));
  });

  it('charges the tests that loaded its row, by the row, when it has one', async () => {
    const narrowing = await narrowByExecution(coverageFile, await edit(fee, 'FEE = 2', 'FEE = 3'), {
      relations,
      sourceAt,
    });
    const audit = named('src/audit.ts');
    expect(narrowing.entered).toEqual(tests('audit', 'fee'));
    expect(narrowing.because[0]!.via).toEqual([
      expect.objectContaining({ reader: audit, region: expect.objectContaining({ file: audit, path: 'module' }) }),
    ]);
  });
});
