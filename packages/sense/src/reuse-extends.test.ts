import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import { memoryRecordCache, treeShapeOf, type RecordCache, type TreeShape } from './reuse.js';
import { scanRelations } from './scan.js';

/**
 * A `tsconfig` whose `paths` come from a base it `extends`: a file named
 * neither `tsconfig*.json` nor `jsconfig.json`, a package's config under
 * `node_modules`, a workspace package's export. The base bounds where an alias
 * lands as much as the `tsconfig` does, so a path appearing elsewhere keeps
 * every record, and an edit to the base re-resolves every one.
 */

const run = promisify(execFile);

const A: Digest = 'git:1111111111111111111111111111111111111111';
const B: Digest = 'git:2222222222222222222222222222222222222222';

function tree(entries: readonly (readonly [string, Digest])[]): ReadonlyMap<string, Digest> {
  return new Map(entries);
}

const made: string[] = [];

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

describe('a configuration an `extends` reads that the listing does not name', () => {
  // `tsconfig.json` extends a file named neither `tsconfig*.json` nor
  // `jsconfig.json`, or one under `node_modules`, which the listing never names.
  async function extending(base: string, target: string): Promise<{ at: string; shapes: (digests: ReadonlyMap<string, Digest>) => Promise<TreeShape> }> {
    const at = await mkdtemp(join(tmpdir(), 'variance-reuse-extends-'));
    made.push(at);
    await write(at, 'tsconfig.json', `{ "extends": "${target}" }`);
    await write(at, base, '{ "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }');
    return { at, shapes: async (digests) => (await treeShapeOf({ root: at, digests })).shape };
  }

  it('moves the configuration when a package config it extends is edited, and not when a path appears', async () => {
    const { at, shapes } = await extending('node_modules/@fixture/base/tsconfig.json', '@fixture/base/tsconfig.json');
    const held = tree([['tsconfig.json', A], ['src/Button.tsx', A]]);
    const before = (await shapes(held)).config;

    expect((await shapes(tree([...held, ['docs/page.md', B]]))).config).toBe(before);
    await write(at, 'node_modules/@fixture/base/tsconfig.json', '{ "compilerOptions": { "paths": { "@app/*": ["lib/*"] } } }');
    expect((await shapes(held)).config).not.toBe(before);
  });

  it('moves the configuration when the listing moves the digest of a tracked base it extends', async () => {
    const { shapes } = await extending('base.json', './base.json');
    const held = tree([['tsconfig.json', A], ['base.json', A], ['src/Button.tsx', A]]);
    const before = (await shapes(held)).config;

    // The listing owns a tracked file's digest; the base is not read again for it.
    expect((await shapes(tree([...held, ['base.json', B]]))).config).not.toBe(before);
  });

  it('keeps the configuration when a path appears, and moves it when the base it extends is generated', async () => {
    const { at, shapes } = await extending('ignored.json', './.nuxt/tsconfig.json');
    const held = tree([['tsconfig.json', A], ['src/Button.tsx', A]]);
    const before = (await shapes(held)).config;

    expect((await shapes(tree([...held, ['docs/page.md', B]]))).config).toBe(before);
    await write(at, '.nuxt/tsconfig.json', '{ "compilerOptions": { "paths": { "@app/*": ["../lib/*"] } } }');
    expect((await shapes(held)).config).not.toBe(before);
  });
});

