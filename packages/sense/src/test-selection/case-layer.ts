import type { SetId } from './crossing-sets.js';
import { openSetExecutionIndex, type OpenedSetExecutionIndex, type SetExecutionModule } from './execution-set-format.js';
import { HeldIndex, writeLaid, type CarriedModule, type LaidModule, type LaidTest } from './held-case-index.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { addressKey, sameNumbering } from './merge-carry.js';
import type { ExecutionTest } from './reverse.js';
import { EMPTY, Translation } from './set-translation.js';

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
   * that text, the before layer is cut at the lines it recorded. With `base`,
   * "the run" is this one or a shard of the landing laid before it, whose
   * lines the index this run is laid over holds. Asked only
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
  /**
   * The id of every case `merged` holds, in its order, read when asked: a
   * carried case is not decoded for a landing that never asks.
   */
  readonly cases: () => readonly string[];
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
 * hold. Nor is a carried string decoded: a carried case or region is its ids,
 * copied as the bytes they name (see {@link HeldIndex}). What is decoded is
 * what the run touched, and each held test file once, to ask whether the
 * checkout still holds it.
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
  const held = HeldIndex.open(previous);
  const cut = files.base === undefined ? held : HeldIndex.open(files.base);
  // FIXME: no index is read as no other cases, and a landing that removed the
  // index leaves exactly that. The next local run then writes its own files'
  // cases alone, and that partial index stands for the whole suite beside a
  // snapshot that still holds every file — the state `seedTestCoverage` keeps a
  // worktree's first run out of. An index that is absent beside a snapshot that
  // is not should be laid only over what it can answer for.
  if (held === undefined) return { merged: Buffer.from(fresh), cases: () => last, last, announced };

  const { tests, fromHeld, fromRun, merged } = layeredCases(held, run, files);
  const runModules = new Map(run.modules.map((module) => [module.file, module]));
  const modules: LaidModule[] = [];
  for (const { row, recorded } of moduleUnion(held, runModules)) {
    if (recorded === undefined) {
      const kept = carriedRow(held, row!, fromHeld, false);
      if (kept !== undefined) modules.push(kept);
      continue;
    }
    const before = row === undefined ? undefined : held.module(row);
    // A name that says same text over lines an older text numbered apart is
    // the snapshot's, not the index's: those cases land where the numbering agrees.
    const file = recorded.file;
    const same = files.sameText?.(file) === true && before !== undefined && relined(before, recorded) !== undefined;
    const lands = before === undefined ? undefined : landing(recorded, before, same);
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
  const recordedRows = cut === undefined ? undefined : recordedIn(cut, runModules);
  const before = cut === undefined ? undefined : beforeRun(cut, new Set([...files.ran, ...run.tests.map((test) => test.file)]), (row) => {
    const named = cut.columns.moduleFile[row]!;
    // A landing's earlier shard may have recorded what this one did not; the
    // index it laid, the one this run is laid over, stands at those lines.
    const recorded = recordedRows!.get(named) ??
      (files.base === undefined ? undefined : heldModule(held, cut.string(named)));
    if (recorded === undefined) return undefined;
    const same = (files.base === undefined ? files.sameText : files.sameBeforeText)?.(recorded.file);
    if (same !== true) return undefined;
    const module = cut.module(row);
    const lined = relined(module, recorded);
    if (lined === undefined || (lined === module && strayed(module, recorded))) unlined.push(recorded.file);
    return lined ?? module;
  });
  return {
    merged: writeLaid(held, tests.map((test) => test.laid), modules, merged.pool()),
    cases: () => tests.map((test) => (typeof test.laid === 'number' ? held.string(held.columns.testId[test.laid]!) : test.laid.id)),
    last,
    announced,
    ...(before === undefined ? {} : { before }),
    ...(unlined.length === 0 ? {} : { unlined }),
  };
}

