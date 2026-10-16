import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterAll, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { Parsed } from './cache.js';
import { native } from './addon.js';
import { openImmutableLog } from './immutable-log.js';
import { readPublishedSources } from './published.js';
import { decodeSourceIndex, encodeSourceIndex } from './source-index-format.js';

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

  it('answers from the later layer, and holds no more of the heap than that layer alone', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    // Enough rows that decoding the shadowed layer stands above what one read leaves on the heap anyway.
    const count = 5_000;
    const later = generation('new', count);
    const alone = await chain([[later]]);
    const layered = await chain([[generation('old', count)], [later]]);
    const held = async (file: string): Promise<number> => {
      gc();
      const before = process.memoryUsage().heapUsed;
      const published = await readPublishedSources(file);
      published.cache.get(`git:${'0'.repeat(40)}`);
      gc();
      const after = process.memoryUsage().heapUsed;
      expect(published.records).toHaveLength(count);
      return after - before;
    };

    const read = await readPublishedSources(layered);
    expect(read.cache.get(`git:${'0'.repeat(40)}`)?.requests[0]?.value).toBe('./new-0-0.js');
    expect(read.records[0]?.edges).toEqual([{ to: 'src/new-0.ts', kind: 'imports' }]);
    // Whatever else the worker frees during one read moves that one measure, so
    // the two are taken in turn and compared by their medians.
    const rounds: { layered: number; alone: number }[] = [];
    for (let round = 0; round < 3; round += 1) rounds.push({ layered: await held(layered), alone: await held(alone) });
    const median = (values: number[]): number => values.sort((left, right) => left - right)[1]!;
    expect(median(rounds.map((round) => round.layered))).toBeLessThan(median(rounds.map((round) => round.alone)) * 1.5);
  });
});
