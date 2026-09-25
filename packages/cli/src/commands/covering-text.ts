/**
 * The answer to `variance covering`, written for whoever asked.
 *
 * Split from the reading because the reading is one and the shapes are many:
 * a person reads the text, an editor reads the JSON, and an agent reads the
 * refs, which `covering-refs.ts` writes.
 */

import {
  formatCoveringChange,
  type CoveringTest,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import type { CoveringFile } from './covering-files.js';
import type { CoveringRange } from './covering-frame.js';
import { motionText } from './covering-motion.js';
import { formatCoveringRefs } from './covering-refs.js';
import type { Covering, CoveringFormat, StatedChange } from './covering.js';

/** Say the answer in the shape the caller asked for. */
export function formatCovering(answer: Covering, format: CoveringFormat): string {
  if (format === 'refs') return formatCoveringRefs(answer);
  if (format === 'json') return `${JSON.stringify(answer, undefined, 2)}\n`;
  return `${[...scopeText(answer), text(answer), ...motionText(answer.motion)].join('\n')}\n`;
}

function text(answer: Covering): string {
  if (answer.changed !== undefined) return sinceText(answer, answer.changed);
  if (answer.frame === 'stale') return staleText(answer);
  if (answer.ranges !== undefined) return wholeFile(answer, answer.ranges);

  const tests = answer.tests ?? [];
  const target = answer.target ?? { function: '' };
  const where = 'line' in target ? `line ${target.line}` : `function ${target.function}`;
  if (tests.length === 0) {
    return [
      `No named test covered ${where} of ${answer.file}${unentered(answer.stopped)}`,
      ...(answer.stopped ?? []).map((test) => `  stopped: ${test.file} > ${caseName(test)}`),
      ...narrowedText(answer),
    ].join('\n');
  }
  return [
    `${tests.length} named test${tests.length === 1 ? '' : 's'} covered ${where} of ${answer.file}${
      answer.state === 'alone' ? ', and it is the only case that could have' : ''
    }:`,
    ...caseLines(tests, '  ', answer.files),
    ...narrowedText(answer),
  ].join('\n');
}

/**
 * Which cases the answer was read from, before anything it says.
 *
 * A focused answer reads exactly like the suite's, and the two lead to
 * opposite decisions about a region nobody entered, so it is said first.
 */
export function scopeText(answer: Covering): readonly string[] {
  const scope = answer.scope;
  if (scope === undefined) return [];
  const count = `${scope.tests.length} case${scope.tests.length === 1 ? '' : 's'}`;
  return [scope.cases === 'last'
    ? `Read from the ${count} of the last run${scope.at === undefined ? '' : ` at ${scope.at.slice(0, 12)}`}, not the whole suite.`
    : `Read from the ${count} of ${scope.cases}, not the whole suite.`];
}

/**
 * The file was edited since the recording and the recorded text is not in
 * history, so there is no line to give.
 */
export function staleText(answer: Covering): string {
  return `${answer.file} is not the text the suite ran over${
    answer.at === undefined ? '' : ` at ${answer.at.slice(0, 12)}`
  }, and that text could not be found, so no recorded line is a place in it. Run the suite to record it again.`;
}

function wholeFile(answer: Covering, ranges: readonly CoveringRange[]): string {
  const file = answer.file ?? '';
  if (ranges.length === 0) return `No line of ${file} is recorded in ${answer.from}.`;
  const named = new Set(ranges.flatMap((range) => range.tests.map((test) => test.id)));
  const lines = [
    `${file} — ${ranges.length} recorded range${ranges.length === 1 ? '' : 's'}, ${
      named.size
    } named test${named.size === 1 ? '' : 's'}${framed(answer)}`,
  ];
  // Where each list of cases was first printed, so a later range walked by the same cases points at it.
  const printed = new Map<string, string>();
  for (const range of ranges) {
    const place = range.startLine === range.endLine ? `line ${range.startLine}` : `lines ${range.startLine}-${range.endLine}`;
    lines.push(`${place}${range.state === undefined ? '' : ` — ${range.state}`}${
      range.moved === true ? ', edited since the recording' : ''
    }`);
    const key = range.tests.map((test) => `${test.id}\0${test.loaded === true}`).join('\n');
    if (range.tests.length === 0) {
      lines.push(`  no named test covered this range${unentered(range.stopped)}`);
      lines.push(...(range.stopped ?? []).map((test) => `    stopped: ${test.file} > ${caseName(test)}`));
    } else if (printed.has(key)) {
      lines.push(`  the same ${range.tests.length === 1 ? 'named test' : `${range.tests.length} named tests`} as ${printed.get(key)}`);
    } else {
      lines.push(...caseLines(range.tests, '  '));
      printed.set(key, place);
    }
  }
  lines.push(...narrowedText(answer));
  return lines.join('\n');
}

/** Which text the line numbers are in, when that was checked. */
function framed(answer: Covering): string {
  if (answer.frame === 'mapped') return ', placed in the text as it is now';
  return '';
}

/**
 * Why nobody entered: a hole, unwalked, or a record that cannot tell them apart.
 *
 * A case that stopped recorded where it went and nothing past that, so the
 * absence of its name is not evidence. Printing the bare *no named test* over a
 * hole would read as permission to delete the code.
 */
function unentered(stopped: readonly ExecutionTest[] | undefined): string {
  if (stopped === undefined) return '.';
  if (stopped.length === 0) return ', and every case that could have reached it finished: unwalked.';
  return ` — a hole: ${stopped.length === 1 ? 'a case' : `${stopped.length} cases`} that could have ` +
    'reached it stopped first, so the record cannot see it.';
}

/**
 * What the narrowing removed, said out loud under every answer it shaped.
 *
 * A filtered list is indistinguishable from a short one, and the two lead to
 * opposite decisions: *one test covers this line* is an argument for writing
 * another, and *one test covers it within three hops, of eleven that cover it*
 * is an argument about where the eleven live. So the counts are printed even
 * when nothing was removed — a band that filtered nothing is a fact about the
 * code, not an absent feature.
 *
 * The sentence says how many survived and stops there. *The rest are further
 * out* would be a second claim, and a false one whenever the rest are tests the
 * walk could not place at all — which on a recording made against built output
 * is most of them. Why each one left is the notes' job, and the notes say it.
 */
export function narrowedText(answer: Covering): readonly string[] {
  const narrowed = answer.narrowed;
  if (narrowed === undefined) return [];
  return [
    `${narrowed.kept} of ${narrowed.of} named test${narrowed.of === 1 ? '' : 's'} that covered ` +
      'it are inside the narrowing.',
    ...narrowed.notes.map((note) => `  ${note}`),
  ];
}

/**
 * The review reading, which `variance_changed_tests` also prints.
 *
 * The words live in `@variance-authority/sense/test-selection` beside
 * `coveringChange`, because two surfaces ask for them and a reading with two
 * renderers has two answers. All this adds is the provenance the CLI is the
 * only one able to state: the ref the diff was taken against, the file the
 * index was read from, and the commit it stands at.
 */
function sinceText(answer: Covering, changed: readonly StatedChange[]): string {
  return formatCoveringChange(changed, {
    ...(answer.since === undefined ? {} : { since: answer.since }),
    from: answer.from,
    ...(answer.at === undefined ? {} : { at: answer.at }),
  });
}

/**
 * Cases under the test file that declares them, each file named once.
 *
 * A case's id is its file and its name, so a line carrying all three said the
 * file twice, and a range walked by eleven cases of one file said it
 * twenty-two times. An id that is not that — a project's, say — is printed.
 *
 * Given the answer's file rows, each file says how many of its cases went
 * there out of how many it has, and how far it is under `--hops`, and the
 * files come in the rows' order: nearest first.
 */
function caseLines(
  tests: readonly CoveringTest[],
  indent: string,
  files: readonly CoveringFile[] = [],
): readonly string[] {
  const byFile = new Map<string, CoveringTest[]>(files.map((row) => [row.file, []]));
  for (const test of tests) {
    const held = byFile.get(test.file);
    if (held === undefined) byFile.set(test.file, [test]);
    else held.push(test);
  }
  const rows = new Map(files.map((row) => [row.file, row]));
  return [...byFile].flatMap(([file, cases]) => [
    `${indent}${file}${fileCount(rows.get(file))}`,
    ...cases.map((test) => `${indent}  ${caseName(test)}${test.loaded === true ? ' (its file imports the module; ran while it evaluated)' : ''}`),
  ]);
}

function fileCount(row: CoveringFile | undefined): string {
  if (row === undefined) return '';
  const hops = row.hops === undefined ? '' : `, ${row.hops} hop${row.hops === 1 ? '' : 's'} away`;
  return ` — ${row.cases}/${row.of}${hops}`;
}

/** A case's name, with its id when the id is not its file and its name. */
function caseName(test: ExecutionTest): string {
  return test.id === `${test.file} > ${test.name}` ? test.name : `${test.name} [${test.id}]`;
}
