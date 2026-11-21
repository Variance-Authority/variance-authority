/**
 * The answer to `variance covering`, written for whoever asked.
 *
 * Split from the reading because the reading is one and the shapes are many:
 * a person reads the text, an editor reads the JSON, and an agent reads the
 * refs, which `covering-refs.ts` writes.
 */

import {
  formatCoveringChange,
  unenteredPlace,
  unenteredSentence,
  whyUnentered,
  type CoveringTest,
  type ExecutionTest,
  type HeldLines,
  type Unentered,
} from '@variance-authority/sense/test-selection';
import { nextPage, pageAt, paged, spellingOf, type Page } from '@variance-authority/mcp/tools';
import { FIRST_PAGE } from '../covering-args.js';
import { runsOfLines, runsText, targetText, type UnrunPart } from './covering-at.js';
import { casesByFile, type CoveringFile } from './covering-files.js';
import type { CoveringRange } from './covering-frame.js';
import { motionText } from './covering-motion.js';
import { preconditionText } from './covering-unloaded.js';
import { formatCoveringRefs } from './covering-refs.js';
import { heldText, lostText } from '@variance-authority/sense/test-selection';
import { whereText } from './covering-where.js';
import { evidenceGapText } from './evidence-gap.js';
import { staleFile, staleLines } from './covering-stale.js';
import { frameText, ranText } from './covering-fresh-text.js';
import type { Covering, CoveringFormat, CoveringTarget, StatedChange } from './covering.js';

/**
 * Say the answer in the shape the caller asked for.
 *
 * @param now The clock the answer is dated against, in ms.
 * @param page The test files the text shows, ten from the first unless
 *   `--limit` or `--offset` asked another page; refs and JSON carry every one.
 */
