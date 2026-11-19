import { isDeepStrictEqual } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Parsed, ParseKey } from './cache.js';
import { countDecodedParseRows } from './__fixtures__/decoded-parse-rows.js';
import { encodeSourceIndex, SOURCE_INDEX_VERSION, type IndexedRecord, type StoredSourceIndex } from './source-index-format.js';
import { readSourceIndexChain, readSourceIndexSegment } from './source-index-reader.js';

const SPAN = { start: 0, end: 4, text: 'head' };

/** Every column family, its optional fields both set and left out, and a zero line. */
const FULL: Parsed = {
  requests: [
    { value: './a', kind: 'imports', line: 0, bindings: [{ imported: 'a', local: 'a', type: false, line: 0 }] },
    { value: 'b', kind: 'requires', line: 2, bindings: [], guessed: true, item: true, republishes: true },
  ],
  exports: [
    { exported: 'a', local: 'a', type: false, line: 0, signature: SPAN, doc: { start: 1, end: 2 }, roles: ['testOnly', 'production'], lineText: 'export a' },
    { from: './c', imported: 'c', type: true, line: 3 },
  ],
  symbols: [
    { name: 'a', kind: 'function', line: 0, signature: SPAN, reach: 'module' },
    { name: 'b', kind: 'class', line: 5 },
  ],
  harvested: true,
  declares: ['a'],
  mocks: { plus: ['./m'] },
  members: [{ request: 1, name: 'x', line: 0, throughDefault: true }, { request: 0, name: 'y', line: 4 }],
  memberDeclarations: [{ name: 'm', line: 0, on: 'b', doc: SPAN, lineText: 'm()' }, { name: 'n', line: 1, on: 'b' }],
  memberUses: [{ name: 'm', line: 0, of: 'b', how: 'call' }],
  ownUses: [{ name: 'a', line: 0 }],
  nested: [
    { name: 'inner', kind: 'function', line: 0, signature: SPAN, holder: 'a', holderLine: 0 },
    { name: 'loose', kind: 'variable', line: 2, signature: SPAN, holderLine: 0 },
  ],
  bindingMembers: [{ request: 0, binding: 'a', within: ['p'], name: 'q', line: 0 }, { request: 0, binding: 'a', name: 'r', line: 1 }],
  unknown: 'too large',
  size: { bytes: 10, lines: 0, blocks: 1 },
  doc: SPAN,
} as Parsed;

/** Lists the format holds present and empty, beside a parse that left them out. */
const EMPTY: Parsed = { requests: [], exports: [], declares: [] } as Parsed;
const BARE: Parsed = { requests: [], size: { bytes: 0, lines: 0 } } as Parsed;

const A = 'git:1111111111111111111111111111111111111111' as ParseKey;
const B = 'git:2222222222222222222222222222222222222222' as ParseKey;
const WAY = `${A}\u0000.css` as ParseKey;

function indexed(file: string, targets?: readonly (string | undefined)[]): IndexedRecord {
  return {
    record: { file, digest: B as Digest, edges: [{ to: 'src/b.ts', kind: 'imports' }], packages: [{ to: 'react', kind: 'imports' }], unresolved: [] },
    witnesses: ['src'],
    ...(targets === undefined ? {} : { targets }),
  };
}

const WHOLE: StoredSourceIndex = {
  config: 'git:3333333333333333333333333333333333333333' as Digest,
  parses: new Map([[A, FULL], [B, EMPTY], [WAY, BARE]]),
  directories: new Map([['src', B as Digest], ['lib', A as Digest]]),
  records: new Map([
    ['src/a.ts', indexed('src/a.ts', [undefined, 'src/b.ts'])],
    ['src/b.ts', indexed('src/b.ts')],
    ['src/c.ts', { record: { file: 'src/c.ts' }, witnesses: [] }],
  ]),
};

/** `count` words of the column `name` in `encoded`, written through to its bytes. */
function column(encoded: Buffer, name: string, count: number): Uint32Array {
  const headerLength = encoded.readUInt32LE(0);
  const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
    sections: { name: string; offset: number }[];
  };
  const section = header.sections.find((value) => value.name === name);
  expect(section).toBeDefined();
  return new Uint32Array(encoded.buffer, encoded.byteOffset + 4 + headerLength + section!.offset, count);
}

