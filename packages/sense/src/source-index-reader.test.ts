import { isDeepStrictEqual } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
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
});
