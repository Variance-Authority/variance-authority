/**
 * Merging is where two runs become one index, and where evidence is retired.
 *
 * Split out of the Vitest seam because it was never that seam's: a Storybook
 * build and a Playwright suite merge into the same index by the same rules, and
 * a journal transport reaching them through the runner integration would be
 * importing a runner it does not have.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestString } from '../digest.js';
import { instrument } from '../instrument/index.js';
import { decodeTestCoverage } from './format.js';
import type { CoverageBlock, CoverageModule, CoverageTest, TestCoverage } from './index.js';
import { codeUnitOrder, coverageBlock } from './instrumented-modules.js';

/** One shard's snapshot and where it was read from, so a refusal can name both sides. */
export interface CoverageShard {
  readonly path: string;
  readonly coverage: TestCoverage;
}

/**
 * N shard snapshots of one suite into the snapshot that suite would have written
 * unsharded, or a refusal naming which two disagreed.
 *
 * A suite too large for one machine runs its files across N jobs and ends with N
 * snapshots, each of them a whole observation of its own test files and a partial
 * one of every module they share. `mergeCoverage` is the wrong tool for that:
 * it layers a run *over* a baseline, positions the result where the newer side
 * stands, and retires whatever the newer side re-recorded — an order-dependent
 * answer, which is what a layer is and what a fan-in must not be. The shards were
 * one run. Folding them is a union, and a union has to be the same union in any
 * order.
 *
 * The rule is `mergeReports`'s: **the fold must not be able to say anything a
 * single unsharded run could not.** Every field singular in a run has to agree
 * across the shards or the fold is refused by name — the probe recipe, because
 * two recipes number regions differently and a crossing under one is a fiction
 * under the other; the commit, because the snapshot stands at exactly one place
 * and a shard recorded elsewhere is evidence about different source. *Absent* is
 * a value there, not a skip: a shard recorded outside a checkout cannot say where
 * it stands, and folding it under a commit it never named would.
 *
 * Two more things one run could not contain. A test file recorded by two shards
 * is a split that overlapped, and picking either observation would attribute the
 * other's crossings to nobody; it is refused. And a module the shards saw as
 * different source — same path, different `sourceDigest` — was built twice, and
 * the region ordinals of one do not name the regions of the other.
 *
 * Where the shards agree, unknown wins. A module one shard could not instrument
 * is recorded as unread in the fold even if another shard read it whole, because
 * the row saying *this build never measured this module* is the one a reader
 * widens on, and a fold that let the measured shards outvote it would have turned
 * an unknown into a narrowing.
 */
export function foldTestCoverage(shards: readonly CoverageShard[]): TestCoverage {
  const [first, ...rest] = shards;
  if (first === undefined) throw new Error('folding needs at least one coverage snapshot');
  if (rest.length === 0) return first.coverage;

  agree(shards, 'instrumentation', (shard) => shard.coverage.instrumentation);
  agree(shards, 'commit', (shard) => shard.coverage.commit ?? '(none)');

  const tests = new Map<string, { test: CoverageTest; path: string }>();
  for (const shard of shards) {
    for (const test of shard.coverage.tests) {
      const seen = tests.get(test.file);
      if (seen !== undefined) {
        throw new Error(
          `\`${test.file}\` was recorded by ${seen.path} and again by ${shard.path}. ` +
            'A test file belongs to one shard, and two observations of it cannot both be ' +
            "the suite's.",
        );
      }
      tests.set(test.file, { test, path: shard.path });
    }
  }

  const modules = new Map<string, { module: CoverageModule; path: string; entered: Map<number, Set<string>> }>();
  for (const shard of shards) {
    for (const module of shard.coverage.modules) {
      const seen = modules.get(module.file);
      if (seen === undefined) {
        modules.set(module.file, {
          module,
          path: shard.path,
          entered: new Map(module.blocks.map((block) => [block.ordinal, new Set(block.testFiles)])),
        });
        continue;
      }
      if (seen.module.sourceDigest !== module.sourceDigest) {
        throw new Error(
          `\`${module.file}\` is different source in ${seen.path} and ${shard.path}: ` +
            'the two shards built it from different text, so the regions of one do not ' +
            'name the regions of the other.',
        );
      }
      if (!module.instrumented) {
        seen.module = module;
        seen.entered.clear();
        continue;
      }
      if (!seen.module.instrumented) continue;
      for (const block of module.blocks) {
        const crossings = seen.entered.get(block.ordinal) ?? new Set<string>();
        for (const test of block.testFiles) crossings.add(test);
        seen.entered.set(block.ordinal, crossings);
      }
    }
  }

  return {
    version: 3,
    instrumentation: first.coverage.instrumentation,
    ...(first.coverage.commit === undefined ? {} : { commit: first.coverage.commit }),
    tests: [...tests.values()]
      .map(({ test }) => test)
      .sort((left, right) => codeUnitOrder(left.file, right.file)),
    modules: [...modules.values()]
      .map(({ module, entered }): CoverageModule => ({
        file: module.file,
        sourceDigest: module.sourceDigest,
        instrumented: module.instrumented,
        blocks: module.blocks.map((block) => ({
          ...block,
          testFiles: [...(entered.get(block.ordinal) ?? [])].sort(codeUnitOrder),
        })),
      }))
      .sort((left, right) => codeUnitOrder(left.file, right.file)),
  };
}

