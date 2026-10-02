import { askCoverageFile } from './coverage-file.js';
import { diffPath } from './diff-lines.js';
import { frameOf } from './frame.js';
import { keptTexts } from './kept-texts.js';
import { findModules } from './lookup.js';
import { textAtRecording } from './recorded-text.js';
import { diffTexts } from './text-diff.js';

/** Lines of the text an editor holds, inclusive. */
export interface HeldLines {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Where a file's recorded line numbers stand in the text somebody holds now.
 *
 * - `recorded`: the text is the one the suite ran over, so every line number
 *   is already a place in it.
 * - `mapped`: the text differs, and the text the suite ran over was found at
 *   the recorded commit. {@link Placement.place} carries each range through the
 *   lines the edit left alone.
 * - `stale`: the text differs and the recorded text cannot be found, so no
 *   recorded line number is a place in anything held.
 */
export interface Placement {
  readonly frame: 'recorded' | 'mapped' | 'stale';
  /** The commit the record stands at, when it says. */
  readonly at?: string;
  /**
   * A recorded range in the held text. `moved` when an edit touched it, with
   * the lines it spans now; absent when the edit removed every line of it.
   */
  place(range: HeldLines): { readonly lines: HeldLines; readonly moved: boolean } | undefined;
  /** The recorded line a held line was, or absent when an edit wrote it. */
  recordedLine(line: number): number | undefined;
}

/**
 * Frame one file's text against the snapshot that recorded it.
 *
 * The recorder wrote a digest of every module's text beside its rows, so the
 * snapshot answers whether a text is the one it measured; `frameOf` asks it,
 * once for the held text and once for the text at the recorded commit — or,
 * for a run recorded over an edit, the text its landing kept. The
 * line map between the recorded text and the held one is git's: `diff
 * --no-index` over the two, which is the same hunk arithmetic every other
 * reading of a change here takes from git.
 *
 * Absent when the snapshot holds no instrumented row for the file, so there is
 * no digest to hold the text against — which is not a frame, and not `stale`.
 */
export function placeInText(snapshot: string, root: string, file: string, text: string): Placement | undefined {
  const asked = askCoverageFile(snapshot, (coverage) => {
    const rows = findModules(coverage, file).filter((module) => coverage.moduleInstrumented.at(module) === 1);
    if (rows.length === 0) return undefined;
    const rowsOf = new Map([[file, rows]]);
    const held = frameOf(coverage, [file], rowsOf, () => text);
    if (held !== 'stale') return { frame: 'recorded' as const, commit: coverage.commit };
    const recorded = frameOf(coverage, [file], rowsOf, textAtRecording(root, [file]), keptTexts(root));
    return typeof recorded === 'string'
      ? { frame: 'stale' as const, commit: coverage.commit }
      : { frame: 'mapped' as const, commit: coverage.commit, text: recorded.text };
  });
  if (asked === undefined) return undefined;
  const at = asked.commit === undefined ? {} : { at: asked.commit };
  if (asked.frame === 'recorded') {
    return { frame: 'recorded', ...at, place: (lines) => ({ lines, moved: false }), recordedLine: (line) => line };
  }
  if (asked.frame === 'stale') {
    return { frame: 'stale', ...at, place: () => undefined, recordedLine: () => undefined };
  }
  const hunks = hunksBetween(asked.text, text);
  return { frame: 'mapped', ...at, place: (lines) => placeThrough(hunks, lines), recordedLine: (line) => backThrough(hunks, line) };
}

/** One `-U0` hunk: old lines `oldStart..+oldCount` became new `newStart..+newCount`. */
export interface Hunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
}

function hunksBetween(recorded: string, held: string): readonly Hunk[] {
  return hunksOf(diffTexts(recorded, held));
}

/** The hunk headers of a `-U0` diff, in order. */
export function hunksOf(diff: string): readonly Hunk[] {
  const hunks: Hunk[] = [];
  for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunks.push({
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4]),
    });
  }
  return hunks;
}

