import type { CaptureArtifact } from '@variance-authority/core';
import { shapeValue, type SubjectRef } from '@variance-authority/core/format';
import { writeCapture } from './archive.js';

/**
 * Snapshot a value that was never rendered (spec 0031).
 *
 * The floor of the subject list: an API response, a generated manifest, a config
 * file, a route table. It needs no browser, no `jsdom` and no dialect reader —
 * which is why it ships before any of them, and why every dialect degrades to it.
 */

export interface SnapshotValueOptions {
  readonly subject: string | SubjectRef;
  /** Where the capture is written. One fresh directory per run. */
  readonly directory: string;
  /** How to read the text later. Defaults to `json`. */
  readonly dialect?: string;
  /** JSON Pointers whose values are volatile. Recorded as present, never compared. */
  readonly drop?: readonly string[];
  /** JSON Pointers whose values become a stable token of your choosing. */
  readonly replace?: Readonly<Record<string, string>>;
  /** For an array of records, the member that identifies a row. */
  readonly arrayKey?: Readonly<Record<string, string>>;
  /** What emitted the value, when something did. */
  readonly generator?: { readonly name: string; readonly version: string };
}

/**
 * Shape a value, address it by content, and write it where a later `variance
 * run` will read it. Returns the path written.
 *
 * **It does not compare, and it does not fail your test.** That is the same
 * contract `capture` has, for the same reason: the baseline is not present in a
 * unit-test process, and a comparison written here would be a second, weaker copy
 * of the run — one that could not see the other subjects, could not reach the
 * store, and could not be approved. The loop is `variance run`, which is the same
 * command locally and in CI.
 *
 * What it *will* fail on is a value that cannot be one. A function, a `Date`, a
 * `bigint` or a non-finite number throws, naming the JSON Pointer where it was
 * found — because the alternative is to drop it silently, and a key missing from
 * the text reads downstream as a key that was removed.
 */
export async function snapshotValue(
  value: unknown,
  options: SnapshotValueOptions,
): Promise<string> {
  const subject: SubjectRef =
    typeof options.subject === 'string' ? { id: options.subject, kind: 'value' } : options.subject;

  const artifact: CaptureArtifact = {
    artifactVersion: 1,
    subject,
    material: {
      kind: 'value',
      value: shapeValue(value, {
        ...(options.dialect === undefined ? {} : { dialect: options.dialect }),
        ...(options.drop === undefined ? {} : { drop: options.drop }),
        ...(options.replace === undefined ? {} : { replace: options.replace }),
        ...(options.arrayKey === undefined ? {} : { arrayKey: options.arrayKey }),
        ...(options.generator === undefined ? {} : { generator: options.generator }),
      }),
    },
  };

  return writeCapture(options.directory, artifact);
}
