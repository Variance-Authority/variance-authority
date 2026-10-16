import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as tinyglobby from 'tinyglobby';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { readOfferings } from './manifest.js';

/**
 * A member list of paths, read without a glob.
 *
 * A large monorepo writes its member list out path by path: one product's root
 * manifest names two thousand directories and not one wildcard. Each glob sets
 * up a walk of its own, so the list cost one walk per entry, seconds of
 * `readdir` on every read of the manifests, to answer what one `stat` answers.
 * A path is read as the manifest inside it; a glob is still read as a glob.
 */

vi.mock('tinyglobby', async (original) => {
  const actual = await original<typeof import('tinyglobby')>();
  return { ...actual, globSync: vi.fn(actual.globSync) };
});

const temporary: string[] = [];

function workspace(files: Readonly<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'variance-members-literal-'));
  temporary.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(contents));
  }
  return root;
}

afterAll(() => {
  for (const root of temporary) rmSync(root, { recursive: true, force: true });
});

describe('a member list of paths', () => {
  it('reads each listed path as the manifest inside it, with no glob', () => {
    const root = workspace({
      'product/package.json': { name: 'root', workspaces: ['packages/a', './packages/b', '../shared/c', 'packages/none'] },
      'product/packages/a/package.json': { name: 'a' },
      'product/packages/b/package.json': { name: 'b' },
      'shared/c/package.json': { name: 'c' },
    });
    vi.mocked(tinyglobby.globSync).mockClear();

    const names = readOfferings(join(root, 'product')).map((offering) => offering.name);

    expect(names).toEqual(['root', 'a', 'b', 'c']);
    expect(tinyglobby.globSync).not.toHaveBeenCalled();
  });

  it('still reads a wildcard entry beside them as a glob', () => {
    const root = workspace({
      'package.json': { name: 'root', workspaces: ['packages/a', 'more/*'] },
      'packages/a/package.json': { name: 'a' },
      'more/z/package.json': { name: 'z' },
    });

    expect(readOfferings(root).map((offering) => offering.name)).toEqual(['root', 'a', 'z']);
  });

  it('never reads a listed path under `node_modules`, as a glob never does', () => {
    const root = workspace({
      'package.json': { name: 'root', workspaces: ['node_modules/dep'] },
      'node_modules/dep/package.json': { name: 'dep' },
    });

    expect(readOfferings(root).map((offering) => offering.name)).toEqual(['root']);
  });
});
