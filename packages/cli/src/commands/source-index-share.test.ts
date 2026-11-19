import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchedSourceIndexPath,
  placeSourceIndex,
  readPublishedSources,
  type SourceFetch,
  SOURCE_INDEX_PIECE,
  SOURCE_INDEX_VERSION,
  sourceIndexChain,
  sourceIndexPath,
  sourceIndexWrittenIn,
  updateSourceIndex,
} from '@variance-authority/sense';
import { memoryLineCell, publishLine } from '@variance-authority/core/share';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { BEFORE, DISCOUNTS, PUSH, cloneOf, collectedBoth, git, originAndCi, ranWhole, recordIn } from './mainline-fixture.js';
import { suiteBase } from './suite-base.js';
import { fetchFromMainline, sourceIndexEntryOf } from './source-index-share.js';
import { publishSuite } from './suite-share.js';

/**
 * A release that changes the source index's format, met by a checkout whose
 * repository opted in to carrying CI's index beside the mainline's record.
 */

const asked = vi.hoisted(() => ({ names: [] as string[], fails: undefined as Error | undefined, carryFails: undefined as Error | undefined }));
vi.mock('@variance-authority/sense', async (actual) => {
  const real = await actual<typeof import('@variance-authority/sense')>();
  return {
    ...real,
    // The index as it is carried; or a disk that fails under it once its headers have read, once `carryFails` is set.
    carriedSourceIndex: (...args: Parameters<typeof real.carriedSourceIndex>) =>
      asked.carryFails === undefined ? real.carriedSourceIndex(...args) : Promise.reject(asked.carryFails),
  };
});
vi.mock('./mainline-entry.js', async (actual) => {
  const real = await actual<typeof import('./mainline-entry.js')>();
  return {
    ...real,
    // The share as it is, with every entry it is asked for written down; or one that cannot be asked, once `fails` is set.
    mainlineEntry: (...args: Parameters<typeof real.mainlineEntry>) => {
      asked.names.push(String(args[1]));
      if (asked.fails !== undefined) return Promise.reject(asked.fails);
      return real.mainlineEntry(...args);
    },
  };
});

/** What `run` returned, and each line it wrote to stderr meanwhile. */
async function stderrOf<T>(run: () => Promise<T>): Promise<{ readonly out: T; readonly lines: readonly string[] }> {
  const lines: string[] = [];
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((line) => {
    lines.push(String(line));
    return true;
  });
  const out = await run().finally(() => stderr.mockRestore());
  return { out, lines };
}

let home: string;
const cwd = process.cwd();
const OLDER = SOURCE_INDEX_VERSION - 1;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-source-index-share-'));
  asked.names = [];
  asked.fails = undefined;
  asked.carryFails = undefined;
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** Five modules that import one another, the record's `src/total.ts` among them. */
const SOURCES: Readonly<Record<string, string>> = {
  'src/total.ts': BEFORE,
  'src/a.ts': "import { applyDiscount } from './total';\nexport const a = applyDiscount(10);\n",
  'src/b.ts': "import { a } from './a';\nexport const b = a + 1;\n",
  'src/c.ts': "import { b } from './b';\nexport const c = b + 1;\n",
  'src/d.ts': "import { c } from './c';\nexport const d = c + 1;\n",
  'test/total.test.ts': "import { applyDiscount } from '../src/total';\nit('discounts', () => applyDiscount(1));\n",
  'test/other.test.ts': "it('stands alone', () => {});\n",
};

/**
 * CI on `main`: `variance index`, then the whole suite's record published by
 * `share --suite` to a directory share, which carries the index when `opted`.
 */
async function mainlinePublished(opted: boolean, indexed: (ci: string) => Promise<void> = async () => undefined) {
  const { origin, ci } = await originAndCi(home);
  for (const [file, text] of Object.entries(SOURCES)) {
    await mkdir(join(ci, file, '..'), { recursive: true });
    await writeFile(join(ci, file), text);
  }
  const share = { kind: 'directory', root: join(home, 'share'), mainlines: ['main'], ...(opted ? { sourceIndex: true } : {}) };
  await writeFile(join(ci, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } }, share }));
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'first');
  const first = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'remote', 'add', 'origin', origin);
  await git(ci, 'push', '--quiet', 'origin', 'main');
  await git(ci, 'fetch', '--quiet', 'origin');

  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  await updateSourceIndex(ci);
  await indexed(ci);
  await recordIn(ci, first, ['test/total.test.ts'], [DISCOUNTS]);
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), first);
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
  return {
    ci,
    origin,
    first,
    written: 'published' in done ? done.published.written : [],
    unpublished: 'published' in done ? done.unpublished ?? [] : [],
  };
}

