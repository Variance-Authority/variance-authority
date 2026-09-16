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
import { decodeTestCoverage } from './format.js';
import type { CoverageBlock, CoverageModule, CoverageTest, TestCoverage } from './index.js';
import { codeUnitOrder } from './instrumented-modules.js';
import {
  addressed,
  crossedBlock,
  crossingsAround,
  lostCrossings,
  recutRows,
  reusableBlock,
  sameNumbering,
  withoutRetired,
} from './merge-carry.js';

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
 *
 * Unknown winning has to *retire* the evidence it wins over rather than merely
 * delete it. Those crossings were some test's whole observation of the module,
 * and a test left whole with nothing recorded against a module it entered is out
 * of `entered` at the next diff of that file and in the caller's skip list —
 * exactly the narrowing the paragraph above refuses, arriving through the tests
 * instead of through the row. Leaving the module unread does not answer for it:
 * the recorder that could not instrument a module declares it as a precondition
 * of every subject that entered it, and a name some test declares is a name no
 * reader is ever told went unmeasured, so the one channel the widening would
 * have come out of is shut by the same shard that opened the question. Every
 * test whose crossings are cleared here is demoted to incomplete instead, the
 * way {@link mergeCoverage} demotes a carried test that loses one. It runs at
 * the next selection whatever changed, and that run records it whole again.
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

  /** Tests whose crossings an uninstrumented row wiped, and which no longer stand whole. */
  const demoted = new Set<string>();
  const modules = new Map<string, {
    module: CoverageModule;
    path: string;
    entered: Map<number, Set<string>>;
    loaded: Map<number, Set<string>>;
  }>();
  for (const shard of shards) {
    for (const module of shard.coverage.modules) {
      const seen = modules.get(module.file);
      if (seen === undefined) {
        modules.set(module.file, {
          module,
          path: shard.path,
          entered: new Map(module.blocks.map((block) => [block.ordinal, new Set(block.testFiles)])),
          loaded: new Map(module.blocks.map((block) => [block.ordinal, new Set(block.loadedBy)])),
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
        for (const crossings of seen.entered.values()) for (const test of crossings) demoted.add(test);
        for (const early of seen.loaded.values()) for (const test of early) demoted.add(test);
        seen.entered.clear();
        seen.loaded.clear();
        continue;
      }
      if (!seen.module.instrumented) {
        // The same erasure from the other side, so the same demotion: this
        // shard's blocks are the ones being dropped, and both branches have to
        // retire the same tests or the fold's answer would depend on which
        // shard was read first.
        for (const block of module.blocks) {
          for (const test of block.testFiles) demoted.add(test);
          for (const test of block.loadedBy ?? []) demoted.add(test);
        }
        continue;
      }
      for (const block of module.blocks) {
        const crossings = seen.entered.get(block.ordinal) ?? new Set<string>();
        for (const test of block.testFiles) crossings.add(test);
        seen.entered.set(block.ordinal, crossings);
        const early = seen.loaded.get(block.ordinal) ?? new Set<string>();
        for (const test of block.loadedBy ?? []) early.add(test);
        seen.loaded.set(block.ordinal, early);
      }
    }
  }

  return {
    version: 3,
    instrumentation: first.coverage.instrumentation,
    ...(first.coverage.commit === undefined ? {} : { commit: first.coverage.commit }),
    tests: [...tests.values()]
      .map(({ test }) => (demoted.has(test.file) ? { ...test, complete: false } : test))
      .sort((left, right) => codeUnitOrder(left.file, right.file)),
    modules: [...modules.values()]
      .map(({ module, entered, loaded }): CoverageModule => ({
        file: module.file,
        sourceDigest: module.sourceDigest,
        instrumented: module.instrumented,
        blocks: module.blocks.map((block) =>
          crossedBlock(block, entered.get(block.ordinal) ?? [], loaded.get(block.ordinal) ?? []),
        ),
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
  // Both sides are indexed before the walk rather than searched inside it. The
  // merge is the read-modify-write at the end of every run, so a scan nested in
  // a scan here is M_prev · M_cur — four times ten to the tenth at two hundred
  // thousand modules a side, which is not a constant factor a faster language
  // recovers.
  //
  // A path is indexed to *all* of its previous rows, not the first of them. One
  // build reading a path is one row; two builds reading it — a second
  // environment, a second transform — are two, each with its own text and its
  // own crossings, and a run that re-recorded one of the builds observed
  // nothing at all about the other. So each re-recorded row claims the previous
  // row of its own build, matched by the text it was built from and otherwise
  // the next unclaimed row of the path, which is that path's one row in the
  // ordinary case. What nobody claims is carried below. Keeping the first row
  // alone dropped every other row's crossings while the demotion that answers
  // for a lost crossing read only the row that was kept, which leaves a test
  // whole with nothing recorded against the module it entered — out of
  // `entered` at the next diff of that file, and in the caller's skip list.
  const previousFiles = new Map<string, CoverageModule[]>();
  for (const module of previous.modules) {
    const rows = previousFiles.get(module.file);
    if (rows === undefined) previousFiles.set(module.file, [module]);
    else rows.push(module);
  }
  const claimed = new Set<CoverageModule>();
  const claim = (module: CoverageModule): CoverageModule | undefined => {
    const free = (previousFiles.get(module.file) ?? []).filter((row) => !claimed.has(row));
    const row = free.find((candidate) => candidate.sourceDigest === module.sourceDigest) ?? free[0];
    if (row !== undefined) claimed.add(row);
    return row;
  };
  const stale = new Set<string>();
  const modules = current.modules.map((module): CoverageModule => {
    const old = claim(module);
    const at = new Map(addressed(module.blocks));
    const surviving = new Map<CoverageBlock, CoverageBlock>();
    // Half of an address is the seat a region took among its siblings, so two
    // cuts that filled a counter differently do not name the same regions by
    // the same addresses — {@link sameNumbering}. A branch written in front of
    // the recorded one takes the address the recorded one had, over text it
    // never covered, and the kinds match because a branch replaced a branch, so
    // every row finds somewhere to go and nothing is demoted for the slide.
    // Across a module that renumbered nothing is carried: every previous row
    // reads as unmatched, which demotes the tests on it. Same text is the same
    // numbering, so the seats are counted only where the digests differ.
    const placeable = old !== undefined &&
      (old.sourceDigest === module.sourceDigest || sameNumbering(old.blocks, module.blocks));
    for (const [address, before] of addressed(old?.blocks ?? [])) {
      const block = at.get(address);
      if (placeable && block !== undefined && module.instrumented && old!.instrumented &&
        reusableBlock(block, before)) {
        surviving.set(block, before);
        continue;
      }
      for (const test of before.testFiles) if (!currentTests.has(test)) stale.add(test);
    }
    const kept = (test: string): boolean => !retired.has(test);
    // A region this run cut that the previous rows never held is not a region
    // nobody entered; it is one nobody has been asked about. It reads its
    // carried crossings off the region around it — see `crossingsAround`.
    const around = crossingsAround(module.blocks, (block) => {
      const before = surviving.get(block);
      if (before === undefined) return undefined;
      return {
        testFiles: before.testFiles.filter(kept),
        loadedBy: (before.loadedBy ?? []).filter(kept),
      };
    });
    return {
      file: module.file,
      sourceDigest: module.sourceDigest,
      instrumented: module.instrumented,
      blocks: module.blocks.map((block) => {
        const before = around(block);
        return crossedBlock(
          block,
          [...before.testFiles, ...block.testFiles],
          [...before.loadedBy, ...(block.loadedBy ?? [])],
        );
      }),
    };
  });
  const carried: CoverageModule[] = [];
  for (const module of previous.modules) {
    // A row a re-recorded row claimed has been folded into it. Every other row
    // is a module this run did not re-record — whether or not some other build
    // of the same path was — and is carried with the crossings it holds.
    if (claimed.has(module)) continue;
    const now = onDisk.get(module.file);
    // A module named {@link UNREADABLE} is mislaid on the ground `recutRows`
    // mislays one whose text will not parse: there is no text here to place the
    // rows in. An uninstrumented row is left alone either way — it says this
    // build never measured the module, and nothing on disk answers that.
    const recut = now === undefined || !module.instrumented
      ? undefined
      : now === UNREADABLE
        ? ('mislaid' as const)
        : recutRows(module, now, current.instrumentation);
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
 * snapshots. A file that is not there is not named, and is carried as it was;
 * one that is there and would not open is named {@link UNREADABLE}.
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
      } catch (error) {
        // Nothing at the path says the rows are about a file that is gone, and
        // the module is carried as it was. A path that is there and would not
        // open says something else: this process does not know whether the text
        // moved, and carrying the rows on the strength of not having looked
        // leaves ranges cut from text that may be gone, with no crossing lost
        // and so no test demoted for them. That is ordinary at this scale —
        // {@link AT_ONCE} descriptors times however many workers merge at once,
        // a build rewriting the file under the read, a permission that slipped
        // — and each is momentary, so it costs one module's tests one run.
        if (missing(error)) continue;
        sources.set(module.file, UNREADABLE);
        continue;
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

/** A path nothing is at, as against one that is there and would not open. */
function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * What {@link readSources} names a module whose text it could not read at all,
 * as against read and found moved.
 *
 * The map is texts, and for this module there is none to put in it. A merge that
 * meets it carries nothing and demotes every test that entered the module, which
 * is what {@link recutRows} answers `mislaid` for and on the same ground: the
 * rows are ranges in text nobody has here, and a reader not told so narrows on
 * coordinates that may be wrong. A file whose whole content is this string is
 * mislaid too, at the cost of one run to one module's tests.
 */
export const UNREADABLE = '\0unreadable';

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
