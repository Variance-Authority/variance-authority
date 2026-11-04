import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import * as help from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as read from './read.js';
import { publishedGeneration } from './read.js';
import { publishWorkspaceFromIndex } from './refresh-native.js';
import { readWorkspaceSnapshot, workspaceSnapshotPath } from './snapshot.js';

/**
 * The questions `variance index` publishes, with the manifests read once.
 *
 * Publishing refreshes the value published last from the index, and reads the
 * workspace when it cannot: on the first run, or when the member list or the
 * exported names moved. Each half read every manifest for itself, twice over:
 * once for what each package publishes and once for where an import between
 * packages lands. On a product that lists two thousand members a read of them
 * is seconds.
 */

vi.mock('@variance-authority/package/help', async (original) => {
  const actual = await original<typeof import('@variance-authority/package/help')>();
  return {
    ...actual,
    readImportTargets: vi.fn(actual.readImportTargets),
    readOfferings: vi.fn(actual.readOfferings),
    readWorkspaceManifests: vi.fn(actual.readWorkspaceManifests),
  };
});

vi.mock('./read.js', async (original) => {
  const actual = await original<typeof import('./read.js')>();
  return { ...actual, readWorkspaceOver: vi.fn(actual.readWorkspaceOver) };
});

/** Every read of the manifests since `beforeEach`, by the function that made it. */
function manifestReads(): Record<string, number> {
  return {
    readImportTargets: vi.mocked(help.readImportTargets).mock.calls.length,
    readOfferings: vi.mocked(help.readOfferings).mock.calls.length,
    readWorkspaceManifests: vi.mocked(help.readWorkspaceManifests).mock.calls.length,
  };
}

const ONCE = { readImportTargets: 0, readOfferings: 0, readWorkspaceManifests: 1 };

function forget(): void {
  vi.mocked(help.readImportTargets).mockClear();
  vi.mocked(help.readOfferings).mockClear();
  vi.mocked(help.readWorkspaceManifests).mockClear();
  vi.mocked(read.readWorkspaceOver).mockClear();
}

/** When `variance index` began reading, which the publish that follows it cannot know for itself. */
const BEGAN = '2026-10-18T00:00:00.000Z';

const temporary: string[] = [];
let root: string;
let index: string;

function write(file: string, contents: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'help-publish-from-index-')));
  temporary.push(root);
  write('package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['packages/a', 'packages/b'] }));
  write('packages/a/package.json', JSON.stringify({ name: 'a', exports: { '.': './src/index.ts' } }));
  write('packages/a/src/index.ts', 'export const see = 1;\n');
  write('packages/b/package.json', JSON.stringify({ name: 'b', exports: { '.': './src/index.ts' } }));
  write('packages/b/src/index.ts', "import { see } from 'a';\nexport const b = see;\n");
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  const cache = mkdtempSync(join(tmpdir(), 'help-publish-from-index-cache-'));
  temporary.push(cache);
  index = join(cache, 'source-index.bin');
  // Current, as `variance index` leaves it before it publishes.
  await updateSourceIndex(root, { index });
  forget();
});

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/** The time the published value says its read began. */
function publishedReadStart(): unknown {
  return (JSON.parse(readFileSync(workspaceSnapshotPath(index), 'utf8')) as { readStartedAt?: unknown }).readStartedAt;
}

