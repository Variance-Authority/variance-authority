import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { withTestSelection } from './vitest.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
// By path rather than by package name: the configuration below is written into
// a temporary directory, where nothing resolves `@variance-authority/sense`.
// It is the same file the manifest's `exports` points that name at.
const seamModule = resolve(repository, 'packages/sense/dist/test-selection/vitest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * The fixture's hook configuration, with a note taken of every reporter hook
 * the runner reaches for.
 *
 * Written from here rather than kept beside the other fixtures because it is
 * not a subject. The other configurations are suites this seam records; this
 * one is an instrument, and what it measures is the runner the checkout
 * installed rather than anything the seam does.
 */
const probe = (coverageFile: string, log: string) => `
import { appendFileSync } from 'node:fs';
import { withTestSelection } from ${JSON.stringify(seamModule)};

const configured = withTestSelection(
  {
    root: ${JSON.stringify(fixture)},
    test: { include: ['test/hook.throws.ts'], environment: 'node' },
  },
  {
    root: ${JSON.stringify(fixture)},
    coverageFile: ${JSON.stringify(coverageFile)},
    include: (file) => file.startsWith(${JSON.stringify(resolve(fixture, 'src'))}),
  },
);

const reporters = configured.test.reporters;
const seam = reporters[reporters.length - 1];
const note = (hook, files) =>
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ hook, files }) + '\\n');

reporters[reporters.length - 1] = {
  onFinished: (files, ...rest) => {
    note('onFinished', files.map((file) => file.filepath));
    return seam.onFinished(files, ...rest);
  },
  onTestRunEnd: (modules, ...rest) => {
    note('onTestRunEnd', modules.map((module) => module.moduleId));
    return seam.onTestRunEnd(modules, ...rest);
  },
};

export default configured;
`;

describe('which of the two complete writers this checkout drives', () => {
  it('declares both hooks, because a reporter a runner does not recognise is silent', () => {
    // Neither hook can be dropped on the strength of the run below: the one the
    // installed runner ignores is the one a bump makes live, and a reporter with
    // no hook the runner knows never objects — the suite goes green and writes
    // no snapshot at all.
    // A root of its own: constructing the configuration writes this seam's
    // shims under it, and this one is read rather than run.
    const reporters = withTestSelection({}, { root: tmpdir(), coverageFile: '/tmp/coverage.bin' })
      .test?.reporters;
    const seam = (reporters as readonly object[]).at(-1) as Record<string, unknown>;

    expect(typeof seam['onFinished']).toBe('function');
    expect(typeof seam['onTestRunEnd']).toBe('function');
  });

  it('settles the run from the task tree, and leaves the reported modules undriven', async () => {
    // What the fakes in `vitest.test.ts` cannot say. Vitest 2.1.9 — the version
    // this repository installs — announces a task tree to `onFinished`, so every
    // run here exercises `taskComplete` and nothing exercises `reportedComplete`;
    // Vitest 3 calls both and Vitest 4 only the second, and under 3 the reported
    // reading is the one that lands, because the snapshot is written once by
    // whichever hook arrives first.
    //
    // So this is a marker rather than a preference. When a bump makes the other
    // writer live, this goes red at the line naming the hook, and the reader
    // learns that the reading covered by hand-made modules alone is now the
    // reading their skip lists are made of.
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-hooks-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    const log = resolve(directory, 'hooks.jsonl');
    const config = resolve(directory, 'vitest.probe.config.mts');
    await writeFile(config, probe(coverageFile, log), 'utf8');

    // Red by construction — the fixture's `beforeAll` throws — and a red run
    // still publishes a snapshot.
    await execute(process.execPath, [vitest, 'run', '--config', config], {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory },
    }).catch(() => undefined);

    const called = (await readFile(log, 'utf8'))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { hook: string; files: readonly string[] });

    expect(called.map((entry) => entry.hook)).toEqual(['onFinished']);
    expect(called[0]?.files).toEqual([resolve(fixture, 'test/hook.throws.ts')]);

    // And the verdict that hook wrote is the refusal, so the reading this run
    // drove is the one the other three assertions in `vitest.test.ts` hold the
    // reported reading to.
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => [test.file, test.complete]))
      .toEqual([['test/hook.throws.ts', false]]);
  }, 20_000);
});
