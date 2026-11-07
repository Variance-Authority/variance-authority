import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestBytes } from '../digest.js';
import { commitRunsFile, readCommitRuns, readTestCoverage, testCoverageFile } from './index.js';
import { jobInputs, jobWritesFile, landJob, readJobWrites, type JobStep } from './job-record.js';

const trace = (parts: { reads?: string[]; writes?: string[]; absent?: string[] }) => ({
  reads: new Set(parts.reads ?? []),
  writes: new Set(parts.writes ?? []),
  absent: new Set(parts.absent ?? []),
});

const tracked = new Map([['a.txt', 'blob-a'], ['pages/one.md', 'blob-one']]);
const none = (): ReadonlySet<string> => new Set();

describe('what a job read, as a record states it', () => {
  it('states a tracked file by its blob, and drops what the repository does not hold', () => {
    expect(jobInputs(trace({ reads: ['/r/a.txt', '/r/dist/out.js', '/usr/lib/libc.so', '/r/.git/HEAD'] }), '/r', tracked, none)).toEqual([
      { name: 'a.txt', digest: 'blob-a' },
    ]);
  });

  it('states a folder holding tracked files as a listing, the root as `./`', () => {
    expect(jobInputs(trace({ reads: ['/r', '/r/pages'] }), '/r', tracked, none)).toEqual([
      { name: './', digest: 'listed' },
      { name: 'pages/', digest: 'listed' },
    ]);
  });

  it('states a path the job did not find, unless the repository ignores it or holds it', () => {
    const ignored = (names: readonly string[]) => new Set(names.filter((name) => name.startsWith('dist/')));
    expect(jobInputs(trace({ absent: ['/r/x.json', '/r/dist/y.json', '/r/a.txt', '/elsewhere/z', '/r/.git/index.lock'] }), '/r', tracked, ignored)).toEqual([
      { name: 'x.json', digest: 'absent' },
    ]);
  });
});

describe('landing a job', () => {
  let root: string;
  const step = (over: Partial<JobStep>): JobStep => ({
    root,
    suite: 'site-job',
    commit: 'c1',
    complete: true,
    at: '2026-11-07T00:00:00.000Z',
    inputs: [],
    trace: trace({}),
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
    await landJob(step({ inputs: [{ name: 'a.txt', digest: 'blob-a' }] }));
    const file = testCoverageFile(root, { suite: 'site-job' });
    const record = await readTestCoverage(file);
    expect(record.commit).toBe('c1');
    expect(record.modules).toEqual([]);
    expect(record.tests).toEqual([{ file: 'site-job', complete: true, preconditions: [{ name: 'a.txt', digest: 'blob-a' }] }]);
    expect(commitRunsFile(file)).not.toBe(jobWritesFile(file));
    expect(await readCommitRuns(file)).toMatchObject({ commit: 'c1', landings: [{ files: ['site-job'] }] });
  });

  it('keeps what the job wrote by its content, inside the repository, and not what is gone', async () => {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'out.js'), 'x');
    await landJob(step({ trace: trace({ writes: [join(root, 'dist/out.js'), join(root, 'gone.tmp'), '/tmp/elsewhere'] }) }));
    const writes = await readJobWrites(testCoverageFile(root, { suite: 'site-job' }));
    expect(writes?.writes.map(({ name }) => name)).toEqual(['dist/out.js']);
    expect(writes?.writes[0]?.digest).toBe(digestBytes(Buffer.from('x')));
  });

  it('adds a later step to the same commit, without what an earlier step made', async () => {
    writeFileSync(join(root, 'gen.txt'), 'made');
    await landJob(step({ inputs: [{ name: 'a.txt', digest: 'blob-a' }], trace: trace({ writes: [join(root, 'gen.txt')] }) }));
    await landJob(step({ inputs: [{ name: 'b.txt', digest: 'blob-b' }, { name: 'gen.txt', digest: 'blob-gen' }] }));
    expect((await row()).preconditions.map(({ name }) => name)).toEqual(['a.txt', 'b.txt']);
    expect((await readJobWrites(testCoverageFile(root, { suite: 'site-job' })))?.writes.map(({ name }) => name)).toEqual(['gen.txt']);
  });

  it('holds the job incomplete once any step failed', async () => {
    await landJob(step({ complete: false }));
    await landJob(step({}));
    expect((await row()).complete).toBe(false);
  });

  it('starts again at another commit', async () => {
    await landJob(step({ inputs: [{ name: 'a.txt', digest: 'blob-a' }], complete: false }));
    await landJob(step({ commit: 'c2', inputs: [{ name: 'b.txt', digest: 'blob-b' }] }));
    expect(await row()).toEqual({ file: 'site-job', complete: true, preconditions: [{ name: 'b.txt', digest: 'blob-b' }] });
  });
});
