// compass: variance-authority.reach
/**
 * Each step of selection, asked alone.
 *
 * `narrowByChangeFromView` composes these steps in the order spec 0091 sets:
 * ignore, route, then the record, the reading, the preconditions and the
 * graph. That is the answer a suite runs on. A caller with a narrower question
 * asks one step: an external system that already knows which files moved and
 * wants the tests that loaded them, or a simulation that invents a range and
 * asks which regions it falls in. Every input is a value — a change, a list of
 * paths, a graph — so no step reads git, a diff or the tree on its own.
 *
 * Every step answers in one shape: the tests it selected, the reasons it
 * selected each for, and the files it could not answer. A file one step leaves
 * unanswered is the next step's question, as the composition hands it on; a
 * step never widens on what it could not answer.
 */

import { idOf, type Relations } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Change } from './change.js';
import { causesOf, chargeAt, chargeLines, chargeLoaded, entering, selector } from './charging.js';
import type { TestCoverageView } from './format-view.js';
import { answerByImporters } from './importers.js';
import { instrumentedRows, testsGovernedBy } from './lookup.js';
import type { ExecutionNarrowingOptions, SelectionCause, SelectionReason } from './narrowing.js';
import { selectedByRelations } from './precision.js';
import { readRowless, type FileReading } from './reading.js';
import { routeOf, type Route } from './route.js';
import { disownedIn } from './shadowed.js';

/** What one step selected, and what it could not answer. */
export interface OperationAnswer {
  /** The tests selected, in code-unit order. */
  readonly entered: readonly string[];
  /** Every selected test with each reason it was selected for. */
  readonly because: readonly SelectionCause[];
  /** The files asked that this step holds no answer for, in code-unit order: the next step's question. */
  readonly unanswered: readonly string[];
}

/** The names a file may be held under, as the composition asks them (`ExecutionNarrowingOptions.knownAs`). */
type Names = Pick<ExecutionNarrowingOptions, 'knownAs'>;

const knownAsOf = (options: Names): ((file: string) => readonly string[]) => options.knownAs ?? ((file) => [file]);

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
  const knownAs = knownAsOf(options);
  return new Map(
    [...new Set(files)].sort(codeUnitOrder).map((file) => [file, routeOf(instrumentedRows(coverage, knownAs(file)).size > 0, options.unmeasured)]),
  );
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
  const knownAs = knownAsOf(options);
  const { selected, select } = selector();
  const charge = entering(coverage, disownedIn(coverage, options.relations), select);
  const unanswered: string[] = [];
  const seen = new Set<string>();
  for (const file of [...new Set(files)].sort(codeUnitOrder)) {
    const rowsOf = instrumentedRows(coverage, knownAs(file));
    if (rowsOf.size === 0) unanswered.push(file);
    else if (once(seen, rowsOf)) chargeLoaded(coverage, file, rowsOf, charge);
  }
  return answer(coverage, selected, unanswered);
}

/**
 * Every test that entered the regions each file's changed lines fall in, at
 * `precision` (`region-use` when absent): `function-use` widens each region to
 * the declaration it is in, and `file-use` is `testsLoadingFromView`. A file
 * changed whole — no lines — is every region of it.
 *
 * Lines are read as they are given, in the coordinates of the text the record
 * was cut from: nothing here checks that frame or reads what the lines moved,
 * which is the composition's work. A file with no instrumented row is
 * unanswered.
 */
export function testsEnteringFromView(
  coverage: TestCoverageView,
  change: Pick<Change, 'lines'>,
  options: Names & Pick<ExecutionNarrowingOptions, 'relations'> & { readonly precision?: 'file-use' | 'function-use' | 'region-use' } = {},
): OperationAnswer {
  if (options.precision === 'file-use') return testsLoadingFromView(coverage, change.lines.keys(), options);
  const knownAs = knownAsOf(options);
  const { selected, select } = selector();
  const charge = chargeAt(coverage, options.precision, entering(coverage, disownedIn(coverage, options.relations), select));
  const unanswered: string[] = [];
  const seen = new Set<string>();
  for (const [file, ranges] of [...change.lines].sort(([left], [right]) => codeUnitOrder(left, right))) {
    const rowsOf = instrumentedRows(coverage, knownAs(file));
    if (rowsOf.size === 0) unanswered.push(file);
    else if (once(seen, rowsOf)) chargeLines(coverage, file, rowsOf, ranges, charge);
  }
  return answer(coverage, selected, unanswered);
}

/**
 * Every test that declared one of each file's names as a precondition: the
 * declaration retires the observation whenever the file's text moves, so
 * nothing narrows it. A file no test declared is unanswered.
 */
export function testsDeclaringFromView(coverage: TestCoverageView, files: Iterable<string>, options: Names = {}): OperationAnswer {
  const knownAs = knownAsOf(options);
  const asked = [...new Set(files)].sort(codeUnitOrder);
  const governed = testsGovernedBy(coverage, [...new Set(asked.flatMap((file) => [...knownAs(file)]))]);
  const { selected, select } = selector();
  for (const [test, names] of governed.tests) for (const name of names) select(test, { kind: 'precondition', name });
  const unread = new Set(governed.unread);
  return answer(coverage, selected, asked.filter((file) => knownAs(file).every((name) => unread.has(name))));
}

