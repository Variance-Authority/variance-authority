import { CaseLinesBuilder, linesOf, valueAt, type CaseLines, type LinesTable, type Segment } from './case-lines.js';

/**
 * Each case's lines as a layer lays them: a carried module keeps the segments
 * its held cases stored, and a module the run recorded takes each case's line
 * from the side whose set holds it, the run's where both do (spec 0100).
 *
 * A case has lines only when every side it came from recorded them: a case
 * that ran again over a held one whose lines were not recorded, or the reverse,
 * would otherwise read a region the other side reached as reached by nothing.
 *
 * Modules are handed over in the order the layer writes them, each region of a
 * recorded module in order, so every case's builder sees its modules rising.
 */
export class LaidLines {
  readonly #held: (CaseLines | undefined)[];
  readonly #run: (CaseLines | undefined)[];
  readonly #heldSource: Uint8Array;
  readonly #lined: Uint8Array;
  readonly #builders: (CaseLinesBuilder | undefined)[];
  /** The held cases' segments by the held row they name, the output case beside each. */
  readonly #carried = new Map<number, [number, Segment][]>();
  readonly #seen: Int32Array;
  #stamp = 0;

  /**
   * The layer's lines, or undefined where neither index recorded any.
   * `heldAt` names each held row's output case, -1 for a dropped one, and
   * `runAt` each run case's.
   */
  static open(
    heldTable: LinesTable | undefined,
    runTable: LinesTable | undefined,
    heldAt: Int32Array,
    runAt: readonly number[],
    count: number,
  ): LaidLines | undefined {
    if (heldTable === undefined && runTable === undefined) return undefined;
    return new LaidLines(heldTable, runTable, heldAt, runAt, count);
  }

  private constructor(
    heldTable: LinesTable | undefined,
    runTable: LinesTable | undefined,
    heldAt: Int32Array,
    runAt: readonly number[],
    count: number,
  ) {
    this.#held = new Array<CaseLines | undefined>(count).fill(undefined);
    this.#run = new Array<CaseLines | undefined>(count).fill(undefined);
    this.#heldSource = new Uint8Array(count);
    const runSource = new Uint8Array(count);
    for (const [row, at] of heldAt.entries()) {
      if (at < 0) continue;
      this.#heldSource[at] = 1;
      this.#held[at] = linesOf(heldTable, row);
    }
    for (const [test, at] of runAt.entries()) {
      runSource[at] = 1;
      this.#run[at] = linesOf(runTable, test);
    }
    this.#lined = Uint8Array.from({ length: count }, (_, at) =>
      (this.#heldSource[at] === 0 || this.#held[at] !== undefined) && (runSource[at] === 0 || this.#run[at] !== undefined) ? 1 : 0);
    this.#builders = new Array<CaseLinesBuilder | undefined>(count).fill(undefined);
    this.#seen = new Int32Array(count).fill(-1);
    for (const [at, held] of this.#held.entries()) {
      if (held === undefined || this.#lined[at] !== 1) continue;
      for (const [row, segment] of held.segments) {
        const named = this.#carried.get(row);
        if (named === undefined) this.#carried.set(row, [[at, segment]]);
        else named.push([at, segment]);
      }
    }
  }

  /** The held module at `row`, carried as it was stored, written as the `module`-th. */
  carried(module: number, row: number): void {
    for (const [at, segment] of this.#carried.get(row) ?? []) this.#builder(at).segment(module, segment);
  }

  /**
   * A region of the `module`-th module written, recorded by the run as region
   * `block` of its module `runModule`, entered by the cases `runMembers`; and
   * by `heldMembers` at region `heldBlock` of held row `heldRow`, where the
   * held cut has one under it.
   */
  recorded(
    module: number,
    block: number,
    runModule: number,
    runMembers: Uint32Array,
    held?: { readonly row: number; readonly block: number; readonly members: Uint32Array },
  ): void {
    this.#stamp += 1;
    for (const at of runMembers) {
      this.#seen[at] = this.#stamp;
      if (this.#lined[at] === 1) this.#builder(at).add(module, block, reached(valueAt(this.#run[at]!, runModule, block)));
    }
    if (held === undefined) return;
    for (const at of held.members) {
      if (this.#seen[at] === this.#stamp || this.#lined[at] !== 1) continue;
      this.#builder(at).add(module, block, reached(valueAt(this.#held[at]!, held.row, held.block)));
    }
  }

  /** Every output case's lines, in output order. */
  finish(): (CaseLines | undefined)[] {
    return this.#builders.map((builder, at) => {
      if (this.#lined[at] !== 1) return undefined;
      // A carried module without a segment stands at the held fallback, so it stays the fallback.
      const fallback = this.#heldSource[at] === 1 ? this.#held[at]!.fallback : undefined;
      return (builder ?? new CaseLinesBuilder()).finish(fallback);
    });
  }

  #builder(at: number): CaseLinesBuilder {
    return (this.#builders[at] ??= new CaseLinesBuilder());
  }
}

/** A crossed region's value; a case whose lines name no value for a region it crossed was not written by a fold. */
function reached(value: number | undefined): number {
  if (value === undefined) throw new Error('not a variance-authority execution index');
  return value;
}
