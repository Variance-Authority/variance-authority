import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { gitDigests } from './tree.js';

/**
 * The one error here is unforgivable and the other one is free.
 *
 * A digest that is *missing* costs a read of the file — the scan hashes it and
 * carries on. A digest that is **stale** is a file that moved and was reported
 * still, which is a subject nobody observes and a green run over it. So every
 * test below is about the working tree disagreeing with `HEAD`, and the assertion
 * is always that the bytes on disk win.
 */

const run = promisify(execFile);

describe('digests read out of git', () => {
  const made: string[] = [];

  afterAll(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
  });

  async function repository(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'variance-tree-'));
    made.push(root);

    await write(root, 'src/Button.tsx', 'export function Button() { return null }\n');
    await write(root, 'src/tokens.css', ':root { --accent: rebeccapurple }\n');

    await git(root, ['init', '--quiet']);
    await git(root, ['add', '-A']);
    await git(root, ['commit', '--quiet', '-m', 'one']);

    return root;
  }

  it('names every tracked file with the digest git already computed', async () => {
    const root = await repository();
    const digests = await gitDigests(root);

    // Nothing was opened to produce this. The blob name *is* the content hash,
    // which is the whole reason a scan can be O(diff) instead of O(repository).
    expect([...(digests?.keys() ?? [])].sort()).toEqual(['src/Button.tsx', 'src/tokens.css']);
    expect(digests?.get('src/Button.tsx')).toBe(await committed(root, 'HEAD:src/Button.tsx'));
  });

  it('keeps the two digest schemes apart', async () => {
    const root = await repository();
    const digests = await gitDigests(root);

    // A `git:` digest and this project's own `v1:` digest describe the same bytes
    // and are not the same string. Comparing them as though they were one would
    // silently equate a closure built from git with one built from reads.
    expect([...(digests?.values() ?? [])].every((digest) => digest.startsWith('git:'))).toBe(true);
  });

  it('reads the bytes on disk, not the bytes in the commit', async () => {
    const root = await repository();
    await write(root, 'src/Button.tsx', 'export function Button() { return <b /> }\n');

    const digests = await gitDigests(root);

    expect(digests?.get('src/Button.tsx')).not.toBe(await committed(root, 'HEAD:src/Button.tsx'));
    expect(digests?.get('src/Button.tsx')).toBe(await onDisk(root, 'src/Button.tsx'));
  });

  it('lands an edit and its revert on the digest it started from', async () => {
    const root = await repository();
    const before = (await gitDigests(root))?.get('src/tokens.css');

    await write(root, 'src/tokens.css', ':root { --accent: hotpink }\n');
    const during = (await gitDigests(root))?.get('src/tokens.css');

    await write(root, 'src/tokens.css', ':root { --accent: rebeccapurple }\n');
    const after = (await gitDigests(root))?.get('src/tokens.css');

    // The difference from a diff, in three lines. Both commits are in a diff
    // against the merge base, so reachability widens; the content came back, so
    // the digest does not.
    expect(during).not.toBe(before);
    expect(after).toBe(before);
  });

  it('digests a file no commit has ever held', async () => {
    const root = await repository();
    await write(root, 'src/Clock.tsx', 'export const Clock = () => null\n');

    const digests = await gitDigests(root);

    // `ls-tree` cannot know about it. Left out, the scan would still read it —
    // but it would read it on every run forever, because a file with no digest
    // is one no cache can ever hit.
    expect(digests?.get('src/Clock.tsx')).toBe(await onDisk(root, 'src/Clock.tsx'));
  });

  it('digests every file in a repository nobody has committed to', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-tree-'));
    made.push(root);
    await write(root, 'src/Button.tsx', 'export function Button() { return null }\n');
    await write(root, 'src/staged.ts', 'export const staged = 1\n');
    await git(root, ['init', '--quiet']);
    await git(root, ['add', 'src/staged.ts']);

    // There is no tree to list, which is an empty listing and not a question Git
    // cannot answer: both files are still named, one staged and one untracked.
    expect(await gitDigests(root)).toEqual(new Map([
      ['src/Button.tsx', await onDisk(root, 'src/Button.tsx')],
      ['src/staged.ts', await onDisk(root, 'src/staged.ts')],
    ]));
  });

  it('drops a path the working tree no longer has', async () => {
    const root = await repository();
    await unlink(join(root, 'src/tokens.css'));

    const digests = await gitDigests(root);

    // Carrying the committed digest for a deleted file would claim its contents
    // are unchanged, which is true of no bytes anywhere.
    expect(digests?.has('src/tokens.css')).toBe(false);
    expect(digests?.has('src/Button.tsx')).toBe(true);
  });

  it('follows a rename to the name on disk', async () => {
    const root = await repository();
    await git(root, ['mv', 'src/tokens.css', 'src/theme.css']);

    const digests = await gitDigests(root);

    // A rename is the one status line that carries two paths, and mistaking the
    // second for a third entry leaves the old name in the map with a digest.
    expect(digests?.has('src/tokens.css')).toBe(false);
    expect(digests?.has('src/theme.css')).toBe(true);
  });

  it('accepts an authoritative changed-file list instead of discovering status', async () => {
    const root = await repository();
    const committedTokens = await committed(root, 'HEAD:src/tokens.css');
    await write(root, 'src/Button.tsx', 'export function Button() { return <b /> }\n');
    await write(root, 'src/tokens.css', ':root { --accent: hotpink }\n');

    const digests = await gitDigests(root, ['src/Button.tsx']);

    expect(digests?.get('src/Button.tsx')).toBe(await onDisk(root, 'src/Button.tsx'));
    // Present means authoritative. The omitted edit is deliberately not
    // rediscovered through status, which is the cost this entrance removes.
    expect(digests?.get('src/tokens.css')).toBe(committedTokens);
  });

  it('spells known-change paths relative to a scan root inside the checkout', async () => {
    const root = await repository();

    const digests = await gitDigests(join(root, 'src'), []);

    expect([...digests?.keys() ?? []].sort()).toEqual(['Button.tsx', 'tokens.css']);
  });

  it('applies known additions, deletions and both sides of a rename', async () => {
    const root = await repository();
    await unlink(join(root, 'src/Button.tsx'));
    await git(root, ['mv', 'src/tokens.css', 'src/theme.css']);
    await write(root, 'src/Clock.tsx', 'export const Clock = () => null\n');

    const digests = await gitDigests(root, [
      'src/Button.tsx',
      'src/tokens.css',
      'src/theme.css',
      'src/Clock.tsx',
    ]);

    expect([...digests?.keys() ?? []].sort()).toEqual(['src/Clock.tsx', 'src/theme.css']);
    expect(digests?.get('src/theme.css')).toBe(await onDisk(root, 'src/theme.css'));
    expect(digests?.get('src/Clock.tsx')).toBe(await onDisk(root, 'src/Clock.tsx'));
  });

  it('refuses a known path that is not scan-root-relative', async () => {
    const root = await repository();

    await expect(gitDigests(root, ['../outside.ts'])).rejects.toThrow(
      'known changed path must be scan-root-relative',
    );
  });

  it('answers nothing outside a checkout rather than failing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-tree-'));
    made.push(root);
    await write(root, 'src/Button.tsx', 'export function Button() { return null }\n');

    // A tarball, a sandbox, a `node_modules` copy. The scanner's own digest is
    // correct and merely slower, so this is a saving that did not apply and not
    // a repository that is misconfigured.
    expect(await gitDigests(root)).toBeUndefined();
  });
});

/** Run `git`, returning its output. Identity is passed in, never inherited. */
async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run(
    'git',
    ['-c', 'user.email=test@example.test', '-c', 'user.name=Test', ...args],
    { cwd: root },
  );

  return stdout.trim();
}

/** The object name git holds for a revision, as the map spells it. */
async function committed(root: string, revision: string): Promise<string> {
  return `git:${await git(root, ['rev-parse', revision])}`;
}

/** The object name the bytes on disk hash to, as the map spells it. */
async function onDisk(root: string, file: string): Promise<string> {
  return `git:${await git(root, ['hash-object', file])}`;
}

async function write(root: string, file: string, contents: string): Promise<void> {
  const path = join(root, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}
