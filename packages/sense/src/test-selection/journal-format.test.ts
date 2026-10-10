import { describe, expect, it } from 'vitest';
import { EVALUATING } from '../instrument/index.js';
import journals from './journal-format.cjs';

const { encodeJournal, encodeLog, decodeJournal } = journals;

const counters = (values: readonly number[]): Uint32Array => Uint32Array.from(values);

describe('a journal as bytes', () => {
  it('carries back the ordinals a test file entered, under the paths it entered them by', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([
      ['src/cart.ts', counters([0, 3, 0, 1])],
      ['src/total.ts', counters([2, 0, 0])],
    ]));

    expect(decodeJournal(frame)).toEqual({
      testFile: 'src/a.test.ts',
      modules: [
        { id: 'src/cart.ts', hits: [1, 3], shared: [], loaded: [] },
        { id: 'src/total.ts', hits: [0], shared: [], loaded: [] },
      ],
    });
  });

  it('refuses a module row filed under a number', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([['src/cart.ts', counters([1])]]));
    const tag = frame.indexOf(Buffer.from('src/cart.ts')) - 2;
    expect(frame[tag]).toBe(1);
    const numbered = Buffer.from(frame);
    numbered[tag] = 0;

    expect(() => decodeJournal(numbered)).toThrow(/not a/);
  });

  it('separates what was entered while the module evaluated from what the file entered itself', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([
      ['src/cart.ts', counters([EVALUATING + 2, 5, EVALUATING])],
    ]));

    expect(decodeJournal(frame).modules).toEqual([{ id: 'src/cart.ts', hits: [0, 1, 2], shared: [0, 2], loaded: [] }]);
  });

  it('writes a module a case entered both while it evaluated and after as a second row of what it entered after', () => {
    // A probe log's read-out: each entry an ordinal shifted left one, with the
    // evaluating bit below it. Ordinal 0 was entered both ways, 1 only while
    // `cart.ts` evaluated, 2 only after.
    const frame = encodeLog('src/a.test.ts', {
      rows: [0],
      start: Int32Array.of(0),
      end: Int32Array.of(4),
      sorted: Int32Array.of(0 << 1, (0 << 1) | 1, (1 << 1) | 1, 2 << 1),
      ids: ['src/cart.ts'],
    });

    expect(decodeJournal(frame).modules).toEqual([
      { id: 'src/cart.ts', hits: [0, 1, 2], shared: [0, 1], loaded: [] },
      { id: 'src/cart.ts', hits: [0], shared: [], loaded: [] },
    ]);
  });

  it('holds a module nothing entered, because the file still consumed it', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([['src/cart.ts', counters([0, 0])]]));

    expect(decodeJournal(frame).modules).toEqual([{ id: 'src/cart.ts', hits: [], shared: [], loaded: [] }]);
  });

  it('carries what was already entered before the first test, from the snapshot taken then', () => {
    const before = new Map([['src/cart.ts', counters([1, 1, 0, 0])]]);
    const frame = encodeJournal('src/a.test.ts', new Map([['src/cart.ts', counters([1, 2, 0, 3])]]), before);

    expect(decodeJournal(frame).modules).toEqual([{ id: 'src/cart.ts', hits: [0, 1, 3], shared: [], loaded: [0, 1] }]);
  });

  it('reads a snapshot of another length as nothing entered early', () => {
    const before = new Map([['src/cart.ts', counters([1, 1])]]);
    const frame = encodeJournal('src/a.test.ts', new Map([['src/cart.ts', counters([1, 2, 0])]]), before);

    expect(decodeJournal(frame).modules).toEqual([{ id: 'src/cart.ts', hits: [0, 1], shared: [], loaded: [] }]);
  });

  it('is under half the same journal as text, paths and all', () => {
    const modules = new Map<string, Uint32Array>();
    for (let id = 0; id < 500; id += 1) {
      modules.set(`packages/app/src/m${id}.ts`, counters(Array.from({ length: 33 }, (_, ordinal) => (ordinal + id) % 5 < 2 ? 1 : 0)));
    }
    const frame = encodeJournal('packages/app/src/wide.test.ts', modules);

    expect(frame.byteLength * 2).toBeLessThan(JSON.stringify(decodeJournal(frame)).length);
  });

  it('refuses a frame that is not one', () => {
    expect(() => decodeJournal(Buffer.from('{"testFile":"src/a.test.ts"}'))).toThrow(/not a/);
  });

  it('refuses a frame whose tail never arrived', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([['src/cart.ts', counters([1, 0, 1])]]));

    expect(() => decodeJournal(frame.subarray(0, frame.byteLength - 1))).toThrow(/not a/);
  });

  it('refuses a frame with bytes after the end of it', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([['src/cart.ts', counters([1])]]));

    expect(() => decodeJournal(Buffer.concat([frame, Buffer.of(0)]))).toThrow(/not a/);
  });

  it('carries ordinals past a single varint byte', () => {
    const wide = new Uint32Array(4000);
    wide[3999] = 1;
    const frame = encodeJournal('src/a.test.ts', new Map([['src/cart.ts', wide]]));

    expect(decodeJournal(frame).modules).toEqual([{ id: 'src/cart.ts', hits: [3999], shared: [], loaded: [] }]);
  });
});
