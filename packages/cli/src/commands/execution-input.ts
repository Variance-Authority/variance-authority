// compass: variance-authority/runtime/attention
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parseExecutionIndex } from '@variance-authority/distill';
import {
  decodeExecutionIndex,
  isEncodedExecutionIndex,
  projectJourneyFile,
  testCoverageFile,
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
 * The first byte separates them: JSON opens on `{` or the whitespace before
 * it, and columns open on the little-endian length of a header.
 */
export async function readExecutionIndex(file: string): Promise<ExecutionIndex> {
  const bytes = await readFile(file);
  if (isEncodedExecutionIndex(bytes)) return decodeExecutionIndex(bytes);
  return parseExecutionIndex(JSON.parse(bytes.toString('utf8')));
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
 * Where a recorded run left the index, for the question asked without a path.
 *
 * Columns are what a run writes now. The JSON name is still answered when the
 * columns are not there, because a cache recorded by an earlier version still
 * holds the answer and re-recording a suite to ask one question about one line
 * is not a reasonable price for a format change.
 */
export async function defaultExecutionFile(root: string): Promise<string> {
  const columns = `${testCoverageFile(root)}.cases.bin`;
  if (await readable(columns)) return columns;
  const json = `${testCoverageFile(root)}.cases.json`;
  return (await readable(json)) ? json : columns;
}

async function readable(file: string): Promise<boolean> {
  try {
    await access(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