/**
 * The hunks of a `-U0` diff over many files, by the name each file had on the
 * old side, or the new one for a file the old side did not have. A file whose
 * lines the diff does not show — unchanged, or only its mode — is not held, and
 * a reader takes its lines where they were.
 */
export function hunksByFile(diff: string): ReadonlyMap<string, readonly Hunk[]> {
  const byFile = new Map<string, readonly Hunk[]>();
  for (const part of diff.split(/^(?=diff --git )/mu)) {
    const old = /^--- (.*)$/mu.exec(part);
    const added = /^\+\+\+ (.*)$/mu.exec(part);
    const file = (old === null ? undefined : diffPath(old[1]!)) ?? (added === null ? undefined : diffPath(added[1]!));
    if (file !== undefined) byFile.set(file, hunksOf(part));
  }
  return byFile;
}

/**
 * A recorded range in the held text.
 *
 * A hunk that removes or rewrites none of its lines and inserts none between
 * them leaves it whole, shifted by what came before. Any other hunk touching it
 * makes it `moved`, spanning from where its first line went to where its last
 * went. `git` writes a pure insertion after old line `oldStart`, and a pure
 * removal before new line `newStart + 1`.
 */
export function placeThrough(hunks: readonly Hunk[], range: HeldLines): { readonly lines: HeldLines; readonly moved: boolean } | undefined {
  let shift = 0;
  let moved = false;
  let start: number | undefined;
  let end: number | undefined;
  let removed = 0;
  for (const hunk of hunks) {
    const oldEnd = hunk.oldStart + hunk.oldCount - 1;
    if (hunk.oldCount === 0) {
      if (hunk.oldStart < range.startLine) shift += hunk.newCount;
      else if (hunk.oldStart < range.endLine) moved = true;
      continue;
    }
    if (oldEnd < range.startLine) {
      shift += hunk.newCount - hunk.oldCount;
      continue;
    }
    if (hunk.oldStart > range.endLine) break;
    moved = true;
    const newEnd = hunk.newStart + Math.max(hunk.newCount, 1) - 1;
    if (hunk.oldStart <= range.startLine) start = hunk.newCount === 0 ? hunk.newStart + 1 : hunk.newStart;
    if (oldEnd >= range.endLine) end = hunk.newCount === 0 ? hunk.newStart : newEnd;
    removed += Math.min(oldEnd, range.endLine) - Math.max(hunk.oldStart, range.startLine) + 1;
  }
  if (removed === range.endLine - range.startLine + 1 && !hunks.some((hunk) =>
    hunk.newCount > 0 && hunk.oldStart <= range.endLine && hunk.oldStart + hunk.oldCount - 1 >= range.startLine)) {
    return undefined;
  }
  if (!moved) return { lines: { startLine: range.startLine + shift, endLine: range.endLine + shift }, moved };
  const startLine = start ?? range.startLine + shift;
  const endLine = end ?? range.endLine + shiftBefore(hunks, range.endLine);
  return { lines: { startLine, endLine: Math.max(startLine, endLine) }, moved };
}

/** How far the edit moved an old line nothing touched. */
function shiftBefore(hunks: readonly Hunk[], line: number): number {
  let shift = 0;
  for (const hunk of hunks) {
    const before = hunk.oldCount === 0 ? hunk.oldStart < line : hunk.oldStart + hunk.oldCount - 1 < line;
    if (before) shift += hunk.newCount - hunk.oldCount;
  }
  return shift;
}

/** The recorded line a held line was, or absent when a hunk wrote it. */
export function backThrough(hunks: readonly Hunk[], line: number): number | undefined {
  let shift = 0;
  for (const hunk of hunks) {
    if (hunk.newCount > 0 && line >= hunk.newStart && line < hunk.newStart + hunk.newCount) return undefined;
    const newEnd = hunk.newCount === 0 ? hunk.newStart : hunk.newStart + hunk.newCount - 1;
    if (newEnd < line) shift += hunk.newCount - hunk.oldCount;
  }
  return line - shift;
}
