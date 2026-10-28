/**
 * Which named tests covered this line.
 *
 * The inverse of [`reach`](./reach-command.ts). That one walks the import graph
 * forward from a diff and answers *what could this change touch*; this one
 * reads a recorded run backwards from one piece of source and answers *what
 * already went there*. One is structure and needs no history; this one is
 * evidence and exists only where a suite has been recorded.
 *
 * The reading is three library calls, and it was three library calls for a
 * while: whoever wanted it wrote a script around `coveringTests`. That is a
 * fine shape for a program and the wrong one for the two readers who ask this
 * question most — a person deciding whether a test still earns its place, and
 * an agent holding a line number it is about to change. Neither wants to author
 * a file to ask one question, and an agent that has to will ask a worse
 * question instead.
 *
 * Execution says where a test went, never why the trip was worth taking. So
 * this prints named tests and stops: nothing here says a test is redundant, and
 * a list of six is the beginning of the question *why do all of these need this
 * code*, not the answer to it.
 *
 * No depth is printed. `ExecutionCrossing.distance` is call-stack depth, which
 * ADR-0056 forecloses recording, so this project's collector writes zero into
 * it everywhere — a column of zeroes beside every witness advertised a reading
 * nothing here has ever produced. What a reader wanted from it is *how far
 * away is this test*, and that is import hops rather than stack frames:
 * `--at-distance 0-3` narrows the list to tests within three imports of the
 * file, and `--in-package` to tests that share its package. Both are measured
 * on demand, off the file graph, in [`covering-reach.ts`](./covering-reach.ts).
 */

import { realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  changedLines,
  coveringChange,
  coveringTestsInFile,
  keepsCases,
  recordedCommit,
  type CoveringChange,
  type CoveringRegion,
  type CoveringTest,
  type ExecutionTest,
  type HeldLines,
  type LineRange,
  type ExecutionIndex,
  type RangeState,
} from '@variance-authority/sense/test-selection';
import { existedAt } from '@variance-authority/sense';
import { OperatorError } from '../exit.js';
import { answerGap, GapRefusal, type EvidenceGap } from './evidence-gap.js';
import { refusalGap } from './refusal-gap.js';
import { readExecutionFor, recordedExecutionFile } from './execution-input.js';
import { cutGap, probesGap, probesNote, type CutGap, type ProbesGap } from './probes-gap.js';
import { hopsToTests, identities, nearbyWitnesses } from './covering-reach.js';
import { coveringFiles, type CoveringFile } from './covering-files.js';
import { addedSince, RecordOlder, unloadedFile, unreadCommit, unreadPreconditions } from './covering-unloaded.js';
import { heldAsPrecondition } from './held-as-precondition.js';
import { motionFor, type CoveringMotion } from './covering-motion.js';
import { scopeCases, type CoveringScope } from './covering-scope.js';
import { listedIn, whereCases, whereOver, type CoveringWhere } from './covering-where.js';
import { staleAnswer } from './covering-stale.js';
import { placeRanges, placementFor, regionState, snapshotFor, type CoveringRange } from './covering-frame.js';
import { diffSince } from './since.js';
import { coveringAt, countOf, loadersOf, type UnrunPart } from './covering-at.js';
import { graphOnce, type Graph } from './gap-selection.js';
import type { CoveringAt, ParsedCovering } from '../covering-args.js';

/**
 * How the answer is written. `text` reads; `refs` names every case once, for an
 * agent that pays per token; `json` is for whatever asks next.
 */
export type CoveringFormat = 'text' | 'refs' | 'json';

export { formatCovering } from './covering-text.js';

/** A changed region, and the one state it is painted as. */
export interface StatedRegion extends CoveringRegion {
  readonly state?: RangeState;
}

/** A changed file, its regions stated. */
export interface StatedChange extends Omit<CoveringChange, 'regions'> {
  readonly regions: readonly StatedRegion[];
}

/** A line, a run of lines, or a recorded function or the scope that holds some. */
export type CoveringTarget =
  | { readonly line: number }
  | { readonly lines: HeldLines }
  | { readonly function: string };

