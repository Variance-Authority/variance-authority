import { CrossingSets, type SetId } from './crossing-sets.js';
import type { CrossingSetsView } from './crossing-sets-read.js';
import {
  encodeSetExecutionIndex,
  openSetExecutionIndex,
  type OpenedSetExecutionIndex,
  type SetExecutionModule,
} from './execution-set-format.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { addressKey, sameNumbering } from './merge-carry.js';
import type { ExecutionTest } from './reverse.js';

/** What a run knows about the test files it was handed. */
export interface CaseRunFiles {
  /** Every test file the run announced, finished or not. */
  readonly ran: ReadonlySet<string>;
  /** The files that ran to the end: their cases replace every case the index held for them. */
  readonly finished: ReadonlySet<string>;
  /** Whether a test file the index holds is still in the checkout. */
  readonly present: (file: string) => boolean;
  /**
   * Whether the run recorded `file` from the text the index's regions of it
   * were cut from. Same text is the same numbering, so its held cases land by
   * address however the two cuts filled a counter, as the rows beside them do
   * in `mergeCoverage`. Absent when nobody can say, and the numbering decides.
   */
  readonly sameText?: (file: string) => boolean;
  /**
   * Whether the run recorded `file` from the text the before layer's cut of it
   * is named at. The names are the snapshot's, and the snapshot re-cuts a
   * carried module to the text on disk while the index keeps the lines it was
   * recorded at, so a module no run re-recorded since an edit above one of its
   * regions stands at the old lines under the new name. Where the run recorded
   * that text, the before layer is cut at the lines it recorded. Asked only
   * when `base` is given; without `base`, `sameText` answers it, and with
   * `base` but without this, nothing is re-cut.
   */
  readonly sameBeforeText?: (file: string) => boolean;
  /**
   * The index the before layer is cut from, when it is not the one the run is
   * laid over: the one a landing began with, which no shard it laid before
   * this one has re-cut to the shards' text.
   */
  readonly base?: Uint8Array;
}

export interface CaseLayers {
  /** The whole suite: this run laid over what the index held. */
  readonly merged: Buffer;
  /** The id of every case `merged` holds, in its order. */
  readonly cases: readonly string[];
  /** The cases this run recorded, by id: the run {@link CaseRunFiles} laid over the rest. */
  readonly last: readonly string[];
  /**
   * The cases of `last` whose files the run announced. A shard's index also
   * holds what its seed carried, which the shard did not run.
   */
  readonly announced: readonly string[];
  /**
   * The cases the index held for the files this run announced, as they were
   * before it: the base an edit to a test is compared against. Absent when
   * there was no index to take them from.
   */
  readonly before?: Buffer;
  /**
   * The modules of `before` cut at another text than the one they are named
   * at, whose lines nothing could carry onto it: a reader has no text to
   * compare them from. Absent when every module was carried or already stood
   * at its text.
   */
  readonly unlined?: readonly string[];
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
 * The before layer is cut at the lines of the text it is named at. A held
 * module the run recorded from that text is read at the recorded lines where
 * the index still stands at an older text's, and is named `unlined` where no
 * address could carry it there.
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
  const announced = run.tests.filter((test) => files.ran.has(test.file)).map((test) => test.id);
  const held = openPrevious(previous);
  const cut = files.base === undefined ? held : openPrevious(files.base);
  // FIXME: no index is read as no other cases, and a landing that removed the
  // index leaves exactly that. The next local run then writes its own files'
  // cases alone, and that partial index stands for the whole suite beside a
  // snapshot that still holds every file — the state `seedTestCoverage` keeps a
  // worktree's first run out of. An index that is absent beside a snapshot that
  // is not should be laid only over what it can answer for.
  if (held === undefined) return { merged: Buffer.from(fresh), cases: last, last, announced };

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
    const lands = before === undefined ? undefined : landing(recorded, before, files.sameText?.(file) === true);
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

  const unlined: string[] = [];
  const before = cut === undefined ? undefined : beforeRun(cut, new Set([...files.ran, ...run.tests.map((test) => test.file)]), (module) => {
    const recorded = runModules.get(module.file);
    const same = (files.base === undefined ? files.sameText : files.sameBeforeText)?.(module.file);
    if (recorded === undefined || same !== true) return module;
    const lined = relined(module, recorded);
    if (lined === undefined) unlined.push(module.file);
    return lined ?? module;
  });
  return {
    merged: encodeSetExecutionIndex({ tests, modules, sets: merged.pool() }),
    cases: tests.map((test) => test.id),
    last,
    announced,
    ...(before === undefined ? {} : { before }),
    ...(unlined.length === 0 ? {} : { unlined }),
  };
}

