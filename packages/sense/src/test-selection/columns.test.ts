import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BLOB_RUN,
  RUN,
  openBlob,
  openBytes,
  openWords,
  packBlob,
  packBytes,
  packWords,
} from './columns.js';

const REFUSED = /not a variance-authority test coverage artifact/;

/** Long enough to be cut into runs, and irregular enough not to be one run repeated. */
const ascending = (rows: number): Uint32Array =>
  Uint32Array.from({ length: rows }, (_, row) => row * 7 + (row % 13));

/** One run of a section, stored as the bytes it already is: `u32 count`, bounds, tag, body. */
const rawRun = (body: Uint8Array): Buffer => {
  const section = Buffer.alloc(12 + 1 + body.length);
  section.writeUInt32LE(1, 0);
  section.writeUInt32LE(0, 4);
  section.writeUInt32LE(body.length + 1, 8);
  Buffer.from(body).copy(section, 13);
  return section;
};

const offsetsOf = (strings: readonly string[]): Uint32Array => {
  const offsets = new Uint32Array(strings.length + 1);
  let at = 0;
  for (const [index, value] of strings.entries()) {
    offsets[index] = at;
    at += Buffer.byteLength(value, 'utf8');
  }
  offsets[strings.length] = at;
  return offsets;
};

describe('a numeric column stored as runs', () => {
  it('answers for every row of a column that spans several runs', () => {
    const values = ascending(RUN * 3 + 11);
    const column = openWords(packWords(values), values.length);

    expect(column.at(0)).toBe(values[0]);
    expect(column.at(RUN - 1)).toBe(values[RUN - 1]);
    expect(column.at(RUN)).toBe(values[RUN]);
    expect(column.at(values.length - 1)).toBe(values.at(-1));
    expect(column.all()).toEqual(values);
  });

  it('answers the same for a row read after the whole column as before it', () => {
    const values = ascending(RUN * 2 + 5);
    const column = openWords(packWords(values), values.length);

    column.all();

    expect(column.at(RUN + 2)).toBe(values[RUN + 2]);
  });

  it('carries the whole unsigned range, in either direction', () => {
    // A delta is signed and the values it is taken between are not, so the pair
    // that wraps is the pair that decides whether the coding is reversible.
    const values = Uint32Array.of(0, 0xffff_ffff, 1, 0xffff_fffe, 0x8000_0000, 0x7fff_ffff, 0);

    expect(openWords(packWords(values), values.length).all()).toEqual(values);
  });

  it('holds a column with no rows at all', () => {
    const empty = new Uint32Array(0);

    expect(openWords(packWords(empty), 0).all()).toEqual(empty);
  });

  it('decodes one run for one row, and leaves the rest of the column alone', () => {
    const values = ascending(RUN * 4);
    const decoded: number[] = [];
    const column = openWords(packWords(values), values.length, (run) => decoded.push(run.length));

    column.at(0);
    column.at(RUN * 3 + 1);

    expect(decoded).toEqual([RUN, RUN]);
  });

  it('settles a run when the run is read, and not when the column is opened', () => {
    const values = ascending(RUN * 2);
    // What the crossings column does: the check is the one a query would
    // otherwise answer from, and it runs where the answer would come from.
    const column = openWords(packWords(values), values.length, (run) => {
      for (const value of run) if (value > RUN * 7) throw new Error('out of range');
    });

    expect(column.at(0)).toBe(values[0]);
    expect(() => column.at(RUN)).toThrow(/out of range/);
  });

  it('refuses a row the column has no place for', () => {
    const column = openWords(packWords(ascending(RUN + 1)), RUN + 1);

    expect(() => column.at(RUN + 1)).toThrow(REFUSED);
    expect(() => column.at(-1)).toThrow(REFUSED);
  });

  it('refuses a section that claims a different number of rows than it holds', () => {
    const values = ascending(RUN * 2);

    expect(() => openWords(packWords(values), RUN * 3)).toThrow(REFUSED);
  });

  it('refuses a section whose runs were cut short', () => {
    const packed = packWords(ascending(RUN * 2));

    expect(() => openWords(packed.subarray(0, packed.length - 5), RUN * 2)).toThrow(REFUSED);
    expect(() => openWords(packed.subarray(0, 2), RUN * 2)).toThrow(REFUSED);
  });

  it('refuses a section whose run bounds run backwards', () => {
    const packed = Buffer.from(packWords(ascending(RUN * 3)));
    const second = packed.readUInt32LE(4 + 4);
    const third = packed.readUInt32LE(4 + 8);
    packed.writeUInt32LE(third + 1, 4 + 4);

    expect(second).toBeLessThan(third);
    expect(() => openWords(packed, RUN * 3)).toThrow(REFUSED);
  });

  it('refuses a run whose varints do not add up to the rows it stands for', () => {
    expect(() => openWords(rawRun(Uint8Array.of(0x02, 0x04)), 3).all()).toThrow(REFUSED);
    expect(() => openWords(rawRun(Uint8Array.of(0x02, 0x04)), 1).all()).toThrow(REFUSED);
  });

  it('refuses a varint that never ends', () => {
    const forever = Uint8Array.from({ length: 8 }, () => 0x80);

    expect(() => openWords(rawRun(forever), 1).all()).toThrow(REFUSED);
  });

  it('refuses a run stored under a tag this build has no reader for', () => {
    const run = Buffer.concat([Buffer.alloc(12), Buffer.of(7, 0x02)]);
    run.writeUInt32LE(1, 0);
    run.writeUInt32LE(2, 8);

    expect(() => openWords(run, 1).all()).toThrow(REFUSED);
  });
});