/** What was asked, and what the record said about it. */
export interface Covering {
  /** The file the question named, absent when it named a diff. */
  readonly file?: string;
  /** The ref a diff was taken against, present only under `--since`. */
  readonly since?: string;
  /** Present when the question named a diff: one entry per changed file. */
  readonly changed?: readonly StatedChange[];
  /** The line, run of lines or function the question named, in the text as it is now; absent when it named none. */
  readonly target?: CoveringTarget;
  /**
   * `file` when an edit to every line the answer read charges the module's own
   * region — a line only the module holds, or one that opens or closes a
   * function the module encloses: the record says the module was loaded and
   * nothing finer, so the cases are the ones that loaded the file.
   */
  readonly grain?: 'file';
  /**
   * Under a run of lines that also holds finer ones: the lines whose edit
   * charges the module's own region, for which the cases are the ones that
   * loaded the file. In the text as it is now.
   */
  readonly fileGrain?: readonly HeldLines[];
  /** Under a run of lines: the lines no recorded region holds, which no case can be said to have run. In the text as it is now. */
  readonly outside?: readonly HeldLines[];
  /** Under a run of lines: the lines written since the recording, which no case has run. In the text as it is now. */
  readonly written?: readonly HeldLines[];
  /** Present when the question named a line or a function. */
  readonly tests?: readonly CoveringTest[];
  /** With `tests`: the same cases gathered by test file, nearest first under `--hops`. */
  readonly files?: readonly CoveringFile[];
  /** Under `--hops`, when no distance could be measured: why. */
  readonly hopsGap?: string;
  /**
   * Present with `tests`, when it could be told: the cases that could have
   * reached the line or function and stopped before entering it. With no
   * `tests`, a non-empty list is a hole and an empty one is unwalked. Read,
   * like `state`, before `--where` narrows the cases: it is evidence for the
   * state, which is a claim about every case, not about the ones listed.
   */
  readonly stopped?: readonly ExecutionTest[];
  /** With `tests`: the one state the line or function is painted as, when it can be told, over the cases before `--where`. */
  readonly state?: RangeState;
  /** With `--function` and a case that entered it: the outermost parts of it no case ran, as the review reads them, over the cases before `--where`. */
  readonly unrun?: readonly UnrunPart[];
  /** Present when the question named a file and nothing narrower. */
  readonly ranges?: readonly CoveringRange[];
  /**
   * Present instead of every other reading when the record holds no line of
   * the file and test files hold it as a precondition: those files, which a
   * change to it selects whole (`covering-unloaded.ts`).
   */
  readonly preconditionOf?: readonly string[];
  /** With `preconditionOf`: whether the run loaded the file uninstrumented, or only the suite declares it (a native source no probe reaches). */
  readonly held?: 'loaded' | 'declared';
  /** With `preconditionOf`: how many test files the reading holds, so that every one of them is said as that. */
  readonly among?: number;
  /**
   * Where the line numbers stand, when the file could be framed against the
   * snapshot: `recorded` when the held text is the one the suite ran over,
   * `mapped` when it differs and the recorded text was found, so every range is
   * carried to where it stands now, and `stale` when it differs and the
   * recorded text was not found — then no range is given, because none of them
   * is a place in anything held, and `tests` names the cases that ran code in
   * the file. Absent when nothing held a digest to check.
   */
  readonly frame?: 'recorded' | 'mapped' | 'stale';
  /** Where the index was read, so an empty answer can be checked against a path. */
  readonly from: string;
  /** Present under `--cases`: the cases the answer was read from, which are not the suite. */
  readonly scope?: CoveringScope;
  /** Under `--where`: how many of the cases that covered it said it, and what could not be read. */
  readonly where?: CoveringWhere;
  /** Under `--against`, or `--cases last`: the regions whose cases moved since the base. */
  readonly motion?: CoveringMotion;
  /** The commit the record stands at, when it says. The diff is measured from it. */
  readonly at?: string;
  /**
   * What a narrowing did, when one was asked for.
   *
   * Present only under `--at-distance` or `--in-package`, and printed whichever
   * way the answer went: a short list and an empty one both read as *few tests
   * go here* unless the reader is told that most of them were filtered out.
   */
  readonly narrowed?: {
    readonly kept: number;
    readonly of: number;
    readonly notes: readonly string[];
  };
  /**
   * Present when the record was cut under probes this build does not place:
   * the answer is the record's, and this says what the difference leaves
   * open, for the asked file when one was asked (`probes-gap.ts`).
   */
  readonly probes?: ProbesGap & { readonly cut?: CutGap; readonly note: string };
  /** The one question the answer leaves open, and the run that closes it (`evidence-gap.ts`). Absent when nothing is open. */
  readonly gap?: EvidenceGap;
}

