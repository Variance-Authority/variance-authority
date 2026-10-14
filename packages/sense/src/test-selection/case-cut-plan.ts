import type { OpenedSetExecutionIndex, SetExecutionModule } from './execution-set-format.js';
import type { HeldIndex } from './held-case-index.js';

/**
 * The before cut's incidence, indexed once. A file names its case rows and
 * distinct called sets; those sets name the modules that contain them. A run
 * therefore selects only the base rows its files retired, without rewriting
 * a growing before index or expanding one crossing per region.
 */
export class CaseCutPlan {
  readonly #files = new Map<number, number[]>();
  readonly #setsByFile = new Map<number, Set<number>>();
  readonly #modulesBySet = new Map<number, Set<number>>();
  readonly #membersByFile = new Map<number, Map<number, number[]>>();
  #indexed = false;

  constructor(readonly held: HeldIndex) {
    for (const [row, file] of held.columns.testFile.entries()) {
      let rows = this.#files.get(file);
      if (rows === undefined) this.#files.set(file, rows = []);
      rows.push(row);
    }
  }

  /** Select the cases of `ran`, and only the module regions any of them crossed. */
  of(ran: ReadonlySet<string>, lines: (row: number) => SetExecutionModule | undefined): OpenedSetExecutionIndex {
    const files = new Set<number>();
    for (const file of ran) { const key = this.held.key(file); if (key % 2 === 1) files.add((key - 1) / 2); }
    const rows = [...files].flatMap((file) => this.#files.get(file) ?? []).sort((left, right) => left - right);
    const at = new Map(rows.map((row, place) => [row, place]));
    const modules = new Set<number>();
    const selectedGroups = new Map<number, number[]>();
    if (rows.length !== 0) {
      this.#index();
      for (const file of files) for (const set of this.#setsByFile.get(file) ?? []) {
        let groups = selectedGroups.get(set);
        if (groups === undefined) selectedGroups.set(set, groups = []);
        groups.push(file);
        for (const module of this.#modulesBySet.get(set) ?? []) modules.add(module);
      }
    }
    const memo = new Map<number, Uint32Array>();
    const members = (set: number): Uint32Array => {
      let found = memo.get(set);
      if (found === undefined) {
        found = Uint32Array.from((selectedGroups.get(set) ?? []).flatMap((file) => this.#membersByFile.get(set)!.get(file)!), (row) => at.get(row)!).sort();
        memo.set(set, found);
      }
      return found;
    };
    return { tests: rows.map((row) => this.held.test(row)),
      modules: [...modules].sort((left, right) => this.held.columns.moduleFile[left]! - this.held.columns.moduleFile[right]!).map((row) => {
        const module = lines(row) ?? this.held.module(row);
        return { ...module, loaded: new Uint8Array(module.blocks.length) };
      }),
      sets: { size: this.held.columns.sets.size, members, count: (set) => members(set).length, has: (set, test) => members(set).includes(test), containerOf: (set) => this.held.columns.sets.containerOf(set) } };
  }

  #index(): void {
    if (this.#indexed) return;
    this.#indexed = true;
    const columns = this.held.columns;
    for (const row of this.held.moduleRows()) {
      const named = new Set(columns.blockCalled.subarray(columns.moduleBlocks[row]!, columns.moduleBlocks[row + 1]!));
      for (const set of named) {
        let modules = this.#modulesBySet.get(set);
        if (modules === undefined) {
          this.#modulesBySet.set(set, modules = new Set());
          const byFile = new Map<number, number[]>();
          this.#membersByFile.set(set, byFile);
          for (const test of columns.sets.members(set)) {
            const file = columns.testFile[test]!;
            let cases = byFile.get(file);
            if (cases === undefined) byFile.set(file, cases = []);
            cases.push(test);
            let sets = this.#setsByFile.get(file);
            if (sets === undefined) this.#setsByFile.set(file, sets = new Set());
            sets.add(set);
          }
        }
        modules.add(row);
      }
    }
  }
}
