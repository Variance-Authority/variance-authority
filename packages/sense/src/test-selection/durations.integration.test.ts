import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { countScope, scopeOfCases, scopeOfSnapshot } from '../recorded-scope.js';
import { testsReachingFromView } from './at-source.js';
import { askCoverageFile } from './coverage-file.js';
import { decodeExecutionIndex } from './execution-format.js';
import { decodeTestCoverage } from './format.js';
import { coveringTestsInFile } from './reverse.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
// By path: the configuration is written into a temporary directory, where
// nothing resolves `@variance-authority/sense`.
const seamModule = resolve(repository, 'packages/sense/dist/test-selection/vitest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * The fixture's own suite, with a note of the duration the runner handed the
 * seam for each file and each case. The note is the runner's figure, read from
 * the same hook the seam reads it from, so the assertion compares the record
 * with what the runner said and not with a clock of the test's own.
 */
const probe = (coverageFile: string, log: string) => `
import { appendFileSync } from 'node:fs';
import { withTestSelection } from ${JSON.stringify(seamModule)};

const configured = withTestSelection(
  {
    root: ${JSON.stringify(fixture)},
    test: { include: ['test/*.case.ts'], environment: 'node', setupFiles: ['test/setup.ts'] },
  },
  {
    root: ${JSON.stringify(fixture)},
    coverageFile: ${JSON.stringify(coverageFile)},
    include: (file) => file.startsWith(${JSON.stringify(resolve(fixture, 'src'))}),
  },
);

const reporters = configured.test.reporters;
const seam = reporters[reporters.length - 1];

const cases = (task, names) => (task.tasks ?? []).flatMap((child) => child.tasks === undefined
  ? [{ name: [...names, child.name].join(' > '), duration: child.result?.duration }]
  : cases(child, [...names, child.name]));

reporters[reporters.length - 1] = {
  onFinished: (files, ...rest) => {
    for (const file of files) {
      appendFileSync(
        ${JSON.stringify(log)},
        JSON.stringify({ file: file.filepath, duration: file.result?.duration, cases: cases(file, []) }) + '\\n',
      );
    }
    return seam.onFinished(files, ...rest);
  },
  onTestRunEnd: (...args) => seam.onTestRunEnd(...args),
};

export default configured;
`;

interface Reported {
  readonly file: string;
  readonly duration?: number;
  readonly cases: readonly { readonly name: string; readonly duration?: number }[];
}

/** Run the fixture's suite through the seam once, and read what the runner said beside what was recorded. */
async function recorded(): Promise<{ coverageFile: string; reported: Map<string, Reported> }> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-durations-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  const log = resolve(directory, 'durations.jsonl');
  const config = resolve(directory, 'vitest.probe.config.mts');
  await writeFile(config, probe(coverageFile, log), 'utf8');

  await execute(process.execPath, [vitest, 'run', '--config', config], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });

  const reported = new Map(
    (await readFile(log, 'utf8'))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Reported)
      .map((entry) => [at(relative(fixture, entry.file)), entry]),
  );
  return { coverageFile, reported };
}

describe('the duration a recording keeps', () => {
  it('for each test file and each case, is the one vitest reported for it, to the whole millisecond', async () => {
    const { coverageFile, reported } = await recorded();

    const files = decodeTestCoverage(await readFile(coverageFile)).tests;
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((test) => test.file).sort()).toEqual([...reported.keys()].sort());
    for (const test of files) {
      const duration = reported.get(test.file)?.duration;
      expect(typeof duration).toBe('number');
      expect(test.duration).toBe(Math.round(duration!));
    }

    const cases = decodeExecutionIndex(await readFile(coverageFile)).tests;
    expect(cases.length).toBeGreaterThan(0);
    for (const test of cases) {
      const said = reported.get(test.file)?.cases.filter((held) => held.name === test.name) ?? [];
      expect(said, `${test.file} > ${test.name}`).toHaveLength(1);
      expect(typeof said[0]!.duration).toBe('number');
      expect(test.duration, `${test.file} > ${test.name}`).toBe(Math.round(said[0]!.duration!));
    }
  }, 20_000);

  it('is scoped by the readers `variance covering` asks, and the two records agree on who entered a module', async () => {
    const { coverageFile } = await recorded();
    const index = decodeExecutionIndex(await readFile(coverageFile));
    expect(index.modules.length).toBeGreaterThan(0);

    for (const module of index.modules) {
      const scope = { to: [module.file] };
      const cases = new Set<number>();
      countScope(scopeOfCases(index, scope), scope, index.tests.length, (test) => cases.add(test));
      const covering = coveringTestsInFile(index, module.file).flatMap((range) => range.tests.map((test) => test.id));
      expect([...cases].map((test) => index.tests[test]!.id).sort()).toEqual([...new Set(covering)].sort());

      const files = askCoverageFile(coverageFile, (view) => {
        const entered: string[] = [];
        const paths = view.testPath.all();
        countScope(scopeOfSnapshot(view, scope), scope, paths.length, (test) => entered.push(view.string(paths[test]!)));
        return { entered, reaching: testsReachingFromView(view, { file: module.file }).tests.map((test) => test.test) };
      });
      expect(files.entered.sort()).toEqual([...new Set(files.reaching)].sort());
      // A case that entered the module sits in a file that did.
      for (const test of cases) expect(files.entered).toContain(index.tests[test]!.file);
    }
  }, 20_000);
});
