// compass: variance-authority/runtime/attention
/**
 * One changed region as a review names it: how a case reached it, what kind of
 * edit wrote it, and how many cases ran the lines that changed.
 *
 * A function a case entered is not a function whose changed lines ran: a test
 * can call `cap` and take the branch the change left alone. So the count a
 * reviewer acts on is read from the innermost region holding each changed line,
 * the same rows the case index already keeps per branch, and the count of cases
 * that entered the function stays beside it.
 *
 * The kind of edit is read from the diff's own text. A region every line of
 * words of which the change wrote is new, unless those lines are text the diff
 * removed somewhere, which makes it moved. Anything else is modified.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  diffPath,
  distanceToSource,
  type CoveringRegion,
  type LineRange,
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

/** Lines past this many are not read for words: a span that wide is a module, not text anyone moved. */
const WIDEST = 2000;

const WORDS = /[\p{L}\p{N}]/u;

/**
 * The text a diff removed from each file, one trimmed line of words per line,
 * with `\0` where removed text stops: at a hunk, at a line kept, at a line
 * written. A file the diff removed no words from has no entry.
 */
export function removedText(diff: string): ReadonlyMap<string, string> {
  const removed = new Map<string, string[]>();
  let file: string | undefined;
  let oldLeft = 0;
  let newLeft = 0;
  const lines = (): string[] | undefined => {
    if (file === undefined) return undefined;
    const held = removed.get(file) ?? [];
    removed.set(file, held);
    return held;
  };
  const stop = (): void => {
    const held = lines();
    if (held !== undefined && held.at(-1) !== '\0') held.push('\0');
  };

  for (const line of diff.split(/\r?\n/)) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('-')) {
        oldLeft -= 1;
        const text = line.slice(1).trim();
        if (WORDS.test(text)) lines()?.push(text);
      } else if (line.startsWith('+')) {
        newLeft -= 1;
        if (WORDS.test(line)) stop();
      } else if (!line.startsWith('\\')) {
        oldLeft -= 1;
        newLeft -= 1;
        if (WORDS.test(line)) stop();
      }
      continue;
    }
    if (line.startsWith('diff --git ')) file = undefined;
    else if (line.startsWith('--- ')) file = diffPath(line.slice(4));
    else if (line.startsWith('@@ ')) {
      const match = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      if (match === null) continue;
      oldLeft = Number(match[1] ?? '1');
      newLeft = Number(match[2] ?? '1');
      stop();
    }
  }

  const texts = new Map<string, string>();
  for (const [path, held] of removed) {
    if (held.some((text) => text !== '\0')) texts.set(path, `\n${held.join('\n')}\n`);
  }
  return texts;
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
  removed: ReadonlyMap<string, string>,
): Edit {
  const written = (line: number): boolean => ranges.some((range) => range.start <= line && line <= range.end);
  const span = Array.from({ length: Math.min(region.endLine - region.startLine + 1, WIDEST) }, (_, at) => region.startLine + at);
  const worded = lines === undefined ? [] : span.filter((line) => WORDS.test(lines[line - 1] ?? ''));
  const counted = worded.length === 0 ? span : worded;
  if (span.length === 0 || !counted.every(written)) return { edit: 'modified' };
  if (worded.length < MOVED_LINES) return { edit: 'new' };
  const needle = `\n${worded.map((line) => lines![line - 1]!.trim()).join('\n')}\n`;
  const others = [...removed.keys()].filter((path) => path !== file).sort();
  const from = [file, ...others].find((path) => removed.get(path)?.includes(needle) === true);
  return from === undefined ? { edit: 'new' } : { edit: 'moved', movedFrom: from };
}

/** Each changed region of one file as a review names it. */
export function regionsOf(
  regions: readonly CoveringRegion[],
  bearings: Bearings | undefined,
  ranges: readonly LineRange[],
  lines: readonly string[] | undefined,
  file: string,
  removed: ReadonlyMap<string, string>,
): ReviewRegion[] {
  const innermost = innermostOf(regions);
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
    const ran = new Set<string>();
    for (const range of ranges) {
      const last = Math.min(range.end, region.endLine);
      for (let line = Math.max(range.start, region.startLine); line <= last; line += 1) {
        for (const test of innermost(line)?.tests ?? []) if (test.loaded !== true) ran.add(test.id);
      }
    }
    return {
      kind: region.kind, name: region.name,
      startLine: region.startLine, endLine: region.endLine,
      reach,
      ...editOf(region, ranges, lines, file, removed),
      cases: called.length,
      changedLineCases: ran.size,
      tests: [...new Set(called.map((test) => test.file))].sort(order),
      called: called
        .map((test) => ({ id: test.id, file: test.file, name: test.name, ...(test.preconditions === undefined ? {} : { preconditions: test.preconditions }) }))
        .sort((left, right) => order(left.file, right.file) || order(left.name, right.name)),
    };
  });
}

/** The narrowest region holding a line, the first of equals. */
function innermostOf(regions: readonly CoveringRegion[]): (line: number) => CoveringRegion | undefined {
  const narrowest = [...regions].sort((left, right) => (left.endLine - left.startLine) - (right.endLine - right.startLine));
  const found = new Map<number, CoveringRegion | undefined>();
  return (line) => {
    if (!found.has(line)) found.set(line, narrowest.find((region) => region.startLine <= line && line <= region.endLine));
    return found.get(line);
  };
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