describe('a byte column stored as runs', () => {
  it('answers for every row of a column that spans several runs', () => {
    const values = Uint8Array.from({ length: RUN * 2 + 9 }, (_, row) => row % 251);

    expect(openBytes(packBytes(values), values.length).all()).toEqual(values);
  });

  it('stores a run it cannot compress as the bytes it already was', () => {
    const values = new Uint8Array(randomBytes(RUN * 2));
    const packed = packBytes(values);

    // A tag byte per run and the run index, and nothing brotli would have added.
    expect(packed.length).toBe(values.length + 2 + 4 + 3 * 4);
    expect(openBytes(packed, values.length).all()).toEqual(values);
  });

  it('refuses a section that decodes to a different number of rows', () => {
    const values = Uint8Array.from({ length: RUN + 40 }, (_, row) => row % 7);

    expect(() => openBytes(packBytes(values), RUN + 39).all()).toThrow(REFUSED);
  });
});

describe('the string blob stored as runs', () => {
  const strings = Array.from({ length: BLOB_RUN * 2 + 17 }, (_, index) =>
    `packages/application/src/feature-${index}/implementation.ts`,
  );
  const offsets = offsetsOf(strings);
  const blob = Buffer.from(strings.join(''), 'utf8');

  it('answers for a string anywhere in the blob, run boundaries included', () => {
    const string = openBlob(packBlob(blob, offsets), () => offsets);
    const decoder = new TextDecoder();

    for (const id of [0, 1, BLOB_RUN - 1, BLOB_RUN, BLOB_RUN * 2, strings.length - 1]) {
      expect(decoder.decode(string(id))).toBe(strings[id]);
    }
  });

  it('holds a string of no bytes between two that have some', () => {
    const empty = ['', 'first', '', 'second', ''];
    const string = openBlob(
      packBlob(Buffer.from(empty.join(''), 'utf8'), offsetsOf(empty)),
      () => offsetsOf(empty),
    );

    expect([...empty.keys()].map((id) => new TextDecoder().decode(string(id)))).toEqual(empty);
  });

  it('refuses an id the offsets have no bounds for', () => {
    const string = openBlob(packBlob(blob, offsets), () => offsets);

    expect(() => string(strings.length)).toThrow(REFUSED);
    expect(() => string(-1)).toThrow(REFUSED);
  });

  it('refuses a blob whose runs hold less than the offsets promise', () => {
    const short = new Uint32Array(offsets);
    short[short.length - 1] = blob.length + 64;
    const string = openBlob(packBlob(blob, offsets), () => short);

    expect(() => string(strings.length - 1)).toThrow(REFUSED);
  });
});
