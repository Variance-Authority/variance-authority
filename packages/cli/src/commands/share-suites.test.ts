import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { instrumentationId } from '@variance-authority/sense/instrument';
import { commitRunsFile, readCommitRuns, readTestCoverage, testCoverageFile, writeCommitRuns, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { parseArgs } from '../parse.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { PUSH, gitPublished, totalCoverage, totalModule } from './mainline-fixture.js';
import { suitesShare } from './share-suites.js';

/**
 * What `variance share` does in the root config's form: the records a CI run's
 * jobs handed on folded over the mainline's base, and every suite given to the
 * share published or refused by name.
 */

const run = promisify(execFile);
let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-share-suites-')));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/**
 * The CI checkout one commit past the published `first`, `unit` and `integration`
 * given to the share, `site` declared beside them, and only `unit` published, as the publish job finds it: nothing
 * recorded in its own cache, and the commit pushed.
 */
async function nextPush(): Promise<{ ci: string; origin: string; first: string; second: string }> {
  const suites = { unit: { kind: 'unit', carry: 'share' }, integration: { kind: 'unit', carry: 'share' }, site: { kind: 'unit' } };
  const { ci, origin, first } = await gitPublished(home, { instrumentation: instrumentationId(), suites });
  await writeFile(join(ci, 'src/later.ts'), 'export const later = 1;\n');
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'second');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'publish-cache'));
  return { ci, origin, first, second: await git(ci, 'rev-parse', 'HEAD') };
}

/** What one job of `suite` that ran `file` whole at `commit` handed on: its cache, under `ran/<job>`. */
async function handedOn(job: string, suite: string, file: string, commit: string): Promise<string> {
  const record = join(home, 'ran', job, 'test-selection', 'digest', 'suites', suite, 'coverage.bin');
  await mkdir(dirname(record), { recursive: true });
  const blocks = [totalModule([file]), {
    ordinal: 1, owner: 0, kind: 'function' as const, digest: digestString('applyDiscount'), name: 'applyDiscount', path: 'applyDiscount',
    startLine: 1, endLine: 3, source: true, testFiles: [file],
  }];
  await writeTestCoverage(record, { ...totalCoverage(commit, [file], blocks), instrumentation: instrumentationId() });
  return record;
}

/** One `<suite>.txt` per suite, each listing both test files. */
async function collectedEach(): Promise<string> {
  const dir = join(home, 'collected');
  await mkdir(dir, { recursive: true });
  for (const suite of ['integration', 'unit']) await writeFile(join(dir, `${suite}.txt`), 'test/other.test.ts\ntest/total.test.ts\n');
  return dir;
}