/**
 * Read the per-case execution index and ask it about one piece of source.
 *
 * The default path is where a recorded run writes the index, so the common
 * question needs no flag but `--file`. A missing file is refused rather than
 * answered empty: an empty list here reads as *no test covers this line*, which
 * is the sentence that gets a test deleted.
 *
 * @param graph The checkout's file graph, read at most once for the whole
 * invocation: a caller asking several suites hands every one the same.
 */
export async function covering(request: ParsedCovering, graph: Graph = graphOnce(request.root)): Promise<Covering> {
  let scope: CoveringScope | undefined;
  let full: ExecutionIndex | undefined;
  let whole: ExecutionIndex | undefined;
  let where: CoveringWhere | undefined;
  let reached: readonly ExecutionTest[] | undefined;
  const reader: IndexReader = async (from, changed) => {
    const read = await readIndex(from, changed);
    whole = read.index;
    let index = read.index;
    if (request.cases !== undefined) {
      ({ index, scope } = await scopeCases((full = read.index), from, request.cases, request.root));
    }
    if (request.where === undefined && request.read === undefined) return { index, files: read.files };
    const kept = whereCases(index, request.where ?? [], request.read ?? []);
    where = kept.where;
    return { index: kept.index, files: read.files, before: index };
  };
  let answer: Covering;
  try {
    answer = await ask(request, reader, graph, (tests) => {
      reached = tests;
    });
  } catch (error) {
    if (!(error instanceof OperatorError)) throw error;
    // The refusal is the answer: a gap that cannot be worked out leaves it standing, never replaces it.
    const older = error instanceof RecordOlder ? { commit: error.commit, record: error.from } : {};
    const gap = await refusalGap(error.kind, request, whole, { ...older, graph })
      .catch((failed: unknown) => {
        if (failed instanceof OperatorError) return undefined;
        throw failed;
      });
    // An answer that the record holds nothing of the file is still the record's, and still carries the gap;
    // a refusal of anything else, such as a `--where` the record never measured, is not about its probes.
    // The refusal is the answer; a record that cannot be found again only leaves it without a note.
    const from = !RECORD_SHAPED.has(error.kind ?? '')
      ? undefined
      : request.execution ?? (await recordedExecutionFile(request.root, request.suite).catch(() => undefined));
    const probes = from === undefined ? undefined : await gapOf(request, from, undefined);
    if (probes === undefined && gap === undefined) throw error;
    const said = probes === undefined ? error.message : `${error.message} ${probes.note}`;
    const kind = error.kind === undefined ? {} : { kind: error.kind };
    throw gap === undefined ? new OperatorError(said, { ...kind, cause: error }) : new GapRefusal(said, { ...kind, gap, cause: error });
  }
  // Counts are read among every case the question reached before `--where` and `--read` narrowed it.
  if (where !== undefined) {
    const listed = listedIn(answer);
    where = whereOver(where, listed, reached ?? listed);
  }
  const motion = await motionFor(request, answer.from, scope, full);
  const hops = answer.tests !== undefined && request.since === undefined && request.hops === true ? await hopsToTests(request) : undefined;
  const files = answer.tests === undefined || whole === undefined ? undefined : coveringFiles(answer.tests, whole, hops?.byFile);
  const probes = await gapOf(request, answer.from, whole);
  const source = { root: request.root, suite: request.suite, execution: request.execution, record: answer.from, graph };
  const gap = whole === undefined ? undefined : await answerGap({ ...answer, ...(files === undefined ? {} : { files }) }, whole, source);
  return {
    ...answer,
    ...(probes === undefined ? {} : { probes }),
    ...(files === undefined ? {} : { files }),
    ...(hops?.unread === undefined ? {} : { hopsGap: hops.unread }),
    ...(scope === undefined ? {} : { scope }),
    ...(where === undefined ? {} : { where }),
    ...(motion === undefined ? {} : { motion }),
    ...(gap === undefined ? {} : { gap }),
  };
}

/** The refusals that say what the record holds of the file, and so are answered from it with its gap beside them. */
const RECORD_SHAPED: ReadonlySet<string> = new Set(['older', 'unloaded']);

/**
 * The probes gap of the record `from`, with, for one asked file the record
 * holds, how its regions there stand against this build's cut.
 */
