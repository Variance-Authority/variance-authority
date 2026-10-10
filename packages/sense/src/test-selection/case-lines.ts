import { blob, column, type Stored } from './format-layout.js';

/**
 * The test line that first reached each region a case crossed, as the case
 * index stores it beside the case's sets (spec 0100).
 *
 * A region's line is a **value**: the line shifted left once, its low bit set
 * where the region was reached in the file's ambient bucket — a hook's
 * statement, not the case's own — and line 0 for what was reached before any
 * statement was cut. A case's own crossing wins over an ambient one of the same
 * region.
 *
 * A case is stored without its membership, which the sets already hold: a
 * reader asks only about a region the case crossed. So the values are stored
 * over each module's regions as runs, a run standing for every region from its
 * start to the next run's, and a region the case did not cross is wherever the
 * run around it says. One value is the case's **fallback**, the one most of its
 * modules hold alone, and a module that holds nothing else is not stored at
 * all: an ambient hook that reaches a thousand modules costs its one value.
 *
 * The bytes of one case: a varint count of distinct values, then the values
 * ascending, the first whole and each next as its distance from the one before.
 * Past one value, the fallback's index, a varint count of stored modules, and
 * for each module the distance from the one before it (the first module's own
 * index, each next less one), its count of runs, each run's value index, and
 * the length of every run but the last.
 *
 * No bytes at all is a case whose lines were not recorded, which a record
 * written without cuts holds for every case; one zero byte is a case recorded
 * with cuts that crossed nothing.
 */

/** The column of each case's bytes, read by name and absent where no case recorded lines. */
export const LINES_COLUMN = 'tests.lines';

/** Where each case's bytes begin in {@link LINES_COLUMN}, and one past the last case's. */
export const LINES_OFFSETS = 'tests.lines.off';

/** One case's lines, as a reader and a layer hold them. */
export interface CaseLines {
  /** Every value a region of the case holds, ascending. */
  readonly table: readonly number[];
  /** The value of a module without a segment; undefined only for a case that crossed nothing. */
  readonly fallback: number | undefined;
  /** The modules that hold another value than the fallback, by their index in the case index. */
  readonly segments: ReadonlyMap<number, Segment>;
}

/** A module's runs: run `at` holds `values[at]` from region `starts[at]`, the first from region 0. */
export interface Segment {
  readonly values: readonly number[];
  readonly starts: readonly number[];
}

/** A region's value: `line`, and whether a hook's statement reached it rather than the case's own. */
export function lineValue(line: number, ambient: boolean): number {
  return line * 2 + (ambient ? 1 : 0);
}

/** The line a region of `module` was first reached at, for a region the case crossed. */
export function lineAt(lines: CaseLines, module: number, block: number): { readonly line: number; readonly ambient: boolean } | undefined {
  const value = valueAt(lines, module, block);
  return value === undefined ? undefined : { line: Math.floor(value / 2), ambient: value % 2 === 1 };
}

/** The stored value of a region of `module`, for a region the case crossed. */
export function valueAt(lines: CaseLines, module: number, block: number): number | undefined {
  const segment = lines.segments.get(module);
  if (segment === undefined) return lines.fallback;
  let at = 0;
  while (at + 1 < segment.starts.length && segment.starts[at + 1]! <= block) at += 1;
  return segment.values[at];
}

/**
 * One case's lines from its crossings, handed over in module order and, within
 * a module, in region order; or, for a module carried as it was stored, as its
 * segment whole.
 *
 * A module that holds one value is kept as its index under that value, not as
 * a segment: a run's case crosses hundreds of modules at its hook's one line,
 * and the fold holds every case at once.
 */
export class CaseLinesBuilder {
  readonly #alone = new Map<number, number[]>();
  readonly #mixed: [number, Segment][] = [];
  #module = -1;
  #open = false;
  #values: number[] = [];
  #starts: number[] = [];

