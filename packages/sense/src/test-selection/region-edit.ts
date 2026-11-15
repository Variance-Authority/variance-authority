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
import { reaches, readEdit, type EditReading } from './edit-readings.js';
import { keptTexts } from './kept-texts.js';
import { hunksOf, placeThrough, type HeldLines, type Hunk } from './placed.js';
import { blobsAt, textAtRecording } from './recorded-text.js';
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
 * Where a reader of edits finds a text besides the ones it finds by digest: the
 * name the source index gives each file now, and the texts the reader already
 * holds, by file and name.
 */
export interface TextNames {
  /** The git name the source index gives `file`'s text in the checkout now, or none. */
  readonly now?: (file: string) => string | undefined;
  /** A text of `file` the reader already holds by `name`, or none. */
  readonly inHand?: (file: string, name: string) => string | undefined;
}

/**
 * A reader of the edit one module went from the text `from` names to the text
 * `to` names, each a digest (`v1:`) or a git blob name (`git:`). Two names that
 * agree are no edit and read no text. `undefined` when either text cannot be
 * had, a file that does not read among them. Each text and edit is read once.
 */
export function editsBetween(
  root: string,
  cacheRoot: string | undefined,
  commits: readonly (string | undefined)[],
  names: TextNames = {},
): Edits {
  const kept = keptTexts(root, cacheRoot);
  const atRecording = textAtRecording(root, []);
  const at = [...new Set(commits)].filter((commit) => commit !== undefined);
  const onDisk = (file: string): string | undefined => {
    try {
      return readFileSync(resolve(root, file), 'utf8');
    } catch {
      return undefined;
    }
  };
  // A digest's text is kept by a landing, at a commit the record names, or on disk, and taken only when it hashes so.
  const byDigest = (file: string, digest: string): string | undefined => {
    const text = kept(digest);
    if (text !== undefined) return text;
    for (const commit of at) {
      const found = hashingTo(atRecording(file, commit), digest);
      if (found !== undefined) return found;
    }
    return hashingTo(onDisk(file), digest);
  };
  // A git name's is on disk when the source index names the file so now, else at a commit holding it by that name.
  const byGitName = (file: string, name: string): string | undefined => {
    if (names.now?.(file) === name) return onDisk(file);
    if (at.length === 0) return undefined;
    const held = blobsAt(root, new Map(at.map((commit) => [commit, [file]])));
    const commit = at.find((each) => held.get(each)?.get(file) === name);
    return commit === undefined ? undefined : atRecording(file, commit);
  };
  const texts = new Map<string, string | undefined>();
  const textOf = (file: string, name: string): string | undefined => {
    const key = `${file}\0${name}`;
    if (texts.has(key)) return texts.get(key);
    const text = names.inHand?.(file, name) ?? (name.startsWith('git:') ? byGitName(file, name) : byDigest(file, name));
    texts.set(key, text);
    return text;
  };
  const edits = new Map<string, Edit | undefined>();
  return (file, from, to) => {
    if (from === to) return NO_EDIT;
    const key = `${file}\0${from}\0${to}`;
    if (edits.has(key)) return edits.get(key);
    const [before, after] = [textOf(file, from), textOf(file, to)];
    const edit = before === undefined || after === undefined ? undefined : editOf(root, file, before, after);
    edits.set(key, edit);
    return edit;
  };
}

/** The edit `file` went through from the text `before` to the text `after`, both in hand. */
function editOf(root: string, file: string, before: string, after: string): Edit {
  const reading = readEdit(root, file, before, after);
  return { hunks: hunksOf(diffTexts(before, after)), ...(reading === undefined ? {} : { reading }) };
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
type Landing =
  | { readonly stays: HeldLines }
  | { readonly reached: boolean; readonly lines?: HeldLines };

/**
 * Whether `edit` reaches what runs in a region of `kind` that it did not leave
 * whole. A text the edit left whole runs as it did, as the recut keeps a row
 * whose text did not move.
 */
function editReaches(edit: Edit, kind: string): boolean {
  return reaches(edit.hunks.length === 0 ? 'none' : edit.reading, kind);
}

/** Where `edit` leaves `region`, by the rule {@link Landing} names. */
function landing(edit: Edit, region: Region): Landing {
  if (region.startLine === NO_LINE) return { stays: region };
  const through = placeThrough(edit.hunks, region);
  if (through !== undefined && !through.moved) return { stays: through.lines };
  const reached = editReaches(edit, region.kind);
  return through === undefined ? { reached } : { reached, lines: through.lines };
}

/**
 * Whether an edit along `edits` changed `region`: {@link landing} folded along
 * the chain, the step the case layering carries a region's cases by
 * (`native/src/case_layer_landing.rs`). Each
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
