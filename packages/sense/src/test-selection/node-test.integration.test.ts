import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { selectTestFiles } from './index.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/node-test');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** Runs the fixture's own `run.mjs`, which is the whole wiring a `node:test` project writes. */
async function record(asked: Readonly<Record<string, string>> = {}): Promise<{ coverageFile: string; stderr: string }> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-node-test-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  const { VARIANCE_AUTHORITY_RECORDING: _open, ...environment } = process.env;
  const { stderr } = await execute(process.execPath, [resolve(fixture, 'run.mjs')], {
    cwd: fixture,
    env: { ...environment, ...asked, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  return { coverageFile, stderr };
}

describe('node:test, through @variance-authority/sense/node-test', () => {
  it('records each case under its declaration path, in ES modules and CommonJS test files', async () => {
    const { coverageFile } = await record();

    const names = decodeExecutionIndex(await readFile(coverageFile)).tests.map((test) => test.id);
    expect(names).toEqual(expect.arrayContaining([
      `${at('test/alpha.test.mjs')} > label > takes the alpha path`,
      `${at('test/beta.test.cjs')} > does not touch the label`,
    ]));
  });

  it('selects only the file that reached a changed line', async () => {
    const { coverageFile } = await record();
    const label = await readFile(resolve(fixture, 'src/label.cjs'), 'utf8');
    const line = label.slice(0, label.indexOf("return 'took A';")).split('\n').length;

    await expect(selectTestFiles(coverageFile, `--- a/${at('src/label.cjs')}\n+++ b/${at('src/label.cjs')}\n@@ -${line},1 +${line},1 @@\n-    return 'took A';\n+    return 'went A';`))
      .resolves.toEqual([at('test/alpha.test.mjs')]);
  });

  it('leaves out the files a selection skips, and counts them against the files it was given', async () => {
    const { coverageFile, stderr } = await record({ FIXTURE_SKIP: JSON.stringify([at('test/beta.test.cjs')]) });

    const names = decodeExecutionIndex(await readFile(coverageFile)).tests.map((test) => test.id);
    expect(names).toEqual([`${at('test/alpha.test.mjs')} > label > takes the alpha path`]);
    expect(stderr).toContain('variance-authority: selected 1 of 2');
  });
});
