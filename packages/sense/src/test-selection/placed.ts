import { askCoverageFile } from './coverage-file.js';
import { changedLines, diffPath, gapAfter, type LineRange } from './diff-lines.js';
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
  /** The text the record's lines are numbered in: the held one under `recorded`, the one found under `mapped`. */
  readonly recorded?: string;
  /**
   * A recorded range in the held text. `moved` when an edit touched it, with
   * the lines it spans now; absent when the edit removed every line of it.
   */
  place(range: HeldLines): { readonly lines: HeldLines; readonly moved: boolean } | undefined;
  /** The recorded line a held line was, or absent when an edit wrote it. */
  recordedLine(line: number): number | undefined;
}

/**
 * Frame each held text against the snapshot that recorded its file, by the
 * digest the recorder wrote beside its rows (`frameOf`), and map its lines from
 * the recorded text, the one at the recorded commit or the one its landing
 * kept, by git's `diff --no-index`. A file with no instrumented row is absent.
 */
export function placeInTexts(snapshot: string, root: string, texts: ReadonlyMap<string, string>): ReadonlyMap<string, Placement> {
  // The snapshot is opened once, and the recorded texts are read together.
  const asked = askCoverageFile(snapshot, (coverage) => {
    const sourceAt = textAtRecording(root, texts.keys());
    const kept = keptTexts(root);
    const frames = new Map<string, { readonly frame: 'recorded' } | { readonly frame: 'stale' } | { readonly frame: 'mapped'; readonly text: string }>();
    for (const [file, text] of texts) {
      const rows = findModules(coverage, file).filter((module) => coverage.moduleInstrumented.at(module) === 1);
      // No digest to hold the text against, which is not a frame, and not `stale`.
      if (rows.length === 0) continue;
      const rowsOf = new Map([[file, rows]]);
      if (frameOf(coverage, [file], rowsOf, () => text) !== 'stale') {
        frames.set(file, { frame: 'recorded' });
        continue;
      }
      const recorded = frameOf(coverage, [file], rowsOf, sourceAt, kept);
      frames.set(file, typeof recorded === 'string' ? { frame: 'stale' } : { frame: 'mapped', text: recorded.text });
    }
    return { commit: coverage.commit, frames };
  });
  const at = asked.commit === undefined ? {} : { at: asked.commit };
  const placements = new Map<string, Placement>();
  for (const [file, framed] of asked.frames) {
    const text = texts.get(file)!;
    if (framed.frame === 'stale') {
      placements.set(file, { frame: 'stale', ...at, place: () => undefined, recordedLine: () => undefined });
    } else if (framed.frame === 'recorded') {
      placements.set(file, { frame: 'recorded', ...at, recorded: text, place: (lines) => ({ lines, moved: false }), recordedLine: (line) => line });
    } else {
      const hunks = hunksBetween(framed.text, text);
      placements.set(file, {
        frame: 'mapped', ...at, recorded: framed.text, place: (lines) => placeThrough(hunks, lines), recordedLine: (line) => backThrough(hunks, line),
      });
    }
  }
  return placements;
}

/** {@link placeInTexts} for one file. */
export function placeInText(snapshot: string, root: string, file: string, text: string): Placement | undefined {
  return placeInTexts(snapshot, root, new Map([[file, text]])).get(file);
}

/**
 * A range of the text `from` placed in the text `to`, through git's line map
 * between the two: whole and unmoved when no hunk touched it, `moved` when one
 * did, absent when the edit removed every line of it. `covering` reads it with
 * the held text as `from` and the text a test file ran over as `to`, so a line
 * or a function an edit elsewhere in the file left alone is the same in both.
 */
export function placeAcross(from: string, to: string): Placement['place'] {
  const hunks = hunksBetween(from, to);
  return (range) => placeThrough(hunks, range);
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
  return new Map(fileParts(diff).map(([file, part]) => [file, hunksOf(part)]));
}

/** A diff cut by file, under the name {@link hunksByFile} gives each. */
function fileParts(diff: string): readonly (readonly [string, string])[] {
  const parts: (readonly [string, string])[] = [];
  for (const part of diff.split(/^(?=diff --git )/mu)) {
    const old = /^--- (.*)$/mu.exec(part);
    const added = /^\+\+\+ (.*)$/mu.exec(part);
    const file = (old === null ? undefined : diffPath(old[1]!)) ?? (added === null ? undefined : diffPath(added[1]!));
    if (file !== undefined) parts.push([file, part]);
  }
  return parts;
}

