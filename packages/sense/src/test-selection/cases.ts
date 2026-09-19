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
 * The emitted probe re-resolves its counter array whenever `globalThis.__VA__`
 * changes identity ([`instrument`](../instrument/index.ts)). So `__VA__` is
 * defined as a **getter** over an {@link AsyncLocalStorage}, handing back a
 * distinct factory per case. A case's probes write into that case's arrays, a
 * continuation after an `await` resolves the same store its caller did, and two
 * concurrent cases interleaving inside one module each invalidate the other's
 * cached array at exactly the crossings where they meet. No probe changes, no
 * bracket is maintained, and nothing is added to what a region records: this
 * refines *who owns a crossing*, and ADR-0056 forecloses order, counts, spans,
 * stacks and depth — not owners.
 *
 * ## What no case owns
 *
 * Module evaluation, `beforeAll`, `beforeEach`, `afterEach` and whatever a
 * floating promise does after its case settled run outside any case scope. Their
 * crossings go to the **ambient** bucket and are given to *every* case in the
 * file, which is the same over-inclusion
 * [`selecting.md`](../../../../docs/selecting.md) already argues for and the same
 * treatment a shared, module-evaluating region already gets. A case is never
 * credited with less than it reached; it is sometimes credited with more.
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
  const cases: CaseJournal[] = [];
  for (const journal of journals) {
    if (journal.name === AMBIENT && journal.id === AMBIENT) {
      ambient.set(journal.file, [...(ambient.get(journal.file) ?? []), journal]);
    } else cases.push(journal);
  }

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

  interface Held {
    readonly test: number;
    readonly loaded: boolean;
  }
  const crossings = new Map<ModuleId, Map<number, Map<number, Held>>>();
  const record = (module: ModuleId, ordinal: number, test: number, loaded: boolean): void => {
    const byOrdinal = crossings.get(module) ?? new Map<number, Map<number, Held>>();
    const byTest = byOrdinal.get(ordinal) ?? new Map<number, Held>();
    const before = byTest.get(test);
    // A region a case entered on its own is not loaded, whatever the ambient
    // bucket said about it: the weaker claim never overwrites the stronger.
    byTest.set(test, { test, loaded: (before?.loaded ?? true) && loaded });
    byOrdinal.set(ordinal, byTest);
    crossings.set(module, byOrdinal);
  };

  for (const [at, journal] of ordered.entries()) {
    for (const module of journal.modules) {
      const evaluating = new Set(module.shared);
      for (const ordinal of module.hits) record(module.id, ordinal, at, evaluating.has(ordinal));
    }
    for (const shared of ambient.get(journal.file) ?? []) {
      for (const module of shared.modules) {
        const evaluating = new Set(module.shared);
        for (const ordinal of module.hits) record(module.id, ordinal, at, evaluating.has(ordinal));
      }
    }
  }

  const rows = [...modules.entries()]
    .filter(([id]) => crossings.has(id))
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
          crossings: [...(crossings.get(id)?.get(block.ordinal)?.values() ?? [])]
            .sort((left, right) => left.test - right.test)
            .map((held): ExecutionCrossing => ({
              test: held.test,
              distance: 0,
              ...(held.loaded ? { loaded: true } : {}),
            })),
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
