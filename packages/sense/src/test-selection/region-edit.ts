/**
 * Where a held module's regions stand in the text a run recorded, read off the
 * edit between the two texts.
 *
 * A region changed or it did not. git's `-U0` hunks between the held text and
 * the recorded one say where every region stands, and the selector's reading
 * of the two texts ({@link readEdit}) says how far the edit reaches what runs.
 * An untouched region keeps its cases at the lines the hunks place it. A
 * touched one keeps them only where the reading spares its kind
 * ({@link reaches}), the rule the snapshot's landing demotes by. The two
 * still part where their evidence does: a region here has no digest, so the
 * hunks say whether it moved, and a reached region drops its cases where the
 * snapshot keeps its row with every crosser owed a run.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestString } from '../digest.js';
import { addressKey } from './carried-rows.js';
import { reaches, readEdit, type EditReading } from './edit-readings.js';
import type { SetExecutionModule } from './execution-set-format.js';
import { NO_OWNER } from './format-layout.js';
import { addressedAlike } from './region-landing.js';
import { keptTexts } from './kept-texts.js';
import { hunksOf, placeThrough, type HeldLines, type Hunk } from './placed.js';
import { textAtRecording } from './recorded-text.js';
import { diffTexts } from './text-diff.js';
import { NO_LINE } from './written-lines.js';

/** What an edit did to a module: git's `-U0` hunks between the two texts, and how far it reaches what runs. */
export interface Edit {
  readonly hunks: readonly Hunk[];
  /**
   * The selector's reading of the two texts. Absent when the module reader does
   * not claim the file: every region the hunks touch then changed.
   */
  readonly reading?: EditReading;
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
    if (before === undefined || after === undefined) return undefined;
    const reading = readEdit(root, file, before, after);
    return { hunks: hunksOf(diffTexts(before, after)), ...(reading === undefined ? {} : { reading }) };
  };
}

function hashingTo(text: string | undefined, digest: string): string | undefined {
  return text !== undefined && digestString(text) === digest ? text : undefined;
}

/** A region of a text: its kind and the lines it stands at, or {@link NO_LINE}. */
type Region = { readonly kind: string } & HeldLines;

/**
 * Where one edit leaves a region of the text it starts at, the step every
 * carry of a region's cases takes. A region the hunks leave whole at its lines
 * `stays`, at the lines they shift it to, and runs as it did; so does one
 * with no lines of its own, where it was. Any other region is `reached` where
 * the edit's reading reaches its kind ({@link editReaches}), and spared where
 * it does not, standing at the `lines` the hunks move it to when they place
 * it at all.
 */
export type Landing =
  | { readonly stays: HeldLines }
  | { readonly reached: boolean; readonly lines?: HeldLines };

/**
 * Whether `edit` reaches what runs in a region of `kind` that it did not leave
 * whole. A text the edit left whole runs as it did, as the recut keeps a row
 * whose text did not move.
 */
export function editReaches(edit: Edit, kind: string): boolean {
  return reaches(edit.hunks.length === 0 ? 'none' : edit.reading, kind);
}

/** Where `edit` leaves `region`, by the rule {@link Landing} names. */
export function landing(edit: Edit, region: Region): Landing {
  if (region.startLine === NO_LINE) return { stays: region };
  const through = placeThrough(edit.hunks, region);
  if (through !== undefined && !through.moved) return { stays: through.lines };
  const reached = editReaches(edit, region.kind);
  return through === undefined ? { reached } : { reached, lines: through.lines };
}

/**
 * Whether an edit along `edits` changed `region`: {@link landing} folded along
 * the chain, the step {@link landedThrough} carries a region's cases by. Each
 * edit starts at the text the one before it ends at, and the region is
 * numbered in the first; a region stays or is spared at the lines one edit
 * leaves it at for the next.
 */
export function regionTouched(region: Region, edits: readonly Edit[]): boolean {
  let lines: HeldLines = region;
  for (const edit of edits) {
    const step = landing(edit, { kind: region.kind, startLine: lines.startLine, endLine: lines.endLine });
    if ('stays' in step) lines = step.stays;
    else if (step.reached) return true;
    else if (step.lines !== undefined) lines = step.lines;
  }
  return false;
}

type Cut = Pick<SetExecutionModule, 'blocks' | 'owner'>;