function agree(
  shards: readonly CoverageShard[],
  what: string,
  read: (shard: CoverageShard) => string,
): void {
  const [first, ...rest] = shards as readonly [CoverageShard, ...CoverageShard[]];
  const expected = read(first);
  const other = rest.find((shard) => read(shard) !== expected);
  if (other !== undefined) {
    throw new Error(
      `${first.path} and ${other.path} disagree about the ${what} (\`${expected}\` against ` +
        `\`${read(other)}\`), so they are not shards of one run and cannot be folded into one.`,
    );
  }
}

/**
 * Merge independent runs and shards without transferring evidence across generations.
 *
 * The result is positioned where `current` is. A merge whose two sides name
 * different commits is a local layer over a baseline — the ordinary shape, and
 * the reason nothing is refused here: a run adds what it saw to what was already
 * known, and the index then stands at the commit that run was made at. Whether
 * an individual block's crossings survive that is decided per block by
 * {@link reusableBlock}, which asks only whether the region is still there
 * under the address it was recorded at.
 *
 * A crossing that does not survive was somebody's evidence. When the test that
 * made it is in `current` it has been re-recorded — whole, and so retired, or in
 * part, and so already marked as something no reader may skip. When it is not,
 * it is carried from `previous` as a whole observation of a region that no
 * longer exists under that name: a subset run — one file by hand, a watch loop —
 * layered over a full one moves the index to where the subset stands and leaves
 * every other test standing where it was recorded. Dropping the crossing and
 * keeping the test whole would turn *entered this region* into *did not*, and a
 * later diff of the place that region was would skip the one test known to have
 * reached it. So a carried test that loses a crossing here is demoted to
 * incomplete. It runs at the next selection regardless of what changed, and that
 * run records it whole again.
 *
 * A module the run never loaded is carried, and its rows are line ranges in the
 * text the module had when it was recorded. The index moves to where this run
 * stands, and a diff is later taken from there, so a carried module whose text
 * has moved has rows in coordinates no diff will be in. `onDisk` gives that
 * module's text as it is now. Rather than retire the module's evidence for being
 * mislaid, the rows are re-cut from that text — the regions are read out of it
 * again and each crossing is carried onto the region with its address — so a
 * module edited between two runs keeps what is known about the parts of it
 * nobody touched. Only a region the new text no longer has loses its crossings,
 * and only then is a test demoted. A module whose text cannot be read as source,
 * one recorded as not instrumented, and one `onDisk` does not name are each
 * carried as they were.
 */
