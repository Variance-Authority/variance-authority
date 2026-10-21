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
  type HeldLines,
} from '@variance-authority/sense/test-selection';
import { runsText, targetText } from './covering-at.js';
import type { CoveringFile } from './covering-files.js';
import type { CoveringRange } from './covering-frame.js';
import { motionText } from './covering-motion.js';
import { preconditionText } from './covering-unloaded.js';
import { formatCoveringRefs } from './covering-refs.js';
import { caseHeard, heldText } from '@variance-authority/sense/test-selection';
import { whereText } from './covering-where.js';
import { staleLines } from './covering-stale.js';
import type { Covering, CoveringFormat, StatedChange } from './covering.js';

/** Say the answer in the shape the caller asked for. */
export function formatCovering(answer: Covering, format: CoveringFormat): string {
  if (format === 'refs') return formatCoveringRefs(answer);
  if (format === 'json') return `${JSON.stringify(answer, heardResolved, 2)}\n`;
  return `${[...probesText(answer), ...scopeText(answer), ...whereText(answer), ...said(text(answer)), ...hopsText(answer), ...motionText(answer.motion)].join('\n')}\n`;
}

/**
 * Every test in the answer with what it heard resolved, as `review` gives a
 * case, in place of the raw `said` record: a reader never resolves it, and a
 * misused breadcrumb is never met as a read.
 */
function heardResolved(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('said' in value) || typeof value.said !== 'string') return value;
  const { said, ...test } = value as ExecutionTest & { readonly said: string };
  return { ...test, ...caseHeard({ said }) };
}

/** Why `--hops` printed no distance, said under the files it would have measured. */
export function hopsText(answer: Covering): readonly string[] {
  const gap = answer.hopsGap;
  return gap === undefined ? [] : [`${gap.charAt(0).toUpperCase()}${gap.slice(1)}.`];
}

/** A block that says nothing is left out, not printed as an empty line. */
function said(block: string): readonly string[] {
  return block === '' ? [] : [block];
}

function text(answer: Covering): string {
  if (answer.changed !== undefined) return sinceText(answer, answer.changed);
  if (answer.preconditionOf !== undefined) return preconditionText(answer.file ?? '', answer.preconditionOf, answer.held, answer.among);
  if (answer.frame === 'stale') return staleText(answer);
  if (answer.ranges !== undefined) return wholeFile(answer, answer.ranges);

  const tests = answer.tests ?? [];
  const where = targetText(answer.target ?? { function: '' });
  if (tests.length === 0 && (answer.where?.of ?? 0) > 0) {
    // `whereText` said the filter left none of the cases that covered it; *no named test covered* would read as nothing running the code.
    return narrowedText(answer).join('\n');
  }
  if (tests.length === 0 && newlyWritten(answer)) {
    // Every asked line is new since the recording: *no named test covered* is true, and the reason is the whole answer.
    const [one, verb, it] = single(answer.written!) ? ['Line', 'was', 'it'] : ['Lines', 'were', 'them'];
    return [`${one} ${runsText(answer.written!)} of ${answer.file} ${verb} written since the recording, so no case has run ${it}.`, ...narrowedText(answer)].join('\n');
  }
  if (tests.length === 0) {
    return [
      `No named test covered ${where} of ${answer.file}${unentered(answer.stopped)}`,
      ...(answer.stopped ?? []).map((test) => `  stopped: ${test.file} > ${caseName(test)}`),
      ...grainText(answer, where),
      ...narrowedText(answer),
    ].join('\n');
  }
  return [
    `${tests.length} named test${tests.length === 1 ? '' : 's'} covered ${where} of ${answer.file}${
      answer.state === 'alone' ? ', and it is the only case that could have' : ''
    }:`,
    ...caseLines(tests, '  ', answer.files),
    ...legend(tests),
    ...grainText(answer, where),
    ...narrowedText(answer),
  ].join('\n');
}

/** Which asked lines the record holds at file grain, and which it has no place for. */
function grainText(answer: Covering, where: string): readonly string[] {
  const lines: string[] = [];
  if (answer.grain === 'file') {
    lines.push(`At file grain: an edit to ${where} charges the module's own region, so the record names the cases that loaded the file.`);
  }
  if (answer.fileGrain !== undefined) {
    const [one, verb] = single(answer.fileGrain) ? ['Line', 'charges'] : ['Lines', 'charge'];
    lines.push(`${one} ${runsText(answer.fileGrain)} ${verb} the module's own region: for them the record names the cases that loaded the file.`);
  }
  if (answer.outside !== undefined) {
    const [one, verb] = single(answer.outside) ? ['Line', 'is'] : ['Lines', 'are'];
    lines.push(`${one} ${runsText(answer.outside)} ${verb} outside every recorded region, so no case can be said to have run ${single(answer.outside) ? 'it' : 'them'}.`);
  }
  if (answer.written !== undefined) {
    const [one, verb] = single(answer.written) ? ['Line', 'was'] : ['Lines', 'were'];
    lines.push(`${one} ${runsText(answer.written)} ${verb} written since the recording, so no case has run ${single(answer.written) ? 'it' : 'them'}.`);
  }
  return lines;
}

/** Whether every line the question asked was written since the recording. */
function newlyWritten(answer: Covering): boolean {
  const target = answer.target;
  if (answer.written === undefined || target === undefined || 'function' in target) return false;
  const asked = 'line' in target ? 1 : target.lines.endLine - target.lines.startLine + 1;
  return answer.written.reduce((sum, run) => sum + run.endLine - run.startLine + 1, 0) === asked;
}

function single(runs: readonly HeldLines[]): boolean {
  return runs.length === 1 && runs[0]!.startLine === runs[0]!.endLine;
}

