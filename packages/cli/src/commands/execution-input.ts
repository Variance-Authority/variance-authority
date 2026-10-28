// compass: variance-authority/runtime/attention
import { readFile } from 'node:fs/promises';
import { parseExecutionIndex } from '@variance-authority/distill';
import { OperatorError } from '../exit.js';
import { suiteRecord } from './suite-record.js';
import {
  caseSectionsAt,
  decodeExecutionIndex,
  isEncodedExecutionIndex,
  keepsCases,
  projectJourneyFile,
  type DeclaredSuite,
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
 * probes this build does not place is read like any other, and its reader
 * names the gap (`probes-gap.ts`).
 */
export async function recordedExecutionFile(
  root: string,
  suite?: string,
  record?: string,
): Promise<string> {
  const file = await defaultExecutionFile(root, suite, record);
  if (keepsCases(file)) return file;
  throw new OperatorError(
    `nothing is recorded in \`${root}\`: no run left a per-case index in \`${file}\`, so no case can be named.${await fetchable(root, suite)}`,
    { kind: 'unrecorded' },
  );
}

/**
 * Where a record of `suite` can be had without running it: the mainline's,
 * which `variance share --suite` fetches, for a suite the root config gives to
 * the share. Nothing for any other suite, because the one other way to a
 * record is a run of the suite, which is often impossible where the question
 * is asked, and which the reader knows of already.
 */
export async function fetchable(root: string, suite: string | undefined): Promise<string> {
  const command = await shareCommand(root, suite);
  return command === undefined ? '' : ` \`${command}\` fetches the mainline's record of it.`;
}

/** The command that fetches the mainline's record of `suite`, when the root config gives it to the share. */
export async function shareCommand(root: string, suite: string | undefined): Promise<string | undefined> {
  const named = await declaredSuite(root, suite);
  return named?.carry === 'share' ? `variance share --suite ${named.name}` : undefined;
}

/**
 * The suite the root config declares as `suite`, or its only one when none is
 * named. Absent when the config declares none, or does not read: the answer
 * that asked is then not one suite's.
 */
export async function declaredSuite(root: string, suite: string | undefined): Promise<DeclaredSuite | undefined> {
  const { declaredSuites } = await import('@variance-authority/sense/test-selection');
  let declared: ReturnType<typeof declaredSuites>;
  try {
    declared = declaredSuites(root);
  } catch {
    return undefined;
  }
  return declared?.find((one) => one.name === (suite ?? (declared?.length === 1 ? declared[0]!.name : undefined)));
}
