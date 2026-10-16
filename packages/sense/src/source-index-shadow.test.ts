import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { Parsed } from './cache.js';
import { native } from './addon.js';
import { openImmutableLog } from './immutable-log.js';
import { readPublishedSources } from './published.js';
import { decodeSourceIndex, encodeSourceIndex, type StoredSourceIndex } from './source-index-format.js';

/** Every layer the chain reader decoded, in the order it decoded them: all a read can go on to hold. */
const decodedLayers = vi.hoisted((): StoredSourceIndex[] => []);

vi.mock('./source-index-format.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./source-index-format.js')>();
  return {
    ...actual,
    decodeSourceIndex: (...args: Parameters<typeof actual.decodeSourceIndex>) => {
      const layer = actual.decodeSourceIndex(...args);
      decodedLayers.push(layer);
      return layer;
    },
  };
});

/** How many rows one read of `file` decoded, by layer, newest first. */
async function rowsDecoded(file: string): Promise<number[]> {
  decodedLayers.length = 0;
  await readPublishedSources(file);
  return decodedLayers.map((layer) => layer.parses.size + layer.records.size + layer.directories.size);
}

/**
 * One generation of `count` files, each parsed and resolved, every string in it its own to `layer`.
 * A parse is keyed by the content it was read from, so a later layer puts one again only as a
 * harvested read of what the earlier read without; the `new` layer's parses are harvested.
 */
function generation(layer: string, count: number): Uint8Array {
  const parses = new Map<Digest, Parsed>();
  const records = new Map<string, { record: { file: string; digest: Digest; edges: { to: string; kind: 'imports' }[] }; witnesses: string[] }>();
  for (let at = 0; at < count; at += 1) {
    const digest = `git:${String(at).padStart(40, '0')}` as Digest;
    const file = `src/${at}.ts`;
    parses.set(digest, {
      requests: Array.from({ length: 4 }, (_, request) => ({
        value: `./${layer}-${at}-${request}.js`,
        kind: 'imports' as const,
        line: request + 1,
        bindings: [{ imported: `${layer}${at}`, local: `${layer}${at}`, type: false, line: request + 1 }],
      })),
      ...(layer === 'new' && { harvested: true as const }),
    });
    records.set(file, {
      record: { file, digest, edges: [{ to: `src/${layer}-${at}.ts`, kind: 'imports' }] },
      witnesses: [`src/${layer}`],
    });
  }
  return encodeSourceIndex({ parses, directories: new Map(), records });
}

describe('a chain whose later layer puts every key again', () => {
  const made: string[] = [];

  afterAll(async () => {
    for (const directory of made) await rm(directory, { recursive: true, force: true });
  });

  /** A chain written save by save: the first save's layers are the base, each later one the working layer. */
  async function chain(saves: readonly (readonly Uint8Array[])[]): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'variance-source-index-shadow-'));
    made.push(directory);
    const file = join(directory, 'source-index.bin');
    for (const layers of saves) {
      expect(native()!.appendSourceIndex(file, [...(await openImmutableLog(file)).digests], false, [...layers])).toBeNull();
    }
    return file;
  }

  it('decodes no row a later layer already decided', () => {
    const decoded = decodeSourceIndex(generation('old', 3), {
      parses: new Set([`git:${'0'.repeat(40)}`, `git:${'0'.repeat(39)}2`]),
      records: new Set(['src/1.ts']),
      directories: new Set(),
    });

    expect([...decoded.parses.keys()]).toEqual([`git:${'0'.repeat(39)}1`]);
    expect([...decoded.records.keys()]).toEqual(['src/0.ts', 'src/2.ts']);
  });

  it('refuses a layer that puts and deletes one key, though a later layer decided it', () => {
    const key = `git:${'0'.repeat(40)}` as Digest;
    const none = { parses: new Map(), directories: new Map(), records: new Map() };
    const decided = { parses: new Set([key]), records: new Set(['src/0.ts']), directories: new Set(['src']) };
    // The encoder writes no record deletes, so a record cannot be both here.
    const layers = [
      { ...none, parses: new Map([[key, { requests: [] }]]), deletedParses: new Set([key]) },
      { ...none, directories: new Map([['src', key]]), deletedDirectories: new Set(['src']) },
    ];

    for (const layer of layers) {
      expect(() => decodeSourceIndex(encodeSourceIndex(layer), decided)).toThrow('not a variance-authority source index');
    }
  });

  it('reads up to a damaged segment as though no layer above it decided anything', async () => {
    // Whole bytes the log reads, under their own digest, that are no source index.
    // One save onto nothing writes them as they are; a save onto them would refuse its base.
    const file = await chain([[generation('old', 2), new TextEncoder().encode('not a source index'), generation('new', 2)]]);
    expect((await openImmutableLog(file)).segments).toHaveLength(3);

    const read = await readPublishedSources(file);
    expect(read.state).toBe('damaged');
    expect(read.generation).toHaveLength(1);
    expect(read.cache.get(`git:${'0'.repeat(40)}`)?.requests[0]?.value).toBe('./old-0-0.js');
    expect(read.records.map((record) => record.edges)).toEqual([
      [{ to: 'src/old-0.ts', kind: 'imports' }],
      [{ to: 'src/old-1.ts', kind: 'imports' }],
    ]);
  });

  it('answers from the later layer, and decodes no row of the layer it shadows', async () => {
    // A row is held only once it is decoded, so the rows each layer decoded are what the read
    // can hold: a count, where the heap around a collection moves with whatever else the worker did.
    const count = 100;
    const later = generation('new', count);
    const alone = await chain([[later]]);
    const layered = await chain([[generation('old', count)], [later]]);

    const read = await readPublishedSources(layered);
    expect(read.records).toHaveLength(count);
    expect(read.cache.get(`git:${'0'.repeat(40)}`)?.requests[0]?.value).toBe('./new-0-0.js');
    expect(read.records[0]?.edges).toEqual([{ to: 'src/new-0.ts', kind: 'imports' }]);
    // One parse and one record per file, and no directories.
    expect(await rowsDecoded(alone)).toEqual([count * 2]);
    expect(await rowsDecoded(layered)).toEqual([count * 2, 0]);
  });
});