async function gapOf(request: ParsedCovering, from: string, index: ExecutionIndex | undefined): Promise<Covering['probes']> {
  const gap = await probesGap(from, request.root, request.suite);
  if (gap === undefined) return undefined;
  // `covering --file` is where a note sends a reader for one file's cut, so when it compared none it says why, not where to ask.
  const module = index?.modules.find((candidate) => candidate.file === request.file);
  const cut: CutGap | undefined = request.file === undefined
    ? undefined
    : module === undefined
      ? { file: request.file, unread: 'the record holds no region of it' }
      : await cutGap(request.root, await recordedCommit(from), module.file, module.blocks);
  return { ...gap, ...(cut === undefined ? {} : { cut }), note: probesNote(gap, cut, '--execution') };
}

/**
 * @param reach Handed the cases the question reached before `--where`
 * narrowed them, read off the same graph, when it narrowed them.
 */
async function ask(
  request: ParsedCovering,
  readIndex: IndexReader,
  graph: Graph,
  reach?: (tests: readonly ExecutionTest[]) => void,
): Promise<Covering> {
  const from = request.execution ?? (await recordedExecutionFile(request.root, request.suite));
  const record = await snapshotFor(request);

  if (request.since !== undefined) {
    // The snapshot's commit is the coordinate of what was recorded beside it,
    // and of nothing else: a journey file handed in by path names no commit, and
    // diffing it from the snapshot's would land its hunks on another text.
    const at = record !== undefined && from.startsWith(record)
      ? await recordedCommit(record)
      : undefined;
    const changed = await changeSince(request.since, request.root, at);
    const { index, before } = await readIndex(from, changed);
    // The graph carries the mocks: a case whose file mocked the changed module
    // is not listed under it, whatever it crossed there.
    const relations = await graph();
    const answer = coveringChange(index, changed, { relations });
    // Both readings land on the same blocks in the same order: `--where` narrows the cases, never the regions.
    const reached = before === undefined ? answer : coveringChange(before, changed, { relations });
    if (before !== undefined) reach?.(listedIn({ changed: reached }));
    return {
      since: request.since,
      changed: answer.map((file, at) => ({
        ...file,
        regions: file.regions.map((region, of) => stated(region, reached[at]!.regions[of]!)),
      })),
      ...(at === undefined ? {} : { at }),
      from,
    };
  }

  const file = request.file;
  const { index, files, before } = await readIndex(from, new Map([[file, []]]));
  const module = index.modules.find((candidate) => candidate.file === file);
  if (module === undefined) {
    const held = heldAsPrecondition(from, [file]);
    const loaded = held?.of.get(file);
    // The record holds every test file's preconditions; `--cases`, `--where` and `--read` ask about the cases left in the index.
    const asked = request.cases === undefined && request.where === undefined && request.read === undefined
      ? undefined
      : new Set(index.tests.map((test) => test.file));
    if (loaded !== undefined) {
      const preconditionOf = asked === undefined ? loaded : loaded.filter((test) => asked.has(test));
      return { file, preconditionOf, held: held?.loaded.has(file) === true ? 'loaded' : 'declared', among: asked?.size ?? held?.tests ?? 0, from };
    }
    // An index with no coverage beside it, as a foreign tool writes, holds no preconditions to read.
    if (held === undefined && keepsCases(from)) throw unreadPreconditions(file, from);
    // Git says whether the commit the record was made at held the file: a
    // record older than the file is not a run that never loaded it.
    const at = record !== undefined && from.startsWith(record) ? await recordedCommit(record) : undefined;
    if (at !== undefined) {
      const then = existedAt(request.root, at, file);
      if (then === false) throw addedSince(file, from, at);
      if (then !== true) throw unreadCommit(file, from, at, then.unread);
    }
    throw unloadedFile(file, from, files.length);
  }

  const near = await nearbyWitnesses(request as CoveringAt);
  const placement = await placementFor(request, from);
  const frame = placement === undefined ? {} : { frame: placement.frame };
  if (placement?.frame === 'stale' && request.function === undefined) {
    return staleAnswer(request as CoveringAt, { index, ...(before === undefined ? {} : { before }), from, near, graph, ...(placement.at === undefined ? {} : { at: placement.at }) }, reach);
  }

  const at = await coveringAt(request as CoveringAt, { index, ...(before === undefined ? {} : { before }), module, from, ...(placement === undefined ? {} : { placement }), near, graph }, reach);
  if (at !== undefined) return at;

  const loaders = await loadersOf(before ?? index, file, graph);
  // Each range is read and stated over the cases before `--where`, then lists only the cases it kept.
  const found = coveringTestsInFile(before ?? index, file, loaders);
  const listed = before === undefined ? undefined : new Set(index.tests.map((test) => test.id));
  const listing = (ranges: readonly CoveringRange[]): readonly CoveringRange[] => listed === undefined
    ? ranges
    : ranges.map((range) => ({ ...range, tests: range.tests.filter((test) => listed.has(test.id)) }));
  if (before !== undefined) reach?.(listedIn({ tests: found.flatMap((range) => range.tests).filter(near.keep) }));
  if (near.whole) return { file: file, ranges: listing(placeRanges(found, placement)), ...frame, from };
  // The narrowing is read inside the fold, so a range boundary still marks where the claim changes.
  const narrowed = coveringTestsInFile(before ?? index, file, { ...loaders, keep: near.keep });
  return {
    file: file,
    ranges: listing(placeRanges(narrowed, placement)),
    ...frame,
    from,
    ...countOf(near, identities(listing(narrowed)), identities(listing(found))),
  };
}

