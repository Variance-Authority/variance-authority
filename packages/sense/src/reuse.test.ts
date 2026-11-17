import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import { treeShapeOf, type TreeShape } from './reuse.js';

/**
 * Reusing an edge is the one saving here that can be *wrong*.
 *
 * A stale parse is impossible — the digest is the key. A stale record is not: the
 * bytes of a file say nothing about which files sit around it, so a record whose
 * digest still matches can describe a resolution that no longer happens. Every
 * test below is a repository that moved without the reused file moving, and the
 * assertion is always that the second scan agrees with a scan that remembered
 * nothing.
 */

const A: Digest = 'git:1111111111111111111111111111111111111111';
const B: Digest = 'git:2222222222222222222222222222222222222222';

function tree(entries: readonly (readonly [string, Digest])[]): ReadonlyMap<string, Digest> {
  return new Map(entries);
}

const made: string[] = [];

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

describe('naming the shape of a tree', () => {
  const root = '/repo';
  const files = tree([
    ['package.json', A],
    ['src/Button.tsx', A],
    ['src/button.css', B],
  ]);

  const shapeOf = async (
    digests: ReadonlyMap<string, Digest>,
    options?: Parameters<typeof treeShapeOf>[0]['options'],
  ): Promise<TreeShape> =>
    (await treeShapeOf({ root, digests, ...(options === undefined ? {} : { options }) })).shape;

  it('answers the same for the same tree, whatever order it arrived in', async () => {
    const shuffled = tree([
      ['src/button.css', B],
      ['package.json', A],
      ['src/Button.tsx', A],
    ]);

    expect(await shapeOf(shuffled)).toEqual(await shapeOf(files));
  });

  it('moves one directory when a path appears, and leaves the configuration alone', async () => {
    const added = tree([...files, ['src/Button.module.css', A]]);
    const after = await shapeOf(added);
    const before = await shapeOf(files);

    // `./button` finds `button.css` only while nothing else beside it answers to
    // that name — without one byte of the importing file changing. What is new
    // here is the bound: the question is asked of `src`, not of the repository,
    // so a file appearing under `docs/` costs a record under `src/` nothing.
    expect(after.config).toBe(before.config);
    expect(after.directories.get('src')).not.toBe(before.directories.get('src'));
    expect(after.directories.get('')).toBe(before.directories.get(''));
  });

  it('moves the configuration when a file that decides resolution is edited', async () => {
    const edited = tree([...files].map(([path, digest]) =>
      path === 'package.json' ? ([path, B] as const) : ([path, digest] as const),
    ));

    // One `paths` entry in a `tsconfig` redirects every `@/` specifier in the
    // repository. Its own digest is the only thing that says so, and there is no
    // narrower answer than everything.
    expect((await shapeOf(edited)).config).not.toBe((await shapeOf(files)).config);
  });

  it('holds still entirely when a source file is edited', async () => {
    const edited = tree([...files].map(([path, digest]) =>
      path === 'src/Button.tsx' ? ([path, B] as const) : ([path, digest] as const),
    ));

    // The division of labour: this names the tree, the file's own digest names
    // the file. Folding content into the shape would throw away every record in
    // the repository on every edit, which is the cost this exists to avoid.
    expect(await shapeOf(edited)).toEqual(await shapeOf(files));
  });

  it('moves when resolution is configured differently', async () => {
    const before = await shapeOf(files);

    expect((await shapeOf(files, { conditionNames: ['import'] })).config).not.toBe(before.config);
    expect((await shapeOf(files, { tsconfig: 'tsconfig.build.json' })).config).not.toBe(before.config);
    expect((await shapeOf(files, { tsconfig: false })).config).not.toBe(before.config);
    // Named from the checkout, so a worktree laid out alike keeps the digest.
    expect((await shapeOf(files, { tsconfig: `${root}/tsconfig.build.json` })).config)
      .toBe((await shapeOf(files, { tsconfig: 'tsconfig.build.json' })).config);
    // A declined record names its bytes, so a raised limit has to let it go.
    expect((await shapeOf(files, { largestFile: 8 })).config).not.toBe(before.config);
  });

  it('moves when the config the caller names is edited, though the listing does not hold it', async () => {
    const at = await mkdtemp(join(tmpdir(), 'variance-reuse-named-'));
    made.push(at);
    await mkdir(join(at, 'config'));
    const held = tree([['package.json', A], ['src/Button.tsx', A]]);
    const named = async (): Promise<Digest> =>
      (await treeShapeOf({ root: at, digests: held, options: { tsconfig: join(at, 'config/aliases.json') } })).shape.config;

    await writeFile(join(at, 'config/aliases.json'), '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }');
    const before = await named();
    await writeFile(join(at, 'config/aliases.json'), '{ "compilerOptions": { "paths": { "@/*": ["lib/*"] } } }');

    expect(await named()).not.toBe(before);
  });

  it('falls back to the whole path set when no configuration bounds an alias', async () => {
    const at = await mkdtemp(join(tmpdir(), 'variance-reuse-'));
    made.push(at);
    await writeFile(join(at, 'tsconfig.json'), '{ this is not JSON', 'utf8');

    const held = tree([['tsconfig.json', A], ['src/Button.tsx', A]]);
    const added = tree([...held, ['docs/page.md', B]]);
    const shapes = async (digests: ReadonlyMap<string, Digest>): Promise<TreeShape> =>
      (await treeShapeOf({ root: at, digests })).shape;

    // A `tsconfig` that cannot be read is no bound on where a bare specifier
    // lands, so there is no bound on what a new path can change either. The old
    // whole-tree rule is the honest answer here, and this is the only place it
    // still applies.
    expect((await shapes(added)).config).not.toBe((await shapes(held)).config);
  });
});
