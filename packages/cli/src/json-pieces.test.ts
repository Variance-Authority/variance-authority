import { describe, expect, it } from 'vitest';
import { jsonPieces, writePieces } from './json-pieces.js';

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
