import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ParsedCarry } from '../carry-args.js';
import { runCarry } from './carry.js';
import { mergeHead } from './carry-merge.js';

/**
 * `carry merge`: a pull request's head merged with the commit the mainline's
 * record was made at, the same commit in every job of a run, or the host's
 * merge left as it was.
 */

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
  const at = await mkdtemp(join(tmpdir(), 'carry-merge-'));
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

/** A clone standing on the host's merge of `head` into the tip, `checked`, where a job starts. */
function job(at: string, upstream: string, head: string, name: string): { clone: string; checked: string } {
  const clone = join(at, name);
  git(at, 'clone', '-q', '--no-local', upstream, clone);
  git(clone, 'fetch', '-q', 'origin', 'pull');
  git(clone, 'checkout', '-q', '--detach', 'origin/main');
  git(clone, '-c', 'user.name=github', '-c', 'user.email=g@h', 'merge', '-q', '--no-ff', '--no-edit', head);
  return { clone, checked: git(clone, 'rev-parse', 'HEAD') };
}

interface Asked {
  readonly head?: string;
  readonly onConflict?: 'stay' | 'fail';
  readonly expect?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** `carry merge <commit>` in `clone` under `--format github`: its exit, its outputs, and what it said. */
async function merge(clone: string, commit: string, asked: Asked = {}): Promise<{ exit: number; outputs: string; said: string }> {
  const parsed: ParsedCarry = {
    command: 'carry',
    direction: 'merge',
    commit,
    ...(asked.head === undefined ? {} : { head: asked.head }),
    onConflict: asked.onConflict ?? 'fail',
    ...(asked.expect === undefined ? {} : { expect: asked.expect }),
    format: 'github',
  };
  let outputs = '';
  let said = '';
  const streams = { out: (text: string) => void (outputs += text), err: (text: string) => void (said += text) };
  try {
    return { exit: await mergeHead(parsed, clone, streams, asked.env ?? {}), outputs, said };
  } catch (error) {
    return { exit: 2, outputs, said: said + (error instanceof Error ? error.message : String(error)) };
  }
}

describe("a pull request's head merged with the commit of the mainline's record", () => {
  it('stands on the head merged into that commit, the same commit in every clone', async () => {
    const { at, upstream, record, head } = await pullRequest();
    const first = job(at, upstream, head, 'first');
    const second = job(at, upstream, head, 'second');

    const made = await merge(first.clone, record, { head, onConflict: 'stay' });
    const checkout = git(first.clone, 'rev-parse', 'HEAD');
    expect(made).toMatchObject({ exit: 0, outputs: `merged=true\ncheckout=${checkout}\n` });
    // Another machine: another git identity and clock in its environment.
    const elsewhere = { GIT_AUTHOR_NAME: 'other', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'other', GIT_COMMITTER_EMAIL: 'o@o', TZ: 'Asia/Tokyo' };
    const again = await merge(second.clone, record, { head, expect: checkout, env: elsewhere });
    expect(again).toMatchObject({ exit: 0, outputs: `merged=true\ncheckout=${checkout}\n` });

    expect(git(first.clone, 'rev-parse', 'HEAD^1', 'HEAD^2').split('\n')).toEqual([record, head]);
    expect(git(second.clone, 'rev-parse', 'HEAD')).toBe(checkout);
  });

  it("takes the head the pull request's event names when none is given", async () => {
    const { at, upstream, record, head } = await pullRequest();
    const { clone } = job(at, upstream, head, 'event');
    const event = join(at, 'event.json');
    await writeFile(event, JSON.stringify({ pull_request: { head: { sha: head } } }));

    const made = await merge(clone, record, { env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event } });

    expect(made.exit).toBe(0);
    expect(git(clone, 'rev-parse', 'HEAD^2')).toBe(head);
    expect((await merge(clone, record)).said).toContain('`carry merge` needs the head: `--head <sha>`, or a pull request event that names it');
  });

  it("stays on the host's merge when the head conflicts with that commit, or fails a job told it merged", async () => {
    const { at, upstream, head } = await pullRequest('conflicts\n');
    const record = await commitIn(upstream, 'shared.ts', 'record\n');
    await commitIn(upstream, 'shared.ts', 'shared\n');
    const stays = job(at, upstream, head, 'stays');
    const fails = job(at, upstream, head, 'fails');

    expect(await merge(stays.clone, record, { head, onConflict: 'stay' })).toMatchObject({ exit: 0, outputs: 'merged=false\n' });
    expect(git(stays.clone, 'rev-parse', 'HEAD')).toBe(stays.checked);
    expect(git(stays.clone, 'status', '--porcelain')).toBe('');

    const failed = await merge(fails.clone, record, { head, onConflict: 'fail' });
    expect(failed.exit).toBe(2);
    expect(failed.said).toContain('shared.ts');
    expect(git(fails.clone, 'rev-parse', 'HEAD')).toBe(fails.checked);
  });

  it('fails rather than stay when the merge stops on something other than a conflict, naming why', async () => {
    const { at, upstream, record, head } = await pullRequest();
    const { clone, checked } = job(at, upstream, head, 'stops');
    await writeFile(join(clone, '.git', 'hooks', 'pre-merge-commit'), '#!/bin/sh\necho refused by the hook >&2\nexit 1\n', { mode: 0o755 });

    const stopped = await merge(clone, record, { head, onConflict: 'stay' });
    expect(stopped.exit).toBe(2);
    expect(stopped.said).toContain('refused by the hook');
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(checked);
    expect(git(clone, 'status', '--porcelain')).toBe('');
  });

  it('fails, naming the commit, when the clone does not hold it', async () => {
    const { at, upstream, head } = await pullRequest();
    const { clone, checked } = job(at, upstream, head, 'lacks');

    const lacking = await merge(clone, 'f'.repeat(40), { head, onConflict: 'stay' });
    expect(lacking.exit).toBe(2);
    expect(lacking.said).toContain('f'.repeat(40));
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(checked);
  });

  it('merges a head that already holds that commit, so the change still starts there', async () => {
    const { at, upstream, record } = await pullRequest();
    git(upstream, 'checkout', '-q', '-b', 'later', record);
    const holds = await commitIn(upstream, 'later.ts', 'later\n');
    git(upstream, 'branch', '-q', '-f', 'pull', holds);
    git(upstream, 'checkout', '-q', 'main');
    const { clone } = job(at, upstream, holds, 'holds');

    expect(await merge(clone, record, { head: holds })).toMatchObject({ exit: 0 });
    expect(git(clone, 'rev-parse', 'HEAD^1', 'HEAD^2').split('\n')).toEqual([record, holds]);
    expect(git(clone, 'rev-parse', 'HEAD^{tree}')).toBe(git(clone, 'rev-parse', `${holds}^{tree}`));
  });

  it('leaves the checkout as it is when no commit is named', async () => {
    const { at, upstream, head } = await pullRequest();
    const { clone, checked } = job(at, upstream, head, 'none');

    expect(await merge(clone, '', { head })).toMatchObject({ exit: 0, outputs: 'merged=false\n' });
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(checked);
  });

  it('refuses a checkout with changes nobody committed, and leaves them as they are', async () => {
    const { at, upstream, record, head } = await pullRequest();
    const { clone, checked } = job(at, upstream, head, 'dirty');
    await writeFile(join(clone, 'record.ts'), 'edited\n');

    const refused = await merge(clone, record, { head });
    expect(refused.exit).toBe(2);
    expect(refused.said).toContain('`carry merge` stands the checkout on another commit, and record.ts holds changes nobody committed');
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(checked);
    expect(git(clone, 'status', '--porcelain')).toBe('M record.ts');
  });

  it('keeps an uncommitted edit to a file the head changes, which a merge git refused would reset', async () => {
    const { at, upstream, record, head } = await pullRequest();
    const { clone } = job(at, upstream, head, 'overlap');
    git(clone, 'checkout', '-q', '--detach', record);
    await writeFile(join(clone, 'shared.ts'), 'mine\n');

    expect((await merge(clone, record, { head, onConflict: 'stay' })).exit).toBe(2);
    expect(await readFile(join(clone, 'shared.ts'), 'utf8')).toBe('mine\n');
  });

  it('fails a job whose merge is not the commit the deciding job made', async () => {
    const { at, upstream, record, head } = await pullRequest();
    const { clone } = job(at, upstream, head, 'differs');

    const differs = await merge(clone, record, { head, expect: record });
    expect(differs.exit).toBe(2);
    expect(differs.said).toContain(record);
  });

  it('is what `variance carry merge` runs, asking no mainline', async () => {
    let outputs = '';
    const parsed: ParsedCarry = { command: 'carry', direction: 'merge', commit: '', onConflict: 'fail', format: 'github' };
    const exit = await runCarry(parsed, { out: (text) => void (outputs += text), err: () => {} }, () => {
      throw new Error('a merge asks no mainline');
    });

    expect({ exit, outputs }).toEqual({ exit: 0, outputs: 'merged=false\n' });
  });
});
