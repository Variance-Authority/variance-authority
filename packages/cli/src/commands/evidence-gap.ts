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
 * No record and no configuration names the runner a suite runs under: a
 * declared suite says its role and its carrier, and a record names its cases'
 * files. So the run the suite's own runner makes is said as what it runs, the
 * test files and the cases, in {@link GapRun}, and `next` holds only commands
 * that run as printed. Naming a runner from the imports or the manifest would
 * be a guess the reader cannot check.
 */

import { coveringTestsInFile, type CoveringTest, type ExecutionIndex } from '@variance-authority/sense/test-selection';
import { OperatorError, type RefusalKind } from '../exit.js';
import { runsText, targetText } from './covering-at.js';
import { coveringFiles, type CoveringFile } from './covering-files.js';
import type { ParsedCovering } from '../covering-args.js';
import type { Covering } from './covering.js';

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
 * under Playwright).
 */
export interface GapRun {
  /** The declared suite the run is of, when the answer is one suite's. */
  readonly suite?: string;
  /** The test files to run, nearest first. Absent: the whole suite, which only a suite with no record is sent to, since that first run is the record. */
  readonly files?: readonly string[];
  /** The cases to run, each filtered by its name; absent when each file runs whole. */
  readonly cases?: readonly { readonly file: string; readonly name: string }[];
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
  /** `absent`: no record; `stale`: the record is of another text; `coarse`: the record holds it at a grain finer questions cannot read. */
  readonly reason: 'absent' | 'stale' | 'coarse';
  /** `record`: a recorded run of the named test files; `deep`: a story of the named cases. */
  readonly gear: 'record' | 'deep';
  /** What the suite's own runner runs first, when a run closes the gap. */
  readonly run?: GapRun;
  /** The commands that run as printed, in order, after `run`. */
  readonly next: readonly string[];
  /** How many tests, in how many test files, the commands run. Absent when no record counts them. */
  readonly cost?: { readonly tests: number; readonly files: number };
}

/** A refusal that still names the run that would answer it. */
export class GapRefusal extends OperatorError {
  readonly gap: EvidenceGap;

  constructor(message: string, options: ErrorOptions & { readonly kind?: RefusalKind; readonly gap: EvidenceGap }) {
    super(message, options);
    this.gap = options.gap;
  }
}

/**
 * The gap of a refusal `kind` of a question about one file, a line or a run of
 * them, when a run closes it: `older`, or `unrecorded`. `whole` is the record,
 * when one was read, and counts the run.
 */
export function refusalGap(kind: RefusalKind | undefined, request: ParsedCovering, whole: ExecutionIndex | undefined): EvidenceGap | undefined {
  if (request.file === undefined || request.since !== undefined || request.function !== undefined) return undefined;
  const target = request.line !== undefined ? { line: request.line } : request.lines === undefined ? undefined : { lines: request.lines };
  const scope = gapScope(request.file, target);
  if (kind === 'older') {
    return {
      question: 'which tests run it',
      scope,
      known: 'the record predates the file',
      reason: 'stale',
      gear: 'record',
      next: ['<runner>'],
      ...(whole === undefined ? {} : { cost: { tests: whole.tests.length, files: new Set(whole.tests.map((test) => test.file)).size } }),
    };
  }
  if (kind === 'unrecorded') {
    return { question: 'which tests ran it', scope, known: 'no run is recorded', reason: 'absent', gear: 'record', run: {}, next: [] };
  }
  return undefined;
}

/** What a question about `file` was asked of, as a gap scopes it. */
export function gapScope(file: string, target: Covering['target']): string {
  return target === undefined ? file : `${targetText(target)} of ${file}`;
}

/**
 * The gap an answer about one file leaves open, read in order: a record of
 * another text first, then lines written or ranges edited since, then a line
 * held only at file grain. Nothing open is no gap.
 */
