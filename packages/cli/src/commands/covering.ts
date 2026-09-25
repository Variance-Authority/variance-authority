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
  coveringTests,
  anyStopped,
  coveringTestsInFile,
  ranWhileLoading,
  stoppedBefore,
  stateOf,
  recordedCommit,
  testCoverageFile,
  type CoveringChange,
  type CoveringRegion,
  type CoveringTest,
  type ExecutionTest,
  type LineRange,
  type ExecutionIndex,
  type RangeState,
  type SourceTestRange,
} from '@variance-authority/sense/test-selection';
import type { Relations } from '@variance-authority/core/relate';
import { OperatorError } from '../exit.js';
import { defaultExecutionFile, readExecutionFor } from './execution-input.js';
import { nearbyWitnesses, type Narrowing } from './covering-reach.js';
import { motionFor, type CoveringMotion } from './covering-motion.js';
import { scopeCases, type CoveringScope } from './covering-scope.js';
import { placeRanges, placementFor, regionState, type CoveringRange } from './covering-frame.js';
import { diffAtTip, diffSince, headCommit, repositoryDirectory } from './since.js';
import { relationsFor } from './source-graph.js';
import type { CoveringAt, ParsedCovering } from '../covering-args.js';

/**
 * How the answer is written. `text` reads; `json` is for whatever asks next.
 * The others are a review of a diff: `github` prints workflow commands a pull
 * request shows beside the lines, the two `bitbucket-` formats print one Code
 * Insights request body each, and `markdown` prints the whole review uncut, for
 * a step summary or a comment.
 */
export type CoveringFormat = 'text' | 'refs' | 'json' | ReviewFormat;

/** The formats a code host reads, each answering `--since` on the commit it reviews. */
export type ReviewFormat = 'github' | 'bitbucket-report' | 'bitbucket-annotations' | 'markdown';

export { formatCovering } from './covering-text.js';

/** A changed region, and the one state it is painted as. */
export interface StatedRegion extends CoveringRegion {
  readonly state?: RangeState;
}

/** A changed file, its regions stated. */
export interface StatedChange extends Omit<CoveringChange, 'regions'> {
  readonly regions: readonly StatedRegion[];
}

/** What was asked, and what the record said about it. */
export interface Covering {
  /** The file the question named, absent when it named a diff. */
  readonly file?: string;
  /** The ref a diff was taken against, present only under `--since`. */
  readonly since?: string;
  /** Present when the question named a diff: one entry per changed file. */
  readonly changed?: readonly StatedChange[];
  /**
   * Where the run's directory sits under the repository's top, present with
   * `changed`. Paths here are the run's; a code host names them from the top.
   */
  readonly directory?: string;
  /** The line or function the question named, absent when it named neither. */
  readonly target?: { readonly line: number } | { readonly function: string };
  /** Present when the question named a line or a function. */
  readonly tests?: readonly CoveringTest[];
  /**
   * Present with `tests`, when it could be told: the cases that could have
   * reached the line or function and stopped before entering it. With no
   * `tests`, a non-empty list is a hole and an empty one is unwalked.
   */
  readonly stopped?: readonly ExecutionTest[];
  /** With `tests`: the one state the line or function is painted as, when it can be told. */
  readonly state?: RangeState;
  /** Present when the question named a file and nothing narrower. */
  readonly ranges?: readonly CoveringRange[];
  /**
   * Where the line numbers stand, when the file could be framed against the
   * snapshot: `recorded` when the held text is the one the suite ran over,
   * `mapped` when it differs and the recorded text was found, so every range is
   * carried to where it stands now, and `stale` when it differs and the
   * recorded text was not found — then no range is given, because none of them
   * is a place in anything held. Absent when nothing held a digest to check.
   */
  readonly frame?: 'recorded' | 'mapped' | 'stale';
  /** Where the index was read, so an empty answer can be checked against a path. */
  readonly from: string;
  /** Present under `--cases`: the cases the answer was read from, which are not the suite. */
  readonly scope?: CoveringScope;
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
}

/**
 * Read the per-case execution index and ask it about one piece of source.
 *
 * The default path is where a recorded run writes the index, so the common
 * question needs no flag but `--file`. A missing file is refused rather than
 * answered empty: an empty list here reads as *no test covers this line*, which
 * is the sentence that gets a test deleted.
 */
export async function covering(request: ParsedCovering): Promise<Covering> {
  let scope: CoveringScope | undefined;
  let full: ExecutionIndex | undefined;
  const answer = await ask(request, async (from, changed) => {
    const read = await readIndex(from, changed);
    if (request.cases === undefined) return read;
    const cut = await scopeCases((full = read.index), from, request.cases, request.root);
    scope = cut.scope;
    return { index: cut.index, files: read.files };
  });
  const motion = await motionFor(request, answer.from, scope, full);
  return { ...answer, ...(scope === undefined ? {} : { scope }), ...(motion === undefined ? {} : { motion }) };
}

