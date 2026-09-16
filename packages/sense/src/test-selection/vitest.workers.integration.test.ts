/**
 * One run, several worker processes, one snapshot — and no fan-in.
 *
 * A suite split across machines produces a snapshot per shard and is folded by
 * `foldTestCoverage`. A suite split across *workers* is not that: it is one
 * runner process with one coverage file, and each test file writes its own
 * journal into the run directory as it finishes. What stitches them is the
 * reporter, in the process that is already there.
 *
 * The distinction is invisible in a single-worker run, which is what makes it
 * worth a test of its own: nothing here would fail if crossings were being
 * accumulated in a module-level variable that each worker has its own copy of —
 * except that every file but the last would be missing from the answer.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { selectTestFiles } from './index.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const lineOf = (source: string, text: string): number =>
  source.slice(0, source.indexOf(text)).split('\n').length;

describe('a local run spread across workers', () => {
  it('writes one snapshot holding every worker file, and needs nothing folded', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-workers-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    // Forks rather than threads, and a floor as well as a ceiling on the pool:
    // a worker per file is the arrangement where a per-process accumulator
    // would answer for one file and forget the rest.
    await execute(
      process.execPath,
      [
        vitest,
        'run',
        '--config',
        resolve(fixture, 'vitest.config.ts'),
        '--pool=forks',
        '--minWorkers=3',
        '--maxWorkers=3',
      ],
      {
        cwd: fixture,
        env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory },
      },
    );

    const coverage = decodeTestCoverage(await readFile(coverageFile));

    // Each file's own verdict about itself survives the crossing, which is the
    // part a lost journal would take with it: alpha skips a test, so it is an
    // upper bound and the snapshot does not speak wholly for it; the three that
    // ran everything do.
    expect(coverage.tests.map((test) => [test.file, test.complete]).sort()).toEqual([
      ['test/alpha.case.ts', false],
      ['test/beta.case.ts', true],
      ['test/delta.case.ts', true],
      ['test/gamma.case.ts', true],
    ]);

    // The crossings are per file, not per worker: each branch still names the
    // one file that entered it, which is the property a lost journal destroys
    // quietly rather than loudly.
    const source = await readFile(resolve(fixture, 'src/decide.ts'), 'utf8');
    const change = (text: string, to: string): string => {
      const line = lineOf(source, text);
      return `--- a/src/decide.ts\n+++ b/src/decide.ts\n@@ -${line},1 +${line},1 @@\n-    ${text}\n+    ${to}`;
    };

    await expect(selectTestFiles(coverageFile, change("return 'A';", "return 'Alpha';"))).resolves.toEqual([
      'test/alpha.case.ts',
    ]);
    await expect(selectTestFiles(coverageFile, change("return 'G';", "return 'Gamma';"))).resolves.toEqual([
      'test/gamma.case.ts',
    ]);
  }, 120_000);
});