export function formatCovering(answer: Covering, format: CoveringFormat, now: number, page: Page = FIRST_PAGE): string {
  if (format === 'refs') return formatCoveringRefs(answer);
  if (format === 'json') return `${JSON.stringify(answer, undefined, 2)}\n`;
  return `${[
    ...(answer.source === undefined ? [] : [answer.source.says]),
    ...probesText(answer),
    ...scopeText(answer),
    ...whereText(answer),
    ...said(text(answer, page)),
    ...hopsText(answer),
    ...motionText(answer.motion),
    ...frameText(answer),
    ...ranText(answer, now),
    ...(answer.gap === undefined ? [] : [evidenceGapText(answer.gap)]),
  ].join('\n')}\n`;
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

function text(answer: Covering, page: Page): string {
  if (answer.changed !== undefined) return sinceText(answer, answer.changed);
  if (answer.preconditionOf !== undefined) return preconditionText(answer.file ?? '', answer.preconditionOf, answer.held, answer.among);
  if (staleFile(answer)) return staleText(answer, page);
  if (answer.ranges !== undefined) return wholeFile(answer, answer.ranges, page);

  const tests = answer.tests ?? [];
  // Past the file's ranges the answer is `coveringAt`'s, which always names what was asked.
  const target = answer.target!;
  const where = targetText(target);
  if (tests.length === 0 && (answer.where?.of ?? 0) > 0) {
    // `whereText` said the filter left none of the cases that covered it; *no named test covered* would read as nothing running the code.
    return [...narrowedText(answer), ...unrunText(answer.unrun)].join('\n');
  }
  if (tests.length === 0 && unplaced(answer, target)) {
    // Every asked line was written since the recording or ran in another text: the reason is the whole answer.
    return [...unplacedText(answer, ` of ${answer.file}`), ...unrunText(answer.unrun), ...narrowedText(answer)].join('\n');
  }
  if (tests.length === 0) {
    // A case ran some asked line in another text, so the record measured neither its run nor its absence there.
    const rest = 'function' in target || answer.overwritten === undefined ? undefined : unsaid(answer, target);
    return [
      rest === undefined
        ? `No named test covered ${where} of ${answer.file}${whyUnentered(answer.stopped)}`
        : `No named test covered ${single(rest) ? 'line' : 'lines'} ${runsText(rest)} of ${answer.file}.`,
      ...(answer.stopped ?? []).map((test) => `  stopped: ${test.file} > ${caseName(test)}`),
      ...grainText(answer, where),
      ...narrowedText(answer),
    ].join('\n');
  }
  return [
    `${tests.length} named test${tests.length === 1 ? '' : 's'} covered ${where} of ${answer.file}${
      answer.state === 'alone' ? ', and it is the only case that could have' : ''
    }:`,
    ...caseLines(tests, '  ', answer.files, page),
    ...legend(tests),
    ...unrunText(answer.unrun),
    ...grainText(answer, where),
    ...narrowedText(answer),
  ].join('\n');
}

/** The parts of an asked function no case ran, which its cases do not say: `the branch at line 12`. */
function unrunText(parts: readonly UnrunPart[] | undefined): readonly string[] {
  if (parts === undefined || parts.length === 0) return [];
  const named = parts.map((part) => `${unrunPart(part)} at ${part.startLine === part.endLine ? 'line' : 'lines'} ${runsText([part])}`);
  return [`No case ran ${parts.length === 1 ? 'a part' : `${parts.length} parts`} of it: ${named.join(', ')}.`];
}

/** A part as a sentence names it: a part of the function's own body by its kind, a nested function by its name too, each `edited` when an edit touched it. */
function unrunPart(part: UnrunPart): string {
  const kind = part.moved === true ? `edited ${part.kind}` : part.kind;
  return part.name === undefined ? `the ${kind}` : `${kind} ${part.name}`;
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
  return [...lines, ...unplacedText(answer, '')];
}

/** The asked lines the record measured no run of: written since, in a text a case ran over where a run over another text has landed since, or not known to be either. */
function unplacedText(answer: Covering, of: string): readonly string[] {
  const said: string[] = [];
  if (answer.written !== undefined) {
    const [one, verb, it] = single(answer.written) ? ['Line', 'was', 'it'] : ['Lines', 'were', 'them'];
    said.push(`${one} ${runsText(answer.written)}${of} ${verb} written since the recording, so no case has run ${it}.`);
  }
  if (answer.overwritten !== undefined) {
    const [one, verb, it] = single(answer.overwritten) ? (['Line', 'is', 'it'] as const) : (['Lines', 'are', 'them'] as const);
    said.push(`${one} ${runsText(answer.overwritten)}${of} ${verb} ${lostText({ other: false, it })}.`);
  }
  if (answer.unknown !== undefined) {
    said.push(`Whether a case has run ${single(answer.unknown.lines) ? 'line' : 'lines'} ${runsText(answer.unknown.lines)}${of} is not known: ${answer.unknown.why}.`);
  }
  return said;
}

/**
 * Whether every line the question asked was written since the recording or
 * ran in another text, or, asked by function, whether a case ran a part of it
 * in another text: then no named case is no measured absence.
 */
function unplaced(answer: Covering, target: CoveringTarget): boolean {
  if ('function' in target) return answer.overwritten !== undefined;
  return unsaid(answer, target).length === 0;
}

/** The asked lines neither written since, nor run in another text, nor not known to be either: the ones a case is known to have run, or known not to. */
function unsaid(answer: Covering, target: Exclude<CoveringTarget, { readonly function: string }>): readonly HeldLines[] {
  const { startLine, endLine } = 'line' in target ? { startLine: target.line, endLine: target.line } : target.lines;
  const out = new Set([...answer.written ?? [], ...answer.overwritten ?? [], ...answer.unknown?.lines ?? []].flatMap((run) =>
    Array.from({ length: run.endLine - run.startLine + 1 }, (_, at) => run.startLine + at)));
  return runsOfLines(Array.from({ length: endLine - startLine + 1 }, (_, at) => startLine + at).filter((line) => !out.has(line)));
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
function staleText(answer: Covering, page: Page): string {
  const { gone, header } = staleLines(answer);
  const tests = answer.tests ?? [];
  return [
    gone,
    ...header === undefined ? [] : [tests.length === 0 ? header : `${header}:`],
    ...caseLines(tests, '  ', answer.files, page),
    ...legend(tests),
    ...narrowedText(answer),
  ].join('\n');
}

/**
 * The test files whose cases called into a file, each named once, the most
 * cases first, then the ranges that have something to say on their own.
 *
 * Which range a case entered is the JSON's and `--line`'s answer: the reader of
 * the text picks test files to run and to open, and the same files listed again
 * under every range they entered told them nothing new. A range is said only
 * when no case called into it, an edit moved it, or it holds what its cases do
 * not say.
 *
 * A case that reached the file only while its own file imported the module is
 * counted, not named: on a module every test file imports, those are most of
 * the suite, and a list of them says who imports the file rather than who runs
 * it. Asked by line or function, or as JSON, they are named.
 */
function wholeFile(answer: Covering, ranges: readonly CoveringRange[], page: Page): string {
  const file = answer.file ?? '';
  if (ranges.length === 0) return `No line of ${file} is recorded in ${answer.from}.`;
  const called = (range: CoveringRange) => range.tests.filter((test) => test.loaded !== true);
  const named = new Map(ranges.flatMap((range) => called(range).map((test) => [test.id, test] as const)));
  const loading = new Set(ranges.flatMap((range) => range.tests.filter((test) => test.loaded === true).map((test) => test.id)));
  for (const id of named.keys()) loading.delete(id);
  const byFile = [...casesByFile([...named.values()], [])].sort(([left, a], [right, b]) =>
    b.length - a.length || (left < right ? -1 : left > right ? 1 : 0));
  const lines = [
    `${file} — ${ranges.length} recorded range${ranges.length === 1 ? '' : 's'}, ${named.size} named test${named.size === 1 ? '' : 's'}${
      named.size === 0 ? '' : ` in ${byFile.length} test file${byFile.length === 1 ? '' : 's'}`
    }${loading.size === 0 ? '' : `, and ${loading.size} more that ran it only while their file imported it`}`,
    ...fileRows(byFile, '  ', page, (_, cases) => ` — ${cases.length} case${cases.length === 1 ? '' : 's'}`),
  ];
  const quiet = ranges.filter(isQuiet);
  for (const range of ranges) if (!quiet.includes(range)) lines.push(...rangeNote(answer, range));
  for (const state of new Set(quiet.map((range) => range.state))) {
    const runs = quiet.filter((range) => range.state === state);
    lines.push(`No case called into ${single(runs) ? 'line' : 'lines'} ${runsText(runs)}: ${state}.`);
  }
  lines.push(...unenteredText(ranges));
  lines.push(...narrowedText(answer));
  return lines.join('\n');
}

/** What one range says that the file's rows do not: nothing when cases called into it and it holds nothing else. */
function rangeNote(answer: Covering, range: CoveringRange): readonly string[] {
  const tests = range.tests.filter((test) => test.loaded !== true);
  const carried = range.tests.filter((test) => test.loaded === true);
  const notes: string[] = [];
  if (range.tests.length === 0) {
    // The header already says `loaded`, `unwalked` or `hole`; the stopped cases are the rest of a hole, and
    // say nothing about a range that ran while its module loaded.
    const said = range.state === 'loaded' || range.state === 'unwalked' || range.state === 'hole';
    // Under `--where` or `--read` the state is read over cases the list leaves out, so an empty list says nothing about them.
    if (!said) {
      notes.push(answer.where === undefined
        ? range.overwritten === undefined
          ? `  no named test covered this range${whyUnentered(range.stopped)}`
          : `  this range is ${lostText({ other: false, it: 'it' })}`
        : `  no case ${answer.where.read === undefined ? '`--where`' : answer.where.asked.length === 0 ? '`--read`' : '`--where` and `--read`'} kept covered this range`);
    }
    notes.push(...(range.state === 'loaded' ? [] : range.stopped ?? []).map((test) =>
      said ? `  stopped first: ${test.file} > ${caseName(test)}` : `    stopped: ${test.file} > ${caseName(test)}`));
  } else if (tests.length === 0) {
    notes.push(...loadedOnly(carried));
  }
  if (range.tests.length > 0 && range.overwritten !== undefined) notes.push(`  it is also ${lostText({ other: true, it: 'it' })}`);
  if (notes.length === 0 && range.tests.length > 0 && range.moved !== true) return [];
  const place = range.startLine === range.endLine ? `line ${range.startLine}` : `lines ${range.startLine}-${range.endLine}`;
  return [`${place}${range.state === undefined ? '' : ` — ${range.state}`}${range.moved === true ? ', edited since the recording' : ''}`, ...notes];
}

/**
 * A range whose state says all there is: no case called into it, none stopped
 * short of it, and no edit or overwrite on it. Said in one line per state for
 * the whole file, not a header per range.
 */
function isQuiet(range: CoveringRange): boolean {
  return range.tests.length === 0 &&
    (range.state === 'unwalked' || range.state === 'loaded' || range.state === 'hole') &&
    (range.state === 'loaded' || (range.stopped ?? []).length === 0) &&
    range.moved !== true && range.overwritten === undefined;
}

/**
 * The regions nobody entered, once each, though a function's opening and
 * closing lines sit on two ranges: the range's cases are the ones an edit to its
 * lines selects, and a region with no line of its own would read as theirs
 * (`unentered.ts` in sense). The unwalked ones are one sentence; a hole keeps
 * its own, with the cases that stopped before it.
 */
function unenteredText(ranges: readonly CoveringRange[]): readonly string[] {
  const regions = new Map<string, Unentered>();
  for (const region of ranges.flatMap((range) => range.unentered ?? [])) {
    regions.set(`${region.kind}:${region.startLine}:${region.endLine}`, region);
  }
  const all = [...regions.values()];
  const lines: string[] = [];
  for (const stopped of [[], undefined] as const) {
    const plain = all.filter((region) => (region.stopped === undefined) === (stopped === undefined) && (region.stopped ?? []).length === 0);
    if (plain.length === 0) continue;
    const why = whyUnentered(stopped);
    lines.push(`No case entered ${plain.map(unenteredPlace).join(', ')}${plain.length === 1 ? why : why.replace('reached it', 'reached them')}`);
  }
  for (const region of all.filter((one) => (one.stopped ?? []).length > 0)) {
    lines.push(`N${unenteredSentence(region).slice(1)}`,
      ...(region.stopped ?? []).map((test) => `  stopped: ${test.file} > ${caseName(test)}`));
  }
  return lines;
}

/** The cases that reached a range only while their file imported its module, counted where no case called into it. */
function loadedOnly(carried: readonly CoveringTest[]): readonly string[] {
  if (carried.length === 0) return [];
  const files = new Set(carried.map((test) => test.file)).size;
  return [`  ${carried.length} case${carried.length === 1 ? '' : 's'} in ${files} test file${
    files === 1 ? '' : 's'
  } ran it only while their file imported the module`];
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
 * The review reading.
 *
 * The words live in `@variance-authority/sense/test-selection` beside
 * `coveringChange`. All this adds is what only the CLI can state: the ref the
 * diff was taken against, the file the index was read from and the commit it
 * stands at.
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
  files: readonly CoveringFile[] | undefined,
  page: Page,
): readonly string[] {
  const rows = new Map((files ?? []).map((row) => [row.file, row]));
  return fileRows([...casesByFile(tests, files ?? [])], indent, page, (file) => fileCount(rows.get(file)));
}

/** The cases a file row names before it counts the rest: enough to open the file at one, few enough to read on every row. */
const CASES_SHOWN = 3;

const SHELL = spellingOf({ shell: 'variance' });

/**
 * One page of test files, each with its first cases and the count of the
 * rest, as `limit.ts` pages every listing; when a file or a case was left
 * out, where every one of them is.
 */
function fileRows(
  byFile: readonly (readonly [string, readonly CoveringTest[]])[],
  indent: string,
  page: Page,
  rowText: (file: string, cases: readonly CoveringTest[]) => string,
): readonly string[] {
  const shown = paged(byFile, page);
  const cut = shown.length < byFile.length || shown.some(([, cases]) => cases.length > CASES_SHOWN);
  return [
    ...pageAt(page, byFile.length, SHELL),
    ...shown.flatMap(([file, cases]) => [
      `${indent}${file}${rowText(file, cases)}`,
      ...cases.slice(0, CASES_SHOWN).map((test) => `${indent}  ${caseName(test)}${test.loaded === true ? '*' : ''}${heldText(test)}`),
      ...(cases.length > CASES_SHOWN ? [`${indent}  and ${cases.length - CASES_SHOWN} more`] : []),
    ]),
    ...nextPage(page, byFile.length, SHELL),
    ...(cut ? ['`--format json` names every case.'] : []),
  ];
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
