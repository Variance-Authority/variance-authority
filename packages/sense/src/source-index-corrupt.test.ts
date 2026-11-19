import { describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import { NONE } from '@variance-authority/core/segment';
import type { Parsed } from './cache.js';
import { encodeSourceIndex } from './source-index-format.js';
import { readSourceIndexSegment } from './source-index-reader.js';

const DIGEST: Digest = 'git:2222222222222222222222222222222222222222';
const PARSED: Parsed = {
  requests: [{ value: './types.js', kind: 'type', line: 7, bindings: [{ imported: 'Props', local: 'Props', type: true, line: 7 }] }],
  exports: [],
  symbols: [],
  declares: [],
  bindingMembers: [{ request: 0, binding: 'Props', within: ['tint'], name: 'tintDeep', line: 9 }],
  nested: [{ name: 'inner', kind: 'function', line: 12, signature: { start: 40, end: 60 }, holder: 'outer', holderLine: 11 }],
};

/** The index of `PARSED`, and the `count` numbers its column `name` holds, to write over. */
function column(name: string, count: number): { encoded: Buffer; values: Uint32Array } {
  const encoded = encodeSourceIndex({ parses: new Map([[DIGEST, PARSED]]), directories: new Map(), records: new Map() });
  const headerLength = encoded.readUInt32LE(0);
  const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
    sections: { name: string; offset: number }[];
  };
  const section = header.sections.find((value) => value.name === name);
  expect(section).toBeDefined();
  return { encoded, values: new Uint32Array(encoded.buffer, encoded.byteOffset + 4 + headerLength + section!.offset, count) };
}

describe('a source index whose binding members or nested declarations are damaged', () => {
  it('reads both back when nothing is damaged', () => {
    const { encoded } = column('parses.nested', 2);
    const parsed = readSourceIndexSegment(encoded).parses.get(DIGEST);
    expect(parsed?.bindingMembers).toEqual(PARSED.bindingMembers);
    expect(parsed?.nested).toEqual(PARSED.nested);
  });

  it('rejects binding members whose offsets run past their columns', () => {
    // One parse, so two offsets: the start of its range and its end.
    const { encoded, values } = column('parses.binding-members', 2);
    values[1] = PARSED.bindingMembers!.length + 1;
    expect(() => readSourceIndexSegment(encoded)).toThrow('not a variance-authority source index');
  });

  // A row is checked when it is asked for, so a damaged one is a miss and the segment is kept.
  it('reads a parse with a binding member read through a request it does not hold as absent', () => {
    const { encoded, values } = column('binding-members.request', 1);
    values[0] = PARSED.requests.length;
    expect(readSourceIndexSegment(encoded).parses.get(DIGEST)).toBeUndefined();
  });

  it('rejects nested declarations whose offsets run past their columns', () => {
    const { encoded, values } = column('parses.nested', 2);
    values[1] = PARSED.nested!.length + 1;
    expect(() => readSourceIndexSegment(encoded)).toThrow('not a variance-authority source index');
  });

  it('reads a parse with a nested signature that has a start and no end as absent', () => {
    const { encoded, values } = column('nested.signature-end', 1);
    values[0] = NONE;
    expect(readSourceIndexSegment(encoded).parses.get(DIGEST)).toBeUndefined();
  });
});
