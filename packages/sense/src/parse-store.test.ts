import { execFileSync } from 'node:child_process';
import { appendFile, cp, mkdtemp, mkdir, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { native } from './addon.js';
import { openImmutableLog } from './immutable-log.js';
import { fillParseStore, parseStorePath, pruneParseStore } from './parse-store.js';
import { updateSourceIndex } from './published.js';
import { realPath } from './resolve.js';
import { nativeGraph } from './native.js';
import { shapeOf } from './reuse.js';
import { LARGEST_FILE, scanRelations } from './scan.js';
import { openSourceIndexFile } from './source-index-file.js';
import { decodeSourceIndex, encodeSourceIndex, SOURCE_INDEX_VERSION } from './source-index-format.js';
import { openSourceIndex, sourceIndexPath } from './source-index.js';
import { CACHE_VARIABLE } from './test-selection/cache-layers.js';
import { gitTreeOf } from './tree.js';

/**
 * A parse is a function of the bytes and the way they are read, so one read
 * anywhere in a cache answers every root that reads the same bytes: the
 * checkout, a directory in it, a worktree. Each case counts the modules an
 * update parsed, which is what the store exists to save.
 */
describe('the parse store a cache keeps', () => {
  const made: string[] = [];
  const before = process.env[CACHE_VARIABLE];
  let cache: string;

  beforeEach(async () => {
    cache = await temporary('variance-parse-store-cache-');
    process.env[CACHE_VARIABLE] = cache;
  });

  afterEach(() => {
    if (before === undefined) delete process.env[CACHE_VARIABLE];
    else process.env[CACHE_VARIABLE] = before;
  });

  afterAll(async () => {
    for (const path of made) await rm(path, { recursive: true, force: true });
  });

  async function temporary(prefix: string): Promise<string> {
    const path = realPath(await mkdtemp(join(tmpdir(), prefix)));
    made.push(path);
    return path;
  }

  async function write(root: string, file: string, text: string): Promise<void> {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }

  function git(root: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, stdio: 'ignore' });
  }

  /** A workspace of two packages, committed. */
  async function checkout(): Promise<string> {
    const root = await temporary('variance-parse-store-');
    await write(root, 'package.json', '{ "name": "fixture", "private": true, "workspaces": ["packages/*"] }');
    await write(root, 'packages/a/package.json', '{ "name": "@fixture/a" }');
    await write(root, 'packages/a/src/index.ts', "import { lens } from './lens.js';\nexport const a = lens;\n");
    await write(root, 'packages/a/src/lens.ts', 'export const lens = 1;\n');
    await write(root, 'packages/b/package.json', '{ "name": "@fixture/b" }');
    await write(root, 'packages/b/src/index.ts', "import { only } from './only.js';\nexport const b = only;\n");
    await write(root, 'packages/b/src/only.ts', 'export const only = 2;\n');
    git(root, 'init', '--quiet');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'fixture');
    return root;
  }

  async function records(root: string): Promise<string> {
    const file = await openSourceIndexFile(sourceIndexPath(root));
    return JSON.stringify([...file.stored.records].sort((left, right) => (left[0] < right[0] ? -1 : 1)));
  }

  async function storedKeys(): Promise<readonly string[]> {
    const file = await openSourceIndexFile(parseStorePath(cache));
    return [...file.stored.parses.keys()];
  }

  it('parses nothing again for a directory of a checkout the cache has read', async () => {
    const root = await checkout();
    const whole = await updateSourceIndex(root);
    expect(whole.parsed).toBeGreaterThan(0);

    const part = await updateSourceIndex(join(root, 'packages/a'));
    expect(part.files).toBeGreaterThan(0);
    expect(part.parsed).toBe(0);
  });

  it('parses nothing again for a directory of a second worktree that holds the same bytes', async () => {
    const root = await checkout();
    await updateSourceIndex(root);
    const second = join(await temporary('variance-parse-store-worktree-'), 'second');
    git(root, 'worktree', 'add', '--quiet', second);

    const part = await updateSourceIndex(join(second, 'packages/b'));
    expect(part.files).toBeGreaterThan(0);
    expect(part.parsed).toBe(0);
  });

  it('parses nothing again for a directory whose modules reach a file only a full read takes', async () => {
    const root = await checkout();
    await write(root, 'packages/a/src/look.css', '.lens { color: red; }\n');
    await write(root, 'packages/a/src/index.ts', "import { lens } from './lens.js';\nimport './look.css';\nexport const a = lens;\n");
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'look');
    await updateSourceIndex(root);

    const steps: string[] = [];
    const part = await updateSourceIndex(join(root, 'packages/a'), { progress: (step) => { steps.push(step); return () => {}; } });
    expect(steps.some((step) => step.startsWith('reading every file'))).toBe(true);
    expect(part.files).toBeGreaterThan(0);
    expect(part.parsed).toBe(0);
  });

  it('parses nothing again when the roots that read before it are of different generations', async () => {
    const root = await checkout();
    // An older root: it read `lens.ts` before the edit below.
    await updateSourceIndex(join(root, 'packages'));
    await write(root, 'packages/a/src/lens.ts', 'export const lens = 3;\n');
    git(root, 'commit', '--quiet', '-am', 'edit');
    // A newer root: it read the edited bytes.
    await updateSourceIndex(root);

    const fresh = await updateSourceIndex(join(root, 'packages/a'));
    expect(fresh.files).toBeGreaterThan(0);
    expect(fresh.parsed).toBe(0);
  });

  it('answers a stored parse with the edges a fresh parse resolves, through a workspace that was never built', async () => {
    const root = await checkout();
    // `@fixture/lib` publishes `./dist/index.js`, and there is no `dist`: the
    // edge reaches `src/index.ts` only through the resolver that maps one to the other.
    await write(root, 'packages/lib/package.json', JSON.stringify({
      name: '@fixture/lib',
      exports: { '.': './dist/index.js' },
    }));
    await write(root, 'packages/lib/src/index.ts', 'export const lib = 4;\n');
    await write(root, 'packages/a/src/uses.ts', "import { lib } from '@fixture/lib';\nexport const uses = lib;\n");
    await write(root, 'packages/a/src/index.ts', "import { lens } from './lens.js';\nimport { uses } from './uses.js';\nexport const a = lens + uses;\n");
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'lib');

    const fresh = await updateSourceIndex(root);
    const edges = await records(root);
    expect(edges).toContain('"packages":[{"to":"@fixture/lib","kind":"imports"}');

    // A second cache, whose store holds `packages/a`'s parses, read from a root that does not reach the workspace.
    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-second-cache-');
    await updateSourceIndex(join(root, 'packages/a'));
    const cached = await updateSourceIndex(root);
    expect(cached.parsed).toBeLessThan(fresh.parsed!);
    expect(await records(root)).toEqual(edges);
  });

  it('reclaims the parses only a removed root named, and keeps every one a standing root or a young write names', async () => {
    const root = await checkout();
    await updateSourceIndex(join(root, 'packages/a'));
    const named = new Set(await storedKeys());
    await updateSourceIndex(join(root, 'packages/b'));
    const all = await storedKeys();
    expect(all.length).toBeGreaterThan(named.size);

    await rm(dirname(sourceIndexPath(join(root, 'packages/b'))), { recursive: true, force: true });
    // Within the grace period nothing goes: a writer may not have published the root that names it yet.
    expect((await pruneParseStore(cache, { graceMs: 60 * 60 * 1000 })).dropped).toBe(0);
    expect(await storedKeys()).toEqual(all);

    const swept = await pruneParseStore(cache, { graceMs: 0 });
    expect(swept.dropped).toBe(all.length - named.size);
    expect(new Set(await storedKeys())).toEqual(named);
  });
  it('keeps the parses of a root whose chain cannot be read, which says nothing of what it names', async () => {
    const root = await checkout();
    await updateSourceIndex(join(root, 'packages/a'));
    await updateSourceIndex(join(root, 'packages/b'));
    const all = await storedKeys();
    // The header names a length the manifest no longer has.
    await appendFile(sourceIndexPath(join(root, 'packages/b')), 'x');

    expect((await pruneParseStore(cache, { graceMs: 0 })).dropped).toBe(0);
    expect(await storedKeys()).toEqual(all);
  });

  it('fills nothing from a chain it cannot read, and does not throw: the next root parses what it would have held', async () => {
    const root = await checkout();
    await updateSourceIndex(join(root, 'packages/a'));
    const chain = sourceIndexPath(join(root, 'packages/a'));
    await appendFile(chain, 'x');
    expect(fillParseStore([parseStorePath(cache)], chain)).toBe(0);
  });

  it('leaves the store as it is without the addon, which is all that reads or writes it', async () => {
    const root = await checkout();
    await updateSourceIndex(join(root, 'packages/a'));
    const all = await storedKeys();
    vi.resetModules();
    vi.doMock('./addon.js', () => ({ native: () => undefined }));
    try {
      const without = await import('./parse-store.js');
      expect(await without.pruneParseStore(cache, { graceMs: 0 })).toEqual({ dropped: 0 });
      expect(without.fillParseStore([parseStorePath(cache)], sourceIndexPath(join(root, 'packages/a')))).toBe(0);
    } finally {
      vi.doUnmock('./addon.js');
      vi.resetModules();
    }
    expect(await storedKeys()).toEqual(all);
  });

  it('parses nothing again for a directory whose checkout names its own index', async () => {
    const root = await checkout();
    await updateSourceIndex(root);

    const part = join(root, 'packages/a');
    const named = await updateSourceIndex(part, { index: sourceIndexPath(part) });
    expect(named.files).toBeGreaterThan(0);
    expect(named.parsed).toBe(0);
  });

  it('parses nothing again for a copy of a checkout at another path', async () => {
    const root = await checkout();
    await updateSourceIndex(root);
    const copy = join(await temporary('variance-parse-store-copy-'), 'copy');
    await cp(root, copy, { recursive: true, filter: (from) => !from.includes('node_modules') });

    const again = await updateSourceIndex(copy);
    expect(again.files).toBeGreaterThan(0);
    expect(again.parsed).toBe(0);
  });

  it('reads back whole after two roots add to it at once', async () => {
    const root = await checkout();
    const [a, b] = await Promise.all([updateSourceIndex(join(root, 'packages/a')), updateSourceIndex(join(root, 'packages/b'))]);
    expect(a.parsed! + b.parsed!).toBeGreaterThan(0);

    // A writer the other moved the store under skips its append; what it parsed is added by the next root that parses it.
    expect((await storedKeys()).length).toBeGreaterThan(0);
    await updateSourceIndex(root);
    const whole = await updateSourceIndex(join(root, 'packages'));
    expect(whole.parsed).toBe(0);
  });

  it('heals a store that lost a segment on the next write, so the root after it parses nothing', async () => {
    const root = await checkout();
    await updateSourceIndex(join(root, 'packages/a'));
    await updateSourceIndex(join(root, 'packages/b'));
    const segments = `${parseStorePath(cache)}.segments`;
    const [lost] = await readdir(segments);
    await rm(join(segments, lost!));

    // This root reads the store as far as the gap, parses what it lost, and writes the store whole again.
    expect((await updateSourceIndex(root)).parsed).toBeGreaterThan(0);
    const after = await updateSourceIndex(join(root, 'packages'));
    expect(after.files).toBeGreaterThan(0);
    expect(after.parsed).toBe(0);
  });

  it('heals a store holding a segment of another format version on the next write, so the root after it parses nothing', async () => {
    const root = await checkout();
    await updateSourceIndex(join(root, 'packages/a'));
    // A whole segment, its digest good, that this build's reader refuses to open.
    const current = encodeSourceIndex({ config: '', parses: new Map(), records: new Map(), directories: new Map() });
    const other = Buffer.from(current.toString('latin1').replace(`"version":${SOURCE_INDEX_VERSION}`, `"version":${SOURCE_INDEX_VERSION - 1}`), 'latin1');
    expect(other.equals(current)).toBe(false);
    const store = parseStorePath(cache);
    const held = await openImmutableLog(store);
    await rm(store);
    // Written as a base, which is never opened on the way in.
    expect(native()!.appendSourceIndex(store, [], false, [...held.segments, other])).toBeNull();
    expect((await openImmutableLog(store)).segments).toHaveLength(held.segments.length + 1);

    expect((await updateSourceIndex(join(root, 'packages/b'))).parsed).toBeGreaterThan(0);
    const after = await updateSourceIndex(join(root, 'packages'));
    expect(after.files).toBeGreaterThan(0);
    expect(after.parsed).toBe(0);
  });

  it('writes over a store whose manifest cannot be read, so the root after it parses nothing', async () => {
    const root = await checkout();
    await updateSourceIndex(join(root, 'packages/a'));
    // The header names a length the manifest no longer has.
    await appendFile(parseStorePath(cache), 'x');

    expect((await updateSourceIndex(root)).parsed).toBeGreaterThan(0);
    const after = await updateSourceIndex(join(root, 'packages'));
    expect(after.files).toBeGreaterThan(0);
    expect(after.parsed).toBe(0);
  });

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
    options: { readonly stored: boolean; readonly largestFile?: number },
    file = 'packages/a/src/entry.css',
  ): Promise<unknown> {
    const stores = options.stored ? [parseStorePath(cache)] : [];
    const source = await openSourceIndex(join(await temporary('variance-parse-store-index-'), 'index.bin'), { stores });
    const found = await scanRelations({
      root,
      dirs: ['packages/a'],
      cache: source.cache,
      stores,
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
  ])('reads again, as a fresh scan does, %s, when the store holds its parse and its file is not on disk', async (_, entry, text, largestFile) => {
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
    const fresh = await entryRecord(second, { stored: false, ...limit }, entry);
    expect(fresh).toMatchObject({ unknown: expect.any(String) });
    expect(await entryRecord(second, { stored: true, ...limit }, entry)).toEqual(fresh);
  });

  it('publishes the parse of every module a store answered, when another root appended it after the index was opened', async () => {
    const root = await checkout();
    const stores = [parseStorePath(cache)];
    const path = join(await temporary('variance-parse-store-index-'), 'index.bin');
    const source = await openSourceIndex(path, { stores });
    // Another root fills the store between the index's read of it and the scan's.
    await updateSourceIndex(root);

    const found = await scanRelations({ root, dirs: ['packages/a'], cache: source.cache, stores });
    await source.save();

    const parses = (await openSourceIndexFile(path)).stored.parses;
    expect(found.filter((record) => record.digest !== undefined).map((record) => record.file)).toHaveLength(parses.size);
    expect(parses.size).toBeGreaterThan(0);
  });

  it('names in the parse layer it hands over only the parses it made, not the ones a store kept', async () => {
    const root = await checkout();
    await updateSourceIndex(root);
    await write(root, 'packages/a/src/fresh.ts', 'export const fresh = 4;\n');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'fresh');
    const tree = (await gitTreeOf(root, ['packages/a']))!;
    const { shape, aliases } = await shapeOf({ root, tree });
    const files = ['packages/a/src/fresh.ts', 'packages/a/src/index.ts', 'packages/a/src/lens.ts'];
    const { built, parseLayer } = nativeGraph({
      addon: native()!,
      tree: tree.native!,
      root,
      files,
      digests: files.map(() => undefined),
      largestFile: LARGEST_FILE,
      remembering: true,
      aliases,
      directories: shape.directories,
      stores: [parseStorePath(cache)],
    }, true);
    expect(built.filter((answer) => answer.kept === true).map((answer) => answer.record.file)).toEqual(files.slice(1));
    expect([...parseLayer!.keys]).toEqual([...decodeSourceIndex(parseLayer!.bytes).parses.keys()]);
    expect(parseLayer!.keys.size).toBe(1);
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

  it('keeps every parse through a compaction, and reclaims one no root names once it is old', async () => {
    const root = await checkout();
    await updateSourceIndex(join(root, 'packages/b'));
    await rm(dirname(sourceIndexPath(join(root, 'packages/b'))), { recursive: true, force: true });
    // Enough roots, each adding a parse of its own, to bring the store past the segments it keeps apart.
    for (let at = 0; at < 16; at += 1) {
      await write(root, `packages/many${String(at)}/index.ts`, `export const many = ${String(at)};\n`);
    }
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'many');
    const segments = `${parseStorePath(cache)}.segments`;
    for (let at = 0; at < 15; at += 1) await updateSourceIndex(join(root, `packages/many${String(at)}`));
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    for (const name of await readdir(segments)) await utimes(join(segments, name), old, old);
    const before = await storedKeys();
    // This append compacts the store into one segment, which holds every parse the segments did.
    await updateSourceIndex(join(root, 'packages/many15'));
    expect((await readdir(segments)).length).toBe(1);
    expect((await storedKeys()).length).toBe(before.length + 1);

    const swept = await pruneParseStore(cache, { graceMs: 60 * 60 * 1000 });
    expect(swept.dropped).toBeGreaterThan(0);
  });
});
