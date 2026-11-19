import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { Parsed } from './cache.js';
import { native } from './addon.js';
import { countDecodedParseRows, decodedParseRows as rowsDecoded } from './__fixtures__/decoded-parse-rows.js';
import { openImmutableLog } from './immutable-log.js';
import { readPublishedSources } from './published.js';
import { encodeSourceIndex } from './source-index-format.js';
import { readSourceRecords } from './source-index.js';
import { readSourceIndexChain } from './source-index-reader.js';


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

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('answers each key from the layer that decided it last, decoding one row per key', async () => {
    const zero = `git:${'0'.repeat(40)}` as Digest;
    const over = encodeSourceIndex({
      parses: new Map([[zero, { requests: [] }], [`git:${'0'.repeat(39)}2` as Digest, { requests: [] }]]),
      directories: new Map(),
      records: new Map([['src/1.ts', { record: { file: 'src/1.ts' }, witnesses: [] }]]),
    });
    const decoded = countDecodedParseRows();
    const read = readSourceIndexChain([generation('old', 3), over]);

    expect(read.kept).toBe(2);
    expect([...read.stored.parses]).toHaveLength(3);
    expect(decoded()).toBe(3);
    expect(read.stored.parses.get(zero)).toEqual({ requests: [] });
    expect(read.stored.parses.get(`git:${'0'.repeat(39)}1` as Digest)?.requests[0]?.value).toBe('./old-1-0.js');
    expect(read.stored.records.get('src/1.ts')).toEqual({ record: { file: 'src/1.ts' }, witnesses: [] });
  });

  it('answers a key one layer both puts and deletes with its put, as compaction folds it', () => {
    const key = `git:${'0'.repeat(40)}` as Digest;
    const none = { parses: new Map(), directories: new Map(), records: new Map() };
    const base = encodeSourceIndex({ ...none, parses: new Map([[key, { requests: [], harvested: true }]]), directories: new Map([['src', key]]) });
    // The encoder writes no record deletes, so a record cannot be both here.
    const parse = readSourceIndexChain([base, encodeSourceIndex({ ...none, parses: new Map([[key, { requests: [] }]]), deletedParses: new Set([key]) })]);
    const directory = readSourceIndexChain([base, encodeSourceIndex({ ...none, directories: new Map([['src', 'git:new' as Digest]]), deletedDirectories: new Set(['src']) })]);

    expect(parse.kept).toBe(2);
    expect([...parse.stored.parses]).toEqual([[key, { requests: [] }]]);
    expect(directory.kept).toBe(2);
    expect([...directory.stored.directories]).toEqual([['src', 'git:new']]);
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

  it('answers from the later layer, and hands over no row of the layer it shadows', async () => {
    // A row is held only once it is decoded, so the rows a read decoded are what it can hold:
    // a count, where the heap around a collection moves with whatever else the worker did.
    const count = 100;
    const later = generation('new', count);
    const alone = await chain([[later]]);
    const layered = await chain([[generation('old', count)], [later]]);

    const read = await readPublishedSources(layered);
    expect(read.records).toHaveLength(count);
    expect(read.cache.get(`git:${'0'.repeat(40)}`)?.requests[0]?.value).toBe('./new-0-0.js');
    expect(read.records[0]?.edges).toEqual([{ to: 'src/new-0.ts', kind: 'imports' }]);
    // A read of the records and one parse hands over that parse alone, whatever the layer below holds:
    // the addon checked every row of both layers at open, and decodes none it is not asked for.
    const one = async (file: string) => (await readPublishedSources(file)).cache.get(`git:${'0'.repeat(40)}`);
    expect(await rowsDecoded(() => one(alone))).toBe(1);
    expect(await rowsDecoded(() => one(layered))).toBe(1);
  });

  it('reads the records alone without decoding a parse row', async () => {
    const file = await chain([[generation('old', 10)], [generation('new', 10)]]);
    expect(await rowsDecoded(async () => expect(await readSourceRecords(file)).toHaveLength(10))).toBe(0);
    expect(await rowsDecoded(async () => expect((await readPublishedSources(file)).records).toHaveLength(10))).toBe(0);
  });
});
