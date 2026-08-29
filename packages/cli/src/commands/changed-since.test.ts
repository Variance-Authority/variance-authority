import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedSince } from './resources.js';

/**
 * The join between the two ways a file gets named, which is where this quietly
 * went wrong.
 *
 * `git` answers from the repository root and the file graph asks from the
 * directory the run started in. When those differ, nothing throws: every changed
 * path matches nothing, the walk reports it reaches no component, and a package
 * inside a monorepo either narrows to the whole suite or refuses — for a reason
 * that never appears on the page. So the failure being tested for here is not an
 * error, it is an answer in the wrong coordinates, and the only way to catch it
 * is a real checkout with a real subdirectory in it.
 */

const cwd = process.cwd();
afterEach(() => process.chdir(cwd));

function repo(at: string): void {
  mkdirSync(at, { recursive: true });
  git(at, ['init', '--quiet', '--initial-branch', 'main']);
  git(at, ['config', 'user.email', 'fixture@example.test']);
  git(at, ['config', 'user.name', 'Fixture']);
}

function git(at: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd: at, stdio: 'pipe' });
}

function commit(at: string, files: Readonly<Record<string, string>>, message: string): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(at, path, '..'), { recursive: true });
    writeFileSync(join(at, path), body);
  }
  git(at, ['add', '-A']);
  git(at, ['commit', '--quiet', '-m', message]);
}

describe('what a diff touched, named the way the run names files', () => {
  it('answers a package inside a monorepo in that package s own terms', () => {
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    commit(root, { 'pkg/src/Button.tsx': 'export const Button = 1;\n' }, 'first');
    commit(root, { 'pkg/src/Button.tsx': 'export const Button = 2;\n' }, 'second');

    process.chdir(join(root, 'pkg'));

    // `pkg/src/Button.tsx` is what git says and it is a path this run's file
    // graph has never heard of: the graph was built from `src`, relative to here.
    return expect(changedSince('HEAD~1', ['src'])).resolves.toEqual(['src/Button.tsx']);
  });

  it('reads the checkout the source is actually in, not the one above it', async () => {
    // The vendored-subject layout: the outer repository holds the integration and
    // ignores the application, which is a checkout of its own. Asking the outer
    // repository answers "nothing changed" about a tree it was told to ignore —
    // which is a green run over an edit nobody looked at.
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    commit(root, { '.gitignore': 'app/\n', 'variance.config.json': '{}\n' }, 'the integration');

    const app = join(root, 'app');
    repo(app);
    commit(app, { 'src/ui/button.tsx': 'export const Button = 1;\n' }, 'the shop');
    commit(app, { 'src/ui/button.tsx': 'export const Button = 2;\n' }, 'the revision');

    process.chdir(root);

    expect(await changedSince('HEAD~1', ['app/src'])).toEqual(['app/src/ui/button.tsx']);
    // And the outer repository, asked the same question, has nothing to say.
    expect(await changedSince('HEAD', [])).toEqual([]);
  });

  it('refuses rather than answering a broken git with an empty diff', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    commit(root, { 'src/a.ts': 'export const a = 1;\n' }, 'first');
    process.chdir(root);

    // An empty list means "this diff touched nothing", and a run that narrowed
    // itself to nothing on the strength of a missing ref would report success.
    await expect(changedSince('no-such-ref', ['src'])).rejects.toThrow(/could not list what changed/);
  });
});