/**
 * A clone of `origin` with one module edited, whose index an earlier release
 * built. `before` changes it before anything reads it: the root config is read
 * once per process.
 */
async function laptopOnOlderRelease(origin: string, before: (clone: string) => Promise<void> = async () => undefined) {
  const clone = await cloneOf(home, origin);
  await before(clone);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'clone-cache'));
  await writeFile(join(clone, 'src/c.ts'), "import { b } from './b';\nexport const c = b + 2;\n");
  await updateSourceIndex(clone);
  await asOlderRelease(sourceIndexPath(clone));
  process.chdir(clone);
  return clone;
}

/**
 * The index at `path` as the release before this one wrote it: each segment's
 * header names the older format version, and every digest is its bytes' own.
 */
async function asOlderRelease(path: string): Promise<void> {
  const chain = await sourceIndexChain(path);
  if (chain === undefined) throw new Error(`no index at ${path}`);
  const length = chain.manifest.readUInt32LE(8);
  const manifest = JSON.parse(chain.manifest.subarray(12, 12 + length).toString('utf8')) as { segments: { digest: string; length: number }[] };
  const current = `"version":${String(SOURCE_INDEX_VERSION)},`;
  manifest.segments = [];
  for (const segment of chain.segments) {
    const bytes = await readFile(segment.path);
    const at = bytes.indexOf(current);
    expect(at).toBeGreaterThan(0);
    const older = Buffer.concat([bytes.subarray(0, at), Buffer.from(`"version":${String(OLDER)},`), bytes.subarray(at + current.length)]);
    const digest = `v1:${createHash('sha256').update(older).digest('hex').slice(0, 32)}`;
    await writeFile(join(`${path}.segments`, `${digest.replace(':', '-')}.bin`), older);
    await rm(segment.path);
    manifest.segments.push({ digest, length: older.length });
  }
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length);
  await writeFile(path, Buffer.concat([chain.manifest.subarray(0, 8), head, json]));
  expect(await sourceIndexWrittenIn(path)).toBe(OLDER);
}

/** The records an index built from nothing holds for `root`. */
async function coldRecords(root: string) {
  const cold = join(home, 'cold', 'source-index.bin');
  await mkdir(join(home, 'cold'), { recursive: true });
  await updateSourceIndex(root, { index: cold });
  return (await readPublishedSources(cold)).records;
}

