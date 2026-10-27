import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { committedAt } from './checkout-path.js';

let repository: string;
let outside: string;
let commit: string;
const when = '2026-10-25T08:30:00.000Z';

beforeAll(async () => {
  repository = await mkdtemp(join(tmpdir(), 'variance-committed-at-'));
  outside = await mkdtemp(join(tmpdir(), 'variance-committed-at-outside-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: repository,
    encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z' },
  }).trim();
  git('init', '--quiet', '--initial-branch', 'main');
  await writeFile(join(repository, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'a');
  commit = git('rev-parse', 'HEAD');
});

afterAll(async () => {
  await Promise.all([repository, outside].map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('committedAt', () => {
  it('reads the committer time of a commit the clone holds, not its author time', () => {
    expect(committedAt(repository, commit)).toBe(when);
  });

  it('has no time for a commit the clone does not hold', () => {
    expect(committedAt(repository, 'f'.repeat(40))).toBeUndefined();
  });

  it('has no time outside a git repository', () => {
    expect(committedAt(outside, commit)).toBeUndefined();
  });
});
