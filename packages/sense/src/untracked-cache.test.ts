import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { gitTreeOf } from './tree.js';
import { workingTreeChanges } from './working-tree-changes.js';

/**
 * The untracked files, asked the way git's untracked cache answers.
 *
 * Git answers from its untracked cache only in the mode the repository
 * configures in `status.showUntrackedFiles`, and only with no pathspec. Asked
 * any other way it walks every directory again: on a checkout of 812,428 paths
 * configured for `all`, `--untracked-files=normal` walked 185,251 directories
 * in 12.7–16.9 s where the configured mode took 1.05 s, and `-- .` below the
 * top took 4.2–5.2 s where the whole checkout took 1.2–2.0 s. Whether the
 * cache answered is git's own trace: `read_directory` counts the cache's nodes
 * only when it is in use.
 */

const run = promisify(execFile);
const made: string[] = [];

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** A checkout with the untracked cache on, an untracked file inside `src/` and one beside it. */
async function repository(mode: string | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variance-untracked-'));
  made.push(root);
  await write(root, 'src/Button.tsx', 'export function Button() { return null }\n');
  await write(root, 'other/kept.ts', 'export const kept = 1\n');
  await git(root, ['init', '--quiet']);
  await git(root, ['config', 'core.untrackedCache', 'true']);
  if (mode !== undefined) await git(root, ['config', 'status.showUntrackedFiles', mode]);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '--quiet', '-m', 'one']);
  await write(root, 'src/fresh/Clock.tsx', 'export const Clock = () => null\n');
  await write(root, 'other/fresh/stray.ts', 'export const stray = 1\n');
  return root;
}

/** Whether git's untracked cache answered every `status` that `ask` ran. */
async function cached(root: string, ask: () => Promise<unknown>): Promise<boolean> {
  // The first ask writes the cache; the second is the one that reads it.
  await ask();
  const trace = join(root, '..', `${root.split('/').at(-1)}.trace2.json`);
  made.push(trace);
  process.env['GIT_TRACE2_EVENT'] = trace;
  // The cache's counts sit three regions deep, below the depth the event target keeps by default.
  process.env['GIT_TRACE2_EVENT_NESTING'] = '10';
  try {
    await ask();
  } finally {
    delete process.env['GIT_TRACE2_EVENT'];
    delete process.env['GIT_TRACE2_EVENT_NESTING'];
  }
  const events = (await readFile(trace, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as {
    readonly sid: string;
    readonly event: string;
    readonly argv?: readonly string[];
    readonly key?: string;
  });
  const statuses = new Set(events.filter((event) => event.argv?.[1] === 'status').map((event) => event.sid));
  const answered = new Set(events.filter((event) => event.key === 'node-creation').map((event) => event.sid));
  return statuses.size > 0 && [...statuses].every((sid) => answered.has(sid));
}

describe('the untracked files of a checkout that caches them', () => {
  for (const mode of ['all', undefined]) {
    const configured = mode === undefined ? 'with no mode configured' : `configured for \`${mode}\``;

    it(`are read from the cache at the top of the checkout, ${configured}`, async () => {
      const root = await repository(mode);

      expect(await cached(root, () => workingTreeChanges(root, ''))).toBe(true);
      expect(await cached(root, () => gitTreeOf(root, ['.']))).toBe(true);
      const changes = await workingTreeChanges(root, '');
      expect([...changes?.changed ?? []].sort()).toEqual(['other/fresh/stray.ts', 'src/fresh/Clock.tsx']);
    });

    it(`are read from the cache below the top, and only the root's are kept, ${configured}`, async () => {
      const root = await repository(mode);
      const src = join(root, 'src');

      expect(await cached(root, () => workingTreeChanges(src, 'src/'))).toBe(true);
      expect(await cached(root, () => gitTreeOf(src, ['.']))).toBe(true);
      expect(await workingTreeChanges(src, 'src/')).toEqual({ changed: ['fresh/Clock.tsx'], gone: [] });
      const tree = await gitTreeOf(src, ['.']);
      expect(tree?.paths()).toEqual(['Button.tsx', 'fresh/Clock.tsx']);
    });

    // Asked in `normal` mode, git collapses an untracked directory to one line,
    // and the root, or a directory above it, can be that line.
    it(`are every file of a root git has never tracked, and of one inside an untracked directory, ${configured}`, async () => {
      const root = await repository(mode);
      await write(root, 'fresh/pkg/src/a.ts', 'export const a = 1\n');
      const fresh = join(root, 'fresh');
      const pkg = join(fresh, 'pkg');

      expect(await workingTreeChanges(fresh, 'fresh/')).toEqual({ changed: ['pkg/src/a.ts'], gone: [] });
      expect(await workingTreeChanges(pkg, 'fresh/pkg/')).toEqual({ changed: ['src/a.ts'], gone: [] });
      expect((await gitTreeOf(fresh, ['.']))?.paths()).toEqual(['pkg/src/a.ts']);
      expect((await gitTreeOf(pkg, ['.']))?.paths()).toEqual(['src/a.ts']);
    });
  }
});

/** Run `git`, returning its output. Identity is passed in, never inherited. */
async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run(
    'git',
    ['-c', 'user.email=test@example.test', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root },
  );
  return stdout.trim();
}

async function write(root: string, file: string, contents: string): Promise<void> {
  const path = join(root, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}