describe('`variance index` over an index another release wrote', () => {
  it('starts from the index the mainline published beside its record, and reads again only the module that differs from it', async () => {
    const { origin, first, written } = await mainlinePublished(true);
    expect(written).toEqual(['suite-v1/unit', `source-index-v${String(SOURCE_INDEX_VERSION)}`]);
    const clone = await laptopOnOlderRelease(origin);

    const out = await indexOutput({ cwd: clone });

    const path = sourceIndexPath(clone);
    expect(out.split('\n')[0]).toBe(
      `source index rebuilt from the one fetched, main's at ${first.slice(0, 12)} over one written in format version ${String(OLDER)}: ` +
        `${String(Object.keys(SOURCES).length)} files, 1 read again, at ${path}`,
    );
    expect(await sourceIndexWrittenIn(path)).toBe(SOURCE_INDEX_VERSION);
    expect(await sourceIndexChain(`${path}.fetched`)).toBeUndefined();
    expect((await readPublishedSources(path)).records).toEqual(await coldRecords(clone));
  });

  it('publishes no index for a repository that did not opt in', async () => {
    const { written } = await mainlinePublished(false);

    expect(written).toEqual(['suite-v1/unit']);
    const held = await readdir(join(home, 'share'), { recursive: true });
    expect(held.filter((name) => name.includes('source-index'))).toEqual([]);
  });

  it('fetches nothing for a checkout whose configuration does not opt in, though the share holds an index, and reads every file', async () => {
    const { origin, written } = await mainlinePublished(true);
    expect(written).toContain(`source-index-v${String(SOURCE_INDEX_VERSION)}`);
    const clone = await laptopOnOlderRelease(origin, async (at) => {
      const config = JSON.parse(await readFile(join(at, 'variance.config.json'), 'utf8')) as { share: Record<string, unknown> };
      delete config.share.sourceIndex;
      await writeFile(join(at, 'variance.config.json'), JSON.stringify(config));
    });
    asked.names = [];

    const out = await indexOutput({ cwd: clone });

    expect(asked.names.filter((name) => name.startsWith('source-index-'))).toEqual([]);
    const path = sourceIndexPath(clone);
    const files = Object.keys(SOURCES).length;
    expect(out.split('\n')[0]).toBe(
      `source index rebuilt over one written in format version ${String(OLDER)}: ${String(files)} files, ${String(files)} read again, at ${path}`,
    );
    expect(await sourceIndexChain(`${path}.fetched`)).toBeUndefined();
  });

  it('publishes an index whose segment is past what Node reads whole, as images no larger than a piece', async () => {
    const { written, unpublished } = await mainlinePublished(true, async (ci) => {
      const chain = await sourceIndexChain(sourceIndexPath(ci));
      // Sparse: the length a large repository's segment reaches, without writing it.
      await truncate(chain?.segments[0]?.path ?? '', 2 ** 31);
    });

    expect(unpublished).toEqual([]);
    expect(written).toEqual(['suite-v1/unit', `source-index-v${String(SOURCE_INDEX_VERSION)}`]);
    const images = join(home, 'share', 'images');
    for (const image of await readdir(images)) expect((await stat(join(images, image))).size).toBeLessThanOrEqual(SOURCE_INDEX_PIECE);
  });

  it('starts from a sibling checkout of this release that fits, and drops the download without waiting on it', async () => {
    const { origin } = await mainlinePublished(true);
    const clone = await laptopOnOlderRelease(origin);
    const sibling = join(home, 'sibling');
    await git(clone, 'worktree', 'add', '--quiet', sibling);
    await updateSourceIndex(sibling);
    const signals: AbortSignal[] = [];
    // A download that never ends on its own: the update finishes only if it drops it.
    const fetch = vi.fn<SourceFetch>((_root, _into, signal) => new Promise((resolve) => {
      signals.push(signal);
      signal.addEventListener('abort', () => resolve(undefined));
    }));

    const update = await updateSourceIndex(clone, { fetch });

    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    expect(update).toMatchObject({ was: 'other-version', files: Object.keys(SOURCES).length, reread: 1 });
    expect(update.from).toMatch(/source-index\.bin$/);
    expect(update.fetched).toBeUndefined();
  });

  it('fetches CI\'s index when the sibling checkout of this release does not open, and reads again only the module that differs', async () => {
    const { origin } = await mainlinePublished(true);
    const clone = await laptopOnOlderRelease(origin);
    const sibling = join(home, 'sibling');
    await git(clone, 'worktree', 'add', '--quiet', sibling);
    await updateSourceIndex(sibling);
    const damaged = (await sourceIndexChain(sourceIndexPath(sibling)))?.segments.at(-1)?.path ?? '';
    // Its header still names this release; the rest does not open.
    await truncate(damaged, (await stat(damaged)).size - 1);
    expect(await sourceIndexWrittenIn(sourceIndexPath(sibling))).toBe(SOURCE_INDEX_VERSION);

    const update = await updateSourceIndex(clone, { fetch: fetchFromMainline });

    expect(update).toMatchObject({ was: 'other-version', files: Object.keys(SOURCES).length, reread: 1 });
    expect(update.fetched).toMatch(/^main's at /);
  });

  it('says why nothing was fetched for an opted-in checkout whose share holds no index, and reads every file', async () => {
    const { origin } = await mainlinePublished(false);
    const clone = await laptopOnOlderRelease(origin, async (at) => {
      const config = JSON.parse(await readFile(join(at, 'variance.config.json'), 'utf8')) as { share: Record<string, unknown> };
      config.share.sourceIndex = true;
      await writeFile(join(at, 'variance.config.json'), JSON.stringify(config));
    });
    const said: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((line) => {
      said.push(String(line));
      return true;
    });

    const out = await indexOutput({ cwd: clone }).finally(() => stderr.mockRestore());

    const files = String(Object.keys(SOURCES).length);
    expect(out.split('\n')[0]).toBe(
      `source index rebuilt over one written in format version ${String(OLDER)}: ${files} files, ${files} read again, at ${sourceIndexPath(clone)}`,
    );
    expect(said.filter((line) => line.includes('source index was not fetched'))).toEqual([
      `variance: CI's source index was not fetched, so every file is read: the share holds no source-index-v${String(SOURCE_INDEX_VERSION)} (absent)\n`,
    ]);
  });

  it('publishes the record, and says why the index is left out, when a segment cannot be read', async () => {
    const { written, unpublished } = await mainlinePublished(true, async (ci) => {
      const segment = (await sourceIndexChain(sourceIndexPath(ci)))?.segments[0]?.path ?? '';
      await rm(segment);
      await mkdir(segment);
    });

    expect(written).toEqual(['suite-v1/unit']);
    expect(unpublished).toEqual([expect.stringMatching(/^the source index: this checkout has no source index at .+ that reads$/)]);
  });

  it('publishes the record, and says why the index is left out, when the disk fails while the index is carried', async () => {
    const { written, unpublished } = await mainlinePublished(true, async () => {
      asked.carryFails = new Error('EIO: i/o error, read');
    });

    expect(written).toEqual(['suite-v1/unit']);
    expect(unpublished).toEqual(['the source index: EIO: i/o error, read']);
  });

  it('starts from no fetched index, and reads every file, when the fetch fails', async () => {
    const { origin } = await mainlinePublished(true);
    const clone = await laptopOnOlderRelease(origin);

    const update = await updateSourceIndex(clone, { fetch: () => Promise.reject(new Error('the network went away')) });

    expect(update).toMatchObject({ was: 'other-version', files: Object.keys(SOURCES).length, reread: Object.keys(SOURCES).length });
    expect(update.fetched).toBeUndefined();
  });

  it.each([
    ['a segment it holds is not what its digest says', 'images', `a segment of main's at`],
    ['the manifest it holds is not what its digest says', 'entries', `the manifest of main's at`],
  ])('says why nothing was fetched, and reads every file, when %s', async (_, kept, why) => {
    const { origin } = await mainlinePublished(true);
    for (const file of await readdir(join(home, 'share'), { recursive: true })) {
      if (file.split('/').at(-2) === kept) await writeFile(join(home, 'share', file), 'damaged');
    }
    const clone = await laptopOnOlderRelease(origin);
    const said = await stderrOf(() => indexOutput({ cwd: clone }));

    const files = String(Object.keys(SOURCES).length);
    expect(said.out.split('\n')[0]).toBe(
      `source index rebuilt over one written in format version ${String(OLDER)}: ${files} files, ${files} read again, at ${sourceIndexPath(clone)}`,
    );
    expect(said.lines.filter((line) => line.includes('source index was not fetched'))).toEqual([expect.stringContaining(why)]);
    expect(await sourceIndexChain(`${sourceIndexPath(clone)}.fetched`)).toBeUndefined();
  });

  it('says why nothing was fetched, and places nothing, when the share names images other than the segments the manifest names', async () => {
    const { origin } = await mainlinePublished(true);
    for (const file of await readdir(join(home, 'share'), { recursive: true })) {
      if (!file.endsWith('manifest.json')) continue;
      const line = JSON.parse(await readFile(join(home, 'share', file), 'utf8')) as { entries: { images?: string[] }[] };
      for (const entry of line.entries) if (entry.images !== undefined) entry.images = entry.images.map(() => '0'.repeat(64));
      await writeFile(join(home, 'share', file), JSON.stringify(line));
    }
    const clone = await laptopOnOlderRelease(origin);
    const into = fetchedSourceIndexPath(sourceIndexPath(clone));

    const said = await stderrOf(() => fetchFromMainline(clone, into, new AbortController().signal));

    expect(said.out).toBeUndefined();
    expect(said.lines.at(-1)).toMatch(/^variance: CI's source index was not fetched, so every file is read: a segment of main's at \w{12} is missing or not what its digest says\n$/);
    expect(await sourceIndexChain(into)).toBeUndefined();
  });

  it('says why nothing was fetched when the share cannot be asked', async () => {
    const { origin } = await mainlinePublished(true);
    const clone = await laptopOnOlderRelease(origin);
    asked.fails = new Error('the share refused the connection');

    const said = await stderrOf(() => fetchFromMainline(clone, fetchedSourceIndexPath(sourceIndexPath(clone)), new AbortController().signal));

    expect(said.out).toBeUndefined();
    expect(said.lines).toEqual([`variance: CI's source index was not fetched, so every file is read: the share refused the connection\n`]);
  });

  it('places nothing, and says nothing, once another checkout\'s index fits', async () => {
    const { origin } = await mainlinePublished(true);
    const clone = await laptopOnOlderRelease(origin);
    const into = fetchedSourceIndexPath(sourceIndexPath(clone));
    const fits = new AbortController();
    fits.abort();

    const said = await stderrOf(() => fetchFromMainline(clone, into, fits.signal));

    expect(said).toEqual({ out: undefined, lines: [] });
    expect(await sourceIndexChain(into)).toBeUndefined();
  });

  it('fetches nothing, and says nothing, for a checkout whose share section does not parse', async () => {
    const root = join(home, 'unparsed');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ share: { kind: 'nowhere', sourceIndex: true } }));

    const said = await stderrOf(() => fetchFromMainline(root, fetchedSourceIndexPath(sourceIndexPath(root)), new AbortController().signal));

    expect(said).toEqual({ out: undefined, lines: [] });
    expect(asked.names).toEqual([]);
  });

  it('reads the mainline record without asking the share for the index, which only an update fetches', async () => {
    const { origin, first } = await mainlinePublished(true);
    const clone = await laptopOnOlderRelease(origin);
    asked.names = [];

    const base = await suiteBase(clone, { env: {} });

    expect(base).toMatchObject({ mainline: { mainline: 'main', commit: first } });
    expect(asked.names.filter((name) => name.startsWith('source-index-'))).toEqual([]);
    expect(await sourceIndexWrittenIn(sourceIndexPath(clone))).toBe(OLDER);
  });
});