export function answerGap(answer: Covering, whole: ExecutionIndex): EvidenceGap | undefined {
  const file = answer.file;
  if (file === undefined || answer.since !== undefined || answer.preconditionOf !== undefined) return undefined;
  if (answer.target !== undefined && 'function' in answer.target) return undefined;
  const scope = gapScope(file, answer.target);
  const tests = answer.tests ?? [];

  if (answer.frame === 'stale') {
    return record('which of these tests ran it', scope, `${named(tests.length)} ran code in ${file}`, answer.files ?? coveringFiles(tests, whole));
  }
  if (answer.written !== undefined && answer.written.length > 0) {
    const ran = coveringTestsInFile(whole, file).flatMap((range) => range.tests);
    const one = answer.written.length === 1 && answer.written[0]!.startLine === answer.written[0]!.endLine;
    return record('which tests run it now', scope, `${one ? 'line' : 'lines'} ${runsText(answer.written)} ${one ? 'was' : 'were'} written since the recording`, coveringFiles(distinct(ran), whole));
  }
  const moved = (answer.ranges ?? []).filter((range) => range.moved === true);
  if (moved.length > 0) {
    const edited = moved.length === 1 ? 'a range' : `${moved.length} ranges`;
    return record('which tests run the edited ranges now', scope, `${edited} the record holds ${moved.length === 1 ? 'was' : 'were'} edited since the recording`, coveringFiles(distinct(moved.flatMap((range) => range.tests)), whole));
  }
  if ((answer.grain === 'file' || (answer.fileGrain?.length ?? 0) > 0) && tests.length > 0) {
    return deep(scope, `${named(tests.length)} loaded ${file}`, nearest(tests, answer.files ?? []).slice(0, DEEP_TESTS));
  }
  return undefined;
}

/** The gap said as text, after the answer. */
export function evidenceGapText(gap: EvidenceGap): string {
  const gear = gap.gear === 'deep' ? 'Deep' : 'Record';
  const cost = gap.cost !== undefined
    ? `, ${count(gap.cost.tests, 'test')} in ${count(gap.cost.files, 'test file')}`
    : gap.run === undefined ? '' : ', at a cost no record counts';
  return [
    `Gap (${gap.reason}) on ${gap.scope}: ${gap.question}. Known: ${gap.known}.`,
    `Next, ${gear}${cost}:`,
    ...(gap.run === undefined ? [] : runText(gap.run)),
    ...gap.next.map((command) => `  ${command}`),
  ].join('\n');
}

/** The run the suite's own runner makes, said as what it runs. */
function runText(run: GapRun): readonly string[] {
  const runner = run.suite === undefined ? "the suite's own runner" : `the runner of \`${run.suite}\``;
  if (run.cases !== undefined) {
    const story = run.story === true ? ' under VARIANCE_AUTHORITY_STORY=1' : '';
    return [
      `  Run each case with ${runner}${story}, filtered by its name (-t; --grep under Playwright):`,
      ...run.cases.map((one) => `    ${quoted(one.file, false)}  ${quoted(one.name, true)}`),
    ];
  }
  if (run.files === undefined) {
    const of = run.suite === undefined ? "the suite's producer" : `the producer of \`${run.suite}\``;
    return [`  Wire ${of} and record one run of it: that first run is the record.`];
  }
  return [`  Run with ${runner}: ${run.files.map((file) => quoted(file, false)).join(' ')}`];
}

function record(question: string, scope: string, known: string, files: readonly CoveringFile[]): EvidenceGap {
  return {
    question,
    scope,
    known,
    reason: 'stale',
    gear: 'record',
    run: { files: files.map((row) => row.file) },
    next: [],
    cost: { tests: files.reduce((sum, row) => sum + row.of, 0), files: files.length },
  };
}

function deep(scope: string, known: string, tests: readonly CoveringTest[]): EvidenceGap {
  return {
    question: 'which of these tests ran it, and in what order',
    scope,
    known,
    reason: 'coarse',
    gear: 'deep',
    run: { cases: tests.map((test) => ({ file: test.file, name: test.name })), story: true },
    next: tests.map((test) => `variance story --file ${quoted(test.file, false)} --name ${quoted(test.name, true)}`),
    cost: { tests: tests.length, files: new Set(tests.map((test) => test.file)).size },
  };
}

/** The cases in the order the answer lists them: by its file rows, then any file they leave out. */
function nearest(tests: readonly CoveringTest[], files: readonly CoveringFile[]): readonly CoveringTest[] {
  const byFile = new Map<string, CoveringTest[]>(files.map((row) => [row.file, []]));
  for (const test of tests) {
    const held = byFile.get(test.file);
    if (held === undefined) byFile.set(test.file, [test]);
    else held.push(test);
  }
  return [...byFile.values()].flat();
}

function distinct(tests: readonly CoveringTest[]): readonly CoveringTest[] {
  const seen = new Set<string>();
  return tests.filter((test) => {
    if (seen.has(test.id)) return false;
    seen.add(test.id);
    return true;
  });
}

function named(n: number): string {
  return `${n} named test${n === 1 ? '' : 's'}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** A shell word: a name always quoted, a path only when the shell would split or expand it. */
function quoted(word: string, always: boolean): string {
  if (!always && /^[\w./@%+=:,-]+$/u.test(word)) return word;
  return `'${word.replaceAll("'", "'\\''")}'`;
}
