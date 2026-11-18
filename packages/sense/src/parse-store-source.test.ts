/** Parse-store reuse obeys the current source bytes and reader's limits. */
import { rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fillParseStore, parseStorePath } from './parse-store.js';
import { updateSourceIndex } from './published.js';
import { nativeIndexGraph } from './native-index-graph.js';
import { shapeOf } from './reuse.js';
import { LARGEST_FILE, scanFixtureGraph, scanRelations } from './test-support/scan.js';
import { openSourceIndexFile } from './test-support/source-index-file.js';
import { decodeSourceIndex } from './test-support/source-index-format.js';
import { CACHE_VARIABLE } from './test-selection/cache-layers.js';
import { gitTreeOf } from './tree.js';
import { parseStoreFixture } from './test-support/parse-store.js';

describe('the parse store a cache keeps', () => {
  const fixture = parseStoreFixture();
  const { temporary, write, git, checkout, records } = fixture;

  it('answers a symbolic link by the bytes behind it, not by the path it holds', async () => {
    // Git names a link by the path it holds, so two checkouts with one link to different bytes share its name.
    const linked = async (body: string): Promise<string> => {
      const root = await checkout();
      await write(root, 'packages/a/src/other.ts', 'export const other = 3;\n');
      await write(root, 'packages/a/src/impl.ts', body);
      await symlink('impl.ts', join(root, 'packages/a/src/entry.ts'));
      git(root, 'add', '.');
      git(root, 'commit', '--quiet', '-m', 'link');
      return root;
    };
    const first = await linked("import { lens } from './lens.js';\nexport const impl = lens;\n");
    const second = await linked("import { other } from './other.js';\nexport const impl = other;\n");
    await updateSourceIndex(first);
    await updateSourceIndex(second);
    const shared = await records(second);

    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-link-cache-');
    await updateSourceIndex(second);
    expect(shared).toEqual(await records(second));
  });

  /** A checkout whose `packages/a` holds `impl.css` with `body`, `entry.css` made by `hold`, committed. */
  async function styled(body: string, hold: (root: string) => Promise<void>): Promise<string> {
    const root = await checkout();
    await write(root, 'packages/a/src/base.css', 'a { color: red; }\n');
    await write(root, 'packages/a/src/other.css', 'b { color: blue; }\n');
    await write(root, 'packages/a/src/impl.css', body);
    await hold(root);
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'style');
    return root;
  }

  /** What a scan answers for `entry.css`, reading the cache's store or, with none, fresh. */
  async function entryRecord(
    root: string,
    options: { readonly stored: boolean; readonly largestFile?: number; readonly packs?: boolean },
    file = 'packages/a/src/entry.css',
  ): Promise<unknown> {
    const stores = options.stored ? [parseStorePath(fixture.cache)] : [];
    const found = await scanRelations({
      root,
      dirs: ['packages/a'],
      stores,
      ...(options.packs === undefined ? {} : { packs: options.packs }),
      ...(options.largestFile === undefined ? {} : { largestFile: options.largestFile }),
    });
    const { digest: _digest, ...record } = found.find((record) => record.file === file) ?? { file: 'none' };
    return record;
  }

  it('answers a stylesheet behind a symbolic link by its bytes when a scan reads the store', async () => {
    const linked = (body: string) => styled(body, (root) => symlink('impl.css', join(root, 'packages/a/src/entry.css')));
    await updateSourceIndex(await linked("@import './base.css';\n"));
    const second = await linked("@import './other.css';\n");
    expect(await entryRecord(second, { stored: true })).toEqual(await entryRecord(second, { stored: false }));
  });

  it('declines a module over the size limit when the store holds its parse from a larger limit', async () => {
    const plain = () => styled('', (root) => write(root, 'packages/a/src/entry.css', "@import './base.css';\n"));
    await updateSourceIndex(await plain());
    const second = await plain();
    expect(await entryRecord(second, { stored: true, largestFile: 1 })).toEqual(await entryRecord(second, { stored: false, largestFile: 1 }));
  });

  it.each([
    ['a module over the size limit', 'packages/a/src/entry.ts', `export const entry = '${'x'.repeat(64)}';\n`, 16],
    ['a stylesheet, whose parse carries no size', 'packages/a/src/entry.css', 'a { color: red; }\n', undefined],
  ])('answers from the selected source, cached or fresh, %s absent from the worktree', async (_, entry, text, largestFile) => {
    const sparse = async () => {
      const root = await checkout();
      await write(root, entry, text);
      git(root, 'add', '.');
      git(root, 'commit', '--quiet', '-m', 'entry');
      return root;
    };
    await updateSourceIndex(await sparse());
    // Tracked, and absent from the working tree, as a sparse checkout leaves it.
    const second = await sparse();
    git(second, 'update-index', '--skip-worktree', entry);
    await rm(join(second, entry));
    const limit = largestFile === undefined ? {} : { largestFile };
    for (const packs of [true, false]) {
      const fresh = await entryRecord(second, { stored: false, packs, ...limit }, entry);
      if (!packs) expect(fresh).toMatchObject({ unknown: expect.stringContaining('could not be read') });
      else if (largestFile !== undefined) expect(fresh).toMatchObject({ unknown: expect.stringContaining('89 bytes, over the 16') });
      else expect(fresh).not.toHaveProperty('unknown');
      expect(await entryRecord(second, { stored: true, packs, ...limit }, entry)).toEqual(fresh);
    }
  });

  it.each([
    ['a module over the default limit whose parse a larger one kept', 'big.ts', `export const big = '${'x'.repeat(LARGEST_FILE)}';\n`, true],
    ['a stylesheet absent from disk, whose parse carries no size', 'entry.css', 'a { color: red; }\n', false],
  ])('applies the default limit to Git bytes when the store holds %s', async (_, name, text, present) => {
    const file = `packages/a/src/${name}`;
    const committed = async () => {
      const root = await checkout();
      await write(root, file, text);
      git(root, 'add', '.');
      git(root, 'commit', '--quiet', '-m', name);
      return root;
    };
    const path = join(await temporary('variance-parse-store-index-'), 'index.bin');
    const { graph, listing } = await scanFixtureGraph({ root: await committed(), dirs: ['packages/a'], largestFile: 2 * LARGEST_FILE });
    expect(graph.publish(path, [])).toBeNull();
    fillParseStore(listing, [parseStorePath(fixture.cache)], path);
    const second = await committed();
    const scan = async (largestFile?: number) => {
      const { files, kept } = (await gitTreeOf(second, ['packages/a']))!.native!.scanGraph(second, [file], largestFile, 1, false, undefined, false, [parseStorePath(fixture.cache)]);
      return kept[files.indexOf(file)];
    };
    expect(await scan(2 * LARGEST_FILE)).toBe(1);
    if (!present) await rm(join(second, file)).then(() => git(second, 'update-index', '--skip-worktree', file));
    expect(await scan()).toBe(present ? 0 : 1);
  });

  it('publishes every store-answered parse into its native generation', async () => {
    const root = await checkout();
    const stores = [parseStorePath(fixture.cache)];
    const path = join(await temporary('variance-parse-store-index-'), 'index.bin');
    await updateSourceIndex(root);
    const { graph } = await scanFixtureGraph({ root, dirs: ['packages/a'], stores });
    expect(graph.parsed).toBe(0);
    expect(graph.publish(path, [])).toBeNull();
    const parses = (await openSourceIndexFile(path)).stored.parses;
    expect(parses.size).toBe(graph.size);
    expect(parses.size).toBeGreaterThan(0);
  });

  it('copies every kept parse into the native graph while parsing only a newly added module', async () => {
    const root = await checkout();
    await updateSourceIndex(root);
    await write(root, 'packages/a/src/fresh.ts', 'export const fresh = 4;\n');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'fresh');
    const tree = (await gitTreeOf(root, ['packages/a']))!;
    const { shape, aliases } = await shapeOf({ root, tree });
    const files = ['packages/a/src/fresh.ts', 'packages/a/src/index.ts', 'packages/a/src/lens.ts'];
    const graph = nativeIndexGraph(tree.native!, {
      root,
      seeds: files,
      largestFile: LARGEST_FILE,
      remembering: true,
      aliases,
      directories: shape.directories,
      stores: [parseStorePath(fixture.cache)],
    });
    const parses = decodeSourceIndex(graph.parseSegment()).parses;
    expect(graph.parsed).toBe(1);
    expect(parses.size).toBe(files.length);
    expect([...parses.keys()].every((key) => graph.hasParse(key))).toBe(true);
  });

  it('counts a file a reader other than the module one parses cold, and not when the store answers it', async () => {
    const root = await checkout();
    await write(root, 'packages/c/package.json', '{ "name": "@fixture/c" }');
    await write(root, 'packages/c/src/only.css', 'c { color: green; }\n');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'style');
    expect((await updateSourceIndex(join(root, 'packages/c'))).parsed).toBe(1);
    expect((await updateSourceIndex(join(root, 'packages'))).parsed).toBe(4);
  });

  it('counts a file a resolver parsed before the scan reached it', async () => {
    const root = await temporary('variance-parse-count-');
    await write(root, 'Cargo.toml', '[package]\nname = "crate"\nversion = "0.1.0"\n');
    // `x.rs` and `y.rs` sort after `lib.rs`: the resolver parses them before the scan reaches them.
    await write(root, 'src/lib.rs', 'mod x;\nmod y;\n');
    await write(root, 'src/x.rs', 'pub fn x() {}\n');
    await write(root, 'src/y.rs', 'pub fn y() {}\n');
    git(root, 'init', '--quiet');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'crate');
    expect((await updateSourceIndex(root)).parsed).toBe(3);
  });

});