describe('the index a publish carries, read off its segments', () => {
  /** A checkout of the five modules, indexed by this release. */
  async function indexed() {
    const root = join(home, 'checkout');
    for (const [file, text] of Object.entries(SOURCES)) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), text);
    }
    await git(root, 'init', '--quiet');
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'cache'));
    await updateSourceIndex(root);
    const path = sourceIndexPath(root);
    const segment = (await sourceIndexChain(path))?.segments[0]?.path ?? '';
    return { root, path, segment };
  }

  it('carries no index from a checkout that has none, or one another release wrote, and names no piece it does not hold', async () => {
    const { root, path } = await indexed();
    const at = { commit: 'a'.repeat(40) };
    const carried = await sourceIndexEntryOf(root, at);
    if (!('entry' in carried)) throw new Error(carried.unpublished);
    await expect(carried.image('0'.repeat(64))).rejects.toThrow(`the source index names no piece ${'0'.repeat(64)}`);

    await asOlderRelease(path);
    expect(await sourceIndexEntryOf(root, at)).toEqual({
      unpublished: `the source index at ${path} was written in format version ${String(OLDER)}, and this release writes ${String(SOURCE_INDEX_VERSION)}`,
    });
    await rm(path);
    expect(await sourceIndexEntryOf(root, at)).toEqual({ unpublished: `this checkout has no source index at ${path} that reads` });
  });

  it.each([
    ['is missing', (segment: string) => rm(segment)],
    ['stops inside its header', (segment: string) => truncate(segment, 10)],
    ['is not a segment', (segment: string) => writeFile(segment, Buffer.alloc(8192, 7))],
    ['stops inside the text of its header', async (segment: string) => truncate(segment, (await readFile(segment)).indexOf('"version":'))],
    ['is a directory', async (segment: string) => {
      await rm(segment);
      await mkdir(segment);
    }],
  ])('names no version for an index one of whose segments %s', async (_, damage) => {
    const { path, segment } = await indexed();
    await damage(segment);

    expect(await sourceIndexWrittenIn(path)).toBeUndefined();
  });

  it('carries a segment longer than a piece as several images, and places it back as it was', async () => {
    const { root, path } = await indexed();
    const carried = await sourceIndexEntryOf(root, { commit: 'a'.repeat(40) }, 1024);
    if (!('entry' in carried)) throw new Error(carried.unpublished);
    const images = carried.entry.images ?? [];
    const segment = (await sourceIndexChain(path))?.segments[0]?.path ?? '';
    expect(images.length).toBeGreaterThanOrEqual(Math.ceil((await stat(segment)).size / 1024));
    for (const image of images) expect((await carried.image(image)).length).toBeLessThanOrEqual(1024);

    const into = fetchedSourceIndexPath(path);
    expect(await placeSourceIndex(into, carried.entry.bytes, carried.image)).toBe(true);

    const placed = await sourceIndexChain(into);
    const original = await sourceIndexChain(path);
    expect(placed?.manifest).toEqual(original?.manifest);
    for (const [at, held] of (original?.segments ?? []).entries()) {
      expect(await readFile(placed?.segments[at]?.path ?? '')).toEqual(await readFile(held.path));
    }
  });

  it('says which segment ended inside a piece it held when published', async () => {
    const { root, segment } = await indexed();
    const carried = await sourceIndexEntryOf(root, { commit: 'a'.repeat(40) }, 1024);
    if (!('entry' in carried)) throw new Error(carried.unpublished);
    await truncate(segment, 1500);

    await expect(carried.image(carried.entry.images?.[1] ?? '')).rejects.toThrow(`${segment} ended at 1500, inside a piece it held when published`);
  });

  it('places nothing when a piece is missing, and leaves no part of a segment behind', async () => {
    const { root, path } = await indexed();
    const carried = await sourceIndexEntryOf(root, { commit: 'a'.repeat(40) }, 1024);
    if (!('entry' in carried)) throw new Error(carried.unpublished);
    const gone = carried.entry.images?.at(-1);
    const into = fetchedSourceIndexPath(path);

    const placed = await placeSourceIndex(into, carried.entry.bytes, (digest) =>
      digest === gone ? Promise.resolve(undefined) : carried.image(digest),
    );

    expect(placed).toBe(false);
    expect(await sourceIndexChain(into)).toBeUndefined();
    expect(await readdir(`${into}.segments`).catch(() => [])).toEqual([]);
  });

  it('sends a mainline only the pieces of the segments its next commit wrote', async () => {
    const { root, path } = await indexed();
    const cell = memoryLineCell();
    const line = { kind: 'mainline', name: 'main' } as const;
    const sent: number[] = [];
    const publish = async (commit: string) => {
      const carried = await sourceIndexEntryOf(root, { commit }, 1024);
      if (!('entry' in carried)) throw new Error(carried.unpublished);
      const image = async (digest: string) => {
        const bytes = await carried.image(digest);
        sent.push(bytes.length);
        return bytes;
      };
      await publishLine(cell, line, [carried.entry], { descends: async () => false, image });
    };
    await publish('a'.repeat(40));
    const before = new Set((await sourceIndexChain(path))?.segments.map((segment) => segment.digest));
    sent.length = 0;

    await writeFile(join(root, 'src/c.ts'), "import { b } from './b';\nexport const c = b + 2;\n");
    await updateSourceIndex(root);
    await publish('b'.repeat(40));

    const after = (await sourceIndexChain(path))?.segments ?? [];
    expect(after.filter((segment) => before.has(segment.digest))).not.toEqual([]);
    let added = 0;
    for (const segment of after) if (!before.has(segment.digest)) added += (await stat(segment.path)).size;
    expect(sent.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(added);
    expect(sent.length).toBeGreaterThan(0);
  });

  it('places nothing from bytes that are not a manifest', async () => {
    const { path } = await indexed();
    const into = fetchedSourceIndexPath(path);

    expect(await placeSourceIndex(into, Buffer.from('not a manifest'), () => Promise.resolve(undefined))).toBe(false);
    expect(await sourceIndexChain(into)).toBeUndefined();
  });
});