async function ask(request: ParsedCovering, readIndex: IndexReader): Promise<Covering> {
  const from = request.execution ?? (await defaultExecutionFile(request.root));

  if (request.since !== undefined) {
    // The snapshot's commit is the coordinate of what was recorded beside it,
    // and of nothing else: a journey file handed in by path names no commit, and
    // diffing it from the snapshot's would land its hunks on another text.
    const at = from.startsWith(testCoverageFile(request.root))
      ? await recordedCommit(testCoverageFile(request.root))
      : undefined;
    const review = request.format !== 'text' && request.format !== 'refs' && request.format !== 'json';
    if (review) await onTip(request.format, at);
    const changed = await changeSince(request.since, request.root, at, review);
    const { index } = await readIndex(from, changed);
    // The graph carries the mocks: a case whose file mocked the changed module
    // is not listed under it, whatever it crossed there.
    const answer = coveringChange(index, changed, { relations: await fileGraph(request.root) });
    return {
      since: request.since,
      changed: answer.map((file) => ({ ...file, regions: file.regions.map(stated) })),
      directory: await repositoryDirectory(await realpath(request.root)),
      ...(at === undefined ? {} : { at }),
      from,
    };
  }

  const file = request.file;
  const { index, files } = await readIndex(from, new Map([[file, []]]));
  const module = index.modules.find((candidate) => candidate.file === file);
  if (module === undefined) {
    throw new OperatorError(
      `\`${file}\` is not in the index at \`${from}\`, which holds ${
        files.length
      } file${files.length === 1 ? '' : 's'}. A file the run never loaded has no answer ` +
        `here, and that is a different statement from no test covering it. ${
          spelling(file, files)
        }`,
    );
  }

  const near = await nearbyWitnesses(request as CoveringAt);
  const placement = await placementFor(request, from);
  const frame = placement === undefined ? {} : { frame: placement.frame };
  if (placement?.frame === 'stale' && request.function === undefined) {
    // No range is a place in the held text, so none is given: painted at its
    // recorded numbers it would land on whatever code holds them now.
    return { file, ...frame, from, ...(placement.at === undefined ? {} : { at: placement.at }) };
  }

  if (request.line !== undefined) {
    const held = request.line;
    const line = placement === undefined ? held : placement.recordedLine(held);
    if (line === undefined) {
      throw new OperatorError(
        `line ${held} of \`${file}\` was written since the recording, so the record has nothing to say ` +
          'about it yet: no case has run it. Run the suite to record it.',
      );
    }
    if (!module.blocks.some((block) => block.source && block.startLine <= line && line <= block.endLine)) {
      throw new OperatorError(
        `line ${line} of \`${file}\` is outside every recorded region. A blank line, an ` +
          'import or a type declaration has no region to be covered, so there is no list to ' +
          'print — which again is not the same as nobody covering it.',
      );
    }
    const target = { file, line };
    const graph = await loadersFor(index, target, request.root);
    const found = coveringTests(index, target, graph);
    const kept = near.whole ? found : found.filter(near.keep);
    const stopped = stoppedBefore(index, target, graph);
    return {
      file: file,
      target: { line: held },
      tests: kept,
      ...(stopped === undefined ? {} : { stopped }),
      ...stateFor(kept, stopped),
      ...frame,
      from,
      ...countOf(near, kept.length, found.length),
    };
  }

  if (request.function !== undefined) {
    const named = request.function;
    if (!module.blocks.some((block) =>
      block.source && block.kind === 'function' && block.name === named,
    )) {
      const functions = module.blocks
        .filter((block) => block.source && block.kind === 'function')
        .map((block) => block.name);
      throw new OperatorError(
        `\`${named}\` is not a recorded function of \`${file}\`. ` +
          (functions.length === 0
            ? 'That file has no recorded functions at all.'
            : `It has ${functions.join(', ')}.`),
      );
    }
    const target = { file, function: named };
    const graph = await loadersFor(index, target, request.root);
    const found = coveringTests(index, target, graph);
    const kept = near.whole ? found : found.filter(near.keep);
    const stopped = stoppedBefore(index, target, graph);
    return {
      file: file,
      target: { function: named },
      tests: kept,
      ...(stopped === undefined ? {} : { stopped }),
      ...stateFor(kept, stopped),
      from,
      ...countOf(near, kept.length, found.length),
    };
  }

  const found = coveringTestsInFile(
    index,
    file,
    module.blocks.some((block) => block.loaded === true) || anyStopped(index)
      ? { relations: await fileGraph(request.root) }
      : {},
  );
  if (near.whole) return { file: file, ranges: placeRanges(found, placement), ...frame, from };
  const narrowed = refold(found.map((range) => ({ ...range, tests: range.tests.filter(near.keep) })));
  return {
    file: file,
    ranges: placeRanges(narrowed, placement),
    ...frame,
    from,
    ...countOf(near, identities(narrowed), identities(found)),
  };
}

