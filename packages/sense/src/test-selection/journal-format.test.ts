import { describe, expect, it } from 'vitest';
import { EVALUATING } from '../instrument/index.js';
import journals from './journal-format.cjs';

const { encodeJournal, decodeJournal } = journals;

const counters = (values: readonly number[]): Uint32Array => Uint32Array.from(values);

describe('a journal as bytes', () => {
  it('carries back the ordinals a test file entered, under the ids it entered them by', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([
      [7, counters([0, 3, 0, 1])],
      ['src/unnumbered.ts', counters([2, 0, 0])],
    ]));

    expect(decodeJournal(frame)).toEqual({
      testFile: 'src/a.test.ts',
      modules: [
        { id: 7, hits: [1, 3], shared: [], loaded: [] },
        { id: 'src/unnumbered.ts', hits: [0], shared: [], loaded: [] },
      ],
    });
  });

  it('separates what was entered while the module evaluated from what the file entered itself', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([
      [1, counters([EVALUATING + 2, 5, EVALUATING])],
    ]));

    expect(decodeJournal(frame).modules).toEqual([{ id: 1, hits: [0, 1, 2], shared: [0, 2], loaded: [] }]);
  });

  it('holds a module nothing entered, because the file still consumed it', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([[4, counters([0, 0])]]));

    expect(decodeJournal(frame).modules).toEqual([{ id: 4, hits: [], shared: [], loaded: [] }]);
  });

  it('carries what was already entered before the first test, from the snapshot taken then', () => {
    const before = new Map([[7, counters([1, 1, 0, 0])]]);
    const frame = encodeJournal('src/a.test.ts', new Map([[7, counters([1, 2, 0, 3])]]), before);

    expect(decodeJournal(frame).modules).toEqual([{ id: 7, hits: [0, 1, 3], shared: [], loaded: [0, 1] }]);
  });

  it('reads a snapshot of another length as nothing entered early', () => {
    const before = new Map([[7, counters([1, 1])]]);
    const frame = encodeJournal('src/a.test.ts', new Map([[7, counters([1, 2, 0])]]), before);

    expect(decodeJournal(frame).modules).toEqual([{ id: 7, hits: [0, 1], shared: [], loaded: [] }]);
  });

  it('is smaller than the same journal as text', () => {
    const modules = new Map<number, Uint32Array>();
    for (let id = 0; id < 500; id += 1) {
      modules.set(id, counters(Array.from({ length: 33 }, (_, ordinal) => (ordinal + id) % 5 < 2 ? 1 : 0)));
    }
    const frame = encodeJournal('packages/app/src/wide.test.ts', modules);

    expect(frame.byteLength * 3).toBeLessThan(JSON.stringify(decodeJournal(frame)).length);
  });

  it('refuses a frame that is not one', () => {
    expect(() => decodeJournal(Buffer.from('{"testFile":"src/a.test.ts"}'))).toThrow(/not a/);
  });

  it('refuses a frame whose tail never arrived', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([[7, counters([1, 0, 1])]]));

    expect(() => decodeJournal(frame.subarray(0, frame.byteLength - 1))).toThrow(/not a/);
  });

  it('refuses a frame with bytes after the end of it', () => {
    const frame = encodeJournal('src/a.test.ts', new Map([[7, counters([1])]]));

    expect(() => decodeJournal(Buffer.concat([frame, Buffer.of(0)]))).toThrow(/not a/);
  });

  it('carries ids and ordinals past a single varint byte', () => {
    const wide = new Uint32Array(4000);
    wide[3999] = 1;
    const frame = encodeJournal('src/a.test.ts', new Map([[300_000, wide]]));

    expect(decodeJournal(frame).modules).toEqual([{ id: 300_000, hits: [3999], shared: [], loaded: [] }]);
  });
});