/** A segment of `parses` alone. */
function parsesOnly(parses: [ParseKey, Parsed][], deletedParses?: Set<ParseKey>): Buffer {
  return encodeSourceIndex({ parses: new Map(parses), ...(deletedParses ? { deletedParses } : {}), directories: new Map(), records: new Map() });
}

/** A segment of `record` alone. */
function recordOnly(record: FileRecord): Buffer {
  return encodeSourceIndex({ parses: new Map(), directories: new Map(), records: new Map([[record.file, { record, witnesses: ['src'] }]]) });
}

/** `stored` as plain maps, read through every question a caller asks of it. */
function plain(stored: StoredSourceIndex): object {
  return {
    ...(stored.config === undefined ? {} : { config: stored.config }),
    parses: new Map(stored.parses),
    directories: new Map(stored.directories),
    records: new Map(stored.records),
  };
}

describe('the source index the addon reads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads every family back as it was written, absent apart from empty and a zero line kept', () => {
    const read = readSourceIndexSegment(encodeSourceIndex(WHOLE));

    expect(isDeepStrictEqual(plain(read), plain(WHOLE))).toBe(true);
    expect(read.parses.get(A)).toStrictEqual(FULL);
    expect(read.parses.get(B)).toStrictEqual(EMPTY);
    expect(read.parses.get(WAY)).toStrictEqual(BARE);
    expect(read.records.get('src/a.ts')).toStrictEqual(WHOLE.records.get('src/a.ts'));
    // A segment holds its rows in code-unit order of their keys.
    expect([...read.parses.keys()]).toEqual([A, WAY, B]);
    expect([...read.records.keys()]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('answers a key, a count and a membership without decoding a row, and one row for one asked', () => {
    const decoded = countDecodedParseRows();
    const read = readSourceIndexSegment(encodeSourceIndex(WHOLE));
    expect(read.parses.size).toBe(3);
    expect(read.parses.has(WAY)).toBe(true);
    expect(read.parses.has('git:missing' as ParseKey)).toBe(false);
    expect([...read.records.values()]).toHaveLength(3);
    expect(decoded()).toBe(0);

    // One row asked twice is read once and is the same object both times.
    expect(read.parses.get(A)).toBe(read.parses.get(A));
    expect(decoded()).toBe(1);
  });

  it('answers a key from the newest layer that decided it, and a deleted one from none', () => {
    const base = encodeSourceIndex(WHOLE);
    const over = encodeSourceIndex({
      parses: new Map([[A, BARE]]),
      deletedParses: new Set([B]),
      directories: new Map(),
      deletedDirectories: new Set(['lib']),
      records: new Map([['src/b.ts', indexed('src/b.ts', ['src/c.ts'])]]),
      deletedRecords: new Set(['src/c.ts']),
    });
    const chain = readSourceIndexChain([base, over]);

    expect(chain.kept).toBe(2);
    expect(chain.written).toBeUndefined();
    // The newer layer names no configuration, and the newest layer's is the chain's.
    expect(chain.stored.config).toBeUndefined();
    expect([...chain.stored.parses]).toStrictEqual([[A, BARE], [WAY, BARE]]);
    expect([...chain.stored.directories]).toStrictEqual([['src', B]]);
    expect([...chain.stored.records]).toStrictEqual([
      ['src/a.ts', WHOLE.records.get('src/a.ts')],
      ['src/b.ts', indexed('src/b.ts', ['src/c.ts'])],
    ]);
  });

  it('keeps the layers below the first that does not read, and names the version of one another release wrote', () => {
    const base = encodeSourceIndex(WHOLE);
    const over = encodeSourceIndex({ parses: new Map([[A, BARE]]), directories: new Map(), records: new Map() });
    const damaged = readSourceIndexChain([base, Buffer.from('damaged'), over]);
    expect(damaged.kept).toBe(1);
    expect(damaged.written).toBeUndefined();
    expect(damaged.stored.parses.get(A)).toStrictEqual(FULL);

    const foreign = Buffer.from(over.toString('latin1')
      .replace(`"version":${SOURCE_INDEX_VERSION}`, `"version":${SOURCE_INDEX_VERSION - 1}`), 'latin1');
    const other = readSourceIndexChain([base, foreign]);
    expect(other.kept).toBe(1);
    expect(other.written).toBe(SOURCE_INDEX_VERSION - 1);

    expect(() => readSourceIndexSegment(Buffer.from('damaged'))).toThrow('not a variance-authority source index');
  });

  it('rejects duplicate logical keys instead of accepting a partial generation', () => {
    const encoded = parsesOnly([[A, FULL], [B, EMPTY]]);
    const digests = column(encoded, 'parses.key', 2);
    digests[1] = digests[0]!;

    expect(() => readSourceIndexSegment(encoded)).toThrow('not a variance-authority source index');
  });

  it.each([
    ['member declarations', 'parses.member-declarations', FULL.memberDeclarations!.length],
    ['member uses', 'parses.member-uses', FULL.memberUses!.length],
  ])('rejects %s whose offsets run past their columns', (_, name, length) => {
    const encoded = parsesOnly([[A, FULL]]);
    // One parse, so two offsets: the start of its range and its end.
    column(encoded, name, 2)[1] = length + 1;

    expect(() => readSourceIndexSegment(encoded)).toThrow('not a variance-authority source index');
  });

  it('refuses a question once the chain is closed, and keeps the rows already read', () => {
    const read = readSourceIndexChain([encodeSourceIndex(WHOLE)]);
    const file = read.stored.records.get('src/a.ts');
    read.close();
    expect(read.stored.records.get('src/a.ts')).toBe(file);
    expect(() => read.stored.records.get('src/b.ts')).toThrow('the source index reader is closed');
  });

  it('ends the chain at a segment one row of which names what the segment does not hold', () => {
    const parses = parsesOnly([[A, FULL], [B, EMPTY]]);
    // A's first request names a string past the dictionary.
    column(parses, 'requests.value', 1)[0] = 0x7fffffff;
    const records = encodeSourceIndex({ ...WHOLE, parses: new Map() });

    const read = readSourceIndexChain([records, parses]);
    expect(read.kept).toBe(1);
    expect(read.stored.parses.size).toBe(0);
    expect(read.stored.parses.has(B)).toBe(false);
    expect([...read.stored.records.keys()]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);

    // src/a.ts is the first record, and its digest names a string past the dictionary.
    column(records, 'records.digest', 1)[0] = 0x7fffffff;
    expect(readSourceIndexChain([records, parses]).kept).toBe(0);
  });

  it('keeps a package name that nothing else in the segment names', () => {
    // Only a subpath import reaches `@scope/only-here`, so the bare name is in no
    // other column. A dictionary that missed it wrote row 0 — whatever sorted
    // first — and a relative specifier sorts before every package.
    const record: FileRecord = { file: 'src/card.tsx', digest: B as Digest, unresolved: ['../exit.js'], packages: [{ to: '@scope/only-here', kind: 'type' }] };

    expect(readSourceIndexSegment(recordOnly(record)).records.get(record.file)?.record.packages).toEqual([{ to: '@scope/only-here', kind: 'type' }]);
  });

  it('reads a package column as written: the one encoder names packages, the reader does not judge them', () => {
    const encoded = recordOnly({ file: 'src/card.tsx', digest: B as Digest, packages: [{ to: 'zzzzzzzzzz', kind: 'imports' }] });
    encoded.write('../exit.js', encoded.indexOf('zzzzzzzzzz'));

    // The write leaves the dictionary out of code-unit order, so the record is walked to, not looked up.
    const [read] = readSourceIndexSegment(encoded).records.values();
    expect(read?.record.packages).toEqual([{ to: '../exit.js', kind: 'imports' }]);
  });

  it('answers a key that one segment both writes and deletes with what it writes', () => {
    expect(readSourceIndexSegment(parsesOnly([[A, FULL]], new Set([A]))).parses.get(A)).toStrictEqual(FULL);
  });

  it('keeps each side of a mock diff apart, and a parse with none has no diff', () => {
    const read = readSourceIndexSegment(parsesOnly([[A, { requests: [], mocks: { plus: ['./real.js'] } }], [B, { requests: [] }]]));

    expect(read.parses.get(A)?.mocks).toEqual({ plus: ['./real.js'] });
    expect(read.parses.get(B)).toEqual({ requests: [] });
  });

  it('keeps whether a reader guessed a request, and whether it asked for it as an item', () => {
    const requests: Parsed['requests'] = [
      { value: 'self::graph', kind: 'imports', line: 1, bindings: [] },
      { value: 'crate::graph::Limits', kind: 'imports', line: 2, bindings: [], guessed: true },
      { value: 'crate::graph', kind: 'imports', line: 3, bindings: [], guessed: true, item: true },
    ];

    expect(readSourceIndexSegment(parsesOnly([[A, { requests }]])).parses.get(A)?.requests).toEqual(requests);
  });
});
