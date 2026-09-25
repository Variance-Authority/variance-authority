import { CrossingSets, type SetId } from './crossing-sets.js';
import type { CrossingSetsView } from './crossing-sets-read.js';
import {
  encodeSetExecutionIndex,
  openSetExecutionIndex,
  type OpenedSetExecutionIndex,
  type SetExecutionModule,
} from './execution-set-format.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { addressKey } from './merge-carry.js';
import type { ExecutionTest } from './reverse.js';

/** What a run knows about the test files it was handed. */
export interface CaseRunFiles {
  /** Every test file the run announced, finished or not. */
  readonly ran: ReadonlySet<string>;
  /** The files that ran to the end: their cases replace every case the index held for them. */
  readonly finished: ReadonlySet<string>;
  /** Whether a test file the index holds is still in the checkout. */
  readonly present: (file: string) => boolean;
}

export interface CaseLayers {
  /** The whole suite: this run laid over what the index held. */
  readonly merged: Buffer;
  /** The cases this run recorded, by id: the run {@link CaseRunFiles} laid over the rest. */
  readonly last: readonly string[];
  /**
   * The cases the index held for the files this run announced, as they were
   * before it: the base an edit to a test is compared against. Absent when
   * there was no index to take them from.
   */
  readonly before?: Buffer;
}

/**
 * Lay one run's case index over the one it replaces, the way the snapshot lays
 * a run over its rows.
 *
 * A file the run finished is replaced, every case and every crossing of it. A
 * file it did not finish is laid over: its old cases stay, and the ones that
 * ran again say how they settled this time. A file the checkout no longer holds
 * is retired, because nothing can run it again to retire it. Every other case is
 * carried untouched, so a run of one file leaves the rest of the suite's answer
 * where it was.
 *
 * Nothing is decoded to a crossing. A region names a set, and a set is
 * translated to the new test numbering once however many regions share it, so
 * the work is regions plus distinct sets, which is what the index costs to
 * hold.
 *
 * A module this run recorded is read at the regions it recorded now, and the
 * carried cases land on them by address — the region's name and structural
 * path, told apart by occurrence — and kind, the rule the snapshot carries its
 * rows by. A region the text no longer has drops its carried cases rather than
 * guessing a place for them. A module this run did not record keeps the regions
 * it was recorded with, as it did before any partial run.
 *
 * An index this cannot open — a row spelling, or bytes it did not write — is no
 * index to lay over, and the run is written alone: what the fold wrote before
 * layering existed.
 */
export function layerCaseIndex(
  previous: Uint8Array | undefined,
  fresh: Uint8Array,
  files: CaseRunFiles,
): CaseLayers {
  const run = openSetExecutionIndex(fresh);
  if (run === undefined) throw new Error('a case fold wrote an index it cannot open');
  const last = run.tests.map((test) => test.id);
  const held = openPrevious(previous);
  if (held === undefined) return { merged: Buffer.from(fresh), last };

  const gone = (file: string): boolean => files.finished.has(file) || !files.present(file);
  const byId = new Map<string, ExecutionTest>();
  for (const test of held.tests) if (!gone(test.file)) byId.set(test.id, test);
  // A case that ran again says how it settled this time.
  for (const test of run.tests) byId.set(test.id, test);
  const tests = [...byId.values()].sort(caseOrder);
  const at = new Map(tests.map((test, index) => [test.id, index]));

  const merged = new Translation(tests.length);
  const fromHeld = merged.from(held.sets, held.tests.map((test) => (gone(test.file) ? -1 : at.get(test.id)!)));
  const fromRun = merged.from(run.sets, run.tests.map((test) => at.get(test.id)!));

  const heldModules = new Map(held.modules.map((module) => [module.file, module]));
  const runModules = new Map(run.modules.map((module) => [module.file, module]));
  const modules: SetExecutionModule[] = [];
  for (const file of [...new Set([...heldModules.keys(), ...runModules.keys()])].sort(codeUnitOrder)) {
    const recorded = runModules.get(file);
    const before = heldModules.get(file);
    if (recorded === undefined) {
      const kept = carried(before!, fromHeld);
      if (kept !== undefined) modules.push(kept);
      continue;
    }
    const lands = before === undefined ? undefined : landing(recorded, before);
    const called = new Uint32Array(recorded.blocks.length);
    const loaded = new Uint8Array(recorded.blocks.length);
    for (let block = 0; block < recorded.blocks.length; block += 1) {
      const own = fromRun(recorded.called[block]!);
      const from = lands?.[block] ?? -1;
      called[block] = from < 0 ? own : merged.union(own, fromHeld(before!.called[from]!));
      loaded[block] = recorded.loaded[block]! | (from < 0 ? 0 : before!.loaded[from]!);
    }
    modules.push({ file, blocks: recorded.blocks, called, loaded });
  }

  return {
    merged: encodeSetExecutionIndex({ tests, modules, sets: merged.pool() }),
    last,
    before: beforeRun(held, new Set([...files.ran, ...run.tests.map((test) => test.file)])),
  };
}