describe('`variance share --publish <records>`', () => {
  it("folds a suite's shards over the mainline's base and publishes the run they make whole", async () => {
    const { ci, origin, second } = await nextPush();
    await handedOn('variance-shard-unit-1', 'unit', 'test/total.test.ts', second);
    await handedOn('variance-shard-unit-2', 'unit', 'test/other.test.ts', second);
    const before = await git(home, 'ls-remote', origin, 'refs/variance/mainline/main');

    const done = await suitesShare(ci, { suite: 'unit', publish: true, records: [join(home, 'ran')], collected: join(await collectedEach(), 'unit.txt') }, { env: PUSH });

    expect(done.exit).toBe(EXIT_CLEAN);
    expect(done.lines.join('\n')).toMatch(/wrote suite-v1\/unit to mainline main in /u);
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).not.toBe(before);
    expect(testCoverageFile(ci, { suite: 'unit' })).toContain(join(home, 'publish-cache'));
  });

  it("lays a slice's record, already laid over the base in its job, as that job left it, and refuses it when the slice ran part of the suite", async () => {
    const { ci, second } = await nextPush();
    const slice = join(home, 'ran', 'variance-slice-unit');
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', slice);
    const shard = await handedOn('variance-shard-unit-1', 'unit', 'test/total.test.ts', second);
    expect((await suitesShare(ci, { suite: 'unit', publish: false, records: [shard] }, { env: PUSH })).exit).toBe(EXIT_CLEAN);
    const laid = await readTestCoverage(testCoverageFile(ci, { suite: 'unit' }));
    const ledger = await readCommitRuns(testCoverageFile(ci, { suite: 'unit' }));
    expect(laid.commit).toBe(second);
    await rm(join(home, 'ran', 'variance-shard-unit-1'), { recursive: true });
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'publish-cache'));

    const done = await suitesShare(ci, { suite: 'unit', publish: true, records: [slice], collected: join(await collectedEach(), 'unit.txt') }, { env: PUSH });

    expect(await readTestCoverage(testCoverageFile(ci, { suite: 'unit' }))).toEqual(laid);
    expect(await readCommitRuns(testCoverageFile(ci, { suite: 'unit' }))).toEqual(ledger);
    expect(done.exit).toBe(EXIT_OPERATOR);
    expect(done.lines.join('\n')).toMatch(/is not a whole run: 1 test file\(s\) the suite collects last ran before \w+, test\/other\.test\.ts among them/u);
  });

  it("publishes the merge queue's run of part of the suite, every test it did not run standing where it last ran", async () => {
    const { ci, origin, second } = await nextPush();
    await handedOn('variance-shard-1-0', 'unit', 'test/total.test.ts', second);
    const before = await git(home, 'ls-remote', origin, 'refs/variance/mainline/main');
    const asked: string[] = [];
    // The download is a directory of its own, which the share removes once it has read it.
    const queue = async ({ pattern, commit }: { readonly pattern: string; readonly commit: string }) => {
      asked.push(`${pattern}@${commit}`);
      const dir = join(home, `downloaded-${asked.length}`);
      await cp(join(home, 'ran'), dir, { recursive: true });
      return { dir };
    };

    const done = await suitesShare(ci, { suite: 'unit', publish: true, records: [], fromQueue: 'variance-shard-*', collected: join(await collectedEach(), 'unit.txt') }, { env: PUSH }, queue);

    expect(asked).toEqual([`variance-shard-*@${second}`]);
    expect(done.exit).toBe(EXIT_CLEAN);
    expect(done.lines.join('\n')).toMatch(/wrote suite-v1\/unit to mainline main in /u);
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).not.toBe(before);

    // The whole run at the commit replaces it.
    await handedOn('variance-shard-2-0', 'unit', 'test/other.test.ts', second);
    const whole = await suitesShare(ci, { suite: 'unit', publish: true, records: [join(home, 'ran')], collected: join(await collectedEach(), 'unit.txt') }, { env: PUSH });
    expect(whole.lines.join('\n')).toMatch(/wrote suite-v1\/unit to mainline main in /u);
    expect(await stat(join(home, 'downloaded-1')).catch(() => undefined)).toBeUndefined();
  });

  it('skips a shared suite the merge queue ran none of, and publishes the one it ran', async () => {
    const { ci, second } = await nextPush();
    await handedOn('variance-shard-unit-0', 'unit', 'test/total.test.ts', second);
    const queue = async () => {
      const dir = join(home, 'downloaded-skip');
      await cp(join(home, 'ran'), dir, { recursive: true });
      return { dir };
    };

    const done = await suitesShare(ci, { publish: true, records: [], fromQueue: 'variance-shard-*', collected: await collectedEach() }, { env: PUSH }, queue);

    expect(done.exit).toBe(EXIT_CLEAN);
    expect(done.lines).toContain('integration: the merge queue ran none of it; the whole run at this commit publishes its record.');
    expect(done.lines.join('\n')).toMatch(/wrote suite-v1\/unit to mainline main in /u);
  });

  it('skips the suite it is named when the merge queue ran none of it', async () => {
    const { ci, origin, second } = await nextPush();
    await handedOn('variance-shard-unit-0', 'unit', 'test/total.test.ts', second);
    const before = await git(home, 'ls-remote', origin, 'refs/variance/mainline/main');
    const queue = async () => {
      const dir = join(home, 'downloaded-named');
      await cp(join(home, 'ran'), dir, { recursive: true });
      return { dir };
    };

    const done = await suitesShare(ci, { suite: 'integration', publish: true, records: [], fromQueue: 'variance-shard-*', collected: join(await collectedEach(), 'integration.txt') }, { env: PUSH }, queue);

    expect(done).toEqual({ lines: ['integration: the merge queue ran none of it; the whole run at this commit publishes its record.'], exit: EXIT_CLEAN });
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toBe(before);
  });

  it('publishes the merge queue\'s run when the runner collects a test file no run has listed yet', async () => {
    const { ci, origin, second } = await nextPush();
    await handedOn('variance-shard-unit-0', 'unit', 'test/total.test.ts', second);
    const collected = await collectedEach();
    await writeFile(join(collected, 'unit.txt'), 'test/added.test.ts\ntest/other.test.ts\ntest/total.test.ts\n');
    const before = await git(home, 'ls-remote', origin, 'refs/variance/mainline/main');
    const queue = async () => {
      const dir = join(home, 'downloaded-added');
      await cp(join(home, 'ran'), dir, { recursive: true });
      return { dir };
    };

    const done = await suitesShare(ci, { suite: 'unit', publish: true, records: [], fromQueue: 'variance-shard-*', collected: join(collected, 'unit.txt') }, { env: PUSH }, queue);

    expect(done.lines.join('\n')).toMatch(/wrote suite-v1\/unit to mainline main in /u);
    expect(done.exit).toBe(EXIT_CLEAN);
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).not.toBe(before);
  });

  it('says why it published nothing when the merge queue kept no run of the commit, and leaves the publish to the whole run', async () => {
    const { ci, origin } = await nextPush();
    const before = await git(home, 'ls-remote', origin, 'refs/variance/mainline/main');

    const done = await suitesShare(ci, { publish: true, records: [], fromQueue: 'variance-shard-*' }, { env: PUSH }, async () => ({ none: 'no green merge-queue run' }));

    expect(done).toEqual({ lines: ['nothing published from the merge queue: no green merge-queue run; the whole run at this commit publishes its record.'], exit: EXIT_CLEAN });
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toBe(before);
  });

  it("lays a slice's record laid over the last push's, not the mainline's, as its job left it, whatever the file is named", async () => {
    const { ci, second } = await nextPush();
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ran', 'variance-slice-unit'));
    const shard = await handedOn('variance-shard-unit-1', 'unit', 'test/total.test.ts', second);
    await suitesShare(ci, { suite: 'unit', publish: false, records: [shard] }, { env: PUSH });
    const record = testCoverageFile(ci, { suite: 'unit' });
    const laid = await readTestCoverage(record);
    const ledger = { ...(await readCommitRuns(record))!, over: second };
    const renamed = join(dirname(record), 'renamed.bin');
    await rename(record, renamed);
    await rm(commitRunsFile(record));
    await writeCommitRuns(commitRunsFile(renamed), ledger);
    await rm(join(home, 'ran', 'variance-shard-unit-1'), { recursive: true });
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'publish-cache'));

    await suitesShare(ci, { suite: 'unit', publish: false, records: [renamed] }, { env: PUSH });

    expect(await readTestCoverage(testCoverageFile(ci, { suite: 'unit' }))).toEqual(laid);
    expect(await readCommitRuns(testCoverageFile(ci, { suite: 'unit' }))).toEqual(ledger);
  });

  it("lands a lone shard, whose runs record names no base, over the base, and a record named by any file", async () => {
    const { ci, second } = await nextPush();
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ran', 'variance-slice-unit'));
    const first = await handedOn('variance-shard-unit-1', 'unit', 'test/total.test.ts', second);
    await suitesShare(ci, { suite: 'unit', publish: false, records: [first] }, { env: PUSH });
    const { over: _over, standing: _standing, ...alone } = (await readCommitRuns(testCoverageFile(ci, { suite: 'unit' })))!;
    const shard = await handedOn('variance-shard-unit-2', 'unit', 'test/total.test.ts', second);
    const dat = join(dirname(shard), 'record.dat');
    await rename(shard, dat);
    await writeCommitRuns(commitRunsFile(dat), alone);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'publish-cache'));

    await suitesShare(ci, { suite: 'unit', publish: false, records: [dat] }, { env: PUSH });

    const runs = await readCommitRuns(testCoverageFile(ci, { suite: 'unit' }));
    expect(runs?.standing?.flatMap(({ files }) => files)).toContain('test/other.test.ts');
    expect(runs?.commit).toBe(second);
  });

  it('publishes every suite given to the share without `--suite`, and names each it could not', async () => {
    const { ci, second } = await nextPush();
    await handedOn('variance-shard-unit-1', 'unit', 'test/total.test.ts', second);
    await handedOn('variance-shard-unit-2', 'unit', 'test/other.test.ts', second);

    const done = await suitesShare(ci, { publish: true, records: [join(home, 'ran')], collected: await collectedEach() }, { env: PUSH });

    expect(done.exit).toBe(EXIT_OPERATOR);
    expect(done.lines).toContain('integration: nothing was handed on, so the base stands.');
    expect(done.lines.join('\n')).toMatch(/wrote suite-v1\/unit to mainline main in /u);
    expect(done.lines.at(-1)).toBe('not published: integration.');
  });

  it('refuses a record it cannot attribute to a suite, or of a suite not given to the share, before anything is read', async () => {
    const { ci } = await nextPush();
    const loose = join(home, 'loose.bin');
    await writeFile(loose, '');
    const site = join(home, 'cache', 'suites', 'site', 'coverage.bin');
    await mkdir(dirname(site), { recursive: true });
    await writeFile(site, '');

    await expect(suitesShare(ci, { publish: true, records: [loose] }, { env: PUSH })).rejects.toThrow(
      `${loose} names no suite: a record is \`suites/<suite>/coverage.bin\` under a cache, or is named beside \`--suite\``,
    );
    await expect(suitesShare(ci, { publish: true, records: [join(home, 'cache')] }, { env: PUSH })).rejects.toThrow(
      `${site} is a record of "site", which the root variance.config.json does not give to the share`,
    );
    await expect(suitesShare(ci, { publish: true, records: [join(home, 'gone')] }, { env: PUSH })).rejects.toThrow(
      `the record ${join(home, 'gone')} is not there`,
    );
    await expect(suitesShare(ci, { publish: true, records: [], collected: join(home, 'loose.bin') }, { env: PUSH })).rejects.toThrow(
      `\`--collected\` names the file ${loose}, and 2 suites are published; name a directory holding one \`<suite>.txt\` each`,
    );
  });

  it('reads every suite given to the share without `--suite`, its outputs keyed by the suite', async () => {
    const { ci, first } = await nextPush();

    const done = await suitesShare(ci, { publish: false, records: [], format: 'github' }, { env: PUSH });

    expect(done.exit).toBe(EXIT_CLEAN);
    expect(done.lines).toEqual(['commit-integration=', `commit-unit=${first}`, 'based-unit=true']);
  });

  it('keys the outputs by the suite without `--suite` when only one suite is given to the share', async () => {
    const { ci } = await gitPublished(home, { instrumentation: instrumentationId() });

    const done = await suitesShare(ci, { publish: false, records: [], format: 'github' }, { env: PUSH });

    expect(done.lines.map((line) => line.split('=')[0])).toEqual(['commit-unit', 'based-unit']);
  });

  it('takes records and `--collected` beside `--publish`, with or without `--suite`', () => {
    expect(parseArgs(['share', '--publish', 'ran', '--collected', 'collected'])).toMatchObject({ command: 'share', publish: true, reports: ['ran'], collected: 'collected' });
    expect(() => parseArgs(['share', '--collected', 'files.txt'])).toThrow('`--collected` is for `share --publish`, which counts a whole run against it');
  });

  it("takes `--from-queue` beside `--publish` alone, for the merge queue's shards", () => {
    expect(parseArgs(['share', '--publish', '--from-queue', 'variance-shard-*', '--collected', 'c'])).toMatchObject({ command: 'share', publish: true, fromQueue: 'variance-shard-*', reports: [] });
    expect(() => parseArgs(['share', '--from-queue', 'variance-shard-*'])).toThrow("`--from-queue` publishes the merge queue's records, so it is for `share --publish`, beside no record");
    expect(() => parseArgs(['share', '--publish', '--from-queue', 'variance-shard-*', 'ran'])).toThrow("`--from-queue` publishes the merge queue's records, so it is for `share --publish`, beside no record");
  });
});
