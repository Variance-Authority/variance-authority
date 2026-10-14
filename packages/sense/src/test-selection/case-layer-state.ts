import { CaseCutPlan } from './case-cut-plan.js';
import { CaseLinesBuilder, linesOf, valueAt, type CaseLines, type Segment } from './case-lines.js';
import { CrossingSets, type SetId } from './crossing-sets.js';
import { encodeSetExecutionIndex, openSetExecutionIndex, type OpenedSetExecutionIndex, type SetExecutionModule } from './execution-set-format.js';
import { HeldIndex, writeLaid, type LaidModule } from './held-case-index.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { landedThrough, NO_EDIT } from './region-edit.js';
import { recordedCuts } from './region-landing.js';
import type { ExecutionTest } from './reverse.js';
import { carriedFrom, type CaseRunFiles } from './case-layer.js';
import { Translation } from './set-translation.js';

interface CaseRow {
  test?: ExecutionTest;
  held?: number;
  file: string;
  lines?: { fallback: number | undefined; segments: Map<string, Segment> };
}
interface ModuleRow { file?: string; module?: SetExecutionModule; row?: number; called: Uint32Array; loaded: Uint8Array; touched: number }

/**
 * A run sequence held until its final numbering is known. Finished files retire
 * case generations, rather than renumbering every earlier shard. Each module
 * is visited when a run records it; carried modules are written once at finish.
 */
export class CaseLayerState {
  #alive = new Uint8Array(1024);
  readonly #held: HeldIndex | undefined;
  readonly #heldIds = new Map<number, number>();
  readonly #cases = new Map<number, CaseRow>();
  readonly #ids = new Map<string, number>();
  readonly #files = new Map<string, Set<number>>();
  readonly #check = new Set<string>();
  readonly #kept = new Map<number, ModuleRow>();
  readonly #modules = new Map<string, ModuleRow>();
  readonly #sets = Translation.deferred((row) => this.#alive[row] === 1);
  #written: Buffer | undefined;
  #before: CaseLayerState | undefined;
  #rawBefore: Uint8Array | undefined;
  readonly #cuts = new Map<Uint8Array, CaseCutPlan>();
  #next = 0;
  #step = 0;