/** A changed region as `--where` lists it, stated, with the cases that stopped, over every case that reached it. */
function stated(listed: CoveringRegion, reached: CoveringRegion): StatedRegion {
  const { stopped: _, ...region } = listed;
  const state = regionState(reached);
  return {
    ...region,
    ...(reached.stopped === undefined ? {} : { stopped: reached.stopped }),
    ...(state === undefined ? {} : { state }),
  };
}

/**
 * Every line a diff changed, in the index's coordinates.
 *
 * The diff is measured from the commit the record was written at, when it has
 * one, rather than from the merge base with `ref`, because the index's line ranges are in that
 * commit's coordinates and nothing else's. The two part company as soon as the
 * branch moves under the recording, and a hunk read at the wrong end lands on
 * lines the index numbered for a different region — which is the one failure
 * here nobody can see, since a wrong list of test names reads exactly like a
 * right one.
 *
 * `git` names files from the repository root and the index names them from the
 * run's, so the paths are brought into the index's coordinates before anything
 * is looked up. Unmatched paths are reported rather than dropped: an answer that
 * silently left out half a diff is worse than one that says it cannot speak to
 * it.
 */
async function changeSince(
  since: string,
  root: string,
  at: string | undefined,
): Promise<ReadonlyMap<string, readonly LineRange[]>> {
  const diff = await diffSince(since, [], at);
  if (diff === undefined) {
    throw new OperatorError(
      `\`--since ${since}\` could not be read as a diff. Check the ref exists and that this is a ` +
        'git checkout; an empty answer here would read as `your change touches nothing`.',
    );
  }

  // The working directory is always a real path and `--root` is spelled however
  // the caller spelled it; through a symlink (`/var` on macOS) the two never meet.
  const here = process.cwd();
  const base = await realpath(root);
  const changed = new Map<string, readonly LineRange[]>();
  for (const [file, ranges] of changedLines(diff)) {
    changed.set(here === base ? file : relative(base, resolve(here, file)), ranges);
  }
  if (changed.size === 0) {
    throw new OperatorError(
      `nothing has changed since \`${since}\`, so there is no region to ask about.`,
    );
  }
  return changed;
}

/** {@link readIndex}, and under `--where` the index before it narrowed the cases. */
type IndexReader = (
  from: string,
  changed: ReadonlyMap<string, readonly LineRange[]>,
) => Promise<{ readonly index: ExecutionIndex; readonly files: readonly string[]; readonly before?: ExecutionIndex }>;

/**
 * The index, read for the files a question is about.
 *
 * A missing file is refused rather than answered empty: an empty list here
 * reads as *no test covers this line*, which is the sentence that gets a test
 * deleted.
 */
async function readIndex(
  from: string,
  changed: ReadonlyMap<string, readonly LineRange[]>,
): Promise<{ readonly index: ExecutionIndex; readonly files: readonly string[] }> {
  try {
    return await readExecutionFor(from, changed);
  } catch (error) {
    throw new OperatorError(
      `no readable per-case execution index at \`${from}\` (${
        error instanceof Error ? error.message : String(error)
      }). Every run wrapped in \`withTestSelection\` writes one beside its coverage file; ` +
        'a run whose test files ran in a page writes none, and knows which files a test covered but not which case.',
    );
  }
}
