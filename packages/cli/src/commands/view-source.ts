// compass: variance-authority.reach
/**
 * The source files the Coverage tab can draw: each one's text, and the state
 * of each range the record holds over it.
 *
 * The states are `covering`'s own answer for the file (`covering-suites.ts`,
 * the answer the editor extension asks for as JSON), never a second reading of
 * the record, so the page and the editor paint one range the same way. A page
 * opened from a file cannot ask for a file when it is picked, so the text and
 * states of a bounded set are embedded when it is written.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RangeState } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { coveringAnswer } from './covering-suites.js';
import type { Covering } from './covering.js';

/** How many source files the page embeds the text of: the most-entered first. The rest are counted, not drawn. */
export const SOURCE_FILES = 30;

/** The largest text, in bytes, embedded for one file. A page of 30 files is then 3 MB of text at most. */
export const SOURCE_BYTES = 100_000;

/** A run of lines of a file and the one state `covering` gives it. */
export interface SourceMark {
  readonly startLine: number;
  readonly endLine: number;
  readonly state: RangeState;
}

/** One source file as the page draws it. */
export interface SourceRow {
  readonly file: string;
  /** Absent when the file has no text to draw: it is off disk, too large, or the record does not hold it. */
  readonly text?: string;
  /** Empty when no range of the file has a state. */
  readonly marks: readonly SourceMark[];
  /** Why there is no text or no state, in words; absent when both are held. */
  readonly note?: string;
}

/** What the page holds of its source files. */
export interface SourcesData {
  readonly files: readonly SourceRow[];
  /** Files asked for beyond `SOURCE_FILES`, which the page does not draw. */
  readonly left: number;
}

/** The first sentence of a refusal: the rest routes a terminal reader. */
function sentence(message: string): string {
  return message.trim().split(/\n\s*\n/u)[0]!.replace(/\s+/gu, ' ');
}

function marksOf(answer: Awaited<ReturnType<typeof coveringAnswer>>): { readonly marks: readonly SourceMark[]; readonly why?: string; readonly lacks?: true } {
  const raw: readonly { readonly startLine: number; readonly endLine: number; readonly state?: RangeState }[] =
    'suites' in answer ? (answer.marks ?? []) : ((answer as Covering).ranges ?? []);
  const marks = raw.flatMap((one) => (one.state === undefined ? [] : [{ startLine: one.startLine, endLine: one.endLine, state: one.state }]));
  if (marks.length > 0) return { marks };
  if ('suites' in answer) {
    const refused = answer.suites.flatMap((one) => ('reason' in one ? [sentence(one.reason)] : []));
    if (refused.length === answer.suites.length) return { marks, why: refused[0] ?? 'no suite answered about it', lacks: true };
  }
  return { marks, why: raw.length === 0 ? 'the record holds no range of it' : 'the record cannot tell the state of any range of it' };
}

async function rowOf(root: string, file: string, suite: string | undefined): Promise<SourceRow> {
  const text = await readFile(join(root, file), 'utf8').catch(() => undefined);
  if (text === undefined) return { file, marks: [], note: `${file} is not on disk, so there is no text to draw` };
  if (Buffer.byteLength(text) > SOURCE_BYTES) return { file, marks: [], note: `${file} is larger than ${SOURCE_BYTES / 1000} kB, so its text is not embedded` };
  try {
    const answer = await coveringAnswer({
      command: 'covering', root, format: 'json', file, held: text, ...(suite === undefined ? {} : { suite }),
    });
    const { marks, why, lacks } = marksOf(answer);
    if (lacks === true) return { file, marks, note: why! };
    return { file, text, marks, ...(why === undefined ? {} : { note: why }) };
  } catch (error) {
    if (!(error instanceof OperatorError)) throw error;
    return { file, marks: [], note: sentence(error.message) };
  }
}

/** The text and range states of the first `SOURCE_FILES` of `files`, each a source file named from the root; one `covering` answer apiece. */
export async function viewSources(root: string, files: readonly string[], suite?: string): Promise<SourcesData> {
  const rows: SourceRow[] = [];
  for (const file of files.slice(0, SOURCE_FILES)) rows.push(await rowOf(root, file, suite));
  return { files: rows, left: Math.max(0, files.length - SOURCE_FILES) };
}
