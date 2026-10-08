// compass: variance-authority/runtime/attention
/**
 * One changed region as a review names it: how a case reached it, what kind of
 * edit wrote it, and how many cases ran the lines that changed.
 *
 * A function a case entered is not a function whose changed lines ran: a test
 * can call `cap` and take the branch the change left alone. So the count a
 * reviewer acts on is the cases that entered the function and that `variance
 * covering --line` names for a changed line in it, and the count of cases that
 * entered the function stays beside it. A function's first and last lines also
 * name the cases of the block around it, which never called the function, so
 * only cases that entered it are counted.
 *
 * The kind of edit is read from the diff's own text. A region every line of
 * words of which the change wrote is new, unless those lines are text the diff
 * removed somewhere, which makes it moved. Anything else is modified.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  distanceToSource,
  hunksOf,
  type CoveringRegion,
  type LineRange,
  type SourceTestRange,
} from '@variance-authority/sense/test-selection';
import type { Relations } from '@variance-authority/core/relate';
import { codeUnitOrder as order } from '@variance-authority/core/segment';
import { regionState } from './covering-frame.js';
import type { Reach, ReviewRegion } from './review.js';

/** The test files near a changed module, and those whose distance to it was not measured. */
export interface Bearings {
  readonly near: ReadonlySet<string>;
  readonly unmeasured: ReadonlySet<string>;
}

/** What kind of edit wrote a region, and where moved text came from. */
export interface Edit {
  readonly edit: ReviewRegion['edit'];
  readonly movedFrom?: string;
}

/** A moved region holds this many lines of words at least: one line alone is too common to say where it came from. */
const MOVED_LINES = 2;

const WORDS = /[\p{L}\p{N}]/u;

/** The text a diff removed, and which files each removed line of words left. */
export interface Removed {
  /**
   * Per file, one trimmed line of words per removed line, with `\0` where
   * removed text stops: at a hunk, at a line kept, at a line written. A file
   * the diff removed no words from has no entry.
   */
  readonly texts: ReadonlyMap<string, string>;
  /** The files each removed line left, in code-unit order, so a region is looked for only where its first line went. */
  readonly holders: ReadonlyMap<string, readonly string[]>;
}

/** The text `diff` removed, read once for every region the review labels. */
export function removedText(diff: string): Removed {
  const texts = new Map<string, string>();
  const holders = new Map<string, string[]>();
  for (const [file, hunks] of hunksOf(diff)) {
    const held: string[] = [];
    const stop = (): void => {
      if (held.at(-1) !== '\0') held.push('\0');
    };
    for (const hunk of hunks) {
      stop();
      for (const line of hunk.lines) {
        if (line.startsWith('-')) {
          const text = line.slice(1).trim();
          if (WORDS.test(text)) held.push(text);
        } else if (!line.startsWith('\\') && WORDS.test(line)) stop();
      }
    }
    if (!held.some((text) => text !== '\0')) continue;
    texts.set(file, `\n${held.join('\n')}\n`);
    for (const text of new Set(held)) if (text !== '\0') holders.set(text, [...(holders.get(text) ?? []), file]);
  }
  for (const files of holders.values()) files.sort(order);
  return { texts, holders };
}

/**
 * What kind of edit wrote `region`, from the tree's `lines` and the diff's
 * removed text. With no tree text, every line of the span counts as words.
 */
export function editOf(
  region: { readonly startLine: number; readonly endLine: number },
  ranges: readonly LineRange[],
  lines: readonly string[] | undefined,
  file: string,
  removed: Removed,
): Edit {
  const written = (line: number): boolean => ranges.some((range) => range.start <= line && line <= range.end);
  const span = Array.from({ length: Math.max(region.endLine - region.startLine + 1, 0) }, (_, at) => region.startLine + at);
  const worded = lines === undefined ? [] : span.filter((line) => WORDS.test(lines[line - 1] ?? ''));
  const counted = worded.length === 0 ? span : worded;
  if (span.length === 0 || !counted.every(written)) return { edit: 'modified' };
  if (worded.length < MOVED_LINES) return { edit: 'new' };
  const texts = worded.map((line) => lines![line - 1]!.trim());
  const holders = removed.holders.get(texts[0]!) ?? [];
  const needle = `\n${texts.join('\n')}\n`;
  const from = [file, ...holders.filter((path) => path !== file)]
    .find((path) => holders.includes(path) && removed.texts.get(path)?.includes(needle) === true);
  return from === undefined ? { edit: 'new' } : { edit: 'moved', movedFrom: from };
}

