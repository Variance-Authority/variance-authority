// compass: variance-authority.reach
/**
 * Each stage of selection, asked alone.
 *
 * `narrowByChangeFromView` calls the stages in `stages.ts` in the order spec
 * 0091 sets: ignore, route, then coverage, the reading, the preconditions and
 * the importer walk. That is the answer a suite runs on. A caller with a
 * narrower question asks one stage: an external system that already knows which
 * files moved and wants the tests that loaded them, or a simulation that
 * invents a range and asks which regions it falls in. Each function here opens
 * a run of its own and calls the same stage the composition calls, so a stage
 * asked alone answers as it does inside the whole. Every input is a value — a
 * change, a list of paths, a graph, the texts at the recorded commit — and no
 * stage reads git; only `root`, where it is given, reads the checkout's
 * layouts.
 *
 * Every stage answers in one shape: the tests it selected, the reasons it
 * selected each for, and the files it could not answer. A file one stage leaves
 * unanswered is the next stage's question, as the composition hands it on; a
 * stage never widens on what it could not answer.
 */

import { idOf, type Relations } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { changeOfFiles, type Change } from './change.js';
import { causesOf } from './charging.js';
import type { LineRange } from './diff-lines.js';
import type { TestCoverageView } from './format-view.js';
import type { ExecutionNarrowingOptions, SelectionCause, SelectionReason } from './narrowing.js';
import { selectedByRelations, type Precision } from './precision.js';
import type { FileReading } from './reading.js';
import type { Route } from './route.js';
import { arrivedAt, chargeMeasured, readUnmeasured, routed, runOf, seenThrough, selectAnswered, selectDeclared, selectOwn, walked, type Run } from './stages.js';

/** What one stage selected, and what it could not answer. */
export interface OperationAnswer {
  /** The tests selected, in code-unit order. */
  readonly entered: readonly string[];
  /** Every selected test with each reason it was selected for. */
  readonly because: readonly SelectionCause[];
  /** The files asked that this stage holds no answer for, in code-unit order: the next stage's question. */
  readonly unanswered: readonly string[];
}

/** A precision the record answers alone; `file` and `symbol` add the graph's reach (`graphReachFromView`). */
type UsePrecision = Exclude<Precision, 'file' | 'symbol'>;

/**
 * The options of the whole narrowing a stage reads, at a precision the record
 * answers alone. `ignore` is its own stage (`ignoredChange`), and the undone
 * pass over `keptDigests` asks for files the change does not name, so neither
 * is taken here.
 */
type StageOptions = Omit<ExecutionNarrowingOptions, 'precision' | 'ignore' | 'keptDigests'> & { readonly precision?: UsePrecision };

/** What a stage reads to know a file's names: `knownAs`, or the layouts under `root`. */
type Names = Pick<ExecutionNarrowingOptions, 'knownAs' | 'root'>;

/** The paths of `files`, each once, in code-unit order. */
const sorted = (files: Iterable<string>): string[] => [...new Set(files)].sort(codeUnitOrder);

/** The files of `change`, in code-unit order. */
const filesOf = (change: Pick<Change, 'lines'>): Array<[string, readonly LineRange[]]> =>
  [...change.lines].sort(([left], [right]) => codeUnitOrder(left, right));

/**
 * The route each file takes: `coverage` when the record holds an instrumented
 * row for it under any name, and otherwise what the suite does with a file it
 * did not measure (`route.ts`).
 */
export function routesFromView(
  coverage: TestCoverageView,
  files: Iterable<string>,
  options: Names & Pick<ExecutionNarrowingOptions, 'unmeasured'> = {},
): ReadonlyMap<string, Route> {
  const asked = sorted(files);
  const run = runOf(coverage, options, new Map(), asked);
  return new Map(asked.map((file) => [file, routed(run, file).route]));
}

/**
 * Every test that loaded each file: every region of every instrumented row the
 * record holds for it, whatever changed inside. The answer `file-use` precision
 * gives a measured file, and the one a caller holding only paths asks.
 *
 * `relations` cuts a test that mocked the file (`shadowed.ts`). A file with no
 * instrumented row is unanswered.
 */
