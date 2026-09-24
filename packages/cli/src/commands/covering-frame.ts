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
 * saved. The frame is checked only when the index was read from beside the
 * snapshot, because the digest it is checked against lives in the snapshot, and
 * an index handed in by path names no snapshot of its own.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  placeInText,
  stateOf,
  testCoverageFile,
  type CoveringRegion,
  type Placement,
  type RangeState,
  type SourceTestRange,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { CoveringAt } from '../covering-args.js';

/** A recorded range where it stands in the held text, and the one state it is painted as. */
export interface CoveringRange extends SourceTestRange {
  /** Absent when the record cannot tell; see `stateOf`. */
  readonly state?: RangeState;
  /** An edit since the recording touched the range; its lines are the ones it spans now. */
  readonly moved?: true;
}

/**
 * Frame the file a question names, or say nothing when there is no digest to
 * frame it against.
 */
export async function placementFor(request: CoveringAt, from: string): Promise<Placement | undefined> {
  const snapshot = testCoverageFile(request.root);
  if (!from.startsWith(snapshot) || !existsSync(snapshot)) return undefined;
  const text = await heldText(request);
  if (text === undefined) return undefined;
  return placeInText(snapshot, request.root, request.file, text);
}

async function heldText(request: CoveringAt): Promise<string | undefined> {
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
 * edit removed is dropped: there is nowhere in the held text to paint it.
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
    placed.push({ ...stated, ...where.lines, ...(where.moved ? { moved: true as const } : {}) });
  }
  return placed;
}

/**
 * The state a changed region adds up to. A passenger is a case that was inside
 * the region only while its module evaluated, which is what `loaded` means on a
 * range.
 */
export function regionState(region: CoveringRegion): RangeState | undefined {
  return stateOf({
    startLine: region.startLine,
    endLine: region.endLine,
    tests: [...region.tests, ...(region.passengers ?? []).map((test) => ({ ...test, loaded: true as const }))],
    ...(region.stopped === undefined ? {} : { stopped: region.stopped }),
  });
}