describe('publishing the questions from the index', () => {
  it('reads the manifests once when nothing was published before', async () => {
    const generation = await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(generation).toEqual(expect.any(String));
    expect(await publishedGeneration(root, index)).toBe(generation);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).toHaveBeenCalledTimes(1);
  });

  it('reads the manifests once when the refresh declines because the members moved', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    write('package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['packages/a'] }));
    await updateSourceIndex(root, { index });
    forget();

    const generation = await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(await publishedGeneration(root, index)).toBe(generation);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).toHaveBeenCalledTimes(1);
  });

  it('reads the manifests once when the refresh declines because the exported names moved', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    write('packages/a/src/index.ts', 'export const see = 1;\nexport const more = 2;\n');
    await updateSourceIndex(root, { index });
    forget();

    const generation = await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(await publishedGeneration(root, index)).toBe(generation);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).toHaveBeenCalledTimes(1);
  });

  it('reads the manifests once when the refresh applies', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    // The first refresh stamps the value with the index it was refreshed from.
    const refreshed = await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    forget();

    expect(await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN })).toBe(refreshed);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).not.toHaveBeenCalled();
  });

  it('reads the manifests once when the refresh reads the files the index moved', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    const first = await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    write('packages/b/src/index.ts', "import { see } from 'a';\nexport const b = see + 1;\n");
    await updateSourceIndex(root, { index });
    forget();

    const refreshed = await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(refreshed).not.toBe(first);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).not.toHaveBeenCalled();
  });

  /** The entry `a` publishes as `name` in the value on disk. */
  const published = async (name: string) => (await readWorkspaceSnapshot(root, { index })).packages
    .flatMap((held) => held.openings)
    .flatMap((opening) => opening.entries)
    .find((entry) => entry.name === name);

  it.each([
    ['moved', '// one\n// two\nexport const see = 1;\n', { line: 3 }],
    ['rewrote', 'export const see: number = 1;\n', { signature: 'const see: number' }],
    ['documented', '/** What it sees. */\nexport const see = 1;\n', { line: 2, doc: 'What it sees.' }],
  ])('reads the workspace when a file %s a declaration it publishes', async (_edit, text, expected) => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    write('packages/a/src/index.ts', text);
    await updateSourceIndex(root, { index });
    forget();

    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(await published('see')).toMatchObject(expected);
  });

  it('reads the workspace when a declaration moves under an export statement that stays', async () => {
    write('packages/a/src/index.ts', 'export { see };\nconst see = 1;\n');
    await updateSourceIndex(root, { index });
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    write('packages/a/src/index.ts', 'export { see };\n// one\nconst see = 1;\n');
    await updateSourceIndex(root, { index });
    forget();

    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect((await published('see'))?.line).toBe(3);
  });

  it.each([
    ['`export *`', 'export const other = 2;\n', "export * from './deep.js';\nexport * from './other.js';\n", "export * from './other.js';\n"],
    ['`export … from` that leads elsewhere', 'export const deep = 2;\n', "export { deep } from './deep.js';\n", "export { deep } from './other.js';\n"],
  ])('reads the workspace when a barrel between an entry and a name drops or moves its %s', async (_edit, other, kept, cut) => {
    write('packages/a/src/index.ts', "export * from './mid.js';\n");
    write('packages/a/src/mid.ts', kept);
    write('packages/a/src/deep.ts', 'export const deep = 1;\n');
    write('packages/a/src/other.ts', other);
    await updateSourceIndex(root, { index });
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    const before = await published('deep');
    write('packages/a/src/mid.ts', cut);
    await updateSourceIndex(root, { index });
    forget();

    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(before?.at).toBe('packages/a/src/deep.ts');
    expect((await published('deep'))?.at).not.toBe('packages/a/src/deep.ts');
  });

  /**
   * One exported name and one target file on both sides of the edit: only the
   * binding it takes out of that file moved, which every one of these publishes
   * something else for.
   */
  const RETARGETED = [
    ['a named binding', 'shared', "export { foo as shared } from './implementation.js';\n", "export { bar as shared } from './implementation.js';\n", { line: 2, signature: 'const bar' }],
    ['the default', 'shared', "export { default as shared } from './implementation.js';\n", "export { bar as shared } from './implementation.js';\n", { line: 2, signature: 'const bar' }],
    ['a whole module', 'ns', "export * as ns from './implementation.js';\n", "export { ns } from './implementation.js';\n", { line: 3, signature: 'const ns' }],
    ['a binding it imported first', 'shared', "import { foo } from './implementation.js';\nexport { foo as shared };\n", "import { bar } from './implementation.js';\nexport { bar as shared };\n", { line: 2, signature: 'const bar' }],
    ['a binding it renamed on the way in', 'shared', "import { foo as held } from './implementation.js';\nexport { held as shared };\n", "import { bar as held } from './implementation.js';\nexport { held as shared };\n", { line: 2, signature: 'const bar' }],
  ] as const;
  const IMPLEMENTATION = 'export const foo = 1;\nexport const bar = 2;\nexport const ns = 3;\nexport default function whole(): void {}\n';

  const retargeting = async (before: string): Promise<void> => {
    write('packages/a/src/index.ts', before);
    write('packages/a/src/implementation.ts', IMPLEMENTATION);
    await updateSourceIndex(root, { index });
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
  };

  it.each(RETARGETED)('reads the workspace when `variance index` finds an entry passing on another binding in place of %s', async (_binding, name, before, after, expected) => {
    await retargeting(before);
    write('packages/a/src/index.ts', after);
    await updateSourceIndex(root, { index });
    forget();

    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(await published(name)).toMatchObject(expected);
  });

  it.each(RETARGETED)('documents the workspace when a refresh of the changed file finds another binding in place of %s', async (_binding, name, before, after, expected) => {
    await retargeting(before);
    const documented = await read.readWorkspaceForAnswer(root, { index });
    write('packages/a/src/index.ts', after);

    const refreshed = await read.refreshWorkspace(root, documented, { index, changed: ['packages/a/src/index.ts'] });

    expect(refreshed.packages.flatMap((held) => held.openings).flatMap((opening) => opening.entries).find((entry) => entry.name === name)).toMatchObject(expected);
  });

  it('refreshes from the index over barrels that did not change', async () => {
    write('packages/a/src/index.ts', "export * from './mid.js';\nexport { deep as renamed } from './deep.js';\nexport { default as whole } from './deep.js';\nexport * as ns from './deep.js';\n");
    write('packages/a/src/mid.ts', "export * from './deep.js';\n");
    write('packages/a/src/deep.ts', 'export const deep = 1;\nexport default function kept(): void {}\n');
    await updateSourceIndex(root, { index });
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    write('packages/b/src/index.ts', "import { see } from 'a';\nexport const b = see + 1;\n");
    await updateSourceIndex(root, { index });
    forget();

    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(read.readWorkspaceOver).not.toHaveBeenCalled();
  });

  it('refreshes from the index when the export that moved is one nothing publishes', async () => {
    write('packages/a/src/inner.ts', 'export const inner = 1;\n');
    await updateSourceIndex(root, { index });
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    write('packages/a/src/inner.ts', '// one\nexport const inner = 1;\n');
    await updateSourceIndex(root, { index });
    forget();

    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(read.readWorkspaceOver).not.toHaveBeenCalled();
    expect((await readWorkspaceSnapshot(root, { index })).exported.find((row) => row.name === 'inner')?.line).toBe(2);
  });

  it('publishes the time its caller began reading, when it reads the workspace itself', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(read.readWorkspaceOver).toHaveBeenCalledTimes(1);
    expect(publishedReadStart()).toBe(BEGAN);
  });

  it('publishes the time its caller began reading, when it refreshes from the index', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: new Date().toISOString() });
    write('packages/b/src/index.ts', "import { see } from 'a';\nexport const b = see + 1;\n");
    await updateSourceIndex(root, { index });
    forget();

    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(read.readWorkspaceOver).not.toHaveBeenCalled();
    expect(publishedReadStart()).toBe(BEGAN);
  });

  it('writes the export rows a read writes, whichever way each export binds', async () => {
    write('packages/a/src/declared.ts', 'export const see = 1;\nexport type Kind = string;\nexport const Kind = 2;\nconst kept = 3;\nexport { kept as renamed };\n');
    write('packages/a/src/named-default.ts', 'export default function named(): void {}\n');
    write('packages/a/src/anonymous-default.ts', 'export default 42;\n');
    write('packages/a/src/default-binding.ts', 'const held = 1;\nexport default held;\n');
    write('packages/a/src/passes.ts', "import { see } from './declared.js';\nimport * as whole from './declared.js';\nexport { see, whole };\nexport { see as seen };\n");
    write('packages/a/src/from.ts', "export { see } from './declared.js';\nexport { see as other } from './declared.js';\nexport * as ns from './declared.js';\nexport * from './declared.js';\n");
    await updateSourceIndex(root, { index });

    const rows = async () => (await readWorkspaceSnapshot(root, { index })).exported
      .toSorted((a, b) => codeUnitOrder(a.at, b.at) || a.line - b.line || codeUnitOrder(a.name, b.name));
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });
    const first = await rows();
    await publishWorkspaceFromIndex(root, { index, readStartedAt: BEGAN });

    expect(first.find((row) => row.name === 'renamed')?.bound).toBe('kept');
    expect(await rows()).toEqual(first);
  });
});