/** A case of the output, with the keys it is ordered by: see {@link HeldIndex.key}. */
interface KeyedCase {
  readonly laid: LaidTest;
  readonly file: number;
  readonly name: number;
  readonly id: number;
}

/**
 * The output's cases in their order, and the translation of both indexes'
 * sets onto them. A held case is read as its ids: only its file is decoded,
 * once a file, to ask whether the run retired it.
 */
function layeredCases(held: HeldIndex, run: OpenedSetExecutionIndex, files: CaseRunFiles): {
  readonly tests: readonly KeyedCase[];
  readonly merged: Translation;
  readonly fromHeld: (set: SetId) => SetId;
  readonly fromRun: (set: SetId) => SetId;
} {
  const { testId, testFile, testName } = held.columns;
  const goneFiles = new Map<number, boolean>();
  const gone = (row: number): boolean => {
    let found = goneFiles.get(testFile[row]!);
    if (found === undefined) {
      const file = held.string(testFile[row]!);
      found = files.finished.has(file) || !files.present(file);
      goneFiles.set(testFile[row]!, found);
    }
    return found;
  };
  const byId = new Map<number, number>();
  for (let row = 0; row < testId.length; row += 1) if (!gone(row)) byId.set(testId[row]!, row);
  // A case that ran again says how it settled this time.
  const runById = new Map<string, KeyedCase>();
  for (const test of run.tests) {
    const id = held.key(test.id);
    if (id % 2 === 1) byId.delete((id - 1) / 2);
    runById.set(test.id, { laid: test, file: held.key(test.file), name: held.key(test.name), id });
  }
  const tests = [
    ...Array.from(byId.values(), (row): KeyedCase =>
      ({ laid: row, file: 2 * testFile[row]! + 1, name: 2 * testName[row]! + 1, id: 2 * testId[row]! + 1 })),
    ...runById.values(),
  ].sort(caseOrder);
  const heldAt = new Map<number, number>();
  const runAt = new Map<string, number>();
  for (const [at, test] of tests.entries()) {
    if (test.id % 2 === 1) heldAt.set((test.id - 1) / 2, at);
    if (typeof test.laid !== 'number') runAt.set(test.laid.id, at);
  }

  const merged = new Translation(tests.length);
  const fromHeld = merged.from(held.columns.sets, Int32Array.from(testId, (id, row) => (gone(row) ? -1 : heldAt.get(id)!)));
  const fromRun = merged.from(run.sets, run.tests.map((test) => runAt.get(test.id)!));
  return { tests, merged, fromHeld, fromRun };
}

/**
 * The output's modules in code-unit order of path: each held row the run did
 * not record, and each module the run recorded with the held row of its path.
 */
function moduleUnion(
  held: HeldIndex,
  runModules: ReadonlyMap<string, SetExecutionModule>,
): { readonly row?: number; readonly recorded?: SetExecutionModule }[] {
  const recorded = [...runModules.values()]
    .map((module) => ({ module, key: held.key(module.file) }))
    .sort((left, right) => left.key - right.key || codeUnitOrder(left.module.file, right.module.file));
  const rows = held.moduleRows();
  const union: { row?: number; recorded?: SetExecutionModule }[] = [];
  let next = 0;
  for (const row of rows) {
    const key = 2 * held.columns.moduleFile[row]! + 1;
    while (next < recorded.length && recorded[next]!.key < key) {
      union.push({ recorded: recorded[next]!.module });
      next += 1;
    }
    if (next < recorded.length && recorded[next]!.key === key) {
      union.push({ row, recorded: recorded[next]!.module });
      next += 1;
      continue;
    }
    union.push({ row });
  }
  for (; next < recorded.length; next += 1) union.push({ recorded: recorded[next]!.module });
  return union;
}