  constructor(previous?: Uint8Array, before?: Uint8Array) {
    this.#rawBefore = before;
    this.#held = HeldIndex.open(previous);
    const held = this.#held;
    if (held === undefined) return;
    const columns = held.columns;
    if (columns.testId.length > this.#alive.length) this.#alive = new Uint8Array(columns.testId.length * 2);
    this.#alive.fill(1, 0, columns.testId.length);
    const files = new Map<number, string>();
    for (let row = 0; row < columns.testId.length; row += 1) {
      let file = files.get(columns.testFile[row]!);
      if (file === undefined) files.set(columns.testFile[row]!, file = held.string(columns.testFile[row]!));
      this.#cases.set(row, { held: row, file });
      this.#heldIds.set(columns.testId[row]!, row);
      let named = this.#files.get(file);
      if (named === undefined) this.#files.set(file, named = new Set());
      named.add(row);
      this.#check.add(file);
      const lines = linesOf(columns.testLines, row);
      if (lines !== undefined) {
        const segments = new Map<string, Segment>();
        for (const [module, segment] of lines.segments) segments.set(held.string(columns.moduleFile[module]!), segment);
        this.#cases.get(row)!.lines = { fallback: lines.fallback, segments };
      }
    }
    this.#next = columns.testId.length;
    const from = this.#sets.from(columns.sets, Array.from(columns.testId.keys()));
    for (const row of held.moduleRows()) {
      const first = columns.moduleBlocks[row]!;
      const last = columns.moduleBlocks[row + 1]!;
      this.#kept.set(columns.moduleFile[row]!, { row, called: columns.blockCalled.subarray(first, last).map(from), loaded: columns.blockLoaded.subarray(first, last), touched: 0 });
    }
  }

  /** Lay the next run, keeping its case identities available without writing its index. */
  lay(fresh: Uint8Array, files: CaseRunFiles): { readonly last: readonly string[]; readonly announced: readonly string[] } {
    const run = openSetExecutionIndex(fresh);
    if (run === undefined) throw new Error('a case fold wrote an index it cannot open');
    return this.layIndex(run, files);
  }

  /** Lay a selected before cut without serializing it between runs. */
  layIndex(run: OpenedSetExecutionIndex, files: CaseRunFiles): { readonly last: readonly string[]; readonly announced: readonly string[] } {
    this.#written = undefined;
    this.#step += 1;
    for (const file of this.#check) if (!files.present(file)) this.#retire(file);
    this.#check.clear();
    for (const file of files.finished) this.#retire(file);
    this.#add(run, files);
    return { last: run.tests.map((test) => test.id), announced: run.tests.filter((test) => files.ran.has(test.file)).map((test) => test.id) };
  }

  /** Whether the current index holds any case of this exact test path. */
  hasFile(file: string): boolean { return this.#files.has(file); }

  /** Whether a run has already laid an index, including an index with no cases. */
  get present(): boolean { return this.#held !== undefined || this.#step !== 0; }

  /** A before cut of the current state, captured before the next run retires its generations. */
  currentCut(ran: ReadonlySet<string>, recut: (module: SetExecutionModule) => SetExecutionModule | undefined): OpenedSetExecutionIndex {
    const selected = new Set([...ran].flatMap((file) => [...(this.#files.get(file) ?? [])]));
    const rows = this.#ordered(selected);
    const at = new Map(rows.map(([generation], position) => [generation, position]));
    const memo = new Map<SetId, Uint32Array>();
    const members = (set: SetId): Uint32Array => {
      let found = memo.get(set);
      if (found === undefined) { found = Uint32Array.from(this.#sets.members(set).filter((generation) => selected.has(generation)), (generation) => at.get(generation)!).sort(); memo.set(set, found); }
      return found;
    };
    const modules: SetExecutionModule[] = [];
    for (const row of rows.length === 0 ? [] : [...this.#kept.values(), ...this.#modules.values()]) {
      if (!row.called.some((set) => members(set).length !== 0)) continue;
      const held = this.#module(row);
      const module = recut(held) ?? held;
      // Capture even sets a re-cut removed, before their live generations change.
      for (const set of module.called) members(set);
      modules.push({ ...module, loaded: new Uint8Array(module.blocks.length) });
    }
    modules.sort((left, right) => codeUnitOrder(left.file, right.file));
    return { tests: rows.map(([, row]) => row.test ?? this.#held!.test(row.held!)), modules,
      sets: { size: this.#sets.size, members: (set) => memo.get(set)!, has: (set, test) => memo.get(set)!.includes(test), count: (set) => memo.get(set)!.length,
        containerOf: () => { throw new Error('a pending case set has no stored container'); } } };
  }

  /** Reuse the initial before cut's incidence for every shard. */
  cut(bytes: Uint8Array, held: HeldIndex): CaseCutPlan {
    let found = this.#cuts.get(bytes);
    if (found === undefined) this.#cuts.set(bytes, found = new CaseCutPlan(held));
    return found;
  }

  /** Lay the retired cases through the same pending owner as the current cases. */
  retire(previous: Uint8Array | undefined, retired: OpenedSetExecutionIndex | undefined, ran: ReadonlySet<string>, again: boolean, unbased: boolean): { readonly bytes: () => Uint8Array; readonly files: () => readonly string[] | undefined } | undefined {
    if (!again) { this.#before = undefined; this.#rawBefore = undefined; }
    else if (this.#before === undefined && this.#rawBefore === undefined) this.#rawBefore = previous;
    if (!unbased && retired !== undefined) {
      this.#before ??= new CaseLayerState(this.#rawBefore);
      this.#rawBefore = undefined;
      this.#before.layIndex(retired, { ran, finished: ran, present: () => true });
    }
    if (this.#before !== undefined) return { bytes: () => this.#before!.finish(), files: () => this.#before!.moduleFiles() };
    if (this.#rawBefore !== undefined) return { bytes: () => this.#rawBefore!, files: () => openSetExecutionIndex(this.#rawBefore!)?.modules.map((module) => module.file) };
    return undefined;
  }

  /** The modules the final index holds, without writing their columns. */
  moduleFiles(): readonly string[] {
    return [...this.#kept.values(), ...this.#modules.values()].filter((row) => row.touched === this.#step || row.loaded.some((loaded) => loaded === 1) || row.called.some((set) => this.#sets.has(set)))
      .map((row) => row.file ?? this.#held!.string(this.#held!.columns.moduleFile[row.row!]!));
  }

  /** The current region cut of a module recorded by an earlier run. */
  module(file: string): SetExecutionModule | undefined { const row = this.#row(file); return row === undefined ? undefined : this.#module(row); }

  /** Cases in the same path, name, identity order the stored index uses. */
  cases(): readonly string[] { return this.#ordered().map(([, row]) => row.test?.id ?? this.#held!.string(this.#held!.columns.testId[row.held!]!)); }

  /** Materialize the final columns once, translating only sets final regions name. */
  finish(): Buffer {
    if (this.#written !== undefined) return this.#written;
    const rows = this.#ordered();
    const at = new Int32Array(this.#next).fill(-1);
    for (const [position, [generation]] of rows.entries()) at[generation] = position;
    const sets = new CrossingSets(rows.length);
    sets.intern([]);
    const translated = new Map<SetId, SetId>();
    const from = (set: SetId): SetId => {
      let found = translated.get(set);
      if (found === undefined) {
        found = sets.intern(this.#sets.mapped(set, at));
        translated.set(set, found);
      }
      return found;
    };
    const modules: LaidModule[] = [];
    const moduleAt = new Map<string, number>();
    const lined = rows.some(([, row]) => row.lines !== undefined);
    const moduleKey = (row: ModuleRow): number => row.file === undefined ? 2 * this.#held!.columns.moduleFile[row.row!]! + 1 : this.#held?.key(row.file) ?? 0;
    for (const row of [...this.#kept.values(), ...this.#modules.values()].sort((left, right) => moduleKey(left) - moduleKey(right) || (moduleKey(left) % 2 === 0 ? codeUnitOrder(left.file!, right.file!) : 0))) {
      const called = row.called.map(from);
      if (row.touched !== this.#step && !called.some((set) => set !== 0) && !row.loaded.some((loaded) => loaded === 1)) continue;
      if (lined) moduleAt.set(row.file ?? this.#held!.string(this.#held!.columns.moduleFile[row.row!]!), modules.length);
      modules.push(row.module === undefined ? { row: row.row!, called, loaded: row.loaded } : { ...row.module, called, loaded: row.loaded });
    }
    const lines = rows.map(([, row]) => {
      if (row.lines === undefined) return undefined;
      const builder = new CaseLinesBuilder();
      for (const [module, segment] of [...row.lines.segments].flatMap(([file, segment]) => moduleAt.has(file) ? [[moduleAt.get(file)!, segment] as const] : []).sort(([left], [right]) => left - right)) builder.segment(module, segment);
      return builder.finish(row.lines.fallback);
    });
    // An empty held dictionary also owns newly recorded object rows.
    const held = this.#held ?? HeldIndex.open(EMPTY_INDEX)!;
    return this.#written = writeLaid(held, rows.map(([, row]) => row.test ?? row.held!), modules, sets.pool(), lines);
  }

  #ordered(selected?: Iterable<number>): [number, CaseRow][] {
    const key = (row: CaseRow, field: 'file' | 'name' | 'id'): number => row.test === undefined
      ? 2 * this.#held!.columns[field === 'file' ? 'testFile' : field === 'name' ? 'testName' : 'testId'][row.held!]! + 1
      : this.#held?.key(row.test[field]) ?? 0;
    const rows = selected === undefined ? [...this.#cases] : [...selected].flatMap((generation) => this.#cases.has(generation) ? [[generation, this.#cases.get(generation)!] as [number, CaseRow]] : []);
    return rows.sort(([, left], [, right]) => {
      for (const field of ['file', 'name', 'id'] as const) {
        const a = key(left, field), b = key(right, field);
        const order = a - b || (a % 2 === 0 ? codeUnitOrder(left.test![field], right.test![field]) : 0);
        if (order !== 0) return order;
      }
      return 0;
    });
  }

  #row(file: string): ModuleRow | undefined {
    const fresh = this.#modules.get(file);
    if (fresh !== undefined || this.#held === undefined) return fresh;
    const key = this.#held.key(file);
    return key % 2 === 1 ? this.#kept.get((key - 1) / 2) : undefined;
  }

  #module(row: ModuleRow): SetExecutionModule {
    return row.module ?? { ...this.#held!.module(row.row!), called: row.called, loaded: row.loaded };
  }

  #retire(file: string): void {
    for (const generation of this.#files.get(file) ?? []) {
      const row = this.#cases.get(generation);
      if (row === undefined) continue;
      this.#cases.delete(generation);
      this.#alive[generation] = 0;
      if (row.test !== undefined && this.#ids.get(row.test.id) === generation) this.#ids.delete(row.test.id);
      if (row.held !== undefined) this.#heldIds.delete(this.#held!.columns.testId[row.held]!)
    }
    this.#files.delete(file);
  }

  #add(run: OpenedSetExecutionIndex, files: CaseRunFiles | undefined): void {
    const modules = run.modules;
    const ownLines: (CaseLines | undefined)[] = [];
    const places = run.tests.map((test, index) => {
      let generation = this.#ids.get(test.id);
      if (generation === undefined && this.#held !== undefined) { const key = this.#held.key(test.id); if (key % 2 === 1) generation = this.#heldIds.get((key - 1) / 2); }
      const line = linesOf(run.lines, index);
      ownLines.push(line);
      if (generation === undefined) {
        generation = this.#next++;
        if (generation >= this.#alive.length) { const grown = new Uint8Array(this.#alive.length * 2); grown.set(this.#alive); this.#alive = grown; }
        this.#alive[generation] = 1;
        this.#ids.set(test.id, generation);
        const segments = new Map<string, Segment>();
        if (line !== undefined) for (const [module, segment] of line.segments) segments.set(modules[module]!.file, segment);
        this.#cases.set(generation, { test, file: test.file, ...(line === undefined ? {} : { lines: { fallback: line.fallback, segments } }) });
        let inFile = this.#files.get(test.file);
        if (inFile === undefined) this.#files.set(test.file, inFile = new Set());
        inFile.add(generation);
        this.#check.add(test.file);
      } else {
        const held = this.#cases.get(generation)!;
        if (held.file !== test.file) {
          const earlier = this.#files.get(held.file)!;
          earlier.delete(generation);
          if (earlier.size === 0) this.#files.delete(held.file);
          let current = this.#files.get(test.file);
          if (current === undefined) this.#files.set(test.file, current = new Set());
          current.add(generation);
          held.file = test.file;
          this.#check.add(test.file);
        }
        held.test = test;
        this.#ids.set(test.id, generation);
        if (line === undefined) delete held.lines;
      }
      return generation;
    });
    const from = this.#sets.from(run.sets, places);
    const runAt = new Map(places.map((generation, index) => [generation, index]));
    const lined = [...this.#cases.values()].some((row) => row.lines !== undefined);
    for (const [moduleAt, recorded] of modules.entries()) {
      const previousRow = this.#row(recorded.file);
      const previous = previousRow === undefined ? undefined : this.#module(previousRow);
      const live = previous !== undefined && (previous.loaded.some((loaded) => loaded === 1) || previous.called.some((set) => this.#sets.has(set)));
      const held = live ? previous : undefined;
      const cuts = files?.artifacts === true && held !== undefined ? recordedCuts(held, recorded) : undefined;
      const target = cuts?.module ?? recorded;
      const lands = held === undefined || files?.artifacts === true ? undefined : landedThrough(held, recorded, (files?.edit ?? (() => NO_EDIT))(recorded.file));
      const around = lands === undefined ? undefined : carriedFrom(recorded.owner, lands);
      const called = new Uint32Array(target.blocks.length);
      const loaded = new Uint8Array(target.blocks.length);
      const segments = new Map<number, { values: number[]; starts: number[] }>();
      const heldValues = new Map<number, Segment | undefined>();
      const addLine = (generation: number, block: number, value: number | undefined): void => {
        if (this.#cases.get(generation)?.lines === undefined) return;
        if (value === undefined) throw new Error('not a variance-authority execution index');
        let segment = segments.get(generation);
        if (segment === undefined) segments.set(generation, segment = { values: [], starts: [] });
        if (segment.values.at(-1) !== value) { segment.values.push(value); segment.starts.push(segment.starts.length === 0 ? 0 : block); }
      };
      for (let block = 0; block < called.length; block += 1) {
        const ownBlock = cuts === undefined ? block : cuts.own[block]!;
        const mine = ownBlock < 0 ? 0 : from(recorded.called[ownBlock]!);
        const before = cuts === undefined ? around?.(block) ?? -1 : cuts.held[block]!;
        const carried = before < 0 ? 0 : held!.called[before]!;
        called[block] = this.#sets.union(mine, carried);
        loaded[block] = (ownBlock < 0 ? 0 : recorded.loaded[ownBlock]!) | (before < 0 ? 0 : held!.loaded[before]!);
        // Without line cuts the crossing product is never expanded here.
        if (!lined) continue;
        const own = new Set(this.#sets.members(mine));
        for (const generation of own) if (this.#cases.get(generation)?.lines !== undefined) addLine(generation, block, valueAt(ownLines[runAt.get(generation)!]!, moduleAt, ownBlock));
        for (const generation of this.#sets.members(carried)) {
          if (own.has(generation)) continue;
          const row = this.#cases.get(generation)!;
          if (!heldValues.has(generation)) heldValues.set(generation, row.lines?.segments.get(recorded.file));
          const segment = heldValues.get(generation);
          let value = row.lines?.fallback;
          if (segment !== undefined) { let at = 0; while (at + 1 < segment.starts.length && segment.starts[at + 1]! <= before) at += 1; value = segment.values[at]; }
          addLine(generation, block, value);
        }
      }
      for (const [generation, segment] of segments) this.#cases.get(generation)!.lines!.segments.set(recorded.file, segment);
      if (previousRow?.row !== undefined) this.#kept.delete(this.#held!.columns.moduleFile[previousRow.row]!);
      this.#modules.set(recorded.file, { file: recorded.file, module: { ...target, called, loaded }, called, loaded, touched: this.#step });
    }
  }
}


const EMPTY_INDEX = (() => { const sets = new CrossingSets(0); sets.intern([]); return encodeSetExecutionIndex({ tests: [], modules: [], sets: sets.pool() }); })();
