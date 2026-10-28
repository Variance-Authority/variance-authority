import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A pull request's checkout merged with the commit the mainline's record was
 * made at, as `.github/actions/merge-baseline` makes it in every job of a
 * `check.yml` run: the same commit in each, or GitHub's merge left as it was.
 */

const MERGE = resolve(import.meta.dirname, '../.github/actions/merge-baseline/merge.sh');

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function commitIn(repo: string, file: string, text: string): Promise<string> {
  await writeFile(join(repo, file), text);
  git(repo, 'add', file);
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file);
  return git(repo, 'rev-parse', 'HEAD');
}

/**
 * An upstream whose `main` gained a commit after `record`, the commit its
 * record was made at, and a pull request cut before `record` whose head is
 * `head`.
 */
async function pullRequest(change = 'x\n'): Promise<{ at: string; upstream: string; record: string; head: string }> {
  const at = await mkdtemp(join(tmpdir(), 'merge-baseline-'));
  const upstream = join(at, 'upstream');
  await mkdir(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  const cut = await commitIn(upstream, 'shared.ts', 'shared\n');
  const record = await commitIn(upstream, 'record.ts', 'record\n');
  await commitIn(upstream, 'tip.ts', 'tip\n');
  git(upstream, 'checkout', '-q', '-b', 'pull', cut);
  const head = await commitIn(upstream, 'shared.ts', change);
  git(upstream, 'checkout', '-q', 'main');
  return { at, upstream, record, head };
}

/** A clone standing on GitHub's merge of `head` into the tip, `checked`, where a job starts. */
function job(at: string, upstream: string, head: string, name: string): { clone: string; checked: string } {
  const clone = join(at, name);
  git(at, 'clone', '-q', '--no-local', upstream, clone);
  git(clone, 'fetch', '-q', 'origin', 'pull');
  git(clone, 'checkout', '-q', '--detach', 'origin/main');
  git(clone, '-c', 'user.name=github', '-c', 'user.email=g@h', 'merge', '-q', '--no-ff', '--no-edit', head);
  return { clone, checked: git(clone, 'rev-parse', 'HEAD') };
}

function merge(
  clone: string,
  commit: string,
  head: string,
  onConflict: 'stay' | 'fail',
  expect = '',
  env: Record<string, string> = {},
): { status: number | null; merged: string } {
  const output = join(clone, '.git', 'github-output');
  writeFileSync(output, '');
  const ran = spawnSync('bash', [MERGE], {
    cwd: clone,
    env: { ...process.env, ...env, COMMIT: commit, HEAD_COMMIT: head, ON_CONFLICT: onConflict, EXPECT: expect, GITHUB_OUTPUT: output },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const merged = /^merged=(.*)$/mu.exec(readFileSync(output, 'utf8'))?.[1] ?? '';
  return { status: ran.status, merged };
}

describe('a pull request merged with the commit of the mainline record', () => {
  it('stands on the head merged into that commit, the same commit in every job', async () => {
    const { at, upstream, record, head } = await pullRequest();
    const first = job(at, upstream, head, 'first');
    const second = job(at, upstream, head, 'second');

    expect(merge(first.clone, record, head, 'stay')).toEqual({ status: 0, merged: 'true' });
    // Another machine: another git identity and clock in its environment.
    const elsewhere = { GIT_AUTHOR_NAME: 'other', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'other', GIT_COMMITTER_EMAIL: 'o@o', TZ: 'Asia/Tokyo' };
    expect(merge(second.clone, record, head, 'fail', git(first.clone, 'rev-parse', 'HEAD'), elsewhere)).toEqual({ status: 0, merged: 'true' });

    expect(git(first.clone, 'rev-parse', 'HEAD^1', 'HEAD^2').split('\n')).toEqual([record, head]);
    expect(git(second.clone, 'rev-parse', 'HEAD')).toBe(git(first.clone, 'rev-parse', 'HEAD'));
  });

  it("stays on GitHub's merge when the head conflicts with that commit, or fails a job told it merged", async () => {
    const { at, upstream, head } = await pullRequest('conflicts\n');
    const record = await commitIn(upstream, 'shared.ts', 'record\n');
    await commitIn(upstream, 'shared.ts', 'shared\n');
    const stays = job(at, upstream, head, 'stays');
    const fails = job(at, upstream, head, 'fails');

    expect(merge(stays.clone, record, head, 'stay')).toEqual({ status: 0, merged: 'false' });
    expect(git(stays.clone, 'rev-parse', 'HEAD')).toBe(stays.checked);
    expect(git(stays.clone, 'status', '--porcelain')).toBe('');

    expect(merge(fails.clone, record, head, 'fail').status).toBe(1);
    expect(git(fails.clone, 'rev-parse', 'HEAD')).toBe(fails.checked);
  });

  it('fails rather than stay when the merge stops on something other than a conflict', async () => {
    const { at, upstream, record, head } = await pullRequest();
    const { clone, checked } = job(at, upstream, head, 'stops');
    await writeFile(join(clone, '.git', 'hooks', 'pre-merge-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    expect(merge(clone, record, head, 'stay').status).toBe(1);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(checked);
    expect(git(clone, 'status', '--porcelain')).toBe('');
  });

  it('merges a head that already holds that commit, so the change still starts there', async () => {
    const { at, upstream, record } = await pullRequest();
    git(upstream, 'checkout', '-q', '-b', 'later', record);
    const holds = await commitIn(upstream, 'later.ts', 'later\n');
    git(upstream, 'branch', '-q', '-f', 'pull', holds);
    git(upstream, 'checkout', '-q', 'main');
    const { clone } = job(at, upstream, holds, 'holds');

    expect(merge(clone, record, holds, 'fail')).toEqual({ status: 0, merged: 'true' });
    expect(git(clone, 'rev-parse', 'HEAD^1', 'HEAD^2').split('\n')).toEqual([record, holds]);
    expect(git(clone, 'rev-parse', 'HEAD^{tree}')).toBe(git(clone, 'rev-parse', `${holds}^{tree}`));
  });

  it('leaves the checkout as it is when no commit is named', async () => {
    const { at, upstream, head } = await pullRequest();
    const { clone, checked } = job(at, upstream, head, 'none');

    expect(merge(clone, '', head, 'fail')).toEqual({ status: 0, merged: 'false' });
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(checked);
  });

  it('fails a job whose merge is not the commit the deciding job made', async () => {
    const { at, upstream, record, head } = await pullRequest();
    const { clone } = job(at, upstream, head, 'differs');

    expect(merge(clone, record, head, 'fail', record).status).toBe(1);
  });
});