/**
 * Each changed region of one file as a review names it. `ran` is the file's
 * covering ranges, `coveringTestsInFile`'s answer over the review's recording:
 * the cases charged with each line, the reading `variance covering --line`
 * gives, read in one pass.
 */
export function regionsOf(
  regions: readonly CoveringRegion[],
  bearings: Bearings | undefined,
  ranges: readonly LineRange[],
  lines: readonly string[] | undefined,
  file: string,
  removed: Removed,
  ran: readonly SourceTestRange[],
): ReviewRegion[] {
  return regions.map((region) => {
    const called = region.tests.filter((test) => test.loaded !== true);
    const state = regionState(region);
    const reach: Reach = called.some((test) => bearings?.near.has(test.file) === true)
      ? 'near'
      : called.some((test) => bearings === undefined || bearings.unmeasured.has(test.file))
        ? 'unplaced'
        : called.length > 0
          ? 'far'
          : state === 'loaded' || state === 'hole' || state === 'unwalked'
            ? state
            : 'unknown';
    const entered = new Set(called.map((test) => test.id));
    const changedLines = new Set<string>();
    for (const range of ranges) {
      const first = Math.max(range.start, region.startLine);
      const last = Math.min(range.end, region.endLine);
      if (first > last) continue;
      for (const covering of ran) {
        if (covering.endLine < first || covering.startLine > last) continue;
        for (const test of covering.tests) if (entered.has(test.id)) changedLines.add(test.id);
      }
    }
    return {
      kind: region.kind, name: region.name,
      startLine: region.startLine, endLine: region.endLine,
      reach,
      ...editOf(region, ranges, lines, file, removed),
      cases: called.length,
      changedLineCases: changedLines.size,
      tests: [...new Set(called.map((test) => test.file))].sort(order),
      called: called
        .map((test) => ({ id: test.id, file: test.file, name: test.name, ...(test.preconditions === undefined ? {} : { preconditions: test.preconditions }) }))
        .sort((left, right) => order(left.file, right.file) || order(left.name, right.name)),
    };
  });
}

/** The tree's text of a changed file as lines, or absent when it cannot be read. */
export async function treeLines(root: string, file: string): Promise<readonly string[] | undefined> {
  const text = await readFile(resolve(root, file), 'utf8').catch(() => undefined);
  return text?.split(/\r?\n/);
}

/**
 * For each changed module, the test files one import away from it or declaring
 * it: the tests a reviewer expects to exercise it. Measured by the file graph
 * over what each test executed, not by where the files sit. A test the graph
 * does not hold, such as one written after the source index was published, is
 * kept apart, so a region only it covered is not called far.
 */
export async function nearTests(
  coverageFile: string,
  files: readonly string[],
  relations: Relations,
): Promise<ReadonlyMap<string, Bearings>> {
  const bearings = new Map<string, Bearings>();
  for (const file of files) {
    const { distances } = await distanceToSource(coverageFile, { file }, { relations });
    const tests = (kept: (bearing: string) => boolean): ReadonlySet<string> =>
      new Set(distances.filter((distance) => kept(distance.bearing)).map((distance) => distance.test));
    bearings.set(file, {
      near: tests((bearing) => bearing === 'direct' || bearing === 'precondition'),
      unmeasured: tests((bearing) => bearing === 'unmeasured'),
    });
  }
  return bearings;
}