export function testsLoadingFromView(
  coverage: TestCoverageView,
  files: Iterable<string>,
  options: Names & Pick<ExecutionNarrowingOptions, 'relations'> = {},
): OperationAnswer {
  const { entered, because, unanswered } = testsEnteringFromView(coverage, changeOfFiles(files), { ...options, precision: 'file-use' });
  return { entered, because, unanswered };
}

/**
 * Every test that entered the regions each measured file's changed lines fall
 * in, at `precision` (`region-use` when absent): `function-use` widens each
 * region to the declaration it is in, and `file-use` is every test that loaded
 * the file. A file changed whole — no lines — is every region of it.
 *
 * With `sourceAt`, the record's frame is checked as the composition checks it:
 * rows cut from another text than the one the change is written against are
 * `stale` and charged whole, and a frame proved lets the parser read what the
 * lines moved, each reading returned beside the answer. Without it, lines are
 * read as given. A file with no instrumented row is unanswered.
 */
export function testsEnteringFromView(
  coverage: TestCoverageView,
  change: Change,
  options: StageOptions = {},
): OperationAnswer & { readonly stale: readonly string[]; readonly readings: readonly FileReading[] } {
  const run = runOf(coverage, options, change.hunks, change.lines.keys());
  const unanswered: string[] = [];
  for (const [file, lines] of filesOf(change)) {
    const { rows } = routed(run, file);
    if (rows.size === 0) unanswered.push(file);
    else chargeMeasured(run, file, rows, lines);
  }
  return { ...answer(run, unanswered), stale: [...run.stale].sort(codeUnitOrder), readings: run.readings };
}

/**
 * Every test that declared one of each changed file's names as a
 * precondition: the declaration retires the observation whenever the file's
 * text moves, so nothing narrows it. A test's own file is its precondition
 * whether or not it declared it, and selects it whatever text it last ran.
 * With `sourceAt`, any other test that already ran the text a rowless file
 * arrives at is not kept, as in the composition. A file no test declared and
 * no test is is unanswered.
 */
export function testsDeclaringFromView(
  coverage: TestCoverageView,
  change: Change,
  options: Names & Pick<ExecutionNarrowingOptions, 'sourceAt'> = {},
): OperationAnswer {
  const run = runOf(coverage, options, change.hunks, change.lines.keys());
  const asked = filesOf(change);
  const own = selectOwn(run, change.lines.keys());
  // The precondition table read as the composition reads it: with nothing to walk, the walk is that one read.
  const { governed } = walked(run, {
    changed: [],
    ignored: new Set(),
    also: new Set(asked.flatMap(([file]) => run.knownAs(file))),
    arrived: arrivedAt(run, asked).arrived,
  });
  selectDeclared(run, governed);
  const unread = new Set(governed.unread);
  return answer(run, asked.map(([file]) => file).filter((file) => !own.has(file) && run.knownAs(file).every((name) => unread.has(name))));
}

/**
 * The tests the import graph reaches from each file, each with the chain that
 * reached it: what `file` precision adds to `testsLoadingFromView`, and with
 * `moved` — each file's moved exports — what `symbol` adds. The composition
 * reads `moved` from the texts; asked alone, a file `moved` does not name is
 * walked whole. A file the graph does not hold is unanswered.
 */
export function graphReachFromView(
  coverage: TestCoverageView,
  files: Iterable<string>,
  options: { readonly relations: Relations; readonly moved?: ReadonlyMap<string, readonly string[]> },
): OperationAnswer {
  const asked = sorted(files);
  const selected = selectedByRelations(coverage, options.relations, asked, options.moved);
  return answerOf(coverage, selected, asked.filter((file) => idOf(options.relations, 'file', file) === undefined));
}

