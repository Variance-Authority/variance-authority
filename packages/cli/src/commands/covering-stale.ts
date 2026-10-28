// compass: variance-authority.reach
/**
 * `variance covering` over a file edited since the recording whose recorded
 * text could not be found: no recorded line is a place in what is held.
 *
 * That leaves the file, and the record still says which cases ran code in it.
 * So the answer names them, and names what the gap takes away: which of them
 * ran the asked line, or any one line. Painting the recorded ranges at their
 * old numbers would land them on whatever code holds those numbers now.
 */

import {
  coveringTestsInFile,
  type CoveringTest,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import type { CoveringAt } from '../covering-args.js';
import { countOf, loadersOf } from './covering-at.js';
import type { Graph } from './gap-selection.js';
import type { Narrowing } from './covering-reach.js';
import type { Covering } from './covering.js';

/** What the command already read when the frame came back stale. */
export interface ReadStale {
  readonly index: ExecutionIndex;
  /** Under `--where`, the index before it narrowed the cases. */
  readonly before?: ExecutionIndex;
  readonly from: string;
  readonly near: Narrowing;
  /** The checkout's file graph, read at most once per invocation. */
  readonly graph: Graph;
  /** The commit the record stands at, when it says. */
  readonly at?: string;
}

/**
 * The cases that ran code in the file, at file grain.
 *
 * @param reach Handed the cases the question reached before `--where`
 * narrowed them, when it narrowed them.
 */
export async function staleAnswer(
  request: CoveringAt,
  read: ReadStale,
  reach?: (tests: readonly CoveringTest[]) => void,
): Promise<Covering> {
  const { index, before, from, near, at } = read;
  const file = request.file;
  // No recorded line is a place here, so the question is the whole module's, whatever line it named.
  const graph = await loadersOf(before ?? index, file, read.graph);
  const found = entered(coveringTestsInFile(before ?? index, file, graph).flatMap((range) => range.tests));
  const kept = near.whole ? found : found.filter(near.keep);
  if (before !== undefined) reach?.(kept);
  const listed = before === undefined ? undefined : new Set(index.tests.map((test) => test.id));
  const tests = listed === undefined ? kept : kept.filter((test) => listed.has(test.id));
  const target = request.lines !== undefined
    ? { target: { lines: request.lines } }
    : request.line === undefined ? {} : { target: { line: request.line } };
  return { file, ...target, tests, frame: 'stale', from, ...(at === undefined ? {} : { at }), ...countOf(near, kept.length, found.length) };
}

/** Each case once, in the order the ranges name them, starred only when it never called in. */
function entered(tests: readonly CoveringTest[]): readonly CoveringTest[] {
  const once = new Map<string, CoveringTest>();
  for (const test of tests) {
    const held = once.get(test.id);
    if (held === undefined || (held.loaded === true && test.loaded !== true)) once.set(test.id, test);
  }
  return [...once.values()];
}

/**
 * What a stale answer says before its cases: that no recorded line is a place
 * in the held text, and which reading that takes away. A header with cases
 * to name is closed by them, after a colon.
 */
export function staleLines(answer: Covering): { readonly gone: string; readonly header?: string } {
  const gone = `${answer.file} is not the text the suite ran over${
    answer.at === undefined ? '' : ` at ${answer.at.slice(0, 12)}`
  }, and that text could not be found, so no recorded line is a place in it.`;
  const tests = answer.tests ?? [];
  // Under `--where`, *kept none* is said already; *no named test ran code here* would read as nothing having run it.
  if (tests.length === 0 && (answer.where?.of ?? 0) > 0) return { gone };
  const target = answer.target;
  const which = target === undefined || 'function' in target
    ? 'at which of its lines cannot be said'
    : `which of them ran ${'line' in target ? `line ${target.line}` : `lines ${target.lines.startLine}-${target.lines.endLine}`} cannot be said`;
  if (tests.length === 0) return { gone, header: `No named test ran code in ${answer.file}.` };
  return { gone, header: `${tests.length} named test${tests.length === 1 ? '' : 's'} ran code in ${answer.file}; ${which}` };
}
