/**
 * `@variance-authority/sense/test-selection` — the same instrument, scoped to one
 * test case.
 *
 * The file-level seam next door ([`vitest.ts`](./vitest.ts)) answers *which files
 * must run*, which is the question CI asks. A local loop and a coding agent ask a
 * narrower one: a branch changed in a module two test files reach, and of the two
 * hundred cases in them five walked that branch. A file-level record cannot say
 * which five — it holds one crossing set per file, so the two hundred cases
 * collapse into a flat line and the answer to *who entered this region* is a
 * number that means nothing.
 *
 * ## Why this is not a drain in `afterEach`
 *
 * The obvious shape is snapshot-and-subtract: copy the counters before each case,
 * copy them after, and call the difference that case's reach. It is wrong twice.
 *
 * It is wrong *by cost*: a snapshot is a copy of every counter the file's closure
 * owns, taken twice per case. A test file whose closure is forty thousand modules
 * copies tens of megabytes per case, for a suite that has hundreds of cases per
 * file — work proportional to the closure, charged per case, when the crossings a
 * case actually makes are a thousandth of it.
 *
 * It is wrong *by correctness*, and that is the half that cannot be tuned away.
 * Both halves of the failure are measured, not supposed —
 * [`cases.concurrency.test.ts`](./cases.concurrency.test.ts) runs the two
 * strategies over one interleaving and prints what each attributed.
 *
 * *Contamination.* `test.concurrent` and `describe.concurrent` dispatch a group
 * through `Promise.all`, so every case's probes fire inside every other case's
 * bracket. A difference therefore holds the union of whatever else was in flight:
 * of two cases entering one branch each, the subtract strategy credits the outer
 * case with both. A concurrent group collapses back into exactly the flat line
 * per-case recording exists to break.
 *
 * *Loss.* A continuation that settles after its case's `afterEach` — a floating
 * promise, a timer, a streamed response — is outside every bracket by then. Its
 * crossings are charged to whichever case happens to be open, and to no case at
 * all when none is. That direction is the one
 * [`selecting.md`](../../../../docs/selecting.md) forbids: a case credited with
 * less than it reached is a case a change can skip.
 *
 * This is the wall [ADR-0056](../../../../docs/context/adr/0056-a-journey-is-the-places-visited.md)
 * already hit — *a bracket that opens at entry and closes at exit closes around
 * somebody else's work* — and the same wall
 * [`journey.ts`](./journey.ts) climbed for services, whose answer is reused here
 * unchanged: **the scope is logical, not temporal**. In Node that means async
 * context.
 *
 * ## The mechanism is the one the probe already has
 *
 * The emitted probe re-resolves its counter array whenever the factory it holds
 * changes identity ([`instrument`](../instrument/index.ts)). So the factory is
 * minted one per case and handed out by a resolver on `globalThis.__VA__.s`. A
 * case's probes write into that case's arrays; nothing else changes, no bracket
 * is maintained, and nothing is added to what a region records. This refines
 * *who owns a crossing*, and ADR-0056 forecloses order, counts, spans, stacks
 * and depth — not owners.
 *
 * The resolver hangs off the factory rather than replacing `__VA__` with an
 * accessor, which is what this was first built as. That accessor was half the
 * axis's cost: **12.6 ns** a probe hit against **1.3 ns** for the flat probe
 * over a data property, and **6.3 ns** once the scope moved one level in and
 * the store began holding the factory rather than a key to look one up by.
 *
 * ## What the resolver reads, and why it is usually a variable
 *
 * A suite runs its cases one at a time. While that holds, *the case running
 * now* is a variable: `enter` assigns it, the body settling restores it, and
 * the resolver is a closure read. That is **1.6 ns**, a fifth over the flat
 * probe's 1.3 and the shape almost every suite gets; on top of it the axis pays
 * for a counter set per case and a re-resolve at each case boundary, which is
 * **6.1%** more time inside the tests over zod's suite against the same run
 * recorded per file, and **3.5%** over TanStack Query's.
 *
 * It holds until a case's work outlives the case. A test that is synchronous to
 * the runner and asynchronous underneath returns before its work does; two
 * cases open at once is the same fault seen from the other end. The variable
 * cannot hold two, so a second `enter` while one is open is an error naming
 * both, and a continuation that arrives after its case closed is charged to the
 * ambient bucket, which every case in the file is given — over-inclusive, which
 * is the direction [`selecting.md`](../../../../docs/selecting.md) permits, and
 * silent.
 *
 * `continuations` is the mode that stops it being silent. The variable becomes
 * an {@link AsyncLocalStorage}: a continuation after an `await` resolves the
 * same store its caller did, two concurrent cases interleaving inside one
 * module each invalidate the other's cached array at exactly the crossings
 * where they meet, and a crossing resolved to a case that has already settled
 * marks that case as one whose work outlived it — which the file prints when it
 * ends. That is **6.3 ns** a crossing, of which 5.5 is
 * `AsyncLocalStorage.getStore()` itself: the price of reading which
 * continuation is running, not of recording anything. It is 4.7 ns a crossing
 * over the variable, which a microbenchmark separates and a suite does not —
 * over zod the crossing count predicts 0.2%, and ten interleaved repetitions
 * cannot resolve that. The reading is in
 * [`instrument`](../instrument/index.ts), which emits the probe that pays it.
 *
 * So the mode is worth turning on to hunt runaway tests, and to record a suite
 * that is deliberately concurrent. The rest of the time the variable is both
 * cheaper and louder.
 *
 * ## What no case owns
 *
 * `beforeAll`, `beforeEach`, `afterEach` and whatever a floating promise does
 * after its case settled run outside any case scope. Their crossings go to the
 * **ambient** bucket and are given to *every* case in the file, which is the
 * over-inclusion [`selecting.md`](../../../../docs/selecting.md) already argues
 * for. A case is never credited with less than it reached; it is sometimes
 * credited with more.
 *
 * Module evaluation is the exception, because it is not a case's work even
 * collectively: a module evaluates once per realm, for whichever case imported
 * it first. A region that ran then is flagged `loaded` and credited to no case,
 * and a reader asks the file graph who imports the module
 * ({@link ExecutionBlock.loaded}).
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ModuleId } from '../instrument/index.js';
import journalFormat from './journal-format.cjs';
import type { CapturedModule } from './instrumented-modules.js';
import { codeUnitOrder, idOrder, isMissing, projectPath } from './instrumented-modules.js';
import type { ExecutionBlock, ExecutionCrossing, ExecutionIndex, ExecutionTest } from './reverse.js';

/**
 * Where the worker half hands the case scope to the runner half.
 *
 * Two modules that never import each other: the setup file installs the
 * collector, the runner enters it, and Vitest loads them through different
 * paths. A symbol on the realm is the one address both can spell.
 */
