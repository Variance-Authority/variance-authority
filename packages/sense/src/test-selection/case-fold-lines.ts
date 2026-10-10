import type { ModuleId } from '../instrument/index.js';
import { CaseLinesBuilder, lineValue, type CaseLines } from './case-lines.js';
import type { CapturedModule } from './instrumented-modules.js';
import { isWritten } from './written-lines.js';

/**
 * The test line that first reached each region, gathered beside the bounded
 * case fold one module slice at a time (spec 0100).
 *
 * A slice holds the line of each region a cut frame reached, keyed by the case
 * for a case's own frame and by the file for its ambient one, the first frame
 * to reach it winning. Once the slice's sets are collected, each member of a
 * region's set takes its own line, else its file's, and goes to that case's
 * builder: the lines are never held for the run's whole test-by-region product.
 *
 * A case has lines when its own frames were cut, or when they logged nothing
 * and some frame of its file was: the transform cuts a whole file or none of
 * it. Any other is a case whose lines were not recorded, such as one a helper
 * outside its file declared, whose body ran uncut.
 */
export class FoldLines {
  readonly #lined: Uint8Array;
  readonly #fileStart: Uint32Array;
  readonly #builders: (CaseLinesBuilder | undefined)[];
  #width = 0;
  #own = new Map<number, number>();
  #ambient = new Map<number, number>();

  /** `lined` per test, and the first test of each test's file. */
  constructor(lined: Uint8Array, fileStart: Uint32Array) {
    this.#lined = lined;
    this.#fileStart = fileStart;
    this.#builders = Array.from(lined, () => undefined);
  }

  /** A new slice of `width` regions. */
  slice(width: number): void {
    this.#width = width;
    this.#own = new Map();
    this.#ambient = new Map();
  }

  /** A region at `local` a cut frame reached at `line`: `test` is its case, or for an ambient frame its file's first. */
  reached(test: number, local: number, line: number, ambient: boolean): void {
    const held = ambient ? this.#ambient : this.#own;
    const key = test * this.#width + local;
    if (!held.has(key)) held.set(key, lineValue(line, ambient));
  }

  /** The region at `local`, entered by `members`, kept at `block` of the `module`-th module written. */
  region(local: number, members: Uint32Array, module: number, block: number): void {
    for (const test of members) {
      if (this.#lined[test] !== 1) continue;
      const value = this.#own.get(test * this.#width + local)
        ?? this.#ambient.get(this.#fileStart[test]! * this.#width + local)
        ?? lineValue(0, true);
      (this.#builders[test] ??= new CaseLinesBuilder()).add(module, block, value);
    }
  }

  /** Every case's lines, by test row. */
  finish(): (CaseLines | undefined)[] {
    return this.#builders.map((builder, test) =>
      this.#lined[test] === 1 ? (builder ?? new CaseLinesBuilder()).finish() : undefined);
  }
}

/** The first test of each test's file, which an ambient frame's lines are kept under. */
export function fileStarts(tests: number, testsByFile: ReadonlyMap<string, readonly [number, number]>): Uint32Array {
  const starts = new Uint32Array(tests);
  for (const [first, last] of testsByFile.values()) starts.fill(first, first, last);
  return starts;
}

/** Each region's index among its module's written regions, -1 for one the transform wrote. */
export function writtenPlaces(shaped: readonly (readonly [ModuleId, CapturedModule])[], blockCount: number): Int32Array {
  const places = new Int32Array(blockCount);
  let at = 0;
  for (const [, module] of shaped) {
    let kept = 0;
    for (const block of module.blocks) places[at++] = isWritten(block) ? kept++ : -1;
  }
  return places;
}
