// compass: variance-authority.reach

/**
 * The one question an answer leaves open, the reason, and the run that closes
 * it.
 *
 * An answer reads what is known (the diff, the code, the index) or what was
 * recorded (the record's cases). When neither holds what the question asked,
 * the answer ends with a gap: the question, its scope, what is known, why it
 * stays open, and the exact next command with what it costs. A record that is
 * missing, stale or older than the file is closed by a recorded run (Record);
 * a record that holds the line only at file grain is closed by a story of a
 * few named tests (Deep). Deep is never a suite: it names at most
 * {@link DEEP_TESTS} tests, the nearest ones, in the order the answer lists
 * them.
 *
 * A stale record is refreshed before Deep is paid for, so one answer carries
 * one gap, and Record wins over Deep: a story of a test over text the record
 * no longer holds answers a question about a file that is not there.
 *
 * Which test files a Record gap runs is selection's answer for the asked file
 * (`gap-selection.ts`): the gap words and counts it, and never names an empty
 * run, a range edited since as much as a line written since, under the suite's
 * own `relations`, `ignore` and `before`.
 *
 * No record and no configuration names the runner a suite runs under: a
 * declared suite says its role and its carrier, and a record names its cases'
 * files. So the run the suite's own runner makes is said as what it runs, the
 * test files and the cases, in {@link GapRun}, and `next` holds only commands
 * that run as printed. Naming a runner from the imports or the manifest would
 * be a guess the reader cannot check.
 */

import { lostText, type CoveringTest, type ExecutionIndex, type HeldLines } from '@variance-authority/sense/test-selection';
import { OperatorError, type RefusalKind } from '../exit.js';
import { runsText, targetText } from './covering-at.js';
import { casesByFile, type CoveringFile } from './covering-files.js';
import type { Covering } from './covering.js';
import { selectedFor, type GapSource, type Selected } from './gap-selection.js';

/**
 * The most tests a Deep gap names. A story is recorded and read one case at a
 * time, never per suite, and three is the story skill's own rule for a
 * question reading leaves open: record the first three tests `covering
 * --hops` lists, and no more (`skills/variance-authority/references/story.md`).
 * The gap holds the same number, so the skill and the answer send a reader to
 * the same run.
 */
export const DEEP_TESTS = 3;

/**
 * What the suite's own runner runs to close a gap, which no record names the
 * runner of: its test files, nearest first, or its cases, each filtered by its
 * name with the runner's filter (`-t` under Vitest, Jest and Rstest, `--grep`
 * under Playwright). Each of those filters reads a regular expression, so a
 * case carries its name escaped as one beside the name itself.
 */
export interface GapRun {
  /** The declared suite the run is of, when the answer is one suite's. */
  readonly suite?: string;
  /** The declared suites, when the run is one first run of each of several with no record. */
  readonly suites?: readonly string[];
  /** The test files to run, nearest first, or in code-unit order as selection names them. */
  readonly files?: readonly string[];
  /** The whole suite runs, for the reason selection gives. */
  readonly whole?: string;
  /** The cases to run, each filtered by `pattern`, its name as a regular expression that matches it as written; absent when each file runs whole. */
  readonly cases?: readonly { readonly file: string; readonly name: string; readonly pattern: string }[];
  /** Run under `VARIANCE_AUTHORITY_STORY=1`, so each case records its story. */
  readonly story?: true;
}

/** One question an answer leaves open, and the run that closes it. */
export interface EvidenceGap {
  /** What stays open, of the scope: `which of these tests ran it, and in what order`. */
  readonly question: string;
  /** What it is asked of: `line 20 of src/ledger.ts`. */
  readonly scope: string;
  /** What the answer does hold. */
  readonly known: string;
  /** `absent`: no record; `stale`: the record, or what it holds of the asked lines, was written over another text; `coarse`: the record holds it at a grain finer questions cannot read. */
  readonly reason: 'absent' | 'stale' | 'coarse';
  /** What closes the gap: `record`, a recorded run of the named test files; `deep`, a story of the named cases, the Deep gear. */
  readonly remedy: 'record' | 'deep';
  /** What the suite's own runner runs first, when a run closes the gap. */
  readonly run?: GapRun;
  /** The commands that run as printed, in order, after `run`. */
  readonly next: readonly string[];
  /** How many test files the run takes, and how many tests the record holds of them. Absent when no record counts the run. */
  readonly cost?: { readonly files: number; readonly tests?: number };
}

/** A refusal that still names the run that would answer it. */
export class GapRefusal extends OperatorError {
  readonly gap: EvidenceGap;

