import { execFileSync } from 'node:child_process';
import { access, cp, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tree } from '@variance-authority/mcp/tools';
import { ask, askSearch, askSearchJson } from './ask.js';
import { readWorkspace, readWorkspaceForAnswer, workspaceSnapshotPath } from './read.js';
import { countingShown } from './ask.js';
import { readSearchForAnswer, unopenedLine } from './search-read.js';
import { workspaceSearchPath } from './snapshot.js';
import { importingOf } from './tools/published-match.js';

/**
 * `search` answers from the file published beside the value, and answers what
 * the value answers.
 *
 * The published value is removed before the search is opened, so a reading that
 * fell back on it would fail rather than pass slowly.
 */

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');

let temporary: string;
let root: string;
let at: string;
const QUESTIONS: readonly (readonly string[])[] = [
  ['--query', 'measure'],
  ['--query', 'meesure'],
  ['--query', 'numbers order'],
  ['--query', 'measure', '--from', 'packages/beta/src/again.ts'],
  ['--query', 'measure', '--to', 'packages/alpha/src/values.ts'],
  ['--query', 'nothing-is-called-this'],
];

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'help-search-'));
  root = join(temporary, 'workspace');
  await cp(WORKSPACE, root, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'],
    { cwd: root },
  );
  at = join(root, '.index');
  await readWorkspace(root, { index: at });
});

afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe('search from its published file', () => {
  it('prints what the whole value prints, footer included', async () => {
    let tree: Tree | undefined;
    const help = await readWorkspaceForAnswer(root, { index: at, justAnswer: true, tree: (drawn) => { tree = drawn; } });
    const expected = QUESTIONS.map((args) => ask(help, 'search', args, () => tree));

    await rm(workspaceSnapshotPath(at));
    let searchTree: Tree | undefined;
    const { index: search } = await readSearchForAnswer(root, { index: at, justAnswer: true, tree: (drawn) => { searchTree = drawn; } });

    expect([...(tree?.files ?? [])].length).toBeGreaterThan(0);
    expect([...(searchTree?.files ?? [])]).toEqual([...(tree?.files ?? [])]);
    // The rows are counted against the value, which the whole value's answer holds and the search's is handed.
    expect(QUESTIONS.map((args) => askSearch(search, args, () => searchTree, false, undefined, importingOf(help, undefined)))).toEqual(expected);
    expect(expected[0]).toContain('\nSnapshot ');
  });

  it('publishes the file when only the value was published', async () => {
    const other = join(root, '.upgraded');
    await readWorkspace(root, { index: other });
    await rm(workspaceSearchPath(other));

    const { index: search } = await readSearchForAnswer(root, { index: other });

    await expect(access(workspaceSearchPath(other))).resolves.toBeUndefined();
    const help = await readWorkspaceForAnswer(root, { index: other, justAnswer: true });
    expect(askSearch(search, ['--query', 'measure'], undefined, false, undefined, importingOf(help, undefined))).toEqual(ask(help, 'search', ['--query', 'measure']));
  });

  it('carries, as data, each published row counted as `uses` counts it beside the counts the search ranks by', async () => {
    const counted = join(root, '.counted');
    const help = await readWorkspace(root, { index: counted });
    const { index: search } = await readSearchForAnswer(root, { index: counted });

    const json = (importing?: ReturnType<typeof importingOf>): unknown => JSON.parse(askSearchJson(search, ['--query', 'measure'], undefined, false, undefined, importing));
    const row = { source: 'published', name: 'measure', specifier: 'alpha', at: 'packages/alpha/src/values.ts', otherPackages: 1, otherImports: 1 };
    // Named no checkout, the imports within a package are not read, and the answer says why once.
    expect(json(importingOf(help, undefined))).toMatchObject({
      published: { total: 1, shown: [{ ...row, importedIn: { places: 1, packages: 1 } }] },
      importsUnread: 'this host named no checkout to read the source index of',
    });
    const uncounted = json() as { published: { shown: Record<string, unknown>[] } };
    expect(uncounted.published.shown).toEqual([expect.objectContaining(row)]);
    expect(uncounted.published.shown[0]).not.toHaveProperty('importedIn');
    expect(uncounted).not.toHaveProperty('importsUnread');
  });

  it('opens the value only for a question that shows a published row', async () => {
    const lazy = join(root, '.lazy');
    await readWorkspace(root, { index: lazy });
    // A value opened at all says it did not open.
    await writeFile(workspaceSnapshotPath(lazy), 'not a value');
    const reading = await readSearchForAnswer(root, { index: lazy });

    expect(reading.unopened).toBeUndefined();
    await expect(countingShown(reading, { query: 'nothing-is-called-this' }, undefined, root)).resolves.toEqual({});
    await expect(countingShown(reading, { query: 'measure' }, undefined, root)).resolves.toEqual({
      unopened: [{ published: 'value', at: workspaceSnapshotPath(lazy), reason: expect.stringMatching(/\S/u) }],
    });
  });

  it('opens a published search at any age, and scans nothing', async () => {
    const written = async (): Promise<readonly number[]> =>
      Promise.all([at, workspaceSearchPath(at)].map(async (file) => (await stat(file)).mtimeMs));
    const before = await written();

    const { index: search, compared } = await readSearchForAnswer(root, { index: at, refreshAfterMs: 0 });

    expect(await written()).toEqual(before);
    expect(compared).toBe(false);
    expect(askSearch(search, ['--query', 'measure'])).toContain('measure');
  });

  it('reads the checkout and publishes the search when nothing is published and no flag forbade it', async () => {
    const empty = join(root, '.unread');
    const { index: search, compared } = await readSearchForAnswer(root, { index: empty });

    expect(compared).toBe(true);
    expect(askSearch(search, ['--query', 'measure'])).toContain('measure');
    await expect(access(workspaceSearchPath(empty))).resolves.toBeUndefined();
  });

  it('says nothing failed to open when nothing was published', async () => {
    const reading = await readSearchForAnswer(root, { index: join(root, '.absent') });
    expect(reading.unopened).toBeUndefined();
  });

  it('says which published search did not open, why, and that the checkout was read instead', async () => {
    const broken = join(root, '.broken');
    await writeFile(workspaceSearchPath(broken), 'not a search');

    const reading = await readSearchForAnswer(root, { index: broken });

    expect(reading.compared).toBe(true);
    expect(reading.unopened).toEqual([{ published: 'search', at: workspaceSearchPath(broken), reason: expect.stringMatching(/\S/u) }]);
    const line = unopenedLine(reading.unopened, reading.compared);
    expect(line?.startsWith(`The published search at ${workspaceSearchPath(broken)} did not open (`)).toBe(true);
    expect(line?.endsWith('); the checkout was read instead.')).toBe(true);
    await expect(readSearchForAnswer(root, { index: broken })).resolves.toMatchObject({ compared: false });
  });

  it('names the published search that did not open in the refusal `--just-answer` makes', async () => {
    const broken = join(root, '.broken-refused');
    await writeFile(workspaceSearchPath(broken), 'not a search');
    await expect(readSearchForAnswer(root, { index: broken, justAnswer: true })).rejects.toThrow(
      `the published search at ${workspaceSearchPath(broken)} did not open`,
    );
  });

  it('refuses under `--just-answer` when nothing is published, names that flag, and publishes nothing', async () => {
    const empty = join(root, '.unpublished');
    const refused = readSearchForAnswer(root, { index: empty, justAnswer: true });
    await expect(refused).rejects.toThrow(/none is published/);
    await expect(refused).rejects.toThrow(/asked with `--just-answer`/);
    await expect(access(empty)).rejects.toThrow();
    await expect(access(workspaceSnapshotPath(empty))).rejects.toThrow();
  });
});
