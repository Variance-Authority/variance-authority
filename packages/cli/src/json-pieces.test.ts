import { describe, expect, it } from 'vitest';
import { jsonOfBytes, jsonPieces, writePieces } from './json-pieces.js';

describe('jsonPieces', () => {
  it.each([
    ['a scope', {
      within: 'packages/app',
      suites: [],
      unrecorded: undefined,
      files: 2,
      withheld: [{ file: 'a.test.ts', reason: 'one "quoted"\nline' }],
      spills: [{ cause: { kind: 'import', importer: 'a.ts', imported: 'b.ts' }, modules: ['b.ts'], files: [], lines: 3 }, {}],
    }],
    ['a list at the top', [1, undefined, () => 1, { nested: [[], {}] }]],
    ['a value with toJSON', { at: new Date(0), mark: { toJSON: (key: string) => `key ${key}` } }],
    ['an empty object', {}],
  ])('joins to the text JSON.stringify gives %s', (_, value) => {
    expect([...jsonPieces(value)].join('')).toBe(JSON.stringify(value, null, 2));
  });

  it('gives an element of a list the value holds as one piece', () => {
    expect([...jsonPieces({ spills: [{ lines: 1 }, { lines: 2 }] })]).toContain('{\n      "lines": 2\n    }');
  });
});

describe('writePieces', () => {
  it('writes the pieces in batches, waiting for the reader after each but the last', async () => {
    const written: string[] = [];
    let waits = 0;
    const piece = 'x'.repeat(40_000);
    await writePieces([piece, piece, piece, 'end'], {
      out: (text) => written.push(text),
      drained: async () => {
        waits += 1;
      },
    });
    expect(written.join('')).toBe(`${piece.repeat(3)}end`);
    expect([written.length, waits]).toEqual([2, 1]);
  });
});

describe('jsonOfBytes', () => {
  /** Bytes that refuse to spell more than `longest` characters at once, as V8 refuses past its string limit. */
  function held(value: unknown, longest: number): Buffer {
    const bytes = Buffer.from(JSON.stringify(value, undefined, 2));
    const spell = bytes.toString.bind(bytes);
    bytes.toString = ((encoding?: BufferEncoding, start = 0, end = bytes.length) => {
      if (end - start > longest) throw Object.assign(new Error('Cannot create a string longer than that'), { code: 'ERR_STRING_TOO_LONG' });
      return spell(encoding, start, end);
    }) as typeof bytes.toString;
    return bytes;
  }

  it('reads an object no one string could spell, a member and an element of a list at a time', () => {
    const value = {
      version: 2,
      quoted: 'a "}," and a \\ in text, [ { ] }',
      cases: Array.from({ length: 50 }, (_, at) => ({ id: `case ${at}`, said: ['é', '"'] })),
      files: Array.from({ length: 50 }, (_, at) => ({ file: `src/${at}.ts`, regions: [{ called: [at, at + 1] }] })),
      empty: [],
      none: null,
    };
    expect(jsonOfBytes(held(value, 200))).toEqual(value);
  });

  it('reads an empty object and a compact one', () => {
    expect(jsonOfBytes(Buffer.from('{}'))).toEqual({});
    expect(jsonOfBytes(Buffer.from('{"a":[1,[2]],"b":{"c":[]}}\n'))).toEqual({ a: [1, [2]], b: { c: [] } });
  });

  it('keeps a member named `__proto__` as a member, as `JSON.parse` does', () => {
    const read = jsonOfBytes(Buffer.from('{"__proto__":{"polluted":true}}'));
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(read).toEqual(JSON.parse('{"__proto__":{"polluted":true}}'));
  });

  it('refuses text that is not one JSON object', () => {
    expect(() => jsonOfBytes(Buffer.from('junk{"a":1}'))).toThrow(SyntaxError);
    expect(() => jsonOfBytes(Buffer.from('[1]'))).toThrow(SyntaxError);
    expect(() => jsonOfBytes(Buffer.from('{"a":1'))).toThrow(SyntaxError);
  });
});
