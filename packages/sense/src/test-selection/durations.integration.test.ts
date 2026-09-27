import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';

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
 * seam for each file. The note is the runner's figure, read from the same hook
 * the seam reads it from, so the assertion compares the record with what the
 * runner said and not with a clock of the test's own.
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

reporters[reporters.length - 1] = {
  onFinished: (files, ...rest) => {
    for (const file of files) {
      appendFileSync(
        ${JSON.stringify(log)},
        JSON.stringify({ file: file.filepath, duration: file.result?.duration }) + '\\n',
      );
    }
    return seam.onFinished(files, ...rest);
  },
  onTestRunEnd: (...args) => seam.onTestRunEnd(...args),
};

export default configured;
`;

describe('the duration a recording keeps for each test file', () => {
  it('is the one vitest reported for that file, to the whole millisecond', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-durations-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    const log = resolve(directory, 'durations.jsonl');
    const config = resolve(directory, 'vitest.probe.config.mts');
    await writeFile(config, probe(coverageFile, log), 'utf8');

    await execute(process.execPath, [vitest, 'run', '--config', config], {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory },
    });

    const reported = new Map(
      (await readFile(log, 'utf8'))
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as { file: string; duration?: number })
        .map((entry) => [at(relative(fixture, entry.file)), entry.duration]),
    );
    const recorded = decodeTestCoverage(await readFile(coverageFile)).tests;

    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.map((test) => test.file).sort()).toEqual([...reported.keys()].sort());
    for (const test of recorded) {
      const duration = reported.get(test.file);
      expect(typeof duration).toBe('number');
      expect(test.duration).toBe(Math.round(duration!));
    }
  }, 20_000);
});
