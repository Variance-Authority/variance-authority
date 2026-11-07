import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCommitRuns, readTestCoverage, testCoverageFile } from './index.js';
import { landJob, readJobWrites, type JobStep } from './job-record.js';

const trace = (parts: { reads?: string[]; writes?: string[] }) => ({
  reads: new Set(parts.reads ?? []),
  writes: new Set(parts.writes ?? []),
});

describe('landing a job', () => {
  let root: string;
  const step = (over: Partial<JobStep>): JobStep => ({
    root,
    suite: 'site-job',
    commit: 'c1',
    complete: true,
    trace: trace({}),
    tracked: new Map([['a.txt', 'blob-a'], ['b.txt', 'blob-b'], ['gen.txt', 'blob-gen']]),
    ...over,
  });
  const row = async () => (await readTestCoverage(testCoverageFile(root, { suite: 'site-job' }))).tests[0]!;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'va-job-record-'));
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { 'site-job': { kind: 'e2e', relations: false } } }));
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-job-record-cache-')));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('writes one row for the job, and a run that says the commit ran it whole', async () => {
    await landJob(step({ trace: trace({ reads: [join(root, 'a.txt')] }) }));
    const file = testCoverageFile(root, { suite: 'site-job' });
    const record = await readTestCoverage(file);
    expect(record.commit).toBe('c1');
    expect(record.modules).toEqual([]);
    expect(record.tests).toEqual([{ file: 'site-job', complete: true, preconditions: [{ name: 'a.txt', digest: 'blob-a' }] }]);
    expect(await readCommitRuns(file)).toMatchObject({ commit: 'c1', landings: [{ files: ['site-job'] }] });
  });

  it('states what it read by its blob, and drops what the repository does not hold', async () => {
    await landJob(step({ trace: trace({ reads: [join(root, 'a.txt'), join(root, 'dist/out.js'), '/usr/lib/libc.so', join(root, '.git/HEAD')] }) }));
    expect((await row()).preconditions).toEqual([{ name: 'a.txt', digest: 'blob-a' }]);
  });

  it('keeps what the job wrote by its name, inside the repository, and not what is gone', async () => {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'out.js'), 'x');
    await landJob(step({ trace: trace({ writes: [join(root, 'dist/out.js'), join(root, 'gone.tmp'), '/tmp/elsewhere'] }) }));
    expect(await readJobWrites(testCoverageFile(root, { suite: 'site-job' }))).toEqual({ commit: 'c1', writes: ['dist/out.js'] });
  });

  it('adds a later step to the same commit, without what an earlier step made', async () => {
    writeFileSync(join(root, 'gen.txt'), 'made');
    await landJob(step({ trace: trace({ reads: [join(root, 'a.txt')], writes: [join(root, 'gen.txt')] }) }));
    await landJob(step({ trace: trace({ reads: [join(root, 'b.txt'), join(root, 'gen.txt')] }) }));
    expect((await row()).preconditions.map(({ name }) => name)).toEqual(['a.txt', 'b.txt']);
    expect((await readJobWrites(testCoverageFile(root, { suite: 'site-job' })))?.writes).toEqual(['gen.txt']);
  });

  it('holds the job incomplete once any step failed', async () => {
    await landJob(step({ complete: false }));
    await landJob(step({}));
    expect((await row()).complete).toBe(false);
  });

  it('counts a later step as one more run at the commit, over where the job stood', async () => {
    await landJob(step({ trace: trace({ reads: [join(root, 'a.txt')] }) }));
    await landJob(step({ commit: 'c2', trace: trace({ reads: [join(root, 'a.txt')] }) }));
    await landJob(step({ commit: 'c2', trace: trace({ reads: [join(root, 'b.txt')] }) }));
    expect(await readCommitRuns(testCoverageFile(root, { suite: 'site-job' }))).toMatchObject({ commit: 'c2', over: 'c1', runs: 2 });
  });

  it('starts again at another commit', async () => {
    await landJob(step({ trace: trace({ reads: [join(root, 'a.txt')] }), complete: false }));
    await landJob(step({ commit: 'c2', trace: trace({ reads: [join(root, 'b.txt')] }) }));
    expect(await row()).toEqual({ file: 'site-job', complete: true, preconditions: [{ name: 'b.txt', digest: 'blob-b' }] });
  });
});
