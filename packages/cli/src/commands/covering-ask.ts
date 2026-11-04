// compass: variance-authority.reach
/**
 * The question `variance covering` asks of the per-case index: which cases a
 * change since a commit reached, or which ran a line, a run of lines or a
 * function of one file, and, for a file the index holds no region of, which
 * test files hold it as a precondition, or why the record says nothing of it.
 *
 * The index is read once per question, through the reader the command hands
 * in, so `--cases`, `--where` and `--read` narrow it in one place.
 */

import {
  coveringChange,
  coveringTestsInFile,
  keepsCases,
  type ExecutionIndex,
  type ExecutionTest,
  type LineRange,
} from '@variance-authority/sense/test-selection';
import { existedAt } from '@variance-authority/sense';
import { OperatorError } from '../exit.js';
import type { CoveringAt, ParsedCovering } from '../covering-args.js';
import { readExecutionFor } from './execution-input.js';
import { identities, nearbyWitnesses } from './covering-reach.js';
import { addedSince, unloadedFile, unreadCommit, unreadPreconditions } from './covering-unloaded.js';
import { heldAsPrecondition } from './held-as-precondition.js';
import { listedIn } from './covering-where.js';
import { staleAnswer } from './covering-stale.js';
import { placeRanges, type placementFor, type CoveringRange } from './covering-frame.js';
import { changeSince, stated } from './covering-since.js';
import { coveringAt, countOf, loadersOf } from './covering-at.js';
import type { AskedLines } from './covering-lines.js';
import type { Graph } from './gap-selection.js';
import type { Covering } from './covering.js';

/**
 * @param record The record the question reads, and the commit it was made at when it says.
 * @param held The asked text, how it is framed, and where a precondition's
 * test files that ran another text of it, and the asked lines, are handed.
 * @param reach Handed the cases the question reached before `--where`
 * narrowed them, read off the same graph, when it narrowed them.
 */
export async function ask(
  request: ParsedCovering,
  readIndex: IndexReader,
  graph: Graph,
  record: { readonly from: string; readonly at: string | undefined },
  held: AskedText,
  reach?: (tests: readonly ExecutionTest[]) => void,
): Promise<Covering> {
  const { from, at } = record;

  if (request.since !== undefined) {
    // The snapshot's commit is the coordinate of what was recorded beside it,
    // and of nothing else: a journey file handed in by path names no commit, and
    // diffing it from the snapshot's would land its hunks on another text.
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
    const { text } = held;
    const holding = heldAsPrecondition(from, [file], text === undefined ? undefined : new Map([[file, text]]));
    const loaded = holding?.of.get(file);
    // The record holds every test file's preconditions; `--cases`, `--where` and `--read` ask about the cases left in the index.
    const asked = request.cases === undefined && request.where === undefined && request.read === undefined
      ? undefined
      : new Set(index.tests.map((test) => test.file));
    if (loaded !== undefined) {
      const preconditionOf = asked === undefined ? loaded : loaded.filter((test) => asked.has(test));
      // No line of it is recorded, so nothing is framed; which text each test file holding it ran is the freshness's.
      if (holding !== undefined) held.ranOther(holding.ranOther);
      const unheld = text === undefined ? { unheld: true as const } : {};
      return { file, preconditionOf, held: holding?.loaded.has(file) === true ? 'loaded' : 'declared', among: asked?.size ?? holding?.tests ?? 0, ...unheld, from };
    }
    // An index with no coverage beside it, as a foreign tool writes, holds no preconditions to read.
    if (holding === undefined && keepsCases(from)) throw unreadPreconditions(file, from);
    // Git says whether the commit the record was made at held the file: a
    // record older than the file is not a run that never loaded it.
    if (at !== undefined) {
      const then = existedAt(request.root, at, file);
      if (then === false) throw addedSince(file, from, at);
      if (then !== true) throw unreadCommit(file, from, at, then.unread);
    }
    throw unloadedFile(file, from, files.length);
  }

  const near = await nearbyWitnesses(request as CoveringAt);
  const framed = await held.placing();
  const placement = framed === undefined || 'unheld' in framed ? undefined : framed;
  const unheld = framed !== undefined && 'unheld' in framed ? { unheld: true as const } : {};
  const frame = placement === undefined ? unheld : { frame: placement.frame };
  if (placement?.frame === 'stale' && request.function === undefined) {
    return staleAnswer(request as CoveringAt, { index, ...(before === undefined ? {} : { before }), from, near, graph, ...(placement.at === undefined ? {} : { at: placement.at }) }, held.entered, reach);
  }

  const narrower = await coveringAt(request as CoveringAt, { index, ...(before === undefined ? {} : { before }), module, from, ...(placement === undefined ? {} : { placement }), near, graph }, reach, held.lines);
  if (narrower !== undefined) return { ...narrower, ...unheld };

  const loaders = await loadersOf(before ?? index, file, graph);
  // Each range is read and stated over the cases before `--where`, then lists only the cases it kept.
  const found = coveringTestsInFile(before ?? index, file, loaders);
  const listed = before === undefined ? undefined : new Set(index.tests.map((test) => test.id));
  const listing = (ranges: readonly CoveringRange[]): readonly CoveringRange[] => listed === undefined
    ? ranges
    : ranges.map((range) => ({ ...range, tests: range.tests.filter((test) => listed.has(test.id)) }));
  if (before !== undefined) reach?.(listedIn({ tests: found.flatMap((range) => range.tests).filter(near.keep) }));
  held.entered(listing(found).flatMap((range) => range.tests));
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

/** The asked text of a question about one file, read once: absent when none is held. */
export interface AskedText {
  readonly text: string | undefined;
  /** How the record's lines are placed in `text`, read when first asked for. */
  readonly placing: () => ReturnType<typeof placementFor>;
  readonly ranOther: (other: ReadonlyMap<string, readonly string[]>) => void;
  /** Handed the lines a question about a line, a run of lines or a function asks, as the case index reads them. */
  readonly lines: (asked: AskedLines) => void;
  /** Handed the cases that entered the file, as `--where` kept them, when the answer folded the whole file to read them. */
  readonly entered: (tests: readonly ExecutionTest[]) => void;
}

/** {@link readIndex}, and under `--where` the index before it narrowed the cases. */
export type IndexReader = (
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
export async function readIndex(
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