export function mergeCoverage(
  previous: TestCoverage | undefined,
  current: TestCoverage,
  onDisk: ReadonlyMap<string, string> = new Map(),
): TestCoverage {
  if (previous === undefined) return current;
  if (previous.instrumentation !== current.instrumentation) return current;

  const currentTests = new Map(current.tests.map((test) => [test.file, test]));
  const previousTests = new Map(previous.tests.map((test) => [test.file, test]));
  const retired = new Set(current.tests.flatMap((test) => {
    const before = previousTests.get(test.file);
    return test.complete || (before !== undefined && !samePreconditions(before, test))
      ? [test.file]
      : [];
  }));
  const currentFiles = new Map(current.modules.map((module) => [module.file, module]));
  // Both sides are indexed before the walk rather than searched inside it. The
  // merge is the read-modify-write at the end of every run, so a scan nested in
  // a scan here is M_prev · M_cur — four times ten to the tenth at two hundred
  // thousand modules a side, which is not a constant factor a faster language
  // recovers. First match wins in both, which is what `find` did.
  const previousFiles = first(previous.modules, (module) => module.file);
  const stale = new Set<string>();
  const modules = current.modules.map((module): CoverageModule => {
    const old = previousFiles.get(module.file);
    const at = first(module.blocks, addressOf);
    const surviving = new Map<CoverageBlock, CoverageBlock>();
    for (const before of old?.blocks ?? []) {
      const block = at.get(addressOf(before));
      if (block !== undefined && module.instrumented && old!.instrumented &&
        reusableBlock(block, before)) {
        surviving.set(block, before);
        continue;
      }
      for (const test of before.testFiles) if (!currentTests.has(test)) stale.add(test);
    }
    return {
      file: module.file,
      sourceDigest: module.sourceDigest,
      instrumented: module.instrumented,
      blocks: module.blocks.map((block) => ({
        ...block,
        testFiles: [...new Set([
          ...(surviving.get(block)?.testFiles ?? []).filter((test) => !retired.has(test)),
          ...block.testFiles,
        ])].sort(codeUnitOrder),
      })),
    };
  });
  const carried: CoverageModule[] = [];
  for (const module of previous.modules) {
    if (currentFiles.has(module.file)) continue;
    const now = onDisk.get(module.file);
    const recut = now === undefined ? undefined : recutRows(module, now);
    const lost = recut === 'mislaid'
      ? [...new Set(module.blocks.flatMap((block) => block.testFiles))]
      : recut === undefined ? [] : lostCrossings(module, recut);
    for (const test of lost) if (!currentTests.has(test)) stale.add(test);
    carried.push(recut === undefined || recut === 'mislaid' ? module : recut);
  }
  const tests = [
    ...previous.tests
      .filter((test) => !currentTests.has(test.file))
      .map((test) => (stale.has(test.file) ? { ...test, complete: false } : test)),
    ...current.tests,
  ].sort((left, right) => codeUnitOrder(left.file, right.file));
  for (const module of carried) modules.push(withoutRetired(module, retired));
  modules.sort((left, right) => codeUnitOrder(left.file, right.file));
  return {
    version: 3,
    instrumentation: current.instrumentation,
    ...(current.commit === undefined ? {} : { commit: current.commit }),
    tests,
    modules,
  };
}

/** What a carried module is named by, which is all {@link readSources} reads. */
export interface CarriedModule {
  readonly file: string;
  readonly sourceDigest: string;
}

/**
 * The text {@link mergeCoverage} re-cuts carried rows from: of the modules the
 * caller names, the ones whose text has moved since their rows were cut. This
 * is the whole of the I/O, so the merge itself stays a function of two
 * snapshots. A file that is not there is not named, and is carried as it was.
 *
 * What the map deliberately does not hold is every other module. A run that
 * re-records ten files of two hundred thousand carries the rest, and almost
 * every one of them has the text its rows were cut from; naming it here would
 * hold a repository of source in one process to answer a question the module's
 * own digest answers in sixteen bytes. So each file is read, decided, and let
 * go, and only text a re-cut will actually read is kept.
 *
 * The caller names them rather than handing over a snapshot to be filtered,
 * because the caller that wants this most does not have a decoded snapshot: a
 * layer reads the same three columns off the file it is about to write over,
 * and materializing the model to name them would be the cost the layer exists
 * to avoid.
 *
 * The reads run {@link AT_ONCE} at a time. They are the one unbounded loop in
 * the merge — one iteration per module the index holds — and awaiting them one
 * after another spends the whole of it waiting on a syscall that was never the
 * limit.
 */