/**
 * `held` at the lines `recorded` stands its regions on, when the two are named
 * at one text; `undefined` when `held` was cut at another text and cannot be
 * carried onto this one.
 *
 * Each held region is read at the recorded region of its address. When every
 * line agrees, `held` was cut at the text it is named at and comes back as it
 * was, whatever regions one cut holds and the other lacks. When a line does
 * not, `held` was cut at an older text, and its regions take the recorded
 * lines only where the two texts numbered alike ({@link sameNumbering}), the
 * rule the snapshot re-cut its rows to the newer text by. Then a held region
 * the recorded cut has no address for is left out: no line of the newer text
 * holds it, and kept at a line of the older one it would pair with whatever
 * region stands there now.
 */
function relined(held: SetExecutionModule, recorded: SetExecutionModule): SetExecutionModule | undefined {
  const lands = landing(recorded, held, true);
  const to = new Map<number, number>();
  for (const [block, from] of lands.entries()) if (from >= 0) to.set(from, block);
  const moved = [...to].some(([from, block]) =>
    held.blocks[from]!.startLine !== recorded.blocks[block]!.startLine ||
    held.blocks[from]!.endLine !== recorded.blocks[block]!.endLine);
  if (!moved) return held;
  if (!sameNumbering(held.blocks, recorded.blocks)) return undefined;
  const kept = [...to.keys()].sort((left, right) => left - right);
  return {
    file: held.file,
    blocks: kept.map((from) => ({
      ...held.blocks[from]!,
      startLine: recorded.blocks[to.get(from)!]!.startLine,
      endLine: recorded.blocks[to.get(from)!]!.endLine,
    })),
    called: Uint32Array.from(kept, (from) => held.called[from]!),
    loaded: Uint8Array.from(kept, (from) => held.loaded[from]!),
  };
}

/**
 * What the runs at one commit retired, as one before: `retired` laid over
 * `kept`, which the earlier runs at that commit left.
 *
 * A suite run in several invocations retires each invocation's files in turn.
 * Written alone, the second invocation's before would replace the first's, and
 * a review of a pull request would compare only the last invocation's files
 * with the base. A file this run ran again keeps what it retired this time,
 * which is the run before it, as a re-run in the edit loop wants.
 */
export function layerBefore(
  kept: Uint8Array | undefined,
  retired: Uint8Array | undefined,
  ran: ReadonlySet<string>,
): Buffer | undefined {
  if (kept === undefined) return retired === undefined ? undefined : Buffer.from(retired);
  if (retired === undefined) return Buffer.from(kept);
  // A deleted test file stays: its cases are what the base had, and that is
  // what a comparison with the base reports as gone.
  return layerCaseIndex(kept, retired, { ran, finished: ran, present: () => true }).merged;
}

/**
 * The held index cut to the cases of the files a run announced.
 *
 * Regions keep the shape they were recorded with, and no region says it ran
 * while its module loaded: that flag belongs to every file that imported the
 * module, not to these cases, and a comparison of what these cases entered must
 * not read it as theirs.
 */
function beforeRun(
  held: OpenedSetExecutionIndex,
  ran: ReadonlySet<string>,
  lines: (module: SetExecutionModule) => SetExecutionModule,
): Buffer {
  const tests = held.tests.filter((test) => ran.has(test.file));
  const at = new Map(tests.map((test, index) => [test.id, index]));
  const cut = new Translation(tests.length);
  const from = cut.from(held.sets, held.tests.map((test) => (ran.has(test.file) ? at.get(test.id)! : -1)));
  const modules: SetExecutionModule[] = [];
  for (const module of held.modules.map(lines)) {
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

/**
 * For each region recorded now, the held region its cases carry from, or -1.
 *
 * An address is half a seat among siblings: a function written in front of an
 * anonymous one takes the seat it held. Where the two cuts filled a counter
 * differently over different text, an address names another region, and every
 * region is -1. Over the same text the seats are the text's: a run that read a
 * file through its source and its build keeps only the regions both cut alike,
 * so one cut can lack a region the other holds and still number the rest the
 * same.
 */
function landing(recorded: SetExecutionModule, before: SetExecutionModule, sameText: boolean): Int32Array {
  if (!sameText && !sameNumbering(before.blocks, recorded.blocks)) return new Int32Array(recorded.blocks.length).fill(-1);
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