describe('a scan under a base an `extends` reaches', () => {
  it('keeps every record when a path appears elsewhere, under a base a workspace package exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-reuse-'));
    made.push(root);
    await write(root, '.gitignore', 'node_modules\n');
    await write(root, 'package.json', '{ "name": "fixture", "type": "module", "workspaces": ["packages/*"] }');
    await write(root, 'tsconfig.json', '{ "extends": "@fixture/tsconfig/base", "include": ["src"] }');
    await write(
      root,
      'packages/tsconfig/package.json',
      '{ "name": "@fixture/tsconfig", "exports": { "./base": "./tsconfig.base.json" } }',
    );
    await write(
      root,
      'packages/tsconfig/tsconfig.base.json',
      '{ "compilerOptions": { "paths": { "@app/*": ["../../src/*"] } } }',
    );
    await write(root, 'src/Clock.tsx', "import { now } from '@app/time';\nexport const Clock = now;\n");
    await write(root, 'src/time.ts', 'export const now = 1;\n');
    await mkdir(join(root, 'node_modules/@fixture'), { recursive: true });
    await symlink(join(root, 'packages/tsconfig'), join(root, 'node_modules/@fixture/tsconfig'), 'dir');
    await git(root, ['init', '--quiet']);
    await git(root, ['add', '-A']);
    await git(root, ['commit', '--quiet', '-m', 'one']);

    const memory = memoryRecordCache();
    const rebuilt: string[] = [];
    const reuse: RecordCache = {
      ...memory,
      set(record, witnesses, targets) {
        rebuilt.push(record.file);
        memory.set(record, witnesses, targets);
      },
    };
    const before = await scanRelations({ root, dirs: ['src'], reuse });
    expect(before.find((record) => record.file === 'src/Clock.tsx')?.edges).toEqual([
      { to: 'src/time.ts', kind: 'imports' },
    ]);

    rebuilt.length = 0;
    await write(root, 'docs/page.md', '# a page\n');
    await git(root, ['add', 'docs/page.md']);
    const after = await scanRelations({ root, dirs: ['src'], reuse });

    // The root config's `paths` come from a package, and the package's link
    // leads back to a file git tracks, so they bound where `@app/time` can land
    // and a page under `docs/` is nowhere near it. Unfollowed, the same base
    // left every record unbounded and this scan rebuilt all of them.
    expect(rebuilt).toEqual([]);
    expect(JSON.stringify(after)).toBe(JSON.stringify(await scanRelations({ root, dirs: ['src'] })));
  });

  it('keeps every record when a path appears elsewhere, and re-resolves every one when the base it extends is edited', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-reuse-'));
    made.push(root);
    await write(root, 'package.json', '{ "name": "fixture", "type": "module" }');
    await write(root, 'tsconfig.json', '{ "extends": "./generated/paths.json", "include": ["src"] }');
    await write(root, 'generated/paths.json', '{ "compilerOptions": { "paths": { "@app/*": ["../src/*"] } } }');
    await write(root, 'src/Clock.tsx', "import { now } from '@app/time';\nexport const Clock = now;\n");
    await write(root, 'src/time.ts', 'export const now = 1;\n');
    await git(root, ['init', '--quiet']);
    await git(root, ['add', '-A']);
    await git(root, ['commit', '--quiet', '-m', 'one']);

    const memory = memoryRecordCache();
    const rebuilt: string[] = [];
    const reuse: RecordCache = {
      ...memory,
      set(record, witnesses, targets) {
        rebuilt.push(record.file);
        memory.set(record, witnesses, targets);
      },
    };
    await scanRelations({ root, dirs: ['src'], reuse });

    rebuilt.length = 0;
    await write(root, 'docs/page.md', '# a page\n');
    await git(root, ['add', 'docs/page.md']);
    await scanRelations({ root, dirs: ['src'], reuse });
    // `paths.json` bounds where `@app/time` can land, whatever it is named,
    // and a page under `docs/` is nowhere near it.
    expect(rebuilt).toEqual([]);

    await write(root, 'generated/paths.json', '{ "compilerOptions": { "paths": { "@app/*": ["../lib/*"] } } }');
    const after = await scanRelations({ root, dirs: ['src'], reuse });
    // The base is configuration, so editing it rebuilds every record.
    expect(rebuilt.toSorted()).toEqual(['src/Clock.tsx', 'src/time.ts']);
    expect(JSON.stringify(after)).toBe(JSON.stringify(await scanRelations({ root, dirs: ['src'] })));
  });
});

async function git(root: string, args: readonly string[]): Promise<void> {
  await run('git', ['-c', 'user.email=test@example.test', '-c', 'user.name=Test', ...args], {
    cwd: root,
  });
}

async function write(root: string, file: string, contents: string): Promise<void> {
  const path = join(root, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}