export const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

/** What a case frame calls the bucket no case owns. */
export const AMBIENT = '';

/**
 * One case's coordinate, packed into the one string a journal frame names itself
 * with.
 *
 * A frame's first field is *who this journal belongs to*. For the file-level seam
 * that is a path; a case is the same fact spelled longer, so the frame format is
 * untouched and the per-case journals cost exactly what the measured varint path
 * already costs. NUL is the separator because it is the one byte a file path
 * and a test name cannot contain.
 *
 * Both writers of a case frame are CommonJS inside somebody else's sandbox, so
 * the pair lives beside the codec and is answered for here.
 */
export const packCase = journalFormat.packCase;

export interface UnpackedCase {
  readonly file: string;
  /** The declaration path the runner reports, or empty for the ambient bucket. */
  readonly name: string;
  /** Unique within the worker; empty for the ambient bucket. */
  readonly id: string;
}

export const unpackCase: (packed: string) => UnpackedCase = journalFormat.unpackCase;

/**
 * Case frames as one file, each behind its own length.
 *
 * A frame must be read to its exact end or it is refused, so frames cannot be
 * concatenated bare. One file per case would be a file per case per worker —
 * hundreds of thousands of them on the suite this is sized for — and a length in
 * front of each costs four bytes to avoid that.
 */
export const packFrames = journalFormat.packFrames;

export const unpackFrames = journalFormat.unpackFrames;

/** One case frame as the reporter reads it back, already joined to its file. */
export interface CaseJournal {
  readonly file: string;
  readonly name: string;
  readonly id: string;
  readonly modules: readonly {
    readonly id: ModuleId;
    readonly hits: readonly number[];
    readonly shared: readonly number[];
  }[];
}

/**
 * Fold case frames and the inventory into the index `coveringTests` reads.
 *
 * The ambient bucket of a file is folded into every case of that file: nothing
 * outside a case scope can be attributed to one, and a case credited with less
 * than it reached is a case a change can skip.
 *
 * Every crossing is recorded at distance zero. ADR-0056 forecloses a recorded
 * depth, and `ExecutionCrossing.distance` exists for a foreign producer that has
 * one; this is not that producer, and a fabricated depth would sort the answer
 * by a number nothing measured.
 */
