import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readJobWrites, readTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';
import { runJob } from './job.js';

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** A recorder that copies `FAKE_TRACE` to where it was told to write, then runs the command. */
const RECORDER = `#!/bin/sh
out=
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    --) shift; break ;;
    *) shift ;;
  esac
done
cp "$FAKE_TRACE" "$out"
exec "$@"
`;

describe('recording a job', () => {
  let root: string;
  let notes: string[];
  const streams = { err: (text: string) => void notes.push(text) };
  const job = (...run: string[]) => runJob({ command: 'job', suite: 'build', run }, streams, root);
  const file = () => testCoverageFile(root, { suite: 'build' });

  function recorder(script: string): void {
    const bin = mkdtempSync(join(tmpdir(), 'va-job-bin-'));
    writeFileSync(join(bin, 'strace'), script);
    chmodSync(join(bin, 'strace'), 0o755);
    vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH ?? ''}`);
  }

  function traced(...lines: string[]): void {
    const trace = join(mkdtempSync(join(tmpdir(), 'va-job-trace-')), 'trace');
    writeFileSync(trace, `${lines.join('\n')}\n`);
    vi.stubEnv('FAKE_TRACE', trace);
    recorder(RECORDER);
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'va-job-')));
    notes = [];
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-job-cache-')));
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'a@b.c');
    git(root, 'config', 'user.name', 'a');
    writeFileSync(join(root, '.gitignore'), 'dist/\n');
    writeFileSync(join(root, 'read.txt'), 'read\n');
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { build: { kind: 'e2e', relations: false } } }));
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'one');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('records what the command read and wrote, at the commit it ran on', async () => {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'out.js'), 'out');
    traced(
      `1 openat(AT_FDCWD<${root}>, "read.txt", O_RDONLY) = 3<${root}/read.txt>`,
      `1 openat(AT_FDCWD<${root}>, "missing.json", O_RDONLY) = -1 ENOENT (No such file or directory)`,
      `1 openat(AT_FDCWD<${root}>, "dist/probe.json", O_RDONLY) = -1 ENOENT (No such file or directory)`,
      `1 openat(AT_FDCWD<${root}>, "dist/out.js", O_WRONLY|O_CREAT, 0666) = 3<${root}/dist/out.js>`,
    );
    expect(await job('sh', '-c', 'exit 0')).toBe(0);
    const record = await readTestCoverage(file());
    expect(record.commit).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(record.tests).toEqual([{
      file: 'build',
      complete: true,
      preconditions: [
        { name: 'missing.json', digest: 'absent' },
        { name: 'read.txt', digest: git(root, 'rev-parse', 'HEAD:read.txt') },
      ],
    }]);
    expect((await readJobWrites(file()))?.writes.map(({ name }) => name)).toEqual(['dist/out.js']);
  });

  it('leaves out a miss under an ignored folder, through a link as a workspace package is', async () => {
    mkdirSync(join(root, 'real'));
    mkdirSync(join(root, 'dist'));
    symlinkSync('../real', join(root, 'dist', 'link'));
    traced(
      `1 openat(AT_FDCWD<${root}>, "dist/link/probe.json", O_RDONLY) = -1 ENOENT (No such file or directory)`,
      `1 openat(AT_FDCWD<${root}>, "read.txt", O_RDONLY) = 3<${root}/read.txt>`,
    );
    await job('sh', '-c', 'exit 0');
    expect((await readTestCoverage(file())).tests[0]?.preconditions.map(({ name }) => name)).toEqual(['read.txt']);
  });

  it('answers the exit of a command that failed, and holds its record incomplete', async () => {
    traced(`1 openat(AT_FDCWD<${root}>, "read.txt", O_RDONLY) = 3<${root}/read.txt>`);
    expect(await job('sh', '-c', 'exit 3')).toBe(3);
    expect((await readTestCoverage(file())).tests[0]?.complete).toBe(false);
  });

  it('answers a command ended by a signal as a shell would', async () => {
    traced(`1 openat(AT_FDCWD<${root}>, "read.txt", O_RDONLY) = 3<${root}/read.txt>`);
    expect(await job('sh', '-c', 'kill -TERM $$')).toBe(143);
  });

  it('runs the command unrecorded when the recorder could not start it', async () => {
    recorder('#!/bin/sh\nexit 1\n');
    expect(await job('sh', '-c', 'touch ran; exit 4')).toBe(4);
    expect(existsSync(join(root, 'ran'))).toBe(true);
    expect((await readTestCoverage(file())).tests).toEqual([{ file: 'build', complete: false, preconditions: [] }]);
    expect(notes.join('')).toContain('strace could not trace it');
  });

  it('holds the job incomplete when a later step could not be traced', async () => {
    traced(`1 openat(AT_FDCWD<${root}>, "read.txt", O_RDONLY) = 3<${root}/read.txt>`);
    await job('sh', '-c', 'exit 0');
    recorder('#!/bin/sh\nexit 1\n');
    await job('sh', '-c', 'exit 0');
    expect((await readTestCoverage(file())).tests[0]?.complete).toBe(false);
  });

  it('runs the command unrecorded when there is no recorder', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'va-job-bin-'));
    for (const tool of ['git', 'sh', 'touch']) symlinkSync(execFileSync('which', [tool], { encoding: 'utf8' }).trim(), join(bin, tool));
    vi.stubEnv('PATH', bin);
    expect(await job('sh', '-c', 'touch ran')).toBe(0);
    expect(existsSync(join(root, 'ran'))).toBe(true);
    expect(notes.join('')).toContain('strace is not installed');
  });

  it('runs the command unrecorded outside a checkout', async () => {
    root = mkdtempSync(join(tmpdir(), 'va-job-bare-'));
    expect(await job('sh', '-c', 'exit 0')).toBe(0);
    expect(notes.join('')).toContain('not a git checkout');
  });
});
