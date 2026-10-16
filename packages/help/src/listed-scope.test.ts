import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readOfferings, type Help } from '@variance-authority/package/help';
import { readWorkspace, readWorkspaceSnapshot } from './read.js';
import { publishWorkspaceFromIndex } from './refresh-native.js';
import { scanScope } from './scan-scope.js';

/**
 * A workspace whose member list reaches beside its root.
 *
 * One product of a large monorepo lists two thousand members, and nearly all
 * of them sit in other top-level directories of the checkout. What the list
 * names is what the workspace can import and work with, so it is what the
 * reading covers: the root and each listed member, never the whole top-level
 * directory a member happens to sit in. Covering the first segment of each
 * member read 316,034 files where the list names 333,029 tracked files in
 * all, but most of them not the listed ones, and it read them on every
 * `variance index`, because a scan of part of a checkout was never saved.
 */

const temporary: string[] = [];
let top: string;
let product: string;
let index: string;

function write(file: string, contents: string): void {
  const path = join(top, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

beforeAll(() => {
  top = realpathSync(mkdtempSync(join(tmpdir(), 'help-listed-scope-')));
  temporary.push(top);
  product = join(top, 'product');
  write('product/package.json', JSON.stringify({ name: 'product', private: true, workspaces: ['packages/a', '../shared/c'] }));
  write('product/packages/a/package.json', JSON.stringify({ name: 'a', exports: { '.': './src/index.ts' } }));
  write('product/packages/a/src/index.ts', "import { see } from 'c';\nexport const a = see;\n");
  write('shared/c/package.json', JSON.stringify({ name: 'c', exports: { '.': './src/index.ts' } }));
  write('shared/c/src/index.ts', 'export const see = 1;\n');
  // Beside the listed member, in the same top-level directory: nothing lists it.
  write('shared/unlisted/src/index.ts', "import { see } from 'c';\nexport const other = see;\n");
  execFileSync('git', ['init', '--quiet'], { cwd: top });
  execFileSync('git', ['add', '.'], { cwd: top });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: top });
  const cache = mkdtempSync(join(tmpdir(), 'help-listed-scope-index-'));
  temporary.push(cache);
  index = join(cache, 'source-index.bin');
});

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/** Who uses each name the workspace publishes. */
function users(help: Help): readonly string[] {
  return help.packages.flatMap((published) => published.openings.flatMap((opening) =>
    opening.entries.flatMap((entry) => entry.sites.map((site) => `${published.name} ${entry.name} <- ${site.at}`)))).sort();
}

describe('a workspace whose members sit beside its root', () => {
  it('covers its root and each listed member, not the top-level directories they sit in', () => {
    expect(scanScope(product, readOfferings(product, { tolerant: true }))).toEqual({
      root: top,
      dirs: ['product', 'shared/c'],
    });
  });

  it('finds the uses inside what the list names, and none beside it', async () => {
    const help = await readWorkspace(product, { index });

    expect(users(help)).toEqual(['c see <- product/packages/a/src/index.ts']);
  });

  it('is refreshed from the index `variance index` keeps for it, with no scan', async () => {
    await readWorkspace(product, { index });

    const generation = await publishWorkspaceFromIndex(product, { index });

    expect(generation).toEqual(expect.any(String));
    expect(users(await readWorkspaceSnapshot(product, { index }))).toEqual(['c see <- product/packages/a/src/index.ts']);
  });
});
