import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { decodeTestCoverage } from './format.js';
import {
  mainlineReadRoot,
  readOwnLayer,
  testCoverageFile,
  writeFetchedMainline,
  writeTestCoverage,
} from './index.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/projects-vitest');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-selected-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** One run of the two-project fixture, handed `skip`: what it said on stderr and which test files it recorded. */
async function run(name: string, skip: readonly string[], ...args: string[]) {
  const coverageFile = resolve(directory, `${name}.bin`);
  const { stderr } = await execute(process.execPath, [vitest, 'run', '--config', 'vitest.config.ts', ...args], {
    cwd: fixture,
    env: environment(name, { FIXTURE_SKIP: JSON.stringify(skip) }),
  });
  const ran = existsSync(coverageFile)
    ? decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file).sort()
    : [];
  return { stderr, ran };
}

function environment(name: string, fixture: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VARIANCE_AUTHORITY_COVERAGE: resolve(directory, `${name}.bin`),
    VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
    ...fixture,
  };
}

describe('a Vitest run over two projects, handed a selection', () => {
  it('runs what the selection kept, and counts it against what Vitest found', async () => {
    const { stderr, ran } = await run('kept', [at('unit/unit.case.ts')]);

    expect(ran).toEqual([at('dom/dom.case.ts')]);
    expect(stderr).toContain('variance-authority: selected 1 of 2');
  });

  it('splits what the selection kept across shards, never what it skipped', async () => {
    const first = await run('first', [at('unit/unit.case.ts')], '--shard', '1/2');
    const second = await run('second', [at('unit/unit.case.ts')], '--shard', '2/2');

    expect([...first.ran, ...second.ran]).toEqual([at('dom/dom.case.ts')]);
  });

  it('runs nothing and passes when the selection skips every file', async () => {
    const { stderr, ran } = await run('none', [at('unit/unit.case.ts'), at('dom/dom.case.ts')]);

    expect(ran).toEqual([]);
    expect(stderr).toContain('variance-authority: selected none of 2, so none of them runs');
  });

  it('fails the run, exiting 1, when the selection refuses the record it read', async () => {
    const refused = execute(process.execPath, [vitest, 'run', '--config', 'vitest.config.ts'], {
      cwd: fixture,
      env: environment('refused', { FIXTURE_REFUSE: 'the record at coverage.bin could not be read' }),
    });

    await expect(refused).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('the record at coverage.bin could not be read'),
    });
    expect(existsSync(resolve(directory, 'refused.bin'))).toBe(false);
  });
});

describe('a Vitest run handed the cases to skip in a file it runs', () => {
  it('runs the other cases of that file, and records the file incomplete', async () => {
    const name = 'cut';
    const report = resolve(directory, `${name}.json`);
    await execute(process.execPath, [
      vitest, 'run', '--config', 'vitest.config.ts', '--reporter', 'json', '--outputFile', report,
    ], {
      cwd: fixture,
      env: environment(name, {
        FIXTURE_SKIP: JSON.stringify([at('dom/dom.case.ts')]),
        FIXTURE_CASES: JSON.stringify({ [at('unit/unit.case.ts')]: ['adds nothing under the unit project'] }),
      }),
    });
    const { testResults } = JSON.parse(await readFile(report, 'utf8')) as {
      testResults: { assertionResults: { title: string; status: string }[] }[];
    };
    const recorded = decodeTestCoverage(await readFile(resolve(directory, `${name}.bin`))).tests;

    expect(testResults.flatMap((file) => file.assertionResults.map(({ title, status }) => [title, status]))).toEqual([
      ['adds under the unit project', 'passed'],
      ['adds nothing under the unit project', 'skipped'],
    ]);
    expect(recorded.map(({ file, complete }) => ({ file, complete }))).toEqual([
      { file: at('unit/unit.case.ts'), complete: false },
    ]);
  });
});

describe('a Vitest run under --shard, with the times a record holds', () => {
  /** Shard `k` of 2, each with a record of its own, as a CI job is, that times the unit file as the slow one. */
  async function shard(k: number) {
    await writeTestCoverage(resolve(directory, `timed-${k}.bin`), {
      version: 3,
      instrumentation: instrumentationId('presence'),
      tests: [
        { file: at('unit/unit.case.ts'), complete: true, preconditions: [], duration: 9000 },
        { file: at('dom/dom.case.ts'), complete: true, preconditions: [], duration: 100 },
      ],
      modules: [],
    });
    return execute(process.execPath, [vitest, 'run', '--config', 'vitest.config.ts', '--shard', `${k}/2`], {
      cwd: fixture,
      env: environment(`timed-${k}`, {}),
    });
  }

  it('places each file by its recorded time, and says what each shard takes', async () => {
    const first = await shard(1);
    const second = await shard(2);

    expect(first.stderr).toContain('variance-authority: shard 1/2 by the times recorded at');
    expect(first.stderr).toContain('1 of 2 files, 9.0 s (shards 100 ms to 9.0 s)');
    expect(first.stdout).toContain('unit.case.ts');
    expect(first.stdout).not.toContain('dom.case.ts');
    expect(second.stdout).toContain('dom.case.ts');
    expect(second.stdout).not.toContain('unit.case.ts');
  });
});

