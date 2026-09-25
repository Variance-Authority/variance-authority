import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedSince, diffSince } from './since.js';

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

  it('measures from the merge base to the working tree, uncommitted edits included', async () => {
    // A watch loop asks about the edit that was just saved. `ref...HEAD` would
    // answer about the last commit, and a save to a module every subject
    // crosses would narrow the run to what the previous commit touched.
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    commit(root, { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' }, 'base');
    git(root, ['checkout', '--quiet', '-b', 'feature']);
    commit(root, { 'src/a.ts': 'export const a = 2;\n' }, 'on the branch');
    git(root, ['checkout', '--quiet', 'main']);
    // `main` moves on: what somebody else merged is not what this branch changed.
    commit(root, { 'src/b.ts': 'export const b = 2;\n' }, 'on main');
    git(root, ['checkout', '--quiet', 'feature']);
    writeFileSync(join(root, 'src/c.ts'), 'export const c = 1;\n');
    git(root, ['add', 'src/c.ts']);
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 3;\n');
    process.chdir(root);

    expect(await changedSince('main', ['src'])).toEqual(['src/a.ts', 'src/c.ts']);
    const diff = await diffSince('main', ['src']);
    expect(diff).toContain('+++ b/src/a.ts');
    expect(diff).toContain('+export const a = 3;');
    expect(diff).toContain('+++ b/src/c.ts');
    expect(diff).not.toContain('src/b.ts');
  });

  it('reads hunks from the commit it is given, not the merge base, when an index names one', async () => {
    // The execution index's line ranges are in the coordinates of the commit it
    // was recorded at. Recorded after `main` moved, the merge base is behind
    // that commit and a hunk read there lands on lines the index never numbered.
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    commit(root, { 'src/a.ts': 'export const a = 1;\n' }, 'first');
    git(root, ['checkout', '--quiet', '-b', 'feature']);
    commit(root, { 'src/b.ts': 'export const b = 1;\n' }, 'recorded here');
    const recorded = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    writeFileSync(join(root, 'src/b.ts'), 'export const b = 2;\n');
    process.chdir(root);

    const diff = await diffSince('main', ['src'], recorded);
    expect(diff).toContain('-export const b = 1;');
    expect(diff).toContain('+export const b = 2;');
    expect(diff).not.toContain('src/a.ts');
    expect(await diffSince('main', ['src'])).toContain('+++ b/src/b.ts');
    expect(await diffSince('main', ['src'])).not.toContain('-export const b = 1;');
  });

  // The index *does* carry a digest of every module it recorded, and the
  // selector now checks it: a module recorded over a dirty tree is charged whole
  // and named in `stale` rather than read at line numbers that mean something
  // else here (`select.ts`, `recorded()`; `resources.ts`, `journeyAgainst`).
  // What is still missing is the other half — reading the hunks *against* those
  // texts — and a digest cannot give it, because a hash does not reconstruct a
  // file. That needs the recording to keep the text, or a blob to keep it for it.
  it.todo(
    'measures from the tree the index was recorded over, not its commit, when that tree was dirty — needs the recorded text itself, which a digest of it cannot supply',
  );

  it('names a path with a character outside ASCII or a space as the file it is, in both answers', async () => {
    // `core.quotePath` writes `src/café.ts` as `"src/caf\303\251.ts"`, quotes
    // included, and a list holding that string matches nothing: the file is
    // treated as untouched, and so are its importers.
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    commit(root, { 'src/café.ts': 'export const a = 1;\n', 'src/two words.ts': 'export const b = 1;\n' }, 'first');
    git(root, ['checkout', '--quiet', '-b', 'feature']);
    writeFileSync(join(root, 'src/café.ts'), 'export const a = 2;\n');
    writeFileSync(join(root, 'src/two words.ts'), 'export const b = 2;\n');
    process.chdir(root);

    expect(await changedSince('main', ['src'])).toEqual(['src/café.ts', 'src/two words.ts']);
    const diff = await diffSince('main', ['src']);
    expect(diff).toContain('+++ b/src/café.ts');
    expect(diff).toContain('+++ b/src/two words.ts');
    expect(diff).not.toContain('\\303');
  });

  it('includes a file no commit holds yet, as the addition it is', async () => {
    // A new module and the edit that imports it arrive together, and `git diff`
    // lists only the edit. The new file is the one the graph has to be asked
    // about, since nothing in any snapshot has a row for it.
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    commit(root, { 'src/a.ts': 'export const a = 1;\n' }, 'first');
    writeFileSync(join(root, 'src/new.ts'), 'export const fresh = 1;\n');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'node_modules\n');
    writeFileSync(join(root, 'node_modules/ignored.ts'), 'export const no = 1;\n');
    process.chdir(root);

    expect(await changedSince('main', ['src'])).toEqual(['.gitignore', 'src/new.ts']);
    const diff = await diffSince('main', ['src']);
    expect(diff).toContain('+++ b/src/new.ts');
    expect(diff).toContain('+export const fresh = 1;');
    expect(diff).not.toContain('ignored.ts');
  });

  it('reads a diff under its own prefixes whatever the operator configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    git(root, ['config', 'diff.noprefix', 'true']);
    git(root, ['config', 'diff.mnemonicPrefix', 'true']);
    commit(root, { 'src/a.ts': 'export const a = 1;\n' }, 'first');
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 2;\n');
    process.chdir(root);

    const diff = await diffSince('main', ['src']);
    expect(diff).toContain('--- a/src/a.ts');
    expect(diff).toContain('+++ b/src/a.ts');
  });

  it('reads a change back from the working tree on the lines the working tree numbers, still `a/` over `b/`', async () => {
    // A record written after the change ran numbers the working tree, so the
    // hunk a reader charges has to be read on that side; forward, `b = 3` would
    // land on the base's line 2, which does not exist.
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    commit(root, { 'src/a.ts': 'export const a = 1;\n' }, 'first');
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 2;\nexport const b = 3;\n');
    writeFileSync(join(root, 'src/new.ts'), 'export const fresh = 1;\n');
    process.chdir(root);

    const diff = await diffSince('main', ['src'], undefined, { reverse: true });
    expect(diff).toContain('--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1 @@\n-export const a = 2;\n-export const b = 3;\n');
    expect(diff).toContain('--- a/src/new.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-export const fresh = 1;');
  });

  it('shows a renamed file as the removal and the addition it is', async () => {
    // A rename with an edit would otherwise arrive as hunks under the new name
    // in the old file's coordinates; shown apart, the old name is charged whole
    // under the rows the index has for it and the new one is asked of the graph.
    const root = mkdtempSync(join(tmpdir(), 'va-since-'));
    repo(root);
    const body = Array.from({ length: 12 }, (_, line) => `export const a${line} = ${line};`).join('\n');
    commit(root, { 'src/a.ts': `${body}\n` }, 'first');
    git(root, ['checkout', '--quiet', '-b', 'feature']);
    git(root, ['mv', 'src/a.ts', 'src/b.ts']);
    commit(root, { 'src/b.ts': `${body.replace('a7 = 7', 'a7 = 8')}\n` }, 'moved');
    process.chdir(root);

    const diff = await diffSince('main', ['src']);
    expect(diff).toContain('--- a/src/a.ts\n+++ /dev/null');
    expect(diff).toContain('--- /dev/null\n+++ b/src/b.ts');
    expect(diff).not.toContain('rename from');
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