/**
 * The record was cut under probes this build does not place: the answer is
 * the record's, and the note says what that leaves open. Said first, because
 * it bears on every line after it.
 */
export function probesText(answer: Covering): readonly string[] {
  return answer.probes === undefined ? [] : [answer.probes.note];
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
 * history, so there is no line to give: the cases that ran code in the file,
 * and the reading the gap takes away.
 */
function staleText(answer: Covering): string {
  const { gone, header } = staleLines(answer);
  const tests = answer.tests ?? [];
  return [
    gone,
    ...header === undefined ? [] : [tests.length === 0 ? header : `${header}:`],
    ...caseLines(tests, '  ', answer.files),
    ...legend(tests),
    ...narrowedText(answer),
  ].join('\n');
}

/**
 * Every recorded range of a file, each with the cases that called into it.
 *
 * A case that reached a range only while its file imported the module is
 * counted, not named: on a module every test file imports, those are most of
 * the suite, and a list of them says who imports the file rather than who runs
 * the range. Asked by line or function, or as JSON, they are named.
 */
function wholeFile(answer: Covering, ranges: readonly CoveringRange[]): string {
  const file = answer.file ?? '';
  if (ranges.length === 0) return `No line of ${file} is recorded in ${answer.from}.`;
  const called = (range: CoveringRange) => range.tests.filter((test) => test.loaded !== true);
  const named = new Set(ranges.flatMap((range) => called(range).map((test) => test.id)));
  const loading = new Set(ranges.flatMap((range) => range.tests.filter((test) => test.loaded === true).map((test) => test.id)));
  for (const id of named) loading.delete(id);
  const lines = [
    `${file} — ${ranges.length} recorded range${ranges.length === 1 ? '' : 's'}, ${
      named.size
    } named test${named.size === 1 ? '' : 's'}${
      loading.size === 0 ? '' : `, and ${loading.size} more that ran it only while their file imported it`
    }${framed(answer)}`,
  ];
  // Where each list of cases was first printed, so a later range walked by the same cases points at it.
  const printed = new Map<string, string>();
  for (const range of ranges) {
    const place = range.startLine === range.endLine ? `line ${range.startLine}` : `lines ${range.startLine}-${range.endLine}`;
    lines.push(`${place}${range.state === undefined ? '' : ` — ${range.state}`}${
      range.moved === true ? ', edited since the recording' : ''
    }`);
    const tests = called(range);
    const carried = range.tests.filter((test) => test.loaded === true);
    const key = `${tests.map((test) => test.id).join('\n')}\0${carried.map((test) => test.id).join('\n')}`;
    if (range.tests.length === 0) {
      // The header already says `unwalked` or `hole`; the stopped cases are the rest of a hole.
      const said = range.state === 'unwalked' || range.state === 'hole';
      // Under `--where` or `--read` the state is read over cases the list leaves out, so an empty list says nothing about them.
      if (!said) {
        lines.push(answer.where === undefined
          ? `  no named test covered this range${unentered(range.stopped)}`
          : `  no case ${answer.where.read === undefined ? '`--where`' : answer.where.asked.length === 0 ? '`--read`' : '`--where` and `--read`'} kept covered this range`);
      }
      lines.push(...(range.stopped ?? []).map((test) =>
        said ? `  stopped first: ${test.file} > ${caseName(test)}` : `    stopped: ${test.file} > ${caseName(test)}`));
    } else if (printed.has(key)) {
      const named = tests.length === 0 ? [] : [tests.length === 1 ? 'named test' : `${tests.length} named tests`];
      const loading = carried.length === 0 ? [] : [`${carried.length} case${carried.length === 1 ? '' : 's'} that only loaded the module`];
      lines.push(`  the same ${[...named, ...loading].join(', and ')}${named.length > 0 && loading.length > 0 ? ',' : ''} as ${printed.get(key)}`);
    } else {
      lines.push(...caseLines(tests, '  '), ...loadedOnly(carried, tests.length > 0));
      printed.set(key, place);
    }
  }
  lines.push(...narrowedText(answer));
  return lines.join('\n');
}

/** The cases that reached a range only while their file imported its module, counted under the ones that called into it. */
function loadedOnly(carried: readonly CoveringTest[], more: boolean): readonly string[] {
  if (carried.length === 0) return [];
  const files = new Set(carried.map((test) => test.file)).size;
  return [`  ${more ? 'and ' : ''}${carried.length} case${carried.length === 1 ? '' : 's'} in ${files} test file${
    files === 1 ? '' : 's'
  } ran it only while their file imported the module`];
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
    `${narrowed.kept} of ${narrowed.of} named test${narrowed.of === 1 ? '' : 's'} kept.`,
    ...narrowed.notes.map((note) => `  ${note}`),
  ];
}

/**
 * The review reading, which `variance_changed_tests` also prints.
 *
 * The words live in `@variance-authority/sense/test-selection` beside
 * `coveringChange`, because two surfaces ask for them and a reading with two
 * renderers has two answers. All this adds is what the CLI is the only one
 * able to state: the ref the diff was taken against, the file the index was
 * read from and the commit it stands at.
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
    ...cases.map((test) => `${indent}  ${caseName(test)}${test.loaded === true ? '*' : ''}${heldText(test)}`),
  ]);
}

/**
 * The one line that says what `*` means, printed once under the cases.
 *
 * A starred case's file imports the module, and the case ran only while the
 * module evaluated. Said once per answer, because on a module every test file
 * imports it is most of the cases.
 */
function legend(tests: readonly CoveringTest[]): readonly string[] {
  return tests.some((test) => test.loaded === true)
    ? ['* ran only while the module evaluated (its file imports it)']
    : [];
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