/**
 * The held index cut to the cases of the files a run announced.
 *
 * Regions keep the shape they were recorded with, and no region says it ran
 * while its module loaded: that flag belongs to every file that imported the
 * module, not to these cases, and a comparison of what these cases entered must
 * not read it as theirs.
 */
function beforeRun(held: OpenedSetExecutionIndex, ran: ReadonlySet<string>): Buffer {
  const tests = held.tests.filter((test) => ran.has(test.file));
  const at = new Map(tests.map((test, index) => [test.id, index]));
  const cut = new Translation(tests.length);
  const from = cut.from(held.sets, held.tests.map((test) => (ran.has(test.file) ? at.get(test.id)! : -1)));
  const modules: SetExecutionModule[] = [];
  for (const module of held.modules) {
    const kept = carried({ ...module, loaded: new Uint8Array(module.blocks.length) }, from);
    if (kept !== undefined) modules.push(kept);
  }
  return encodeSetExecutionIndex({ tests, modules, sets: cut.pool() });
}

/** A module read at the regions it was recorded with, or nothing when no case is left in it. */
function carried(module: SetExecutionModule, from: (set: SetId) => SetId): SetExecutionModule | undefined {
  const called = module.called.map(from);
  let entered = false;
  for (let block = 0; block < called.length; block += 1) {
    if (called[block] !== EMPTY || module.loaded[block] === 1) entered = true;
  }
  return entered ? { ...module, called } : undefined;
}

/** For each region recorded now, the held region its cases carry from, or -1. */
function landing(recorded: SetExecutionModule, before: SetExecutionModule): Int32Array {
  const seen = new Map<string, number>();
  const heldAt = new Map<string, number>();
  for (const [at, block] of before.blocks.entries()) {
    heldAt.set(addressKey(`${block.name}\0${block.path}`, seen), at);
  }
  seen.clear();
  return Int32Array.from(recorded.blocks, (block) => {
    const at = heldAt.get(addressKey(`${block.name}\0${block.path}`, seen));
    return at !== undefined && before.blocks[at]!.kind === block.kind ? at : -1;
  });
}

function openPrevious(bytes: Uint8Array | undefined): OpenedSetExecutionIndex | undefined {
  if (bytes === undefined) return undefined;
  try {
    return openSetExecutionIndex(bytes);
  } catch {
    return undefined;
  }
}

function caseOrder(left: ExecutionTest, right: ExecutionTest): number {
  return codeUnitOrder(left.file, right.file) ||
    codeUnitOrder(left.name, right.name) ||
    codeUnitOrder(left.id, right.id);
}

/** The first set a pool interns is the empty one, and every translation starts it that way. */
const EMPTY = 0;

/**
 * One output pool, and the translation of each input pool into it.
 *
 * Each input set is read once and interned once, however many regions name it;
 * a union is interned once per distinct pair. That keeps the layering at the
 * size of the sets rather than of the crossings they stand for.
 */
class Translation {
  readonly #sets: CrossingSets;
  readonly #members: Uint32Array[] = [];
  readonly #unions = new Map<string, SetId>();

  constructor(testCount: number) {
    this.#sets = new CrossingSets(testCount);
    this.#intern(new Uint32Array());
  }

  /** Translate `view`'s sets through `remap`, which names -1 for a case that is gone. */
  from(view: CrossingSetsView, remap: readonly number[]): (set: SetId) => SetId {
    const memo = new Map<SetId, SetId>();
    return (set) => {
      let found = memo.get(set);
      if (found === undefined) {
        const members: number[] = [];
        for (const test of view.members(set)) {
          const to = remap[test];
          if (to === undefined) throw new Error('a case index names a case it does not hold');
          if (to >= 0) members.push(to);
        }
        found = this.#intern(Uint32Array.from(members).sort());
        memo.set(set, found);
      }
      return found;
    };
  }

  union(left: SetId, right: SetId): SetId {
    if (left === right || right === EMPTY) return left;
    if (left === EMPTY) return right;
    const key = left < right ? `${left},${right}` : `${right},${left}`;
    let found = this.#unions.get(key);
    if (found === undefined) {
      found = this.#intern(Uint32Array.from(new Set([...this.#members[left]!, ...this.#members[right]!])).sort());
      this.#unions.set(key, found);
    }
    return found;
  }

  pool(): ReturnType<CrossingSets['pool']> {
    return this.#sets.pool();
  }

  #intern(members: Uint32Array): SetId {
    const id = this.#sets.intern(members);
    this.#members[id] ??= members;
    return id;
  }
}