/**
 * The tests the import graph reaches from each file, each with the chain that
 * reached it: what `file` precision adds to `testsLoadingFromView`, and with
 * `moved` — each file's moved exports — what `symbol` adds. A file the graph
 * does not hold is unanswered.
 */
export function graphReachFromView(
  coverage: TestCoverageView,
  files: Iterable<string>,
  options: { readonly relations: Relations; readonly moved?: ReadonlyMap<string, readonly string[]> },
): OperationAnswer {
  const asked = [...new Set(files)].sort(codeUnitOrder);
  const selected = selectedByRelations(coverage, options.relations, asked, options.moved);
  return answer(coverage, selected, asked.filter((file) => idOf(options.relations, 'file', file) === undefined));
}

/**
 * Each file the record holds no instrumented row for, walked up its importers
 * over every edge a runtime loads through to the nearest file the record
 * holds — a test, or a row with probes — whose tests answer for it. A
 * stylesheet or an image is walked through the modules that import it as an
 * asset (`importers.ts`).
 *
 * A file with a row is the row's, and a test that declares the file is the
 * preconditions'; neither is answered here. Unanswered is a file the graph does
 * not hold, every file the record has a row for, and every file when the suite
 * declines relations.
 */
export function importersFromView(
  coverage: TestCoverageView,
  files: Iterable<string>,
  options: Names & Pick<ExecutionNarrowingOptions, 'unmeasured'> & { readonly relations: Relations },
): OperationAnswer {
  const knownAs = knownAsOf(options);
  const asked = [...new Set(files)].sort(codeUnitOrder);
  const rowed = new Set(asked.flatMap((file) => [...instrumentedRows(coverage, knownAs(file)).keys()]));
  const answered = answerByImporters(
    coverage,
    { changed: asked, ignored: new Set(), rowed, disowned: disownedIn(coverage, options.relations), also: new Set(), wholes: [], arrived: new Map() },
    options,
  );
  const held = asked.filter((file) => knownAs(file).some((name) => rowed.has(name)));
  return answer(coverage, answered.selected, [...answered.unread, ...held]);
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
  const asked = [...new Set(ignored)].sort(codeUnitOrder);
  const answered = answerByImporters(
    coverage,
    { changed: asked, ignored: new Set(asked), rowed: new Set(), disowned: disownedIn(coverage, options.relations), also: new Set(), wholes: [], arrived: new Map() },
    options,
  );
  return answer(coverage, answered.selected, answered.unheld);
}

/**
 * Each changed module the record holds no row for, read against its text at
 * the recorded commit (`sourceAt`) or against nothing when it is new: every
 * export counts as moved, and the regions that read them are charged (#520).
 * An importer the reading could not read is answered by every test that loaded
 * it.
 *
 * Unanswered is a file with a row, one changed whole, and one the reading
 * left to the importer walk — no graph, no text, no reader, or a `load`
 * verdict. Each reading made is returned beside the answer.
 */
export function readRowlessFromView(
  coverage: TestCoverageView,
  change: Change,
  options: Omit<ExecutionNarrowingOptions, 'precision'> & { readonly precision?: 'file-use' | 'function-use' | 'region-use' },
): OperationAnswer & { readonly readings: readonly FileReading[] } {
  const knownAs = knownAsOf(options);
  const { selected, select } = selector();
  const disowned = disownedIn(coverage, options.relations);
  const wholes = new Map<string, Array<Extract<SelectionReason, { readonly kind: 'reader' }>>>();
  const context = {
    coverage,
    options,
    knownAs,
    hunks: change.hunks,
    charge: chargeAt(coverage, options.precision, entering(coverage, disowned, select)),
    pick: select,
    whole: (file: string, reason: Extract<SelectionReason, { readonly kind: 'reader' }>): void => {
      wholes.set(file, [...(wholes.get(file) ?? []), reason]);
    },
  };
  const readings: FileReading[] = [];
  const unanswered: string[] = [];
  for (const [file, lines] of [...change.lines].sort(([left], [right]) => codeUnitOrder(left, right))) {
    const read = lines.length === 0 || instrumentedRows(coverage, knownAs(file)).size > 0 ? undefined : readRowless(context, file);
    if (read !== undefined) readings.push(read.reading);
    if (read?.charged !== true) unanswered.push(file);
  }
  if (wholes.size > 0) {
    const answered = answerByImporters(
      coverage,
      { changed: [], ignored: new Set(), rowed: new Set(), disowned, also: new Set(), wholes: [...wholes.keys()].sort(codeUnitOrder), arrived: new Map() },
      options,
    );
    for (const [test, files] of answered.wholes) for (const reason of files.flatMap((file) => wholes.get(file) ?? [])) select(test, reason);
  }
  return { ...answer(coverage, selected, unanswered), readings };
}

/** Whether these rows are asked for the first time: a file handed over under two of its names is charged once. */
function once(seen: Set<string>, rowsOf: ReadonlyMap<string, readonly number[]>): boolean {
  const held = [...rowsOf.keys()].sort(codeUnitOrder).join('\n');
  if (seen.has(held)) return false;
  seen.add(held);
  return true;
}

function answer(
  coverage: TestCoverageView,
  selected: ReadonlyMap<number, readonly SelectionReason[]>,
  unanswered: readonly string[],
): OperationAnswer {
  const because = causesOf(coverage, selected);
  return { entered: because.map((cause) => cause.test), because, unanswered: [...new Set(unanswered)].sort(codeUnitOrder) };
}
