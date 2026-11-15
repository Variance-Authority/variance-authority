import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { importersOf, readySourceIndex, updateSourceIndex } from '@variance-authority/sense';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publishWorkspaceFromIndex } from './refresh-native.js';
import { readWorkspaceSnapshot, searchIndexOf } from './snapshot.js';

/**
 * The questions `variance index` publishes live in the chain they were read
 * from: the manifest names the store beside the segments it was drawn over,
 * and no file of its own sits beside the index. A question answers as of that
 * reading, so another writer appending to the chain after it cannot mix two
 * generations into one answer.
 */

const BEGAN = '2026-10-18T00:00:00.000Z';
const temporary: string[] = [];
let root: string;
let index: string;

function write(file: string, contents: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/** The manifest at `index`, as JSON: what the chain names. */
function manifest(): { segments: { digest: string }[]; workspace?: { digest: string; over: string[]; given?: boolean } } {
  const bytes = readFileSync(index);
  return JSON.parse(bytes.toString('utf8', 12)) as ReturnType<typeof manifest>;
}

/** Every file beside the index, with its size and when it was last written. */
const written = (): readonly string[] => readdirSync(dirname(index))
  .map((name) => { const at = statSync(join(dirname(index), name)); return `${name} ${at.size} ${at.mtimeMs}`; })
  .toSorted(codeUnitOrder);

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'help-published-in-chain-')));
  temporary.push(root);
  write('package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['packages/a', 'packages/b'] }));
  write('packages/a/package.json', JSON.stringify({ name: 'a', exports: { '.': './src/index.ts' } }));
  write('packages/a/src/index.ts', 'export const see = 1;\n');
  write('packages/b/package.json', JSON.stringify({ name: 'b', exports: { '.': './src/index.ts' } }));
  write('packages/b/src/index.ts', "import { see } from 'a';\nexport const b = see;\n");
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  const cache = mkdtempSync(join(tmpdir(), 'help-published-in-chain-cache-'));
  temporary.push(cache);
  index = join(cache, 'source-index.bin');
  await updateSourceIndex(root, { index });
});

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

describe('the questions published in the chain', () => {
  it('names the store in the manifest, drawn over the segments it read, with no file of its own beside the index', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(readdirSync(dirname(index)).filter((name) => name.endsWith('.help.bin'))).toEqual([]);
    const { segments, workspace } = manifest();
    expect(workspace?.over).toEqual(segments.map((segment) => segment.digest));
    expect((await readWorkspaceSnapshot(root, { index })).packages.map((held) => held.name)).toEqual(['a', 'b']);
  });

  it('publishes again when a manifest opens another entry, and the openings answer it', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    write('packages/a/package.json', JSON.stringify({ name: 'a', exports: { '.': './src/index.ts', './extra': './src/extra.ts' } }));
    write('packages/a/src/extra.ts', 'export const extra = 2;\n');
    await updateSourceIndex(root, { index });

    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    const a = (await readWorkspaceSnapshot(root, { index })).packages.find((held) => held.name === 'a');
    expect(a?.openings.map((opening) => opening.subpath)).toEqual(['.', './extra']);
    const { segments, workspace } = manifest();
    expect(workspace?.over).toEqual(segments.map((segment) => segment.digest));
  });

  it('answers who imports a name as the published value does after another writer appends to the chain', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    write('packages/b/src/late.ts', "import { see } from 'a';\nexport const late = see;\n");
    await updateSourceIndex(root, { index });

    const help = await readWorkspaceSnapshot(root, { index });
    const published = help.packages.find((held) => held.name === 'a')!.openings[0]!.entries.find((entry) => entry.name === 'see')!;
    const importers = importersOf(root, ['packages/a/src/index.ts'], 'see', index);

    // A file whose import of `a` resolves to no file of the fixture, which links no package, is `unresolved`.
    const reading = [...new Set([...importers?.uses.map((use) => use.at) ?? [], ...importers?.unresolved ?? []])];
    expect(reading).toEqual([...new Set(published.sites.map((use) => use.at))]);
    expect(reading).toEqual(['packages/b/src/index.ts']);
  });

  it('keeps the published value readable over the chain a readying folded, and a refresh after it writes nothing', async () => {
    write('packages/b/src/index.ts', "import { see } from 'a';\nexport const b = see + 1;\n");
    await updateSourceIndex(root, { index });
    const generation = await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(await readySourceIndex(index)).toBe(true);

    const { segments, workspace } = manifest();
    expect(segments).toHaveLength(1);
    expect(workspace?.over).toEqual([segments[0]!.digest]);
    expect((await readWorkspaceSnapshot(root, { index })).packages.map((held) => held.name)).toEqual(['a', 'b']);
    const before = written();
    expect(await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN })).toBe(generation);
    expect(written()).toEqual(before);
  });

  it('keeps a search hit for each of two files of the same text', async () => {
    write('packages/a/package.json', JSON.stringify({ name: 'a', exports: { '.': './src/index.ts', './twin': './src/twin.ts' } }));
    write('packages/b/package.json', JSON.stringify({ name: 'b', exports: { '.': './src/index.ts', './twin': './src/twin.ts' } }));
    write('packages/a/src/twin.ts', '/** One of two of the same text. */\nexport const twin = 1;\n');
    write('packages/b/src/twin.ts', '/** One of two of the same text. */\nexport const twin = 1;\n');
    await updateSourceIndex(root, { index });

    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    const search = searchIndexOf(await readWorkspaceSnapshot(root, { index }));
    const [name] = search.namesContaining('twin');
    expect([...search.exportedOf(name!)].map((row) => search.exportedAt(row)).toSorted(codeUnitOrder)).toEqual(['packages/a/src/twin.ts', 'packages/b/src/twin.ts']);
  });
});