describe('a Vitest run under --shard, in a cache holding a fetched mainline', () => {
  /**
   * Shard `k` of 2 recording into a cache of its own, as a CI shard job does,
   * after the mainline's record was fetched into that cache: what reading the
   * suite's times through the cli leaves there. The record is at the path a
   * run of this repository's `unit` suite lands in, a suite given to the share.
   * `carried` lays the last push's record there instead, as `carry take
   * --as-base` does, and leaves the checkout's own layer empty. `wave` names
   * a cache an earlier wave of the same shard already ran in.
   */
  async function shard(
    k: number,
    selected: boolean,
    flags: readonly string[] = [],
    carried?: { readonly skip: readonly string[] },
    wave?: string,
    killed = false,
  ) {
    const cache = resolve(directory, wave ?? `alone-${k}-${String(selected)}-${flags.join('')}-${String(carried?.skip.length)}`);
    const commit = 'a'.repeat(40);
    const fetched = resolve(mainlineReadRoot(cache, 'unit'), commit, 'coverage.bin');
    await mkdir(dirname(fetched), { recursive: true });
    await writeTestCoverage(fetched, {
      version: 3,
      instrumentation: instrumentationId('presence'),
      commit,
      tests: [
        { file: at('unit/unit.case.ts'), complete: true, preconditions: [] },
        { file: at('dom/dom.case.ts'), complete: true, preconditions: [] },
        { file: at(carried === undefined ? 'elsewhere/only.case.ts' : 'elsewhere/pushed.case.ts'), complete: true, preconditions: [] },
      ],
      modules: [],
    });
    const read = await readFile(fetched);
    await writeFetchedMainline(cache, 'unit', {
      mainline: 'main',
      commit,
      fetched: new Date().toISOString(),
      ...(carried === undefined ? {} : { handed: true as const }),
    });
    const coverageFile = testCoverageFile(repository, { cacheRoot: cache, suite: 'unit' });
    // A selection the run of this test was handed is not the fixture's.
    const { VARIANCE_AUTHORITY_SINCE: _since, VARIANCE_AUTHORITY_AT_DISTANCE: _distance, ...inherited } = process.env;
    const ran = execute(process.execPath, [vitest, 'run', '--config', 'vitest.config.ts', '--shard', `${k}/2`, ...flags], {
      cwd: fixture,
      env: {
        ...inherited,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: cache,
        ...(selected ? { FIXTURE_SKIP: JSON.stringify(carried?.skip ?? []) } : {}),
        ...(killed ? { FIXTURE_KILL: '1' } : {}),
      },
    });
    if (killed) await expect(ran).rejects.toMatchObject({ signal: 'SIGKILL' });
    else await ran;
    // A shard that runs nothing records nothing: its part of the fold is empty.
    if (!existsSync(coverageFile)) return { ran: [], layer: undefined, read: (await readFile(fetched)).equals(read) };
    return {
      read: (await readFile(fetched)).equals(read),
      ran: decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file).sort(),
      layer: await readOwnLayer(coverageFile),
    };
  }

  it('records the files it ran and nothing else when it selects nothing, so the shards fold', async () => {
    const first = await shard(1, false);
    const second = await shard(2, false);

    expect([...first.ran, ...second.ran].sort()).toEqual([at('dom/dom.case.ts'), at('unit/unit.case.ts')]);
    expect(first.ran).toHaveLength(1);
    expect(first.layer?.pinned).toBeUndefined();
  });

  it('records alone when a command-line `--reporter` replaces the seam\'s reporter', async () => {
    const first = await shard(1, false, ['--reporter', 'dot']);
    const second = await shard(2, false, ['--reporter', 'dot']);

    expect([...first.ran, ...second.ran].sort()).toEqual([at('dom/dom.case.ts'), at('unit/unit.case.ts')]);
    expect(first.layer?.pinned).toBeUndefined();
  });

  it('records the files it ran and nothing else when it selects, so the shards fold over the mainline', async () => {
    const first = await shard(1, true);
    const second = await shard(2, true);

    expect([...first.ran, ...second.ran].sort()).toEqual([at('dom/dom.case.ts'), at('unit/unit.case.ts')]);
    expect(first.ran).toHaveLength(1);
    expect(first.layer?.pinned).toBeUndefined();
  });

  it('reads the last push\'s record and records only what it ran, so the shards fold over that record', async () => {
    const skip = { skip: [at('unit/unit.case.ts')] };
    const first = await shard(1, true, [], skip);
    const second = await shard(2, true, [], skip);

    expect([...first.ran, ...second.ran]).toEqual([at('dom/dom.case.ts')]);
    expect(first.read && second.read).toBe(true);
  });

  it('lands its later wave over its earlier one, so its part holds what both ran and nothing it was handed', async () => {
    await shard(1, true, [], { skip: [at('dom/dom.case.ts')] }, 'waves');
    const far = await shard(1, true, [], { skip: [at('unit/unit.case.ts')] }, 'waves');

    expect(far.ran).toEqual([at('dom/dom.case.ts'), at('unit/unit.case.ts')]);
    expect(far.layer?.pinned).toBeUndefined();
    expect(far.read).toBe(true);
  });

  it('leaves no part when it is killed after it selected and before it landed, so the fold is the one without it', async () => {
    const carried = { skip: [at('dom/dom.case.ts')] };
    const killed = await shard(1, true, [], carried, 'killed', true);

    expect(killed.ran).toEqual([]);
    expect(killed.layer).toBeUndefined();
    // The directory CI uploads as the shard's part: nothing in it, so nothing is handed on.
    expect(existsSync(dirname(testCoverageFile(repository, { cacheRoot: resolve(directory, 'killed'), suite: 'unit' })))).toBe(false);
    expect(killed.read).toBe(true);
  });

  it('keeps none of the last push\'s record when its selection skips every file', async () => {
    const first = await shard(1, true, [], { skip: [at('unit/unit.case.ts'), at('dom/dom.case.ts')] });

    expect(first.ran).toEqual([]);
  });
});