export function executionIndexFrom(
  journals: readonly CaseJournal[],
  modules: ReadonlyMap<ModuleId, CapturedModule>,
): ExecutionIndex {
  const ambient = new Map<string, CaseJournal[]>();
  // A case is written when it settles, so work that outlived it arrives as a
  // second frame under the same coordinate: one case, joined here.
  const byCase = new Map<string, CaseJournal>();
  for (const journal of journals) {
    if (journal.name === AMBIENT && journal.id === AMBIENT) {
      ambient.set(journal.file, [...(ambient.get(journal.file) ?? []), journal]);
      continue;
    }
    const key = `${journal.file}\0${journal.name}\0${journal.id}`;
    const first = byCase.get(key);
    byCase.set(key, first === undefined ? journal : { ...first, modules: [...first.modules, ...journal.modules] });
  }
  const cases = [...byCase.values()];

  // Ordered before they are numbered, so the index reads the same whichever
  // worker finished first and whichever order the frames landed on disk.
  const ordered = [...cases].sort((left, right) =>
    codeUnitOrder(left.file, right.file) ||
    codeUnitOrder(left.name, right.name) ||
    codeUnitOrder(left.id, right.id),
  );

  // A name is the coordinate, so the identity is the name and not the runner's
  // positional id — which moves when a case is inserted above it. Two cases in
  // one file may share a name; the repeat is numbered, in the order above, so
  // the second is `name#1` rather than indistinguishable.
  const seen = new Map<string, number>();
  const tests: ExecutionTest[] = ordered.map((journal) => {
    const coordinate = `${journal.file} > ${journal.name}`;
    const repeat = seen.get(coordinate) ?? 0;
    seen.set(coordinate, repeat + 1);
    return {
      id: repeat === 0 ? coordinate : `${coordinate}#${repeat}`,
      file: journal.file,
      name: journal.name,
    };
  });

  const crossings = new Map<ModuleId, Map<number, Set<number>>>();
  // What ran while a module evaluated ran for whichever case imported it first,
  // so it is kept as a flag on the region and no case is credited with it: the
  // file graph names every case that loaded the module.
  const loaded = new Map<ModuleId, Set<number>>();
  const record = (module: ModuleId, ordinal: number, test: number): void => {
    const byOrdinal = crossings.get(module) ?? new Map<number, Set<number>>();
    byOrdinal.set(ordinal, (byOrdinal.get(ordinal) ?? new Set<number>()).add(test));
    crossings.set(module, byOrdinal);
  };
  const visit = (module: CaseJournal['modules'][number], test: number): void => {
    const evaluating = new Set(module.shared);
    for (const ordinal of module.hits) {
      if (!evaluating.has(ordinal)) record(module.id, ordinal, test);
      else loaded.set(module.id, (loaded.get(module.id) ?? new Set<number>()).add(ordinal));
    }
  };

  for (const [at, journal] of ordered.entries()) {
    for (const module of journal.modules) visit(module, at);
    for (const shared of ambient.get(journal.file) ?? []) {
      for (const module of shared.modules) visit(module, at);
    }
  }

  const rows = [...modules.entries()]
    .filter(([id]) => crossings.has(id) || loaded.has(id))
    .sort(([left], [right]) => idOrder(left, right));

  return {
    tests,
    modules: rows
      .map(([id, module]) => ({
        file: module.file,
        blocks: module.blocks.map((block): ExecutionBlock => ({
          kind: block.kind,
          name: block.name,
          path: block.path,
          startLine: block.startLine,
          endLine: block.endLine,
          source: block.source,
          ...(loaded.get(id)?.has(block.ordinal) === true ? { loaded: true as const } : {}),
          crossings: [...(crossings.get(id)?.get(block.ordinal) ?? [])]
            .sort((left, right) => left - right)
            .map((test): ExecutionCrossing => ({ test, distance: 0 })),
        })),
      }))
      .sort((left, right) => codeUnitOrder(left.file, right.file)),
  };
}

/** How many test-to-region crossings an index holds: the number that grows. */
export function countCrossings(index: ExecutionIndex): number {
  let total = 0;
  for (const module of index.modules) for (const block of module.blocks) total += block.crossings.length;
  return total;
}

/**
 * The case frames a run left, joined back to the files they belong to.
 *
 * Each `.vac` file is one test file's buckets — the ambient one and a frame per
 * case — and each frame names itself with the packed coordinate. Nothing here
 * decides what a case reached; that is {@link executionIndexFrom}'s job.
 */
export async function readCaseJournals(
  directory: string,
  root: string,
): Promise<readonly CaseJournal[]> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const journals: CaseJournal[] = [];
  for (const name of names) {
    for (const frame of unpackFrames(await readFile(resolve(directory, name)))) {
      const read = journalFormat.decodeJournal(frame);
      const { file, name: caseName, id } = unpackCase(read.testFile);
      journals.push({ file: projectPath(root, file), name: caseName, id, modules: read.modules });
    }
  }
  return journals;
}
