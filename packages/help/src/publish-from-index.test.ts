import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as help from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as read from './read.js';
import { publishedGeneration } from './read.js';
import { publishWorkspaceFromIndex } from './refresh-native.js';

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

describe('publishing the questions from the index', () => {
  it('reads the manifests once when nothing was published before', async () => {
    const generation = await publishWorkspaceFromIndex(root, { index });

    expect(generation).toEqual(expect.any(String));
    expect(await publishedGeneration(root, index)).toBe(generation);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).toHaveBeenCalledTimes(1);
  });

  it('reads the manifests once when the refresh declines because the members moved', async () => {
    await publishWorkspaceFromIndex(root, { index });
    write('package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['packages/a'] }));
    await updateSourceIndex(root, { index });
    forget();

    const generation = await publishWorkspaceFromIndex(root, { index });

    expect(await publishedGeneration(root, index)).toBe(generation);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).toHaveBeenCalledTimes(1);
  });

  it('reads the manifests once when the refresh declines because the exported names moved', async () => {
    await publishWorkspaceFromIndex(root, { index });
    write('packages/a/src/index.ts', 'export const see = 1;\nexport const more = 2;\n');
    await updateSourceIndex(root, { index });
    forget();

    const generation = await publishWorkspaceFromIndex(root, { index });

    expect(await publishedGeneration(root, index)).toBe(generation);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).toHaveBeenCalledTimes(1);
  });

  it('reads the manifests once when the refresh applies', async () => {
    await publishWorkspaceFromIndex(root, { index });
    // The first refresh stamps the value with the index it was refreshed from.
    const refreshed = await publishWorkspaceFromIndex(root, { index });
    forget();

    expect(await publishWorkspaceFromIndex(root, { index })).toBe(refreshed);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).not.toHaveBeenCalled();
  });

  it('reads the manifests once when the refresh reads the files the index moved', async () => {
    await publishWorkspaceFromIndex(root, { index });
    const first = await publishWorkspaceFromIndex(root, { index });
    write('packages/b/src/index.ts', "import { see } from 'a';\nexport const b = see + 1;\n");
    await updateSourceIndex(root, { index });
    forget();

    const refreshed = await publishWorkspaceFromIndex(root, { index });

    expect(refreshed).not.toBe(first);
    expect(manifestReads()).toEqual(ONCE);
    expect(read.readWorkspaceOver).not.toHaveBeenCalled();
  });
});

describe('the first reading and the refresh', () => {
  it('count an export … from a workspace package the scan did not resolve the same way, so the refresh applies', async () => {
    // `c` declares no entry, so the scan resolves no import of it to a file;
    // it is still the workspace's own package, not one installed from outside.
    write('package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['packages/a', 'packages/b', 'packages/c'] }));
    write('packages/c/package.json', JSON.stringify({ name: 'c' }));
    write('packages/c/src/index.ts', 'export const sea = 1;\n');
    write('packages/b/package.json', JSON.stringify({ name: 'b', exports: { '.': './src/index.ts' }, dependencies: { c: '*' } }));
    write('packages/b/src/index.ts', "import { see } from 'a';\nexport const b = see;\nexport { sea } from 'c';\n");
    await updateSourceIndex(root, { index });
    await publishWorkspaceFromIndex(root, { index });
    forget();

    await publishWorkspaceFromIndex(root, { index });

    expect(read.readWorkspaceOver).not.toHaveBeenCalled();
  });
});
