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
  type Bytes,
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

/**
 * A section that is not resident: every read copies out of it, and is counted.
 *
 * What a file on disk is to a column, without the file. A subarray would hide
 * the thing under test — how much of the section a reader asks for — because a
 * resident section answers every range for nothing.
 */
const elsewhere = (section: Uint8Array): Bytes & { readonly asked: () => number } => {
  let asked = 0;
  return {
    length: section.length,
    read: (from, to) => {
      asked += to - from;
      return Uint8Array.from(section.subarray(from, to));
    },
    asked: () => asked,
  };
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

    // A tag byte per run and the run index, and nothing a frame would have added.
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

describe('a column read where it lies rather than out of a buffer', () => {
  it('answers the same rows, whether the section is resident or not', () => {
    const values = ascending(RUN * 3 + 11);
    const packed = packWords(values);

    const away = openWords(elsewhere(packed), values.length);

    expect(away.at(0)).toBe(values[0]);
    expect(away.at(RUN * 2 + 3)).toBe(values[RUN * 2 + 3]);
    expect(away.all()).toEqual(openWords(packed, values.length).all());
  });

  it('reads one run and the index for one row, and not the section', () => {
    const values = ascending(RUN * 8);
    const packed = packWords(values);
    const section = elsewhere(packed);
    // The count and every run's bound, which is read at the door and is the
    // whole of what opening a column costs.
    const index = 4 + (8 + 1) * 4;

    openWords(section, values.length).at(RUN * 5 + 9);

    expect(section.asked()).toBeGreaterThan(index);
    // What is left is the payload, and one row costs the one run it sits in.
    expect(section.asked() - index).toBeLessThan((packed.length - index) / 4);
  });

  it('answers a byte column and a blob through the same door', () => {
    const flags = Uint8Array.from({ length: RUN * 2 + 9 }, (_, row) => row % 251);
    const strings = Array.from({ length: BLOB_RUN + 3 }, (_, index) => `src/module-${index}.ts`);
    const offsets = offsetsOf(strings);
    const blob = Buffer.from(strings.join(''), 'utf8');

    const bytes = openBytes(elsewhere(packBytes(flags)), flags.length);
    const string = openBlob(elsewhere(packBlob(blob, offsets)), () => offsets);

    expect(bytes.at(RUN + 4)).toBe(flags[RUN + 4]);
    expect(bytes.all()).toEqual(flags);
    expect(new TextDecoder().decode(string(BLOB_RUN + 1))).toBe(strings[BLOB_RUN + 1]);
  });

  it('holds nothing of a run it has handed back, so a later read sees the same bytes', () => {
    // A resident section hands out subarrays of itself and a read hands out its
    // own copy. Neither may be written through by the reader that got it.
    const strings = ['alpha', 'beta', 'gamma'];
    const offsets = offsetsOf(strings);
    const string = openBlob(elsewhere(packBlob(Buffer.from(strings.join(''), 'utf8'), offsets)), () => offsets);

    const first = string(1);
    const again = string(1);

    expect(new TextDecoder().decode(first)).toBe('beta');
    expect(new TextDecoder().decode(again)).toBe('beta');
  });
});
describe('when a column gives up and materializes', () => {
  /** Few enough runs that the whole column fits in what a column is allowed to hold. */
  const rows = RUN * 12;
  const runs = 12;

  /** A column that says which runs it decoded, in the order it decoded them. */
  const watched = (): { column: ReturnType<typeof openWords>; decoded: number[] } => {
    const decoded: number[] = [];
    const values = ascending(rows);
    const column = openWords(packWords(values), rows, (_, from) => decoded.push(from / RUN));
    return { column, decoded };
  };

  /**
   * More runs than one column may hold at once, which is where the question is.
   *
   * The budget is bytes, so the row count is what spends it: `wide` is a little
   * over a thousand runs of `RUN` u32s, and a column cannot hold them all.
   * Packing it is the expensive part, so it is packed once and read from by
   * each column opened over it.
   */
  const wide = 1100;
  const wideRows = RUN * wide;
  let packedWide: Buffer | undefined;
  const watchedWide = (): { column: ReturnType<typeof openWords>; decoded: number[] } => {
    const decoded: number[] = [];
    packedWide ??= packWords(ascending(wideRows));
    const column = openWords(packedWide, wideRows, (_, from) => decoded.push(from / RUN));
    return { column, decoded };
  };

  it('never does for a reader walking the column in order', () => {
    // The shape that made counting misses wrong: a scan misses once per run and
    // wastes nothing, and the largest table a snapshot holds is scanned this
    // way. Tripping here would materialize a column the reader is already
    // halfway through reading, for nothing.
    const { column, decoded } = watched();

    for (let row = 0; row < rows; row += 1) column.at(row);

    expect(decoded).toEqual([...Array(runs).keys()]);
  });

  it('never does for a search that halves its way down the column', () => {
    // The other shape counting misses got wrong: about `log2(rows)` probes,
    // which on a column of a few runs is more places than the column has runs.
    // The last probes converge, so they land in runs the cache is still holding.
    const { column, decoded } = watched();

    let low = 0;
    let high = rows - 1;
    const wanted = column.at(rows - 3);
    decoded.length = 0;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (column.at(middle) < wanted) low = middle + 1;
      else high = middle;
    }

    expect(low).toBe(rows - 3);
    expect(decoded.length).toBeLessThanOrEqual(runs);
  });

  it('never does for searches that keep landing back on the top of a wide column', () => {
    // The dictionary shape, and the one this column was getting wrong. Every
    // search starts at the middle and halves, so the first probes of all of
    // them are the same few runs and only the last probes are anywhere new: a
    // few hundred searches over a column of `wide` runs reach well under half
    // of it, however many times they are run. Held, that costs each of those
    // runs once. Dropped between searches, it costs them again on every search
    // and reads as a reader that wants the column whole.
    const { column, decoded } = watchedWide();
    const values = ascending(wideRows);
    let probes = 0;
    let hit = 0;

    for (let search = 0; search < 400; search += 1) {
      // A stride coprime with the row count, so the targets are spread over the
      // whole column rather than neighbours of each other.
      const wanted = values[(search * 26833) % wideRows]!;
      let low = 0;
      let high = wideRows - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        probes += 1;
        if (column.at(middle) < wanted) low = middle + 1;
        else high = middle;
      }
      if (values[low] === wanted) hit += 1;
    }

    expect(hit).toBeGreaterThan(300);
    expect(probes).toBeGreaterThan(wide * 4);
    // Materializing decodes every run, so a count under the run count is proof
    // it never did — and a count with no run twice in it is proof the ones the
    // searches kept coming back to were still there when they came back.
    expect(decoded.length).toBeLessThan(wide);
    expect(new Set(decoded).size).toBe(decoded.length);
  });

  it('does for a reader that keeps coming back to runs it has dropped', () => {
    // A walk over more runs than the column may hold decodes every run again on
    // every pass. Once it has paid for the column twice over, the column is
    // cheaper held than re-read, and after that nothing decodes at all.
    const { column, decoded } = watchedWide();

    for (let pass = 0; pass < 4; pass += 1) {
      for (let run = 0; run < wide; run += 1) column.at(run * RUN + pass);
    }
    const paid = decoded.length;
    for (let run = 0; run < wide; run += 1) column.at(run * RUN);

    expect(paid).toBeGreaterThan(wide);
    expect(paid).toBeLessThan(wide * 4);
    expect(decoded.length).toBe(paid);
    expect(column.at(wideRows - 1)).toBe(ascending(wideRows)[wideRows - 1]);
  });
});