  constructor(message: string, options: ErrorOptions & { readonly kind?: RefusalKind; readonly gap: EvidenceGap }) {
    super(message, options);
    this.gap = options.gap;
  }
}

/** What a question about `file` was asked of, as a gap scopes it. */
export function gapScope(file: string, target: Covering['target']): string {
  return target === undefined ? file : `${targetText(target)} of ${file}`;
}

/**
 * The gap an answer about one file leaves open, read in order: a record of
 * another text first, then lines the record measured no run of, written since
 * or run in another text, then ranges edited since, then a line held only at
 * file grain. Nothing open is no gap. `source` is where the record was read,
 * which selection is asked of.
 */
export async function answerGap(answer: Covering, whole: ExecutionIndex, source: GapSource): Promise<EvidenceGap | undefined> {
  const file = answer.file;
  // FIXME: a `--function`, `--since` or precondition answer held at file grain ends with no gap; it should end with its Deep or Record one.
  if (file === undefined || answer.since !== undefined || answer.preconditionOf !== undefined) return undefined;
  if (answer.target !== undefined && 'function' in answer.target) return undefined;
  const scope = gapScope(file, answer.target);
  const tests = answer.tests ?? [];

  if (answer.frame === 'stale') {
    return selected('which of these tests ran it', scope, `${named(tests.length)} ran code in ${file}`, await selectedFor(source, file), whole);
  }
  const unplaced = [
    ...unplacedKnown(answer.written, ['was', 'were'], 'written since the recording'),
    ...unplacedKnown(answer.overwritten, ['is', 'are'], lostText()),
    ...unplacedKnown(answer.unknown?.lines, ['is', 'are'], 'of a text the record cannot say a case ran over'),
  ];
  if (unplaced.length > 0) return selected('which tests run it now', scope, unplaced.join(', and '), await selectedFor(source, file), whole);
  const moved = (answer.ranges ?? []).filter((range) => range.moved === true);
  if (moved.length > 0) {
    const edited = moved.length === 1 ? 'a range' : `${moved.length} ranges`;
    return selected('which tests run the edited ranges now', scope, `${edited} the record holds ${moved.length === 1 ? 'was' : 'were'} edited since the recording`, await selectedFor(source, file), whole);
  }
  if ((answer.grain === 'file' || (answer.fileGrain?.length ?? 0) > 0) && tests.length > 0) {
    const read = nearest(tests, answer.files ?? []).slice(0, DEEP_TESTS);
    const unread = tests.length - read.length;
    return deep(scope, `${named(tests.length)} loaded ${file}${unread === 0 ? '' : `, and ${unread} past the nearest ${read.length} ${unread === 1 ? 'stays' : 'stay'} unread`}`, read, unread > 0);
  }
  return undefined;
}

/** What is known of asked lines the record measured no run of, `said` of them: none when there are none. */
function unplacedKnown(runs: readonly HeldLines[] | undefined, verbs: readonly [string, string], said: string): readonly string[] {
  if (runs === undefined || runs.length === 0) return [];
  const one = runs.length === 1 && runs[0]!.startLine === runs[0]!.endLine;
  return [`${one ? 'line' : 'lines'} ${runsText(runs)} ${one ? verbs[0] : verbs[1]} ${said}`];
}

/**
 * Selection's answer for the asked file, as the run a gap names and the words
 * it adds to what is known: `said` after `joint`. A run of no file is no run.
 */
export function selectionRun(
  answer: Selected,
  suite: string | undefined,
  whole: ExecutionIndex | undefined,
): { readonly said: string; readonly joint: '; ' | ', and '; readonly run?: GapRun; readonly cost?: NonNullable<EvidenceGap['cost']> } {
  const of = suite === undefined ? {} : { suite };
  if ('unread' in answer) return { said: `which test files selection runs for it could not be read: ${answer.unread}`, joint: ', and ' };
  if ('none' in answer) return { said: 'selection runs no recorded test file for it', joint: ', and ' };
  const tests = whole?.tests ?? [];
  if ('whole' in answer) {
    const files = new Set(tests.map((test) => test.file)).size;
    return {
      said: 'selection runs the whole suite for it',
      joint: '; ',
      run: { ...of, whole: answer.whole },
      ...(whole === undefined ? {} : { cost: { files, ...(tests.length === 0 ? {} : { tests: tests.length }) } }),
    };
  }
  const run = new Set(answer.files);
  const held = tests.filter((test) => run.has(test.file)).length;
  return {
    said: `selection runs ${count(answer.files.length, 'recorded test file')} for it`,
    joint: '; ',
    run: { ...of, files: answer.files },
    cost: { files: answer.files.length, ...(held === 0 ? {} : { tests: held }) },
  };
}

