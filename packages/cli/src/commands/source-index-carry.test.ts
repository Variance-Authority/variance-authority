import { mkdir, mkdtemp, readdir, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchedSourceIndexPath,
  placeSourceIndex,
  SOURCE_INDEX_VERSION,
  sourceIndexChain,
  sourceIndexPath,
  sourceIndexWrittenIn,
  updateSourceIndex,
} from '@variance-authority/sense';
import { memoryLineCell, publishLine } from '@variance-authority/core/share';
import { git } from './mainline-fixture.js';
import { OLDER, SOURCES, asOlderRelease } from './source-index-fixture.js';
import { sourceIndexEntryOf } from './source-index-share.js';

/** The source index as a mainline's publish carries it, in pieces, and as an update places it back. */

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-source-index-carry-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
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
    ['holds a whole header of no segment', (segment: string) => writeFile(segment, Buffer.from([2, 0, 0, 0, 0x7b, 0x7d]))],
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
