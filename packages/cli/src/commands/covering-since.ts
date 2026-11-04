// compass: variance-authority.reach
/**
 * `variance covering --since`: the lines a diff changed, in the record's
 * coordinates, and each changed region stated over every case that reached it.
 */

import { readFile, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { backThrough, changedLines, diffTexts, hunksByFile, type CoveringRegion, type Hunk, type LineRange } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { renamesBetween, requireCommit, unreadDiff } from './base-diff.js';
import { regionState } from './covering-frame.js';
import { diffPoint, diffSince, gitIn, topLevel } from './since.js';
import type { StatedRegion } from './covering.js';

/** A changed region as `--where` lists it, stated, with the cases that stopped, over every case that reached it. */
export function stated(listed: CoveringRegion, reached: CoveringRegion): StatedRegion {
  const { stopped: _, ...region } = listed;
  const state = regionState(reached);
  return {
    ...region,
    ...(reached.stopped === undefined ? {} : { stopped: reached.stopped }),
    ...(state === undefined ? {} : { state }),
  };
}

/** A `-U0` diff to the working tree: its lines by the old side's numbers, and the hunks that say where they stand in the tree. */
interface ChangeRead {
  readonly lines: ReadonlyMap<string, readonly LineRange[]>;
  readonly hunks: ReadonlyMap<string, readonly Hunk[]>;
}

/** What a change changed, read once for every suite asked: the commit it parted from `since` at, and its diff from there, with no lines when it changed nothing. */
export interface ListedChange extends ChangeRead {
  readonly base: string;
}

/** The change in a record's coordinates: its lines by the names the record holds, and the name the change has for each it holds under another. */
export interface RecordedChange {
  readonly lines: ReadonlyMap<string, readonly LineRange[]>;
  readonly names: ReadonlyMap<string, string>;
}

/** One file's side of the diff from a record. Absent when that diff does not show the file: the record holds it as the tree does. */
interface RecordedFile {
  readonly ranges: readonly LineRange[] | undefined;
  readonly hunks: readonly Hunk[] | undefined;
}

const readChange = (diff: string): ChangeRead => ({ lines: changedLines(diff), hunks: hunksByFile(diff) });

/**
 * The change since `since`'s merge base. A ref that does not read is one
 * refusal, before any record is read: every suite would give it the same way.
 */
export async function listedChange(since: string): Promise<ListedChange> {
  const base = (await diffPoint(since))?.base;
  const diff = base === undefined ? undefined : await diffSince(since, [], base, { unified: 0 });
  if (base === undefined || diff === undefined) {
    throw new OperatorError(
      `\`--since ${since}\` could not be read as a diff. Check the ref exists and that this is a git checkout ` +
        '(a shallow CI clone needs every commit: `fetch-depth: 0` with `filter: tree:0`); ' +
        'an empty answer here would read as `your change touches nothing`.',
      { kind: 'undiffed' },
    );
  }
  return { base, ...readChange(diff) };
}

/**
 * Every line the change changed, in the index's coordinates. The listed change
 * is the scope and the commit the record was written at only says how to read
 * it, since a hunk read at another end lands on another region: every file
 * listed stays, however much of it that record already holds.
 */
export async function changeSince(listed: ListedChange, since: string, root: string, at: string | undefined): Promise<RecordedChange> {
  const read = at === undefined || at === listed.base ? { lines: listed.lines, names: new Map<string, string>() } : await theChangeIn(await readFrom(at, since, root), listed, at);

  // `git` names files from the repository root and the index from the run's. The working directory is always
  // a real path and `--root` is spelled however the caller spelled it; through a symlink (`/var` on macOS) the
  // two never meet.
  const here = process.cwd();
  const base = await realpath(root);
  const rooted = (file: string): string => (here === base ? file : relative(base, resolve(here, file)));
  return {
    lines: new Map([...read.lines].map(([file, ranges]) => [rooted(file), ranges])),
    names: new Map([...read.names].map(([held, file]) => [rooted(held), rooted(file)])),
  };
}

/**
 * The listed change read from the record's commit. A file the record holds
 * under the name it had there is read under that name, the mainline having
 * renamed it since. A file the record does not hold stays listed, for the
 * answer to say so.
 */
async function theChangeIn(read: ChangeRead, listed: ListedChange, at: string): Promise<RecordedChange> {
  const moved = await movedSince(read, listed, at);
  const lines = new Map<string, readonly LineRange[]>();
  const names = new Map<string, string>();
  for (const [file, whole] of listed.lines) {
    const change = listed.hunks.get(file);
    const held = moved.get(file);
    if (held === undefined) {
      lines.set(file, inRecord({ ranges: read.lines.get(file), hunks: read.hunks.get(file) }, change, whole));
      continue;
    }
    lines.set(held.name, held.read === undefined ? [] : inRecord(held.read, change, whole));
    names.set(held.name, file);
  }
  return { lines, names };
}

/** A listed file the record does not hold and git says it holds under another name, with that file's diff from the record, absent when it did not read. */
async function movedSince(read: ChangeRead, listed: ListedChange, at: string): Promise<ReadonlyMap<string, { readonly name: string; readonly read: RecordedFile | undefined }>> {
  const unheld = [...listed.lines.keys()].filter((file) => unheldBy(read.hunks.get(file), listed.hunks.get(file)));
  if (unheld.length === 0) return new Map();
  const here = process.cwd();
  const renames = await renamesBetween(at, listed.base, here).catch(() => {
    throw new OperatorError(unreadDiff('The record', at), { kind: 'undiffed' });
  });
  const moved = await Promise.all(unheld.map(async (file) => {
    const name = renames.get(file);
    // The old name in the change is a file the change wrote there: a different name is a different file.
    if (name === undefined || listed.lines.has(name)) return [];
    // A file the change deleted has no text in the tree, and its diff from the record removes every line.
    return [[file, { name, read: fromRecord(name, at, await readFile(join(here, file), 'utf8').catch(() => '')) }] as const];
  }));
  return new Map(moved.flat());
}

/** Whether a record lacks a listed file: its diff from there adds the file, or shows nothing of a file the change left with no lines, which it would show had the record held it. */
function unheldBy(fromRecord: readonly Hunk[] | undefined, change: readonly Hunk[] | undefined): boolean {
  if (fromRecord !== undefined) return fromRecord.some((hunk) => hunk.oldStart === 0 && hunk.oldCount === 0);
  return change?.some((hunk) => hunk.newStart === 0 && hunk.newCount === 0) === true;
}

/** The diff of `name` as commit `at` holds it to `text`, absent when git read neither. */
function fromRecord(name: string, at: string, text: string): RecordedFile | undefined {
  try {
    const body = diffTexts(gitIn(process.cwd())('show', `${at}:./${name}`), text);
    if (body === '') return { ranges: undefined, hunks: undefined };
    const { lines, hunks } = readChange(`--- a/${name}\n+++ b/${name}\n${body}`);
    return { ranges: lines.get(name), hunks: hunks.get(name) };
  } catch {
    return undefined;
  }
}

/**
 * One listed file in the record's numbers. The record's own hunks that meet the
 * change stay whole, as hunks are the grain where both sides wrote, and every
 * other line of the change is carried back to the line the record holds it on.
 * A file either diff shows no lines of, a binary, is held at file grain.
 */
function inRecord(file: RecordedFile, change: readonly Hunk[] | undefined, whole: readonly LineRange[]): readonly LineRange[] {
  const { ranges, hunks = [] } = file;
  if (change === undefined || change.length === 0) return ranges ?? whole;
  if (ranges !== undefined && hunks.length === 0) return ranges;
  const met = hunks.filter((hunk) => change.some((other) => meet(hunk, other)));
  const written = (ranges ?? []).filter((range) => met.some((hunk) => charged(range, hunk)));
  return [...written, ...change.flatMap((hunk) => carried(hunk, hunks))].sort((one, other) => one.start - other.start || one.end - other.end);
}

/** The lines the record holds that a hunk of the change stands on: a line a hunk from the record wrote has none, and a removal no such hunk met charges the lines either side of it. */
function carried(change: Hunk, hunks: readonly Hunk[]): readonly LineRange[] {
  if (change.newCount === 0) {
    if (hunks.some((hunk) => meet(hunk, change))) return [];
    const line = change.newStart === 0 ? 0 : backThrough(hunks, change.newStart);
    return line === undefined ? [] : [{ start: Math.max(line, 1), end: line + 1 }];
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

/** Whether `changedLines` charged a range to this hunk: its old lines, and the line past them a gap it opened reaches. */
function charged(range: LineRange, hunk: Hunk): boolean {
  return range.start >= hunk.oldStart && range.end <= hunk.oldStart + Math.max(hunk.oldCount, 1);
}

/** The diff from `at`. The listed change read, so what git could not read is from the record's commit. */
async function readFrom(at: string, since: string, root: string): Promise<ChangeRead> {
  const diff = await diffSince(since, [], at, { unified: 0 });
  if (diff !== undefined) return readChange(diff);
  await requireCommit(at, (await topLevel(root)) ?? root, 'The record');
  throw new OperatorError(unreadDiff('The record', at), { kind: 'undiffed' });
}

/** The refusal of a change with no region in it: each suite's reason, when a question reads them all. */
export function nothingChanged(since: string): OperatorError {
  return new OperatorError(`nothing has changed since \`${since}\`, so there is no region to ask about.`);
}