/**
 * Each file the record holds no instrumented row for, walked up its importers
 * over every edge a runtime loads through to the nearest file the record
 * holds — a test, or a row with probes — whose tests answer for it. A
 * stylesheet or an image is walked through the modules that import it as an
 * asset (`importers.ts`).
 *
 * A file with a row is the row's, and a test that declares the file is the
 * preconditions'; neither is answered here. With `sourceAt`, a test that
 * declared a file and already ran the text it arrives at is not held by it,
 * and the walk keeps its chain, as in the composition. A rowless file the
 * reading charges (`readRowlessFromView`) is the reading's in the composition:
 * ask this stage with what the reading left unanswered to get its answer. Unanswered is a file the graph does
 * not hold, every file the record has a row for, and every file when the suite
 * declines relations.
 */
export function importersFromView(
  coverage: TestCoverageView,
  change: Change,
  options: Names & Pick<ExecutionNarrowingOptions, 'unmeasured' | 'sourceAt'> & { readonly relations: Relations },
): OperationAnswer {
  const run = runOf(coverage, options, change.hunks, change.lines.keys());
  const asked = filesOf(change);
  for (const [file] of asked) for (const name of routed(run, file).rows.keys()) run.rowed.add(name);
  const files = asked.map(([file]) => file);
  // A test that declared a file and ran the text it arrives at is not held by it, so the walk keeps its chain.
  const answered = walked(run, { changed: files, ignored: new Set(), arrived: arrivedAt(run, asked).arrived });
  selectAnswered(run, answered);
  const held = files.filter((file) => run.knownAs(file).some((name) => run.rowed.has(name)));
  return answer(run, [...answered.unread, ...held]);
}

/**
 * Each ignored file walked through the modules that declare they read it
 * (`/// <depends>`), and through nothing else: a suite's `ignore` cuts what
 * selection infers from a file and keeps what code declares of it. A declaring
 * module with a row answers with its tests; one without goes on to its
 * importers, or, in a suite that declines relations, is unanswered.
 */
export function dependsReachFromView(
  coverage: TestCoverageView,
  ignored: Iterable<string>,
  options: Names & Pick<ExecutionNarrowingOptions, 'unmeasured'> & { readonly relations: Relations },
): OperationAnswer {
  const asked = sorted(ignored);
  const run = runOf(coverage, options, new Map(), asked);
  const answered = walked(run, { changed: asked, ignored: new Set(asked) });
  selectAnswered(run, answered);
  return answer(run, answered.unheld);
}

/**
 * Each changed module the record holds no row for, read against its text at
 * the recorded commit (`sourceAt`) or against nothing when it is new: every
 * export counts as moved, and the regions that read them are charged (#520).
 * An importer the reading could not read is answered by every test that loaded
 * it, through the importer walk, as in the composition.
 *
 * Unanswered is a file with a row, one changed whole, one the suite declines
 * relations for, and one the reading left to the importer walk — no graph, no
 * text, no reader, or a `load` verdict. Each reading made is returned beside
 * the answer.
 */
export function readRowlessFromView(
  coverage: TestCoverageView,
  change: Change,
  options: StageOptions,
): OperationAnswer & { readonly readings: readonly FileReading[] } {
  const run = runOf(coverage, options, change.hunks, change.lines.keys());
  const unanswered: string[] = [];
  for (const [file, lines] of filesOf(change)) {
    if (routed(run, file).route !== 'relations' || !readUnmeasured(run, file, lines)) unanswered.push(file);
  }
  const through = run.wholes.size === 0 ? new Set<string>() : selectAnswered(run, walked(run, { changed: [], ignored: new Set() }));
  return { ...answer(run, unanswered), readings: seenThrough(run.readings, through) };
}

function answer(run: Run, unanswered: readonly string[]): OperationAnswer {
  return answerOf(run.coverage, run.selected, unanswered);
}

function answerOf(
  coverage: TestCoverageView,
  selected: ReadonlyMap<number, readonly SelectionReason[]>,
  unanswered: readonly string[],
): OperationAnswer {
  const because: readonly SelectionCause[] = causesOf(coverage, selected);
  return { entered: because.map((cause) => cause.test), because, unanswered: sorted(unanswered) };
}