  /** A region of `module` the case crossed, at `value`. */
  add(module: number, block: number, value: number): void {
    if (module !== this.#module || !this.#open) {
      this.#begin(module);
      this.#values.push(value);
      this.#starts.push(0);
      return;
    }
    if (this.#starts.at(-1)! > block) throw new Error('case lines are handed over out of order');
    if (this.#values.at(-1) !== value) {
      this.#values.push(value);
      this.#starts.push(block);
    }
  }

  /** A module's segment as it was stored, every region of it at the values it held. */
  segment(module: number, segment: Segment): void {
    this.#begin(module);
    this.#values.push(...segment.values);
    this.#starts.push(...segment.starts);
    this.#close();
  }

  /**
   * The case's lines. `fallback` is the value of modules handed over by
   * nobody, which a case carried from a held index keeps; without it, the
   * value most modules hold alone, the lower of two that tie.
   */
  finish(fallback?: number): CaseLines {
    this.#close();
    const held = new Set<number>(this.#alone.keys());
    if (fallback !== undefined) held.add(fallback);
    for (const [, { values }] of this.#mixed) for (const value of values) held.add(value);
    let chosen = fallback;
    if (chosen === undefined) {
      let most = 0;
      for (const [value, modules] of this.#alone) {
        if (modules.length > most || (modules.length === most && value < chosen!)) [chosen, most] = [value, modules.length];
      }
      chosen ??= this.#mixed[0]?.[1].values[0];
    }
    const segments: [number, Segment][] = [...this.#mixed];
    for (const [value, modules] of this.#alone) {
      if (value !== chosen) for (const module of modules) segments.push([module, { values: [value], starts: [0] }]);
    }
    segments.sort(([left], [right]) => left - right);
    return { table: [...held].sort((left, right) => left - right), fallback: chosen, segments: new Map(segments) };
  }

  #begin(module: number): void {
    if (module <= this.#module) throw new Error('case lines are handed over out of order');
    this.#close();
    this.#module = module;
    this.#open = true;
  }

  #close(): void {
    if (!this.#open) return;
    this.#open = false;
    const [values, starts] = [this.#values, this.#starts];
    this.#values = [];
    this.#starts = [];
    if (values.length === 1) {
      const modules = this.#alone.get(values[0]!);
      if (modules === undefined) this.#alone.set(values[0]!, [this.#module]);
      else modules.push(this.#module);
    } else {
      this.#mixed.push([this.#module, { values, starts }]);
    }
  }
}

/** One case's bytes, none for a case whose lines were not recorded. */
export function encodeCaseLines(lines: CaseLines | undefined): Uint8Array {
  if (lines === undefined) return new Uint8Array(0);
  const out: number[] = [];
  const index = new Map(lines.table.map((value, at) => [value, at]));
  put(out, lines.table.length);
  for (const [at, value] of lines.table.entries()) put(out, at === 0 ? value : value - lines.table[at - 1]!);
  if (lines.table.length > 1) {
    put(out, index.get(lines.fallback!)!);
    put(out, lines.segments.size);
    let previous = -1;
    for (const module of [...lines.segments.keys()].sort((left, right) => left - right)) {
      const { values, starts } = lines.segments.get(module)!;
      put(out, module - previous - 1);
      previous = module;
      put(out, values.length);
      for (const value of values) put(out, index.get(value)!);
      for (let at = 1; at < starts.length; at += 1) put(out, starts[at]! - starts[at - 1]!);
    }
  }
  return Uint8Array.from(out);
}

/** One case's lines off its bytes, or undefined for a case whose lines were not recorded. */
export function decodeCaseLines(bytes: Uint8Array): CaseLines | undefined {
  if (bytes.length === 0) return undefined;
  let at = 0;
  const take = (): number => {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = bytes[at++];
      if (byte === undefined || shift > 28) throw invalid();
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
    }
  };
  const table: number[] = [];
  for (let count = take(); table.length < count;) table.push((table.at(-1) ?? 0) + take());
  const segments = new Map<number, Segment>();
  let fallback = table[0];
  if (table.length > 1) {
    fallback = table[take()];
    if (fallback === undefined) throw invalid();
    let module = -1;
    for (let count = take(); segments.size < count;) {
      module += take() + 1;
      const runs = take();
      if (runs === 0) throw invalid();
      const values = Array.from({ length: runs }, () => table[take()] ?? fail());
      const starts = [0];
      while (starts.length < runs) starts.push(starts.at(-1)! + take());
      segments.set(module, { values, starts });
    }
  }
  if (at !== bytes.length) throw invalid();
  return { table, fallback, segments };
}

/** Each case's lines as the column pair a case index stores, or no column where no case recorded any. */
export function linesColumn(lines: readonly (CaseLines | undefined)[]): Readonly<Record<string, Stored>> {
  if (lines.every((held) => held === undefined)) return {};
  const encoded = lines.map(encodeCaseLines);
  const offsets = new Uint32Array(encoded.length + 1);
  for (const [at, bytes] of encoded.entries()) offsets[at + 1] = offsets[at]! + bytes.length;
  const bytes = new Uint8Array(offsets[encoded.length]!);
  for (const [at, held] of encoded.entries()) bytes.set(held, offsets[at]!);
  return { [LINES_COLUMN]: blob(bytes, offsets), [LINES_OFFSETS]: column(offsets) };
}

/** The column pair as a reader holds it: absent in an index written without cuts. */
export interface LinesTable {
  readonly blob: Uint8Array;
  readonly offsets: Uint32Array;
}

/** One case's lines off the column pair, undefined where the index or the case recorded none. */
export function linesOf(table: LinesTable | undefined, test: number): CaseLines | undefined {
  if (table === undefined) return undefined;
  return decodeCaseLines(caseBytes(table, test));
}

/** One case's stored bytes, to copy as they are. */
export function caseBytes(table: LinesTable, test: number): Uint8Array {
  const from = table.offsets[test];
  const to = table.offsets[test + 1];
  if (from === undefined || to === undefined || to < from || to > table.blob.length) throw invalid();
  return table.blob.subarray(from, to);
}

function put(out: number[], value: number): void {
  let rest = value;
  while (rest > 0x7f) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
}

function fail(): never {
  throw invalid();
}

function invalid(): Error {
  return new Error('not a variance-authority execution index');
}
