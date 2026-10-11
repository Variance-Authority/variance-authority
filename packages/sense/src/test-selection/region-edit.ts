/**
 * Where a held module's regions stand in the text a run recorded, read off the
 * edit between the two texts.
 *
 * A region changed or it did not, and git's `-U0` hunks between the held text
 * and the recorded one say which. An untouched region keeps its cases at the
 * lines the hunks place it; a touched one carries none, and its tests count as
 * changed. The mapping is the one the readers use (`placeThrough`, and the
 * charge of `blocksAround`), so what a selection would run over this edit and
 * what a landing drops are the same regions.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestString } from '../digest.js';
import type { SetExecutionModule } from './execution-set-format.js';
import { keptTexts } from './kept-texts.js';
import { hunksOf, placeThrough, type Hunk } from './placed.js';
import { textAtRecording } from './recorded-text.js';
import { diffTexts } from './text-diff.js';
import { NO_LINE } from './written-lines.js';

/** What git says an edit did to a module: the `-U0` hunks between the two texts. */
export interface Edit {
  readonly hunks: readonly Hunk[];
}

/** The edit between a text and itself: no region is touched and every one stands where it was. */
export const NO_EDIT: Edit = { hunks: [] };

/** The edit a module went through, or `undefined` when a text of it cannot be found. */
export type EditOf = (file: string) => Edit | undefined;

/** The edit one module went through from the text `from` names to the text `to` names. */
export type Edits = (file: string, from: string, to: string) => Edit | undefined;

/**
 * A reader of the edit one module went from the text `from` names to the text
 * `to` names, both digests.
 *
 * Two digests that agree are no edit and need no text. Otherwise each text is
 * found the way a reading of an edit finds it: kept by a landing, at one of the
 * commits the record names, or on disk, and taken only when it hashes to its
 * digest. `undefined` when either cannot be had: the caller then reads the
 * whole module as changed.
 */
export function editsBetween(
  root: string,
  cacheRoot: string | undefined,
  commits: readonly (string | undefined)[],
): Edits {
  const kept = keptTexts(root, cacheRoot);
  const atRecording = textAtRecording(root, []);
  const textOf = (file: string, digest: string): string | undefined => {
    const text = kept(digest);
    if (text !== undefined) return text;
    for (const commit of new Set(commits)) {
      const found = hashingTo(atRecording(file, commit), digest);
      if (found !== undefined) return found;
    }
    try {
      return hashingTo(readFileSync(resolve(root, file), 'utf8'), digest);
    } catch {
      return undefined;
    }
  };
  return (file, from, to) => {
    if (from === to) return NO_EDIT;
    const [before, after] = [textOf(file, from), textOf(file, to)];
    return before === undefined || after === undefined ? undefined : editBetween(before, after);
  };
}

/** The edit from `before` to `after`, read as the readers read a diff. */
function editBetween(before: string, after: string): Edit {
  return { hunks: hunksOf(diffTexts(before, after)) };
}

function hashingTo(text: string | undefined, digest: string): string | undefined {
  return text !== undefined && digestString(text) === digest ? text : undefined;
}

/**
 * For each region of `recorded`, the held region its cases carry from, or -1.
 *
 * A held region the edit touched carries nothing, and one it left alone stands
 * where `change` places it. A recorded region lands on the untouched held
 * region of its kind that stands at its lines, the n-th of them when several
 * share the lines; so the pairing is the text's, and no name, path or count of
 * siblings decides it. A region no untouched one stands under, a region the
 * edit wrote, is -1. Without a `change` — a text could not be found — the
 * whole module changed and nothing lands.
 */
export function landedThrough(
  held: Pick<SetExecutionModule, 'blocks'>,
  recorded: Pick<SetExecutionModule, 'blocks'>,
  change: Edit | undefined,
): Int32Array {
  const lands = new Int32Array(recorded.blocks.length).fill(-1);
  if (change === undefined) return lands;
  // The held regions the edit left alone, at the lines it places them, in order.
  const seats = new Map<string, number[]>();
  for (const [at, block] of held.blocks.entries()) {
    let placed: { readonly startLine: number; readonly endLine: number } | undefined = block;
    if (block.startLine !== NO_LINE) {
      const through = placeThrough(change.hunks, block);
      placed = through === undefined || through.moved ? undefined : through.lines;
    }
    if (placed === undefined) continue;
    const key = seatOf(block.kind, placed.startLine, placed.endLine);
    seats.set(key, [...(seats.get(key) ?? []), at]);
  }
  const taken = new Map<string, number>();
  for (const [at, block] of recorded.blocks.entries()) {
    const key = seatOf(block.kind, block.startLine, block.endLine);
    const nth = taken.get(key) ?? 0;
    taken.set(key, nth + 1);
    lands[at] = seats.get(key)?.[nth] ?? -1;
  }
  return lands;
}

function seatOf(kind: string, startLine: number, endLine: number): string {
  return `${kind}\0${startLine}\0${endLine}`;
}