/** The state of one line or function, from the cases that entered it and those that stopped. */
function stateFor(tests: readonly CoveringTest[], stopped: readonly ExecutionTest[] | undefined): Pick<Covering, 'state'> {
  const state = stateOf({ startLine: 0, endLine: 0, tests, ...(stopped === undefined ? {} : { stopped }) });
  return state === undefined ? {} : { state };
}

function stated(region: CoveringRegion): StatedRegion {
  const state = regionState(region);
  return state === undefined ? region : { ...region, state };
}

/**
 * Refuse a review whose record is not of the commit under review.
 *
 * A host paints each region on the lines of the commit it shows, and the record
 * numbers them in the text the suite ran over. The two are the same text only
 * when the suite ran on that commit, and a region placed from another one lands
 * on whatever code holds its numbers there.
 */
async function onTip(format: ReviewFormat, at: string | undefined): Promise<void> {
  const head = await headCommit();
  if (at !== undefined && at === head) return;
  throw new OperatorError(
    `\`--format ${format}\` places each region on the lines of the commit under review, ` +
      `and the record ${at === undefined ? 'names no commit' : `stands at ${at.slice(0, 12)}`} while ` +
      `the checkout is at ${head === undefined ? 'no commit' : head.slice(0, 12)}. Run the suite on this ` +
      'commit, then ask again.',
  );
}

/**
 * Re-fold ranges a filter has just changed the answer of.
 *
 * `coveringTestsInFile` folds adjacent lines whose witness lists are identical,
 * so a range boundary is a place where the claim on the code changes. Filtering
 * the lists afterwards can make two neighbours agree that did not, and leaving
 * them apart would print a boundary where nothing happens — the one thing the
 * folding rule exists to prevent.
 */
function refold(ranges: readonly SourceTestRange[]): readonly SourceTestRange[] {
  const folded: SourceTestRange[] = [];
  for (const range of ranges) {
    const previous = folded.at(-1);
    if (
      previous !== undefined &&
      previous.endLine + 1 === range.startLine &&
      previous.tests.length === range.tests.length &&
      previous.tests.every((test, at) => test.id === range.tests[at]?.id) &&
      sameStopped(previous.stopped, range.stopped)
    ) {
      folded[folded.length - 1] = { ...previous, endLine: range.endLine };
      continue;
    }
    folded.push(range);
  }
  return folded;
}

function sameStopped(
  left: readonly ExecutionTest[] | undefined,
  right: readonly ExecutionTest[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((test, at) => test.id === right[at]?.id);
}

/** How many distinct named tests a set of ranges names. */
function identities(ranges: readonly SourceTestRange[]): number {
  return new Set(ranges.flatMap((range) => range.tests.map((test) => test.id))).size;
}

/** The narrowing's own report, when there was a narrowing. */
function countOf(
  near: Narrowing,
  kept: number,
  of: number,
): Pick<Covering, 'narrowed'> {
  return near.whole ? {} : { narrowed: { kept, of, notes: near.notes } };
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
 * is looked up. Unmatched paths are reported rather than dropped: a review that
 * silently left out half a diff is worse than one that says it cannot speak to
 * it.
 */
async function changeSince(
  since: string,
  root: string,
  at: string | undefined,
  review: boolean,
): Promise<ReadonlyMap<string, readonly LineRange[]>> {
  const diff = review ? await diffAtTip(since) : await diffSince(since, [], at);
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

type IndexReader = typeof readIndex;

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

/**
 * The file graph, read only when a region the question landed on ran while its
 * module evaluated, or when a recorded case stopped and a hole has to be told
 * from a region nobody walked.
 *
 * The record credits no case with that: a module evaluates once per realm, for
 * whichever case imported it first. The graph names every case whose file
 * imports the module, and rules out one that mocked it. A question about a
 * region only a case called into never pays for the scan.
 */
async function loadersFor(
  index: ExecutionIndex,
  target: Parameters<typeof ranWhileLoading>[1],
  root: string,
): Promise<{ readonly relations?: Relations }> {
  return ranWhileLoading(index, target) || anyStopped(index) ? { relations: await fileGraph(root) } : {};
}

function fileGraph(root: string): Promise<Relations> {
  return relationsFor(root, ['.'], [], [], {
    why: 'a region that ran while its module evaluated is answered, and a mocked module ruled out, by the file graph',
    fix: 'Install `@variance-authority/sense`, which is what reads the tree.',
  });
}


/**
 * Point at the closest spelling rather than printing the whole index.
 *
 * A path given to this command is usually the right file and the wrong root:
 * the record spells a module the way the run saw it, and a reader who pasted an
 * editor path is one prefix away. Three candidates answer that; a list of every
 * recorded file answers nothing and scrolls the refusal off the screen.
 */
function spelling(file: string, files: readonly string[]): string {
  const tail = file.slice(file.lastIndexOf('/') + 1);
  const near = files
    .filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`))
    .sort();
  return near.length === 0
    ? `Nothing recorded ends in \`${tail}\`.`
    : `The record spells it ${near.slice(0, 3).map((candidate) => `\`${candidate}\``).join(', ')}.`;
}
