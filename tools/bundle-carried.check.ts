import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLE, bundleCarried } from './bundle-carried.mjs';

/**
 * The merge `check.yml` makes of a pull request's head and the commit the
 * mainline's record was made at is on no remote, so the push that ran on it
 * bundles it beside the records it kept, and the next push fetches the
 * bundle's heads before `variance carry take` asks the remote for the rest.
 */

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function commitIn(repo: string, file: string, text: string): Promise<string> {
  await writeFile(join(repo, file), text);
  git(repo, 'add', file);
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file);
  return git(repo, 'rev-parse', 'HEAD');
}

/** An upstream with one commit on `main`, and two clones of it. */
async function upstreamWithClones(): Promise<{ earlier: string; clone: string; base: string }> {
  const at = await mkdtemp(join(tmpdir(), 'bundle-carried-'));
  const upstream = join(at, 'upstream');
  await mkdir(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  const base = await commitIn(upstream, 'a.ts', 'a\n');
  const earlier = join(at, 'earlier');
  const clone = join(at, 'clone');
  git(at, 'clone', '-q', '--no-local', upstream, earlier);
  git(at, 'clone', '-q', '--no-local', upstream, clone);
  return { earlier, clone, base };
}

async function carry(dir: string, suite: string, commit: string, standing: readonly string[] = []): Promise<void> {
  const at = '2026-10-06T00:00:00.000Z';
  await mkdir(join(dir, suite), { recursive: true });
  await writeFile(join(dir, suite, 'coverage.bin'), 'carried');
  await writeFile(
    join(dir, suite, 'coverage.runs.json'),
    JSON.stringify({
      commit,
      latest: at,
      runs: 1,
      landings: [{ files: ['a.test.ts'], first: at, latest: at, runs: 1 }],
      standing: standing.map((one) => ({ commit: one, files: ['b.test.ts'] })),
    }),
  );
}

describe('a merge no remote holds travels beside the records', () => {
  it('bundles the merge, and the next clone reads it from the bundle alone', async () => {
    const { earlier, clone, base } = await upstreamWithClones();
    const head = await commitIn(earlier, 'c.ts', 'c\n');
    git(earlier, 'checkout', '-q', '--detach', base);
    git(earlier, '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '-q', '--no-ff', '--no-edit', head);
    const merge = git(earlier, 'rev-parse', 'HEAD');
    const carried = join(earlier, '.carried');
    await carry(carried, 'unit', merge, [base]);

    expect(await bundleCarried(earlier, carried, 'refs/remotes/origin/main')).toEqual({ bundled: [merge], absent: [] });
    expect(git(earlier, 'for-each-ref', 'refs/carried/')).toBe('');

    const bundle = join(carried, BUNDLE);
    const heads = git(clone, 'bundle', 'list-heads', bundle).split('\n').map((line) => line.split(' ')[1] ?? '');
    git(clone, 'fetch', '--quiet', '--no-tags', bundle, ...heads);
    expect(git(clone, 'rev-parse', `${merge}^2`)).toBe(head);
    expect(git(clone, 'for-each-ref', 'refs/carried/')).toBe('');
  });

  it('names a commit the clone does not hold, and bundles the rest', async () => {
    const { earlier, base } = await upstreamWithClones();
    const ahead = await commitIn(earlier, 'c.ts', 'c\n');
    const lost = 'f'.repeat(40);
    const carried = join(earlier, '.carried');
    await carry(carried, 'unit', base, [ahead, lost]);

    expect(await bundleCarried(earlier, carried, 'refs/remotes/origin/main')).toEqual({ bundled: [ahead], absent: [lost] });
  });

  it('writes no bundle when every commit the records name is on the mainline', async () => {
    const { earlier, base } = await upstreamWithClones();
    const carried = join(earlier, '.carried');
    await carry(carried, 'unit', base);

    expect(await bundleCarried(earlier, carried, 'refs/remotes/origin/main')).toEqual({ bundled: [], absent: [] });
    expect(existsSync(join(carried, BUNDLE))).toBe(false);
  });
});
