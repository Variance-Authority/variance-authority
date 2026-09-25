/**
 * What each file a patch changes does, read from both of its texts, for the
 * journey selector.
 *
 * A journey file carries no text, so the old side is the one the patch was
 * written against: the caller reads it from the blob the patch names. The new
 * side is that text with the hunks applied (`patch.ts`). The verdict is the
 * addon's, the one `readChange` reads for the snapshot, and two of its answers
 * narrow what the lines alone would charge:
 *
 * - `none`: the runtime text is equal, and the file charges nothing.
 * - `bodies`: what the module does as it loads is equal, so its own region is
 *   not charged. A comment or a new function between two declarations lands in
 *   that region, and the line path charges it to every file that imports the
 *   module.
 *
 * `values` and `load` are charged by their lines, as they were. So is a `bodies`
 * verdict whose new import loads a module its package declares in
 * `sideEffects`, which is reported as `load`. Only a file the module reader
 * claims is read (`MODULE_EXTENSIONS`); a lockfile or a stylesheet is answered
 * as it was, without a reading. A file with no old text, a hunk
 * that does not apply to it, or a side that does not parse is reported unread,
 * and its lines are charged.
 */

import { extname } from 'node:path';
import type { Relations } from '@variance-authority/core/relate';
import { native } from '../addon.js';
import { MODULE_EXTENSIONS } from '../read.js';
import { changedLines } from './diff-lines.js';
import { declaredEffects } from './effects.js';
import type { JourneyRead } from './execution-select.js';
import { applied, hunksOf } from './patch.js';
import type { FileReading } from './reading.js';

export interface JourneyReadingOptions {
  /** Where a package's `sideEffects` field is resolved from. */
  readonly root?: string;
  readonly relations?: Relations;
}

export interface JourneyReading {
  /** What each read file proved, for `JourneySelectionOptions.read`. */
  readonly read: ReadonlyMap<string, JourneyRead>;
  /** One per changed file with lines, for `readingLines`. */
  readonly readings: readonly FileReading[];
}

/**
 * Read every file `diff` changes by lines. `before` is the text the patch was
 * written against, or `undefined` when there is none to read.
 */
export function readJourneyChange(
  diff: string,
  before: (file: string) => string | undefined,
  options: JourneyReadingOptions = {},
): JourneyReading {
  const scanner = native();
  const hunks = hunksOf(diff);
  const read = new Map<string, JourneyRead>();
  const readings: FileReading[] = [];

  for (const [file, ranges] of changedLines(diff)) {
    if (ranges.length === 0 || !MODULE_EXTENSIONS.includes(extname(file))) continue;
    if (scanner?.moduleVerdict === undefined) {
      readings.push({ file, unread: 'addon' });
      continue;
    }
    const text = before(file);
    if (text === undefined) {
      readings.push({ file, unread: 'source' });
      continue;
    }
    const patched = applied(text, hunks.get(file) ?? []);
    if (patched === undefined) {
      readings.push({ file, unread: 'hunk' });
      continue;
    }
    const verdict = scanner.moduleVerdict(file, text, patched.after);
    if (verdict === null) {
      readings.push({ file, unread: 'parse' });
      continue;
    }
    const effects = verdict.kind === 'bodies'
      ? declaredEffects(options.root, options.relations, file, verdict.imported)
      : [];
    if (effects.length > 0) {
      readings.push({ file, verdict: 'load', names: [], effects });
      continue;
    }
    readings.push({ file, verdict: verdict.kind, names: verdict.names });
    if (verdict.kind === 'none' || verdict.kind === 'bodies') read.set(file, verdict.kind);
  }

  return { read, readings };
}