export async function readSources(
  root: string,
  carried: readonly CarriedModule[],
): Promise<ReadonlyMap<string, string>> {
  const sources = new Map<string, string>();
  let next = 0;
  const reader = async (): Promise<void> => {
    for (let index = next++; index < carried.length; index = next++) {
      const module = carried[index]!;
      let text: string;
      try {
        text = await readFile(resolve(root, module.file), 'utf8');
      } catch {
        continue; // Not on disk under that name: nothing to re-cut from.
      }
      // Text that has not moved is the text the rows were cut from, so the rows
      // already stand where the next diff will be taken.
      if (digestString(text) !== module.sourceDigest) sources.set(module.file, text);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, carried.length) }, () => reader()),
  );
  return sources;
}

/**
 * Files read at once by {@link readSources}.
 *
 * Enough to keep the disk busy, few enough that the descriptors are a constant
 * rather than a function of how many modules the index holds — a merge that
 * opened one per carried module would run out of them at the scale that makes
 * the merge worth doing.
 */
const AT_ONCE = 32;

/**
 * The index a merge is about to write over, or nothing to merge with.
 *
 * Undecodable counts as nothing. This is the read half of a read-modify-write,
 * and the only two things it can do with a file it cannot parse are refuse the
 * recording or replace it. Refusing means a format change, a truncated write or
 * a half-copied cache file stops every later run from recording anything until
 * somebody deletes it by hand — and it does so *after* taking the index lock,
 * from inside a runner's teardown, where the sentence is easiest to miss.
 * Replacing costs this machine the evidence it could no longer read, which the
 * next full run restores, and which in the meantime widens selection rather than
 * narrowing it.
 *
 * Readers ask the opposite way round. A caller that is about to *exclude* tests
 * gets the decode error, because there the same unreadable file would silently
 * become an empty answer.
 */
export async function existingCoverage(file: string): Promise<TestCoverage | undefined> {
  try {
    return decodeTestCoverage(await readFile(file));
  } catch {
    return undefined;
  }
}

export function samePreconditions(left: CoverageTest, right: CoverageTest): boolean {
  const keys = (test: CoverageTest): ReadonlySet<string> =>
    new Set(test.preconditions.map((input) => `${input.name}\0${input.digest}`));
  const leftKeys = keys(left);
  const rightKeys = keys(right);
  return leftKeys.size === rightKeys.size && [...leftKeys].every((key) => rightKeys.has(key));
}

/**
 * Whether a crossing recorded against the previous region carries to this one.
 *
 * The address carries it: the declaration name path and the structural path
 * inside it, which is where the region is in the module's tree rather than where
 * it is in the module's text. Both sides of this call already share that
 * address; the kind is the one thing left that can differ under it, and a region
 * that changed kind under one address is a different region.
 *
 * What deliberately does not enter: the region's own digest, and anything at all
 * about the regions above it. A digest that moved says the text changed, and the
 * reader that cares about changed text is selection, which charges the region
 * from the diff and runs every test recorded against it — the crossing is what
 * makes that possible, so discarding it here would remove the evidence the
 * change is about to be answered with. Reading the owners as well made any edit
 * to a module's top level — an added declaration, a renamed export, a changed
 * constant — move the root's digest and retire every crossing in the file, which
 * is the whole suite demoted for a function nobody calls yet.
 */
export function reusableBlock(
  current: Pick<CoverageBlock, 'kind'>,
  previous: Pick<CoverageBlock, 'kind'>,
): boolean {
  return current.kind === previous.kind;
}

