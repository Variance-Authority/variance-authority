import { describe, expect, it } from 'vitest';
import {
  encodeSegment,
  flagOf,
  intern,
  NONE,
  offsetsOf,
  openSegment,
  rangeOf,
  sameLength,
  stringColumns,
  stringReader,
  validateOffsets,
} from './index.js';

const FORMAT = 'variance-authority-test-segment';

describe('a segment', () => {
  it('reads back the columns it was given, at their own widths', () => {
    const bytes = encodeSegment(FORMAT, 1, {
      'flags': Uint8Array.of(0, 1, 1),
      'counts': Uint32Array.of(7, 0, 4_000_000_000),
    });
    const opened = openSegment(FORMAT, 1, bytes, 'test segment');
    expect([...opened.u8('flags')]).toEqual([0, 1, 1]);
    expect([...opened.u32('counts')]).toEqual([7, 0, 4_000_000_000]);
  });

  it('refuses a column read at the wrong width', () => {
    const bytes = encodeSegment(FORMAT, 1, { 'flags': Uint8Array.of(1) });
    const opened = openSegment(FORMAT, 1, bytes, 'test segment');
    expect(() => opened.u32('flags')).toThrow(/not a variance-authority test segment/);
    expect(() => opened.u8('absent')).toThrow(/not a variance-authority test segment/);
  });

  it('answers an absent optional column with nothing, and a corrupt one with a refusal', () => {
    const bytes = encodeSegment(FORMAT, 1, { 'flags': Uint8Array.of(1) });
    const opened = openSegment(FORMAT, 1, bytes, 'test segment');
    expect([...opened.maybeU32('never-written')]).toEqual([]);
    expect(() => opened.maybeU32('flags')).toThrow(/not a variance-authority test segment/);
  });

  it('refuses another format, another version, and bytes that are neither', () => {
    const bytes = encodeSegment(FORMAT, 1, { 'flags': Uint8Array.of(1) });
    expect(() => openSegment('other', 1, bytes, 'test segment')).toThrow(/test segment/);
    expect(() => openSegment(FORMAT, 2, bytes, 'test segment')).toThrow(/test segment/);
    expect(() => openSegment(FORMAT, 1, new Uint8Array(2), 'test segment')).toThrow(/test segment/);
    expect(() => openSegment(FORMAT, 1, Uint8Array.of(255, 255, 255, 255, 0), 'test segment'))
      .toThrow(/test segment/);
  });

  it('names the reader that refused', () => {
    expect(() => openSegment(FORMAT, 1, new Uint8Array(0), 'suite index'))
      .toThrow('not a variance-authority suite index');
  });

  it('opens a view that does not start on an alignment boundary', () => {
    const bytes = encodeSegment(FORMAT, 1, { 'counts': Uint32Array.of(1, 2, 3) });
    const shifted = new Uint8Array(bytes.length + 3);
    shifted.set(bytes, 3);
    const opened = openSegment(FORMAT, 1, shifted.subarray(3), 'test segment');
    expect([...opened.u32('counts')]).toEqual([1, 2, 3]);
  });
});

describe('an interned dictionary', () => {
  it('numbers every distinct string, and nothing twice', () => {
    const { strings, id, optionalId } = intern(['beta', 'alpha', 'beta']);
    expect(strings).toEqual(['alpha', 'beta']);
    expect(id('alpha')).toBe(0);
    expect(optionalId(undefined)).toBe(NONE);
    expect(() => id('gamma')).toThrow(/not interned/);
  });

  it('numbers equal facts equally, whatever order they arrived in', () => {
    expect(intern(['a', 'b', 'c']).strings).toEqual(intern(['c', 'a', 'b']).strings);
  });

  it('round-trips through its two columns, including characters outside the plane', () => {
    const values = ['', 'plain', 'πλ', '🜂 sigil'];
    const { blob, off } = stringColumns(values);
    const { text, optional } = stringReader(blob, off, () => new Error('refused'));
    expect(values.map((_, index) => text(index))).toEqual(values);
    expect(optional(NONE)).toBeUndefined();
  });

  it('refuses an id the blob cannot hold', () => {
    const { blob, off } = stringColumns(['one']);
    const { text } = stringReader(blob, off, () => new Error('refused'));
    expect(() => text(2)).toThrow('refused');
  });
});

describe('offset columns', () => {
  it('are running totals, and end where the values do', () => {
    expect([...offsetsOf([2, 0, 3])]).toEqual([0, 2, 2, 5]);
    expect([...offsetsOf([])]).toEqual([0]);
  });

  it('name the indices each row owns', () => {
    const offsets = offsetsOf([2, 0, 3]);
    expect(rangeOf(offsets, 0, refuse)).toEqual([0, 1]);
    expect(rangeOf(offsets, 1, refuse)).toEqual([]);
    expect(rangeOf(offsets, 2, refuse)).toEqual([2, 3, 4]);
    expect(() => rangeOf(offsets, 3, refuse)).toThrow('refused');
  });

  it('are checked before a row is read through one', () => {
    validateOffsets(offsetsOf([1, 1]), 2, 2, refuse);
    expect(() => validateOffsets(offsetsOf([1, 1]), 2, 3, refuse)).toThrow('refused');
    expect(() => validateOffsets(offsetsOf([1, 1]), 3, 2, refuse)).toThrow('refused');
    expect(() => validateOffsets(Uint32Array.of(0, 2, 1, 2), 2, 3, refuse)).toThrow('refused');
    expect(() => validateOffsets(Uint32Array.of(1, 2), 2, 1, refuse)).toThrow('refused');
  });
});

describe('the checks a decode performs before it believes a file', () => {
  it('refuses columns that disagree about how many rows there are', () => {
    sameLength(2, [Uint32Array.of(1, 2), Uint8Array.of(1, 2)], refuse);
    expect(() => sameLength(2, [Uint32Array.of(1)], refuse)).toThrow('refused');
  });

  it('refuses a stored boolean that is not one', () => {
    expect(flagOf(0, refuse)).toBe(false);
    expect(flagOf(1, refuse)).toBe(true);
    expect(() => flagOf(2, refuse)).toThrow('refused');
    expect(() => flagOf(undefined, refuse)).toThrow('refused');
  });
});

function refuse(): Error {
  return new Error('refused');
}
