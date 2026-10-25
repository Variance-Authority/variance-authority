import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { moduleId } from './captured-modules.js';
import { decodeTestCoverage } from './index.js';
import SelectionReporter from './jest-reporter.js';
import { RUN_DIRECTORY_VARIABLE } from './jest.js';
import journalFormat from './journal-format.cjs';
import { withTestSelection } from './rstest.js';
import probeAfter from './rstest-after-loader.js';
import instrumentModule from './rstest-loader.js';
import { runOf } from './selection-run.js';

const { encodeJournal } = journalFormat;

/**
 * `-t` reports every case it does not name as skipped, which is also how a
 * case the file skips by its own text reads. Under a name filter a skipped case
 * may be one an edit changed and nothing ran, so its file is not recorded
 * whole. Vitest reads the filter off its runner (`runnerSkipped`); these are
 * the runners that hand it to the seam another way.
 */

const made: string[] = [];
let cache: string | undefined;

afterEach(async () => {
  delete process.env[RUN_DIRECTORY_VARIABLE];
  if (cache === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  for (const directory of made.splice(0)) await rm(directory, { recursive: true, force: true });
});

const MODULE = 'module.exports = 1;\n';

/** A project with two test files, `a` and `b`, each entering one module. */
async function project(): Promise<{ root: string; coverageFile: string; journals: ReadonlyMap<string, Buffer> }> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-name-filter-'));
  made.push(root);
  await mkdir(resolve(root, 'test'), { recursive: true });
  await mkdir(resolve(root, 'src'), { recursive: true });
  await writeFile(resolve(root, 'src/one.js'), MODULE);
  const journals = new Map<string, Buffer>();
  for (const name of ['a', 'b']) {
    const testFile = resolve(root, `test/${name}.case.js`);
    await writeFile(testFile, `// ${name}\n`);
    journals.set(name, encodeJournal(testFile, new Map([[moduleId('src/one.js', MODULE), new Uint32Array([1])]])));
  }
  cache = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = resolve(root, 'variance-cache');
  return { root, coverageFile: resolve(root, 'coverage.bin'), journals };
}

async function landJournals(directory: string, journals: ReadonlyMap<string, Buffer>): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const [name, journal] of journals) await writeFile(resolve(directory, `${name}.va`), journal);
}

const completeness = async (coverageFile: string) =>
  decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => [test.file, test.complete]);

describe('a Jest run with a name filter', () => {
  it('records a file with a pending case incomplete, and a file that ran every case whole', async () => {
    const { root, coverageFile, journals } = await project();
    const reporter = new SelectionReporter({ testNamePattern: 'adds' }, { root, coverageFile, preconditions: [] });
    reporter.onRunStart();
    await landJournals(process.env[RUN_DIRECTORY_VARIABLE]!, journals);

    await reporter.onRunComplete(new Set([{ config: { cacheDirectory: resolve(root, 'cache'), id: 'project' } }]), {
      testResults: [
        { testFilePath: resolve(root, 'test/a.case.js'), skipped: false, testResults: [{ status: 'passed' }, { status: 'pending' }] },
        { testFilePath: resolve(root, 'test/b.case.js'), skipped: false, testResults: [{ status: 'passed' }] },
      ],
    });

    expect(await completeness(coverageFile)).toEqual([['test/a.case.js', false], ['test/b.case.js', true]]);
  });
});

describe.each([
  ['`-t`, merged into the configuration before the plugin is set up', 'adds', undefined],
  ["watch mode's `t`, set on the configuration between cycles", undefined, 'adds'],
])('an Rstest run with a name filter from %s', (_from, atSetup, atCycle) => {
  it('records a file with a skipped case incomplete, and a file that ran every case whole', async () => {
    const { root, coverageFile, journals } = await project();
    const config = withTestSelection({ root }, { coverageFile });
    const rstest: { testNamePattern?: string } = { testNamePattern: atSetup };
    const plugin = (config.plugins as ReadonlyArray<{ setup(api: object): void }>).at(-1)!;
    plugin.setup({ useExposed: () => ({ getRstestConfig: () => ({ ...rstest }) }) });
    if (atCycle !== undefined) rstest.testNamePattern = atCycle;
    const reporter = (config.reporters as ReadonlyArray<{
      onTestRunStart(): unknown;
      onTestRunEnd(payload: object): Promise<unknown> | unknown;
    }>).at(-1)!;
    // The bundle loads the module both files enter, through both loaders.
    const resourcePath = resolve(root, 'src/one.js');
    let handed: string | undefined;
    let map: unknown;
    instrumentModule.call({ resourcePath, getOptions: () => ({ coverageFile }), callback: (_error, text, given) => {
      handed = text;
      map = given;
    } }, MODULE);
    probeAfter.call({ resourcePath, getOptions: () => ({ coverageFile }), callback: () => undefined }, handed!, map as never);
    await landJournals(runOf(coverageFile)!.runDirectory, journals);

    reporter.onTestRunStart();
    await reporter.onTestRunEnd({
      results: [
        { testPath: resolve(root, 'test/a.case.js'), status: 'pass', results: [{ status: 'pass' }, { status: 'skip' }] },
        { testPath: resolve(root, 'test/b.case.js'), status: 'pass', results: [{ status: 'pass' }] },
      ],
    });

    expect(await completeness(coverageFile)).toEqual([['test/a.case.js', false], ['test/b.case.js', true]]);
  });
});