/** The held module named `file`, as an object, when the index holds one. */
function heldModule(held: HeldIndex, file: string): SetExecutionModule | undefined {
  const key = held.key(file);
  const row = key % 2 === 1 ? held.moduleOf((key - 1) / 2) : undefined;
  return row === undefined ? undefined : held.module(row);
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
// FIXME: regions told apart only by occurrence carry no seat for
// `sameNumbering` to compare, so a sibling taken out in front of them and
// another written behind keep their count and re-line each one onto its
// neighbour without a signal — the limit the snapshot's
// re-cut has. The index carrying the text each module was recorded from would
// let a reader leave such a module uncompared instead.
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
 * not read it as theirs. `lines` gives a module read at other lines, or nothing
 * for one carried as it is stored.
 */
function beforeRun(
  held: HeldIndex,
  ran: ReadonlySet<string>,
  lines: (row: number) => SetExecutionModule | undefined,
): Buffer {
  const { testId, testFile, moduleFile } = held.columns;
  const ranFiles = new Set<number>();
  for (const file of ran) {
    const key = held.key(file);
    if (key % 2 === 1) ranFiles.add((key - 1) / 2);
  }
  const tests: number[] = [];
  for (let row = 0; row < testId.length; row += 1) if (ranFiles.has(testFile[row]!)) tests.push(row);
  const at = new Map(tests.map((row, index) => [testId[row]!, index]));
  const cut = new Translation(tests.length);
  const from = cut.from(held.columns.sets, Int32Array.from(testId, (id, row) => (ranFiles.has(testFile[row]!) ? at.get(id)! : -1)));
  const modules: { readonly file: number; readonly module: LaidModule }[] = [];
  for (let row = 0; row < moduleFile.length; row += 1) {
    const lined = lines(row);
    const kept = lined === undefined
      ? carriedRow(held, row, from, true)
      : carried({ ...lined, loaded: new Uint8Array(lined.blocks.length) }, from);
    if (kept !== undefined) modules.push({ file: moduleFile[row]!, module: kept });
  }
  modules.sort((left, right) => left.file - right.file);
  return writeLaid(held, tests, modules.map(({ module }) => module), cut.pool());
}

/** A held row read at the regions it was stored with, or nothing when no case is left in it; `unloaded` clears its load flags. */
function carriedRow(held: HeldIndex, row: number, from: (set: SetId) => SetId, unloaded: boolean): CarriedModule | undefined {
  const { moduleBlocks, blockCalled, blockLoaded } = held.columns;
  const [first, last] = [moduleBlocks[row]!, moduleBlocks[row + 1]!];
  const called = new Uint32Array(last - first);
  for (let block = first; block < last; block += 1) called[block - first] = from(blockCalled[block]!);
  const loaded = unloaded ? new Uint8Array(last - first) : blockLoaded.subarray(first, last);
  for (let block = 0; block < called.length; block += 1) {
    if (called[block] !== EMPTY || loaded[block] === 1) return { row, called, loaded };
  }
  return undefined;
}

/** A module object read at the regions it was recorded with, or nothing when no case is left in it. */
function carried(module: SetExecutionModule, from: (set: SetId) => SetId): SetExecutionModule | undefined {
  const called = module.called.map(from);
  let entered = false;
  for (let block = 0; block < called.length; block += 1) {
    if (called[block] !== EMPTY || module.loaded[block] === 1) entered = true;
  }
  return entered ? { ...module, called } : undefined;
}

/** The modules a run recorded, by the id of their path in `held`; one `held` lacks is none of its rows. */
function recordedIn(held: HeldIndex, runModules: ReadonlyMap<string, SetExecutionModule>): ReadonlyMap<number, SetExecutionModule> {
  const found = new Map<number, SetExecutionModule>();
  for (const module of runModules.values()) {
    const key = held.key(module.file);
    if (key % 2 === 1) found.set((key - 1) / 2, module);
  }
  return found;
}

/**
 * For each region recorded now, the held region its cases carry from, or -1.
 *
 * An address is half a seat among siblings: a function written in front of an
 * anonymous one takes the seat it held. Where the two cuts filled a counter
 * differently over different text, an address names another region, and every
 * region is -1. Over the same text the seats are the text's: a run that read a
 * file through its source and its build keeps only the regions both cut alike,
 * so one cut can lack a region the other holds. A seat it lacks among regions
 * told apart only by occurrence moves every later sibling down one, so where
 * the two cuts of one text hold an address a different number of times, a
 * region lands only on the held one at its own lines, and the rest are absent
 * from the other cut rather than its neighbours.
 */
function landing(recorded: SetExecutionModule, before: SetExecutionModule, sameText: boolean): Int32Array {
  // A layer asks one pair this up to four times: whether its text is the same,
  // where its cases land, and twice again for the before layer.
  const memo = landed[sameText ? 1 : 0];
  const known = memo.get(recorded)?.get(before);
  if (known !== undefined) return known;
  const found = landingOf(recorded, before, sameText);
  if (!memo.has(recorded)) memo.set(recorded, new WeakMap());
  memo.get(recorded)!.set(before, found);
  return found;
}

/** {@link landing} by the text the pair was named at: `[other, same]`. Modules are read-only, so an answer stands while both do. */
const landed = [
  new WeakMap<SetExecutionModule, WeakMap<SetExecutionModule, Int32Array>>(),
  new WeakMap<SetExecutionModule, WeakMap<SetExecutionModule, Int32Array>>(),
] as const;

function landingOf(recorded: SetExecutionModule, before: SetExecutionModule, sameText: boolean): Int32Array {
  if (!sameText && !sameNumbering(before.blocks, recorded.blocks)) return new Int32Array(recorded.blocks.length).fill(-1);
  const [heldCount, recordedCount] = [addressCounts(before.blocks), addressCounts(recorded.blocks)];
  const seen = new Map<string, number>();
  // Lines are a seat only over one text; two callbacks on one line still part by order.
  const keyOf = (block: Region): string => {
    const key = address(block);
    const byOrder = !sameText || heldCount.get(key) === recordedCount.get(key);
    return addressKey(byOrder ? key : `${key}\0@${block.startLine}-${block.endLine}`, seen);
  };
  const heldAt = new Map<string, number>();
  for (const [at, block] of before.blocks.entries()) heldAt.set(keyOf(block), at);
  seen.clear();
  return Int32Array.from(recorded.blocks, (block) => {
    const at = heldAt.get(keyOf(block));
    return at !== undefined && before.blocks[at]!.kind === block.kind ? at : -1;
  });
}

type Region = SetExecutionModule['blocks'][number];

function address(block: Region): string {
  return `${block.name}\0${block.path}`;
}

function addressCounts(blocks: readonly Region[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of blocks) counts.set(address(block), (counts.get(address(block)) ?? 0) + 1);
  return counts;
}

/**
 * Whether a held region went unmatched among siblings the two cuts hold a
 * different number of times: its cut lacked one the run recorded, or the text
 * changed under a name that says it did not, and nothing tells which.
 */
function strayed(held: SetExecutionModule, recorded: SetExecutionModule): boolean {
  const matched = new Set(landing(recorded, held, true));
  const [heldCount, recordedCount] = [addressCounts(held.blocks), addressCounts(recorded.blocks)];
  return held.blocks.some((block, at) =>
    !matched.has(at) && recordedCount.has(address(block)) && heldCount.get(address(block)) !== recordedCount.get(address(block)));
}

function caseOrder(left: KeyedCase, right: KeyedCase): number {
  for (const field of ['file', 'name', 'id'] as const) {
    // Equal even keys are two strings the held index lacks, both of the run's cases.
    const order = left[field] - right[field] ||
      (left[field] % 2 === 0 ? codeUnitOrder((left.laid as ExecutionTest)[field], (right.laid as ExecutionTest)[field]) : 0);
    if (order !== 0) return order;
  }
  return 0;
}
