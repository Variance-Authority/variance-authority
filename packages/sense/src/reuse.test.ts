import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import { memoryRecordCache, openRecordCache, treeShapeOf, type TreeShape } from './reuse.js';
import { scanRelations } from './scan.js';
import { directoriesOf } from './witness.js';

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

const run = promisify(execFile);

const A: Digest = 'git:1111111111111111111111111111111111111111';
const B: Digest = 'git:2222222222222222222222222222222222222222';

const RECORD: FileRecord = {
  file: 'src/Button.tsx',
  digest: A,
  edges: [{ to: 'src/button.css', kind: 'asset' }],
};

/** The directories `RECORD` could have been answered from. */
const WITNESSES = ['src'];

function tree(entries: readonly (readonly [string, Digest])[]): ReadonlyMap<string, Digest> {
  return new Map(entries);
}

/** A tree shape stated directly, so a test can move one half of it at a time. */
function shape(paths: readonly string[], config: Digest = A): TreeShape {
  return { config, directories: directoriesOf(paths) };
}

const HERE = shape(['package.json', 'src/Button.tsx', 'src/button.css']);

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

describe('the record cache in memory', () => {
  it('answers only for the bytes the record was built from', () => {
    const cache = memoryRecordCache();
    cache.under(HERE);
    cache.set(RECORD, WITNESSES);

    expect(cache.get('src/Button.tsx', A)).toEqual(RECORD);
    expect(cache.get('src/Button.tsx', B)).toBeUndefined();
  });

  it('forgets everything when the configuration moves', () => {
    const cache = memoryRecordCache();
    cache.under(HERE);
    cache.set(RECORD, WITNESSES);
    cache.under({ ...HERE, config: B });

    expect(cache.get('src/Button.tsx', A)).toBeUndefined();
  });

  it('forgets a record whose witness moved', () => {
    const cache = memoryRecordCache();
    cache.under(HERE);
    cache.set(RECORD, WITNESSES);
    cache.under(shape(['package.json', 'src/Button.tsx', 'src/button.css', 'src/button.tsx']));

    expect(cache.get('src/Button.tsx', A)).toBeUndefined();
  });

  it('keeps a record whose witnesses did not move', () => {
    const cache = memoryRecordCache();
    cache.under(HERE);
    cache.set(RECORD, WITNESSES);
    cache.under(shape(['package.json', 'src/Button.tsx', 'src/button.css', 'docs/page.md']));

    // The demand this whole change answers. A hundred pull requests an hour land
    // a hundred files somewhere, and a record that never asked a question about
    // where they landed is still the record it was.
    expect(cache.get('src/Button.tsx', A)).toEqual(RECORD);
  });

  it('does not remember a record that names no bytes', () => {
    const cache = memoryRecordCache();
    cache.under(HERE);
    cache.set({ file: 'src/legacy.js', unknown: 'could not be read' }, []);

    expect(cache.get('src/legacy.js', A)).toBeUndefined();
  });
});

describe('the record cache on disk', () => {
  async function path(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'variance-reuse-'));
    made.push(dir);
    return join(dir, 'nested', 'records.bin');
  }

  it('round-trips a record, and prunes one nothing touched', async () => {
    const file = await path();

    const first = await openRecordCache(file);
    first.under(HERE);
    first.set(RECORD, WITNESSES);
    first.set({ file: 'src/Clock.tsx', digest: B }, WITNESSES);
    await first.save();

    const second = await openRecordCache(file);
    second.under(HERE);
    expect(second.get('src/Button.tsx', A)).toEqual(RECORD);
    await second.save();

    const third = await openRecordCache(file);
    third.under(HERE);
    expect(third.get('src/Button.tsx', A)).toEqual(RECORD);
    expect(third.get('src/Clock.tsx', B)).toBeUndefined();
  });

  it('carries a record’s witnesses across the file, not just its edges', async () => {
    const file = await path();

    const first = await openRecordCache(file);
    first.under(HERE);
    first.set(RECORD, WITNESSES);
    await first.save();

    // Witnesses are derived from the specifiers, which live in a parse the next
    // run never opens. Losing them on the way to disk would make every reused
    // record unprunable, which is worse than not reusing it.
    const second = await openRecordCache(file);
    second.under(shape(['package.json', 'src/Button.tsx', 'src/button.css', 'src/late.ts']));

    expect(second.get('src/Button.tsx', A)).toBeUndefined();
  });

  it('discards a file written under another configuration', async () => {
    const file = await path();

    const first = await openRecordCache(file);
    first.under(HERE);
    first.set(RECORD, WITNESSES);
    await first.save();

    const second = await openRecordCache(file);
    second.under({ ...HERE, config: B });

    expect(second.get('src/Button.tsx', A)).toBeUndefined();
  });

  it('writes nothing at all when no scan adopted a shape', async () => {
    const file = await path();

    const first = await openRecordCache(file);
    first.under(HERE);
    first.set(RECORD, WITNESSES);
    await first.save();

    // A scan with no digests validates nothing and reuses nothing. Letting it
    // save would replace a usable cache with an empty one, and the next scan
    // that *could* have reused would pay for it.
    const unused = await openRecordCache(file);
    await unused.save();

    const third = await openRecordCache(file);
    third.under(HERE);
    expect(third.get('src/Button.tsx', A)).toEqual(RECORD);
  });

  it('starts empty on a file that is not what it expects', async () => {
    const file = await path();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, 'half an index', 'utf8');

    const cache = await openRecordCache(file);
    cache.under(HERE);

    expect(cache.get('src/Button.tsx', A)).toBeUndefined();
  });

  it('saves nowhere rather than failing the run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'variance-reuse-'));
    made.push(dir);

    const blocked = join(dir, 'file');
    await writeFile(blocked, 'not a directory', 'utf8');

    const cache = await openRecordCache(join(blocked, 'records.bin'));
    cache.under(HERE);
    cache.set(RECORD, WITNESSES);

    await expect(cache.save()).resolves.toBeUndefined();
  });
});

