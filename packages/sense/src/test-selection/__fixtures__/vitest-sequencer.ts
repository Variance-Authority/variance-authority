/**
 * The runs the `vitest-sequencer` cases make: the `external-vitest` fixture
 * under a real Vitest, one file at a time, each run recording into a scratch
 * directory the calling test file removes after each case.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, stripVTControlCharacters } from 'node:util';
import { afterEach, expect } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');

export interface Report {
  readonly testResults: readonly { readonly name: string; readonly status: string; readonly startTime: number }[];
}

/** Gives the calling test file its runs, and removes their scratch directories after each case. */
export function vitestSequencer() {
  const temporary: string[] = [];
  afterEach(async () => {
    await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function scratch(): Promise<string> {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-sequencer-'));
    temporary.push(directory);
    return directory;
  }

  /** What a run wrote to stdout and to stderr, as {@link run} reads them, with `env` over the fixture's. */
  async function output(directory: string, env: Record<string, string>, config: string, ...flags: string[]): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await execute(
      process.execPath,
      [vitest, 'run', '--config', resolve(fixture, config), '--no-file-parallelism', ...flags],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'), VARIANCE_AUTHORITY_CACHE: directory, ...env } },
    );
    return { stdout: stripVTControlCharacters(stdout), stderr: stripVTControlCharacters(stderr) };
  }

  /** What a run wrote to stdout, one file at a time, under the reporters `flags` leave it, as a terminal shows it: Vitest colours it wherever `CI` or `FORCE_COLOR` is set. */
  async function run(directory: string, config: string, ...flags: string[]): Promise<string> {
    return (await output(directory, {}, config, ...flags)).stdout;
  }

  /** {@link started}, with `env` over the fixture's. */
  async function startedWith(env: Record<string, string>, config: string, ...flags: string[]): Promise<string[]> {
    const directory = await scratch();
    const report = resolve(directory, 'report.json');
    await output(directory, env, config, '--reporter=json', `--outputFile=${report}`, ...flags);
    const { testResults } = JSON.parse(await readFile(report, 'utf8')) as Report;
    expect(testResults.map((file) => file.status)).toEqual(testResults.map(() => 'passed'));
    return [...testResults].sort((a, b) => a.startTime - b.startTime).map((file) => basename(file.name));
  }

  /** The files a run passed, in the order they started; one at a time, so that order is the sequencer's. */
  async function started(config: string, ...flags: string[]): Promise<string[]> {
    return startedWith({}, config, ...flags);
  }

  return { scratch, output, run, startedWith, started };
}
