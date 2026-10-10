import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { caseIndexOf } from './case-record.js';
import { lineAt, linesOf } from './case-lines.js';
import { decodeExecutionIndex } from './execution-format.js';
import { openSetColumns } from './execution-set-format.js';

/**
 * `test/branch.case.ts` holds one case per branch of `src/decide.ts`, each
 * calling it from its own line. Under the seam's transform each case records,
 * for the branch it took, the line of the statement that reached it.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/cases-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the test line that reached each region, under Vitest', () => {
  it('says which line of each case reached the branch it took', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-cadence-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
    });
    const cases = await caseIndexOf(coverageFile);
    if (cases === undefined) throw new Error('the run wrote no execution index');
    const index = decodeExecutionIndex(cases);

    const table = openSetColumns(cases)!.testLines;
    const module = index.modules.findIndex((entry) => entry.file === named('src/decide.ts'));
    const reaching = (name: string, line: number) => {
      const test = index.tests.findIndex((entry) => entry.name === name);
      const block = index.modules[module]!.blocks.findLastIndex((entry) => entry.startLine <= line && line <= entry.endLine);
      return lineAt(linesOf(table, test)!, module, block);
    };
    expect(reaching('decide > takes the alpha branch', 3)).toEqual({ line: 6, ambient: false });
    expect(reaching('decide > takes the gamma branch', 6)).toEqual({ line: 10, ambient: false });
    expect(reaching('decide > falls through to B', 8)).toEqual({ line: 14, ambient: false });
  }, 20_000);
});