/** A `-U0` diff read for its lines and for the hunks that say where they stand on the new side. */
export interface ChangeRead {
  readonly lines: ReadonlyMap<string, readonly LineRange[]>;
  readonly hunks: ReadonlyMap<string, readonly Hunk[]>;
}

/** A hunk, with the lines `changedLines` charged to it alone. */
interface ChargedHunk {
  readonly hunk: Hunk;
  readonly lines: readonly LineRange[];
}

/** One file's part of a diff, hunk by hunk: `changedLines` reads each under the file's header. */
function chargedHunks(part: string): readonly ChargedHunk[] {
  const [header = '', ...bodies] = part.split(/^(?=@@ )/mu);
  return bodies.map((body) => ({ hunk: hunksOf(body)[0]!, lines: [...changedLines(header + body).values()].flat() }));
}

/**
 * A change listed from one commit, read in the numbers of another: `diff` runs
 * from that other commit to the same tree. Every file listed stays. A line
 * cannot be carried by {@link placeThrough} here: a line the record's side wrote
 * has no place to go, and a hunk both sides wrote is read at its own grain.
 */
export function changeInRecord(diff: string, listed: ChangeRead): ReadonlyMap<string, readonly LineRange[]> {
  const lines = changedLines(diff);
  const hunks = new Map(fileParts(diff).map(([file, part]) => [file, chargedHunks(part)]));
  return new Map([...listed.lines].map(([file, whole]) => [file, inRecord(lines.get(file), hunks.get(file) ?? [], listed.hunks.get(file), whole)]));
}

/**
 * One listed file in the record's numbers. The record's own hunks that meet the
 * change stay whole, as hunks are the grain where both sides wrote, and every
 * other line of the change is carried back to the line the record holds it on.
 * A file either diff shows no lines of, a binary, is held at file grain.
 */
function inRecord(ranges: readonly LineRange[] | undefined, hunks: readonly ChargedHunk[], change: readonly Hunk[] | undefined, whole: readonly LineRange[]): readonly LineRange[] {
  if (change === undefined || change.length === 0) return ranges ?? whole;
  if (ranges !== undefined && hunks.length === 0) return ranges;
  const written = hunks.filter(({ hunk }) => change.some((other) => meet(hunk, other))).flatMap(({ lines }) => lines);
  const held = hunks.map(({ hunk }) => hunk);
  return [...written, ...change.flatMap((hunk) => carried(hunk, held))].sort((one, other) => one.start - other.start || one.end - other.end);
}

/** The lines the record holds that a hunk of the change stands on: a line a hunk from the record wrote has none, and a removal no such hunk met opens a gap there. */
function carried(change: Hunk, hunks: readonly Hunk[]): readonly LineRange[] {
  if (change.newCount === 0) {
    if (hunks.some((hunk) => meet(hunk, change))) return [];
    const line = backThrough(hunks, change.newStart);
    return line === undefined ? [] : [gapAfter(line)];
  }
  const runs: { start: number; end: number }[] = [];
  for (let at = change.newStart; at < change.newStart + change.newCount; at++) {
    const line = backThrough(hunks, at);
    if (line === undefined) continue;
    const run = runs.at(-1);
    if (run?.end === line - 1) run.end = line;
    else runs.push({ start: line, end: line });
  }
  return runs;
}

/** Whether two hunks' new sides share a line of the tree. A pure removal has no line, so its position meets what touches it. */
function meet(one: Hunk, other: Hunk): boolean {
  const [from, to] = [treeSpan(one), treeSpan(other)];
  if (one.newCount === 0 || other.newCount === 0) return from.start <= to.end && to.start <= from.end;
  return from.start < to.end && to.start < from.end;
}

/** A hunk's new side as offsets between the tree's lines. Git names the line a pure removal follows, so its offset is that line's end. */
function treeSpan(hunk: Hunk): { readonly start: number; readonly end: number } {
  const start = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
  return { start, end: start + hunk.newCount };
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