/** Where the cases a cut of a module held land in a recorded cut of it, region by region. */
export interface RegionPairing {
  /** Per recorded region, the held region its cases carry from, or -1. */
  readonly lands: Int32Array;
  /**
   * Per recorded region the edit reached, the held region whose cases would
   * have landed there, or -1: they ran another text at the region, so whether
   * they cross it is not known. It is -1 wherever `lands` names a region.
   */
  readonly overwrote: Int32Array;
  /**
   * The edit could not be read: no held region is known to land anywhere, so
   * every held case ran another text at every recorded region.
   */
  readonly unread: boolean;
}

/**
 * Where each region of `recorded` takes its cases from in `held`: the held
 * region the edit left alone at its lines, which ran as it did, else the one
 * at its address or what the region around it took, which land only where
 * {@link reaches} says the edit did not reach the region's kind and are
 * overwritten where it did. Without a `change` — a text could not be found —
 * nothing lands, and the pairing says it is `unread`.
 */
export function landedThrough(held: Cut, recorded: Cut, change: Edit | undefined): RegionPairing {
  // FIXME: the snapshot's `carried` in record_coverage_recut.rs pairs by the
  // same rule in Rust; the case index should ask the addon for its landing instead.
  const lands = new Int32Array(recorded.blocks.length).fill(-1);
  const overwrote = new Int32Array(recorded.blocks.length).fill(-1);
  if (change === undefined) return { lands, overwrote, unread: true };
  // The held regions the edit left alone, at the lines it places them, in order.
  const seats = new Map<string, number[]>();
  for (const [at, block] of held.blocks.entries()) {
    const step = landing(change, block);
    if (!('stays' in step)) continue;
    const key = seatOf(block.kind, step.stays.startLine, step.stays.endLine);
    seats.set(key, [...(seats.get(key) ?? []), at]);
  }
  // A recorded region takes the held region of its kind seated at its lines,
  // the n-th of them when several share the lines.
  const seated = new Int32Array(recorded.blocks.length).fill(-1);
  const taken = new Map<string, number>();
  for (const [at, block] of recorded.blocks.entries()) {
    const key = seatOf(block.kind, block.startLine, block.endLine);
    const nth = taken.get(key) ?? 0;
    taken.set(key, nth + 1);
    seated[at] = seats.get(key)?.[nth] ?? -1;
  }
  const occupied = new Set(seated.filter((from) => from >= 0));
  const addressed = new Map<string, number>();
  // The top level is one region in every cut of a module, whatever its branches did.
  const top = held.blocks.findIndex((block) => block.kind === 'module');
  const alike = addressedAlike(held, recorded);
  const heldSeen = new Map<string, number>();
  for (const [at, block] of held.blocks.entries()) addressed.set(addressKey(`${block.name}\0${block.path}`, heldSeen), at);
  const seen = new Map<string, number>();
  // What each recorded region took before the edit's reach was asked. A region
  // with neither a seat nor an address was written by the edit, or cannot be
  // told from a sibling, and takes what the region around it took, as the
  // recut's `decided` does: a superset, never a sibling's cases.
  const decided = new Int32Array(recorded.blocks.length).fill(-1);
  for (const [at, block] of recorded.blocks.entries()) {
    const address = addressKey(`${block.name}\0${block.path}`, seen);
    if (seated[at]! >= 0) {
      decided[at] = lands[at] = seated[at]!;
      continue;
    }
    // Unseated, it pairs by address, as `carried` pairs rows: the n-th region
    // of a name and structural path, of its kind, where both cuts hold the
    // address as many times and seated every counter it passes through alike
    // ({@link addressedAlike}), and the held one is not seated.
    const was = block.kind === 'module' && top >= 0 ? top : alike(block) ? addressed.get(address) : undefined;
    const owner = recorded.owner?.[at];
    decided[at] = was !== undefined && !occupied.has(was) && held.blocks[was]!.kind === block.kind
      ? was
      : owner === undefined || owner === NO_OWNER ? -1 : decided[owner]!;
    // Where the edit reached its kind, those cases ran another text there.
    if (!editReaches(change, block.kind)) lands[at] = decided[at]!;
    else overwrote[at] = decided[at]!;
  }
  return { lands, overwrote, unread: false };
}

function seatOf(kind: string, startLine: number, endLine: number): string {
  return `${kind}\0${startLine}\0${endLine}`;
}
