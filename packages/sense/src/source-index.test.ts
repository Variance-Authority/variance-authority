import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Parsed } from './cache.js';
import { BadLogPath, openImmutableLog } from './immutable-log.js';
import { decodeSourceIndex, encodeSourceIndex } from './source-index-format.js';
import { readPublishedSources } from './published.js';
import { openSourceIndex, readSourceRecords } from './source-index.js';
import type { TreeShape } from './reuse.js';
import { directoriesOf } from './witness.js';

const CONFIG: Digest = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
const OTHER_CONFIG: Digest = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const SHAPE: TreeShape = { config: CONFIG, directories: directoriesOf(['src/card.tsx', 'src/button.tsx']) };
const OTHER_SHAPE: TreeShape = { ...SHAPE, config: OTHER_CONFIG };
/** The directories `RECORD`'s one specifier could have been answered from. */
const WITNESSES = ['src'];
const DIGEST: Digest = 'git:2222222222222222222222222222222222222222';
const OTHER: Digest = 'git:3333333333333333333333333333333333333333';
const PARSED: Parsed = {
  requests: [
    {
      value: './button.js',
      kind: 'imports',
      line: 1,
      bindings: [{ imported: 'Button', local: 'Button', type: false, line: 1 }],
    },
    {
      // Two different lines, so a round trip that collapsed them into one column
      // — or dropped the per-binding half — fails here rather than downstream in
      // a citation nobody can open.
      value: './types.js',
      kind: 'type',
      line: 7,
      bindings: [{ imported: 'Props', local: 'CardProps', type: true, line: 7 }],
    },
  ],
  exports: [
    {
      exported: 'Card',
      local: 'Card',
      type: false,
      line: 3,
      signature: { start: 18, end: 42 },
      doc: { start: 2, end: 15 },
    },
    { from: './button.js', imported: '*', type: false, line: 9, signature: { start: 80, end: 108 } },
  ],
  symbols: [
    {
      name: 'Card',
      kind: 'class',
      line: 3,
      signature: { start: 18, end: 42 },
      doc: { start: 2, end: 15 },
    },
  ],
  declares: ['Card'],
  unknown: 'one dynamic request could not be read',
};
const RECORD: FileRecord = {
  file: 'src/card.tsx',
  digest: DIGEST,
  edges: [{ to: 'src/button.tsx', kind: 'imports' }],
  // A name no other field of this generation holds, so a dictionary that never
  // collected package edges writes it as some other string and the round trip
  // below fails on it.
  packages: [{ to: '@scope/only-in-packages', kind: 'imports' }],
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
    first.reuse.under(SHAPE);
    first.reuse.set(RECORD, WITNESSES);
    await first.save();

    const bytes = await readFile(file);
    expect(bytes.subarray(0, 1).toString('utf8')).not.toBe('{');

    const second = await openSourceIndex(file);
    second.reuse.under(SHAPE);
    expect(second.cache.get(DIGEST)).toEqual(PARSED);
    expect(second.reuse.get(RECORD.file, DIGEST)).toEqual(RECORD);
    await second.save();
    expect(await readFile(file)).toEqual(bytes);
    expect(await readSourceRecords(file)).toEqual([RECORD]);
  });

  it('discards the resolved half when the configuration changes without discarding parses', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    first.reuse.under(SHAPE);
    first.reuse.set(RECORD, WITNESSES);
    await first.save();

    const second = await openSourceIndex(file);
    expect(second.reuse.get(RECORD.file, DIGEST)).toBeUndefined();
    second.reuse.under(OTHER_SHAPE);
    expect(second.cache.get(DIGEST)).toEqual(PARSED);
    expect(second.reuse.get(RECORD.file, DIGEST)).toBeUndefined();
  });

  it('certifies unchanged record values under a new configuration without writing them again', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    first.reuse.under(SHAPE);
    first.reuse.set(RECORD, WITNESSES);
    await first.save();

    const second = await openSourceIndex(file);
    expect(second.cache.get(DIGEST)).toEqual(PARSED);
    second.reuse.under(OTHER_SHAPE);
    expect(second.reuse.get(RECORD.file, DIGEST)).toBeUndefined();
    second.reuse.set(RECORD, WITNESSES); // The full scan rebuilt the same logical value.
    await second.save();

    const changes = decodeSourceIndex((await openImmutableLog(file)).segments[1]!);
    expect(changes.config).toBe(OTHER_CONFIG);
    expect(changes.records.size).toBe(0);
    const third = await openSourceIndex(file);
    third.reuse.under(OTHER_SHAPE);
    expect(third.reuse.get(RECORD.file, DIGEST)).toEqual(RECORD);
  });

  it('layers a later generation over the first and lets tombstones hide old keys', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    first.reuse.under(SHAPE);
    first.reuse.set(RECORD, WITNESSES);
    await first.save();

    const replacement: FileRecord = { file: RECORD.file, digest: OTHER, edges: [] };
    const second = await openSourceIndex(file);
    second.cache.set(OTHER, { requests: [] });
    second.reuse.under(SHAPE);
    second.reuse.set(replacement, WITNESSES);
    await second.save();

    expect(await readdir(`${file}.segments`)).toHaveLength(2);
    const changes = decodeSourceIndex((await openImmutableLog(file)).segments[1]!);
    expect([...changes.parses]).toEqual([[OTHER, { requests: [] }]]);
    expect([...changes.deletedParses ?? []]).toEqual([DIGEST]);
    expect([...changes.records]).toEqual([
      [RECORD.file, { record: replacement, witnesses: WITNESSES }],
    ]);
    const third = await openSourceIndex(file);
    third.reuse.under(SHAPE);
    expect(third.cache.get(DIGEST)).toBeUndefined();
    expect(third.cache.get(OTHER)).toEqual({ requests: [] });
    expect(third.reuse.get(RECORD.file, OTHER)).toEqual(replacement);
  });

  it('keeps the generation up to the first corrupt segment, and says it is damaged', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    await first.save();
    const second = await openSourceIndex(file);
    second.cache.set(OTHER, { requests: [] });
    await second.save();

    const [, later] = (await openImmutableLog(file)).digests;
    await writeFile(join(`${file}.segments`, `${later!.replace(':', '-')}.bin`), 'corrupt');

    const opened = await openSourceIndex(file);
    expect(opened.cache.get(DIGEST)).toEqual(PARSED);
    expect(opened.cache.get(OTHER)).toBeUndefined();
    expect((await readPublishedSources(file)).state).toBe('damaged');

    await opened.save();
    expect((await readPublishedSources(file)).state).toBe('published');
  });

  it('keeps nothing when the first segment is corrupt', async () => {
    const file = await path();
    const first = await openSourceIndex(file);
    first.cache.set(DIGEST, PARSED);
    await first.save();

    const [only] = (await openImmutableLog(file)).digests;
    await writeFile(join(`${file}.segments`, `${only!.replace(':', '-')}.bin`), 'corrupt');

    expect((await openSourceIndex(file)).cache.get(DIGEST)).toBeUndefined();
    expect((await readPublishedSources(file)).state).toBe('damaged');
  });

  it('refuses a path that cannot name a file rather than reporting an empty cache', async () => {
    const file = await path();
    const notAPath = { file } as unknown as string;

    await expect(openSourceIndex(notAPath)).rejects.toBeInstanceOf(BadLogPath);
  });

  it('rejects duplicate logical keys instead of accepting a partial generation', () => {
    const encoded = encodeSourceIndex({
      parses: new Map([[DIGEST, PARSED], [OTHER, { requests: [] }]]),
      directories: new Map(),
      records: new Map(),
    });
    const headerLength = encoded.readUInt32LE(0);
    const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
      sections: { name: string; offset: number }[];
    };
    const section = header.sections.find((value) => value.name === 'parses.key');
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
      directories: new Map(),
      records: new Map(),
    });

    expect(() => decodeSourceIndex(encoded)).toThrow('not a variance-authority source index');
  });
});