/**
 * A carried module with retired crossings dropped, and the module itself when
 * it holds none of them.
 *
 * Almost every module in an index is carried. A run re-records the files it
 * loaded and the rest stand exactly as they were, so rebuilding each of them to
 * remove a handful of tests that entered none of their regions rebuilds the
 * whole index to change nothing — at two hundred thousand modules that is the
 * merge's entire cost and the peak the process is sized by. What a run retires
 * is what it re-recorded, which is small and local, so the answer for nearly
 * every module is the object that came in.
 */
export function withoutRetired(module: CoverageModule, retired: ReadonlySet<string>): CoverageModule {
  const holds = (block: CoverageBlock): boolean =>
    block.testFiles.some((test) => retired.has(test));
  if (retired.size === 0 || !module.blocks.some(holds)) return module;
  return {
    ...module,
    blocks: module.blocks.map((block) =>
      holds(block)
        ? { ...block, testFiles: block.testFiles.filter((test) => !retired.has(test)) }
        : block,
    ),
  };
}

/** Name path and structural path together: where a region is in the module's tree. */
export function addressOf(block: CoverageBlock): string {
  return `${block.name}\0${block.path}`;
}

/** Rows by key, the first of a repeated key winning: `Array.prototype.find` as an index. */
function first<T>(rows: readonly T[], keyOf: (row: T) => string): ReadonlyMap<string, T> {
  const found = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!found.has(key)) found.set(key, row);
  }
  return found;
}

/**
 * A carried module's rows, re-cut from the text the module has now.
 *
 * The rows of a module this run did not load are lines of the text it had when
 * it was recorded, and the index is about to move to where this run stands. So
 * the regions are read out of the current text and every crossing is carried
 * onto the region with its address, which leaves the evidence about the parts
 * nobody edited in coordinates the next diff will be in.
 *
 * `undefined` when there is nothing to re-cut: the text is the text the rows
 * were recorded over, or the module was recorded as not instrumented. The second
 * is the one worth naming — that row says this build never measured this module,
 * a reader widens on it, and cutting regions out of the file here would answer
 * it with a table of regions no run ever entered, an unknown turned into a
 * narrowing.
 *
 * `mislaid` when the text moved and cannot be read as source. There is no table
 * to place the crossings in and the rows that are there are ranges in text
 * nobody has, so the module is carried as it was and every test that entered it
 * is demoted: the alternative is an index that answers a diff with regions it
 * has the wrong coordinates for.
 */
export function recutRows(module: CoverageModule, source: string): CoverageModule | 'mislaid' | undefined {
  if (!module.instrumented) return undefined;
  if (digestString(source) === module.sourceDigest) return undefined;
  const fresh = instrument(source, module.file);
  if (fresh === undefined) return 'mislaid';
  const before = new Map(module.blocks.map((block) => [addressOf(block), block]));
  return {
    file: module.file,
    sourceDigest: fresh.sourceDigest,
    instrumented: true,
    blocks: fresh.blocks.map((block) => {
      const row = coverageBlock(source, block);
      const previous = before.get(addressOf(row));
      return previous !== undefined && reusableBlock(row, previous)
        ? { ...row, testFiles: previous.testFiles }
        : row;
    }),
  };
}

/**
 * The tests the re-cut rows have nowhere to put a crossing for.
 *
 * Losing one region is not losing a test. Arrival nests — a test that entered a
 * region entered every region around it, up to the module — so a test whose
 * function was deleted still has its crossing on whatever now spans the place
 * that function was, and a diff there still reaches it. A test is only mislaid
 * when the new text holds no region it is recorded against at all.
 */
export function lostCrossings(before: CoverageModule, after: CoverageModule): readonly string[] {
  const kept = new Set(after.blocks.flatMap((block) => block.testFiles));
  return [...new Set(before.blocks.flatMap((block) => block.testFiles))].filter(
    (test) => !kept.has(test),
  );
}