describe('a scan that remembers the last one', () => {
  async function repository(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'variance-reuse-'));
    made.push(root);

    await write(root, 'package.json', '{ "name": "fixture", "type": "module" }');
    await write(root, 'src/Button.tsx', "import './later.js';\nexport function Button() {}\n");
    await write(root, 'src/Clock.tsx', "import { now } from './time.js';\nexport const Clock = now;\n");
    await write(root, 'src/time.ts', 'export const now = 1;\n');

    await git(root, ['init', '--quiet']);
    await git(root, ['add', '-A']);
    await git(root, ['commit', '--quiet', '-m', 'one']);

    return root;
  }

  it('answers exactly what a scan with no memory answers', async () => {
    const root = await repository();
    const reuse = memoryRecordCache();

    await scanRelations({ root, dirs: ['src'], reuse });
    const remembered = await scanRelations({ root, dirs: ['src'], reuse });
    const fresh = await scanRelations({ root, dirs: ['src'] });

    expect(JSON.stringify(remembered)).toBe(JSON.stringify(fresh));
  });

  it('re-reads a file whose contents moved', async () => {
    const root = await repository();
    const reuse = memoryRecordCache();
    await scanRelations({ root, dirs: ['src'], reuse });

    await write(root, 'src/Clock.tsx', 'export const Clock = 1;\n');
    const records = await scanRelations({ root, dirs: ['src'], reuse });

    expect(records.find((record) => record.file === 'src/Clock.tsx')?.edges).toBeUndefined();
  });

  it('re-resolves a file that did not move, when a file it names appears', async () => {
    const root = await repository();
    const reuse = memoryRecordCache();

    const before = await scanRelations({ root, dirs: ['src'], reuse });
    // `./later.js` resolves to nothing, so `Button.tsx` is recorded unknown.
    expect(before.find((record) => record.file === 'src/Button.tsx')?.unknown).toContain('./later');

    await write(root, 'src/later.ts', 'export const later = 1;\n');
    const after = await scanRelations({ root, dirs: ['src'], reuse });

    // The whole soundness argument in one assertion. Not one byte of
    // `Button.tsx` changed; its edges did. A cache keyed on content alone would
    // hand back the unknown record forever, and the file that appeared would have
    // no dependents in any run after this one.
    const button = after.find((record) => record.file === 'src/Button.tsx');
    expect(button?.unknown).toBeUndefined();
    expect(button?.edges).toEqual([{ to: 'src/later.ts', kind: 'imports' }]);
  });

  it('re-resolves a file that did not move, when a file it names is deleted', async () => {
    const root = await repository();
    const reuse = memoryRecordCache();
    await scanRelations({ root, dirs: ['src'], reuse });

    await unlink(join(root, 'src/time.ts'));
    const records = await scanRelations({ root, dirs: ['src'], reuse });

    const clock = records.find((record) => record.file === 'src/Clock.tsx');
    expect(clock?.edges).toBeUndefined();
    expect(clock?.unknown).toContain('./time.js');
  });

  it('reuses nothing when it was told not to trust digests', async () => {
    const root = await repository();
    const reuse = memoryRecordCache();

    await scanRelations({ root, dirs: ['src'], reuse, digests: false });
    await write(root, 'src/later.ts', 'export const later = 1;\n');
    const records = await scanRelations({ root, dirs: ['src'], reuse, digests: false });

    // `digests: false` is the escape hatch, and it has to close the whole
    // mechanism rather than half of it: a record kept under no layout at all
    // could never be checked against anything.
    expect(records.find((record) => record.file === 'src/Button.tsx')?.edges).toEqual([
      { to: 'src/later.ts', kind: 'imports' },
    ]);
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
