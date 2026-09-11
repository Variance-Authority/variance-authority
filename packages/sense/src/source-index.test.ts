import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Parsed } from './cache.js';
import { openImmutableLog } from './immutable-log.js';
import { decodeSourceIndex, encodeSourceIndex } from './source-index-format.js';
import { openSourceIndex } from './source-index.js';

const LAYOUT: Digest = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
const OTHER_LAYOUT: Digest = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const DIGEST: Digest = 'git:2222222222222222222222222222222222222222';
const OTHER: Digest = 'git:3333333333333333333333333333333333333333';
const PARSED: Parsed = {
  requests: [
    {
      value: './button.js',
      kind: 'imports',
      bindings: [{ imported: 'Button', local: 'Button', type: false }],
    },
    {
      value: './types.js',
      kind: 'type',
      bindings: [{ imported: 'Props', local: 'CardProps', type: true }],
    },
  ],
  exports: [
    { exported: 'Card', local: 'Card', type: false },
    { from: './button.js', imported: '*', type: false },
  ],
  declares: ['Card'],
  unknown: 'one dynamic request could not be read',
};
const RECORD: FileRecord = {
  file: 'src/card.tsx',
  digest: DIGEST,
  edges: [{ to: 'src/button.tsx', kind: 'imports' }],
  declares: ['Card'],
  unresolved: ['missing-package'],
  unknown: 'one relative request did not resolve',
};

describe('the binary source index', () => {
  const made: string[] = [];

  afterAll(async () => {
    for (const directory of made) await rm(directory, { recursive: true, force: true });
  });

  async function path(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'variance-source-index-'));
    made.push(directory);
    return join(directory, 'nested', 'source-index.bin');
  }

  it('publishes parses and resolved records as one generation', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    first.reuse.under(LAYOUT);
    first.reuse.set(RECORD);
    await first.save();

    const bytes = await readFile(file);
    expect(bytes.subarray(0, 1).toString('utf8')).not.toBe('{');

    const second = await openSourceIndex(file);
    second.reuse.under(LAYOUT);
    expect(second.cache.get(DIGEST)).toEqual(PARSED);
    expect(second.reuse.get(RECORD.file, DIGEST)).toEqual(RECORD);
    await second.save();
    expect(await readFile(file)).toEqual(bytes);
  });

  it('discards the resolved half when the layout changes without discarding parses', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    first.reuse.under(LAYOUT);
    first.reuse.set(RECORD);
    await first.save();

    const second = await openSourceIndex(file);
    expect(second.reuse.get(RECORD.file, DIGEST)).toBeUndefined();
    second.reuse.under(OTHER_LAYOUT);
    expect(second.cache.get(DIGEST)).toEqual(PARSED);
    expect(second.reuse.get(RECORD.file, DIGEST)).toBeUndefined();
  });

  it('certifies unchanged record values under a new layout without writing them again', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    first.reuse.under(LAYOUT);
    first.reuse.set(RECORD);
    await first.save();

    const second = await openSourceIndex(file);
    expect(second.cache.get(DIGEST)).toEqual(PARSED);
    second.reuse.under(OTHER_LAYOUT);
    expect(second.reuse.get(RECORD.file, DIGEST)).toBeUndefined();
    second.reuse.set(RECORD); // The full scan rebuilt the same logical value.
    await second.save();

    const changes = decodeSourceIndex((await openImmutableLog(file)).segments[1]!);
    expect(changes.layout).toBe(OTHER_LAYOUT);
    expect(changes.records.size).toBe(0);
    const third = await openSourceIndex(file);
    third.reuse.under(OTHER_LAYOUT);
    expect(third.reuse.get(RECORD.file, DIGEST)).toEqual(RECORD);
  });

  it('layers a later generation over the first and lets tombstones hide old keys', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    first.reuse.under(LAYOUT);
    first.reuse.set(RECORD);
    await first.save();

    const replacement: FileRecord = { file: RECORD.file, digest: OTHER, edges: [] };
    const second = await openSourceIndex(file);
    second.cache.set(OTHER, { requests: [] });
    second.reuse.under(LAYOUT);
    second.reuse.set(replacement);
    await second.save();

    expect(await readdir(`${file}.segments`)).toHaveLength(2);
    const changes = decodeSourceIndex((await openImmutableLog(file)).segments[1]!);
    expect([...changes.parses]).toEqual([[OTHER, { requests: [] }]]);
    expect([...changes.deletedParses ?? []]).toEqual([DIGEST]);
    expect([...changes.records]).toEqual([[RECORD.file, replacement]]);
    const third = await openSourceIndex(file);
    third.reuse.under(LAYOUT);
    expect(third.cache.get(DIGEST)).toBeUndefined();
    expect(third.cache.get(OTHER)).toEqual({ requests: [] });
    expect(third.reuse.get(RECORD.file, OTHER)).toEqual(replacement);
  });

  it('rejects the complete generation when any committed segment is corrupt', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    await first.save();
    const second = await openSourceIndex(file);
    second.cache.set(OTHER, { requests: [] });
    await second.save();

    const [segment] = await readdir(`${file}.segments`);
    await writeFile(join(`${file}.segments`, segment!), 'corrupt');

    expect((await openSourceIndex(file)).cache.get(OTHER)).toBeUndefined();
  });

  it('rejects duplicate logical keys instead of accepting a partial generation', () => {
    const encoded = encodeSourceIndex({
      parses: new Map([[DIGEST, PARSED], [OTHER, { requests: [] }]]),
      records: new Map(),
    });
    const headerLength = encoded.readUInt32LE(0);
    const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
      sections: { name: string; offset: number }[];
    };
    const section = header.sections.find((value) => value.name === 'parses.digest');
    expect(section).toBeDefined();
    const digests = new Uint32Array(
      encoded.buffer,
      encoded.byteOffset + 4 + headerLength + section!.offset,
      2,
    );
    digests[1] = digests[0]!;

    expect(() => decodeSourceIndex(encoded)).toThrow('not a variance-authority source index');
  });

  it('rejects a key that one segment both writes and deletes', () => {
    const encoded = encodeSourceIndex({
      parses: new Map([[DIGEST, PARSED]]),
      deletedParses: new Set([DIGEST]),
      records: new Map(),
    });

    expect(() => decodeSourceIndex(encoded)).toThrow('not a variance-authority source index');
  });
});
