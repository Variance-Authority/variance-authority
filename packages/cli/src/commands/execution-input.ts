// compass: variance-authority/runtime/attention
import { readFile } from 'node:fs/promises';
import { parseExecutionIndex } from '@variance-authority/distill';
import { OperatorError } from '../exit.js';
import { suiteRecord } from './suite-record.js';
import { retiredProbes } from '@variance-authority/sense/instrument';
import {
  askCoverageFile,
  caseSectionsAt,
  decodeExecutionIndex,
  isEncodedExecutionIndex,
  keepsCases,
  projectJourneyFile,
  type ExecutionIndex,
  type LineRange,
} from '@variance-authority/sense/test-selection';

/**
 * Read an execution index, whichever of its two spellings the file holds.
 *
 * A recorded run writes columns, because the same relation as JSON objects
 * measured tens of megabytes on real projects. A file an operator named
 * `.json` is JSON, and one produced by a foreign tool is JSON by definition —
 * that arm goes through `parseExecutionIndex`, which validates it field by
 * field, because nothing here recorded it.
 *
 * The frame separates them: columns open on the little-endian length of a
 * header that follows it, and JSON opens on `{` after an optional byte order
 * mark and whitespace. A coverage record is read as the case index it carries.
 */
export async function readExecutionIndex(file: string): Promise<ExecutionIndex> {
  return executionIndexOf(await readFile(file));
}

/** {@link readExecutionIndex} for bytes already in hand, such as a record a share gave. */
export function executionIndexOf(bytes: Uint8Array): ExecutionIndex {
  if (isEncodedExecutionIndex(bytes)) return decodeExecutionIndex(bytes);
  // TextDecoder drops a leading byte order mark, which JSON.parse refuses.
  return parseExecutionIndex(JSON.parse(new TextDecoder().decode(bytes)));
}

/**
 * The cases the latest run at `record` replaced, which is what an edit to a
 * test is compared with. Absent when that run replaced none, or the record does
 * not read: there is then nothing to compare with, which is not an error.
 */
export function replacedCases(record: string): ExecutionIndex | undefined {
  try {
    const { before } = caseSectionsAt(record);
    return before === undefined ? undefined : decodeExecutionIndex(before);
  } catch {
    return undefined;
  }
}

/**
 * An execution index read for one change, and the name of every file it holds.
 *
 * A journey file is read by the addon, which keeps only the changed modules and
 * the regions the change can ask about: a stitched day of shards holds hundreds
 * of millions of crossings, and decoding all of them to answer four changed lines
 * exhausts the heap. Every other spelling is decoded whole, as before.
 */
export async function readExecutionFor(
  file: string,
  changed: ReadonlyMap<string, readonly LineRange[]>,
): Promise<{ readonly index: ExecutionIndex; readonly files: readonly string[] }> {
  const projected = await projectJourneyFile(file, changed);
  if (projected !== undefined) return projected;
  const index = await readExecutionIndex(file);
  return { index, files: index.modules.map((module) => module.file) };
}

/**
 * The record a recorded run left its cases in, for the question asked without a path.
 *
 * A run writes its case index into the record its coverage is (spec 0094), so
 * the index is the record: with none named, the one a reader reads — the
 * nearest that holds it, which in a checkout that has not run is the mainline's
 * as last fetched here, else, in a worktree, the primary checkout's. The suite
 * is resolved as `review` resolves it, by {@link suiteRecord}: the only one
 * declared when none is named, and a refusal naming them when several are.
 */
export async function defaultExecutionFile(
  root: string,
  suite?: string,
  record?: string,
): Promise<string> {
  return record ?? (await suiteRecord(root, suite));
}

/**
 * The record holding a recorded run's cases, refused as `unrecorded` when no
 * run kept any.
 *
 * Told apart from an index that is there and cannot be read: that one is a
 * defect somebody fixes, and this one is a project that never ran the recorder,
 * which a program asking on every edit has to be able to recognise. A record
 * written before records carried cases is one of these. A record cut under
 * probes this build no longer places is refused by {@link currentProbes}.
 */
export async function recordedExecutionFile(
  root: string,
  suite?: string,
  record?: string,
): Promise<string> {
  const file = await defaultExecutionFile(root, suite, record);
  if (keepsCases(file)) return currentProbes(file, suite);
  throw new OperatorError(
    `nothing is recorded in \`${root}\`: no run left a per-case index in \`${file}\`. ` +
      'Run the suite with `withTestSelection` and ask again.',
    { kind: 'unrecorded' },
  );
}

/**
 * `file`, refused when the record there was cut under probes this build no
 * longer places.
 *
 * A record's regions are numbered by the probes that cut it, so after the
 * recipe changes an ordinal names other code, and a record from before reads
 * as an answer about the code as it is now that nobody measured. The run side
 * refuses to lay a run over such a record; a reader refuses to answer from one,
 * because a stale answer given as a current one is the one answer worse than
 * none. A file that holds no coverage of ours — an index a foreign tool wrote,
 * a fixture's own identity — is not ours to call retired, and passes.
 */
export function currentProbes(file: string, suite?: string): string {
  let instrumentation: string | undefined;
  try {
    instrumentation = askCoverageFile(file, (coverage) => coverage.instrumentation);
  } catch {
    return file;
  }
  const now = instrumentation === undefined ? undefined : retiredProbes(instrumentation);
  if (now === undefined) return file;
  throw new OperatorError(
    `this record was cut under the probes \`${instrumentation}\`, which this build no longer places ` +
      `(it places ${now.map((id) => `\`${id}\``).join(' and ')}), so no answer is read from it: ` +
      'its regions are numbered by the old probes, and an answer read from them would be a stale one given as current. ' +
      `The record is \`${file}\`; \`variance share --suite ${suite ?? '<suite>'}\` fetches the mainline's, ` +
      "and a run of the suite records this checkout's own.",
  );
}