/** The gap said as text, after the answer. */
export function evidenceGapText(gap: EvidenceGap): string {
  const remedy = gap.remedy === 'deep' ? 'Deep' : 'Record';
  const cost = gap.cost !== undefined ? costText(gap.cost) : gap.run === undefined ? '' : ', at a cost no record counts';
  const next = gap.run === undefined && gap.next.length === 0
    ? []
    : [`Next, ${remedy}${cost}:`, ...(gap.run === undefined ? [] : runText(gap.run)), ...gap.next.map((command) => `  ${command}`)];
  return [`Gap (${gap.reason}) on ${gap.scope}: ${gap.question}. Known: ${gap.known}.`, ...next].join('\n');
}

/** What a gap's run costs: its test files, and the tests the record holds of them when it holds any. */
function costText(cost: NonNullable<EvidenceGap['cost']>): string {
  const files = count(cost.files, 'test file');
  return cost.tests === undefined ? `, ${files}` : `, ${count(cost.tests, 'test')} in ${files}`;
}

/** The run the suite's own runner makes, said as what it runs. */
function runText(run: GapRun): readonly string[] {
  const runner = run.suite === undefined ? "the suite's own runner" : `the runner of \`${run.suite}\``;
  if (run.cases !== undefined) {
    const story = run.story === true ? ' under VARIANCE_AUTHORITY_STORY=1' : '';
    return [
      `  Run each case with ${runner}${story}, filtered by its name as a regular expression (-t; --grep under Playwright):`,
      ...run.cases.map((one) => `    ${quoted(one.file, false)}  ${quoted(one.pattern, true)}`),
    ];
  }
  if (run.whole !== undefined) return [`  Run the whole suite with ${runner}: ${run.whole}.`];
  if (run.files !== undefined) return [`  Run with ${runner}: ${run.files.map((file) => quoted(file, false)).join(' ')}`];
  if (run.suites !== undefined && run.suites.length > 1) {
    return [`  Wire the producers of ${listed(run.suites.map((suite) => `\`${suite}\``))} and record one run of each: that first run is the record.`];
  }
  const of = run.suite === undefined ? "the suite's producer" : `the producer of \`${run.suite}\``;
  return [`  Wire ${of} and record one run of it: that first run is the record.`];
}

/** `a`, `a and b`, `a, b and c`. */
function listed(words: readonly string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** A Record gap over what selection runs for the file; a run of no file is said in `known`, never named. */
function selected(question: string, scope: string, known: string, answer: Selected, whole: ExecutionIndex): EvidenceGap {
  const { said, joint, run, cost } = selectionRun(answer, undefined, whole);
  return {
    question,
    scope,
    known: run === undefined ? `${known}${joint}${said}` : known,
    reason: 'stale',
    remedy: 'record',
    ...(run === undefined ? {} : { run }),
    next: [],
    ...(cost === undefined ? {} : { cost }),
  };
}

/** A Deep gap over `tests`; `fewer` when the answer named more than the story reads, so the question is asked of these alone. */
function deep(scope: string, known: string, tests: readonly CoveringTest[], fewer: boolean): EvidenceGap {
  return {
    question: fewer ? `which of the nearest ${tests.length} ran it, and in what order` : 'which of these tests ran it, and in what order',
    scope,
    known,
    reason: 'coarse',
    remedy: 'deep',
    run: { cases: tests.map((test) => ({ file: test.file, name: test.name, pattern: escaped(test.name) })), story: true },
    next: tests.map((test) => `variance story --file ${quoted(test.file, false)} --name ${quoted(test.name, true)}`),
    cost: { tests: tests.length, files: new Set(tests.map((test) => test.file)).size },
  };
}

/** The cases in the order the answer lists them: by its file rows, then any file they leave out. */
function nearest(tests: readonly CoveringTest[], files: readonly CoveringFile[]): readonly CoveringTest[] {
  return [...casesByFile(tests, files).values()].flat();
}

function named(n: number): string {
  return `${n} named test${n === 1 ? '' : 's'}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** `name` as a regular expression that matches it as written. */
function escaped(name: string): string {
  return name.replaceAll(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}

/** A shell word: a name always quoted, a path only when the shell would split or expand it. */
function quoted(word: string, always: boolean): string {
  if (!always && /^[\w./@%+=:,-]+$/u.test(word)) return word;
  return `'${word.replaceAll("'", "'\\''")}'`;
}
