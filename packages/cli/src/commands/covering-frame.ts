/**
 * The recorded line numbers, placed in the text the question holds.
 *
 * Every range the index answers with is numbered in the text the suite ran
 * over. An editor holds another text the moment somebody types, and a range
 * painted at its recorded numbers then lands on whatever code occupies them
 * now — a different function, belonging to different tests, or to none. So the
 * answer about a file says which frame it is in, and carries each range to
 * where its lines stand in the held text.
 *
 * The held text is the file on disk unless `--text` names another: `-` reads
 * it from standard input, which is how an editor asks about a buffer it has not
 * saved. The frame is checked only against a snapshot, because the digest it is
 * checked against lives there: the one the index was read from beside, or a
 * record handed in by path that names the commit it was made at. A journey file
 * handed in by path names no snapshot of its own.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  placeInText,
  reachOf,
  readableTestCoverage,
  recordedCommit,
  regionRecord,
  stateOf,
  type CoveringRegion,
  type Placement,
  type RangeState,
  type Reach,
  type SourceTestRange,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { CoveringAt, CoveringSource } from '../covering-args.js';

/** A recorded range where it stands in the held text, and the one state it is painted as. */
export interface CoveringRange extends SourceTestRange {
  /** Absent when the record cannot tell; see `stateOf`. */
  readonly state?: RangeState;
  /** An edit since the recording touched the range; its lines are the ones it spans now. */
  readonly moved?: true;
}

/**
 * Frame the file a question names in `text`, the one {@link heldText} read,
 * against `snapshot`, the record {@link recordOf} found; `unheld` when no text
 * is held to frame, the file being off disk and no `--text` given; or nothing
 * when there is no snapshot to frame it against.
 */
export async function placementFor(
  request: CoveringAt,
  snapshot: string | undefined,
  text: string | undefined,
): Promise<Placement | { readonly unheld: true } | undefined> {
  if (text === undefined) return { unheld: true };
  if (snapshot === undefined || !existsSync(snapshot)) return undefined;
  return placeInText(snapshot, request.root, request.file, text);
}

/**
 * The snapshot the index at `from` is read from, and the commit it was made at
 * when it says: the snapshot the index lies beside, or a record handed in by
 * path that names the commit it was made at. Nothing for a journey file handed
 * in by path, which is no record of a commit.
 */
export async function recordOf(
  request: CoveringSource,
  from: string,
): Promise<{ readonly snapshot: string; readonly at: string | undefined } | undefined> {
  const snapshot = await snapshotFor(request);
  if (snapshot !== undefined && from.startsWith(snapshot)) return { snapshot, at: await recordedCommit(snapshot) };
  if (request.execution === undefined) return undefined;
  const at = await recordedCommit(from);
  return at === undefined ? undefined : { snapshot: from, at };
}

/**
 * The snapshot beside the record the question reads.
 *
 * Undefined for an index handed in by path in a repository that declares
 * suites and a question that names none: no declared record is that index's,
 * so there is no snapshot to frame it against or date it by.
 *
 * It is the snapshot in the nearest cache layer holding one, the layer the
 * index beside it is read from.
 */
export async function snapshotFor(request: CoveringSource): Promise<string | undefined> {
  try {
    return await readableTestCoverage(request.root, { suite: request.suite });
  } catch (error) {
    if (request.execution !== undefined) return undefined;
    throw error;
  }
}

export async function heldText(request: CoveringAt): Promise<string | undefined> {
  if (request.held !== undefined) return request.held;
  if (request.text === '-') return readStandardInput();
  if (request.text !== undefined) {
    try {
      return await readFile(resolve(request.text), 'utf8');
    } catch (error) {
      throw new OperatorError(
        `\`--text ${request.text}\` could not be read (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  }
  // A file the run loaded and the tree no longer holds has no text to place a
  // range in, and that is not a frame: the answer stays in recorded numbers.
  return readFile(resolve(request.root, request.file), 'utf8').catch(() => undefined);
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Every range where it stands now, with its state. A range whose every line an
 * edit removed is dropped: there is nowhere in the held text to paint it. The
 * regions no case entered move with it, and one the edit removed is dropped.
 */
export function placeRanges(
  ranges: readonly SourceTestRange[],
  placement: Placement | undefined,
): readonly CoveringRange[] {
  const placed: CoveringRange[] = [];
  for (const range of ranges) {
    const state = stateOf(range);
    const stated = state === undefined ? range : { ...range, state };
    if (placement === undefined) {
      placed.push(stated);
      continue;
    }
    const where = placement.place(range);
    if (where === undefined) continue;
    const unentered = range.unentered?.flatMap((region) => {
      const now = placement.place(region);
      return now === undefined ? [] : [{ ...region, ...now.lines }];
    });
    const { unentered: _, ...rest } = stated;
    placed.push({
      ...rest, ...where.lines,
      ...(where.moved ? { moved: true as const } : {}),
      ...(unentered === undefined || unentered.length === 0 ? {} : { unentered }),
    });
  }
  return placed;
}

/** The state a changed region adds up to, read from `regionRecord`. */
export function regionState(region: CoveringRegion): RangeState | undefined {
  return stateOf(regionRecord(region));
}

/**
 * What a region no case called adds up to, or undefined where a case called
 * it: a case that was inside it only while its module loaded did not call it.
 * It is `reachOf`, the reading the whole-file answer's unentered regions take
 * too, so the handover and every `covering` answer cannot disagree on a part.
 */
export function unrunOf(region: CoveringRegion): Exclude<Reach, 'entered'> | undefined {
  const reach = reachOf(regionRecord(region));
  return reach === 'entered' ? undefined : reach;
}

/**
 * The regions a reader counts: each one whose reach differs from the region
 * around it. A function no case covered is one finding, not one per branch
 * inside it. A region is around another only where it holds every line of it:
 * an `else` that opens on the line its `then` closes on is beside it, and so
 * is a branch with the same lines as another branch, a one-line ternary's arm.
 */
export function outermostOf<Region extends { readonly kind: string; readonly startLine: number; readonly endLine: number; readonly reach: string }>(
  regions: readonly Region[],
): readonly Region[] {
  const sorted = [...regions].sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
  const kept: Region[] = [];
  const open: Region[] = [];
  const around = (outer: Region, inner: Region): boolean =>
    outer.startLine <= inner.startLine && inner.endLine <= outer.endLine
    && !(outer.kind === 'branch' && inner.kind === 'branch' && outer.startLine === inner.startLine && outer.endLine === inner.endLine);
  for (const region of sorted) {
    while (open.length > 0 && !around(open.at(-1)!, region)) open.pop();
    if (open.at(-1)?.reach !== region.reach) kept.push(region);
    open.push(region);
  }
  return kept;
}
