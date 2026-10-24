// compass: variance-authority.reach
/**
 * The stages of selection, each over one shared run.
 *
 * A run is the sink every stage writes into: the tests selected with their
 * reasons, the readings made, the names answered by a row, the rows found
 * stale, and the files left for the importer walk to answer whole. The
 * composition (`select.ts`) opens one run and calls the stages in the order
 * spec 0091 sets; a stage asked alone (`operations.ts`) opens a run of its own
 * and calls the same stage. Neither holds a second copy of what a stage does.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { builtNamesOf } from './built-names.js';
import { chargeAt, chargeLines, chargeLoaded, entering, selector, type Charge } from './charging.js';
import { frameOf } from './frame.js';
import type { TestCoverageView } from './format-view.js';
import { answerByImporters, type ImporterAnswer } from './importers.js';
import { instrumentedRows, testPathOf } from './lookup.js';
import type { ExecutionNarrowingOptions, SelectionReason } from './narrowing.js';
import { readChange, readRowless, type FileReading, type ReadingContext } from './reading.js';
import { hunksFor } from './patch.js';
import { routeOf, type Route } from './route.js';
import { disownedIn, type Disowned } from './shadowed.js';
import { rebasedChange } from './text-diff.js';
import { arrivedDigests, ranOverReading } from './ran-over.js';

type ReaderReason = Extract<SelectionReason, { readonly kind: 'reader' }>;

/** One run of selection: what its stages read with, and what they wrote. */
export interface Run extends ReadingContext {
  readonly charge: Charge;
  readonly disowned: Disowned | undefined;
  readonly selected: Map<number, SelectionReason[]>;
  /** Every importer a reading could not read and holds no row for, with the reasons it gave. */
  readonly wholes: Map<string, ReaderReason[]>;
  readonly readings: FileReading[];
  /** Every name answered from a row, or by a reading: not walked. */
  readonly rowed: Set<string>;
  /** Every name whose rows were cut from a text other than the one the change is written against. */
  readonly stale: Set<string>;
  /** The rows already charged: a file handed over under two of its names is charged once. */
  readonly seen: Set<string>;
}

/**
 * `options` with the names each of `files` may be held under: given, or, with
 * a checkout to read layouts in (`root`), every recorded name built from it.
 */
export function namedAs(coverage: TestCoverageView, options: ExecutionNarrowingOptions, files: Iterable<string>): ExecutionNarrowingOptions {
  return options.knownAs !== undefined || options.root === undefined ? options : { ...options, knownAs: builtNamesOf(coverage, options.root, files) };
}

/** A run over `coverage`, reading `hunks` as the change's own, and `files` under every name `namedAs` gives them. */
export function runOf(coverage: TestCoverageView, asked: ExecutionNarrowingOptions, hunks: Run['hunks'], files: Iterable<string> = hunks.keys()): Run {
  const options = namedAs(coverage, asked, files);
  const { selected, select } = selector();
  // A test that mocked the module is not the audience of what it only loaded there (`shadowed.ts`).
  const disowned = disownedIn(coverage, options.relations);
  const wholes = new Map<string, ReaderReason[]>();
  return {
    coverage,
    options,
    knownAs: options.knownAs ?? ((file) => [file]),
    hunks,
    charge: chargeAt(coverage, options.precision, entering(coverage, disowned, select)),
    pick: select,
    whole: (file, reason) => {
      wholes.set(file, [...(wholes.get(file) ?? []), reason]);
    },
    disowned,
    selected,
    wholes,
    readings: [],
    rowed: new Set(),
    stale: new Set(),
    seen: new Set(),
  };
}

/**
 * Route: every row the record holds for `file` under any of its names, and the
 * route that gives it — `coverage` when there is one, and otherwise what the
 * suite does with a file it did not measure (`route.ts`). Two builds reading a
 * path are two rows, each with its own crossings, and the answer is all of
 * them; `instrumented: false` is the build saying it never read this module.
 */
export function routed(run: Run, file: string): { readonly rows: ReadonlyMap<string, readonly number[]>; readonly route: Route } {
  const rows = instrumentedRows(run.coverage, run.knownAs(file));
  return { rows, route: routeOf(rows.size > 0, run.options.unmeasured) };
}

/**
 * Coverage: a measured file's changed lines charged to the regions they fall
 * in, at the run's precision. At `file-use` it is every test that loaded the
 * file. Otherwise the record's frame is checked first: rows cut from a text
 * the landing kept are read against the change from that text, rows cut from
 * a text nobody holds are stale and charged whole, and a frame proved lets the
 * parser read what the lines moved. `undone` is a file the change does not
 * name whose tests ran an edit that is gone.
 */
export function chargeMeasured(
  run: Run,
  file: string,
  rows: ReadonlyMap<string, readonly number[]>,
  lines: Parameters<typeof chargeLines>[3],
  undone = false,
): void {
  const { coverage, options, knownAs } = run;
  // A caller that writes one file's hunks under each of its names hands the
  // same change over twice, and every name of it was charged the first time.
  const held = [...rows.keys()].sort(codeUnitOrder).join('\n');
  if (run.seen.has(held)) return;
  run.seen.add(held);
  if (options.precision === 'file-use') {
    chargeLoaded(coverage, file, rows, run.charge);
    return;
  }

  // Everything below reads line numbers, and a line number is only a place
  // in the text it was cut from. The recorder wrote a digest of that text,
  // so whether these numbers mean anything here is a question the snapshot
  // answers about itself.
  let ranges = lines;
  let frame = frameOf(coverage, knownAs(file), rows, options.sourceAt, options.keptText);
  let reader: ReadingContext = run;
  // An undone file read in the commit's own text, or not read at all, ran
  // what is on disk: nothing changed for it.
  if (undone && (typeof frame !== 'object' || frame.kept !== true) && frame !== 'stale') return;
  // Lines with no hunks say where the file moved and not what it became: no
  // text is arrived at, so none is rebased or read, and the lines are charged.
  // An undone file is the exception: the diff never named it, so it arrives
  // at the commit's own text.
  const patched = undone || hunksFor(run.hunks, file) !== undefined;
  // Lines cut against the commit's text cannot be moved onto a kept text
  // without the hunks, so the record's line numbers say nothing here.
  if (!patched && typeof frame === 'object' && frame.kept === true) frame = 'stale';
  if (typeof frame === 'object' && frame.kept === true && (ranges.length > 0 || undone)) {
    // The rows were cut from a text the landing kept, and the diff is written
    // against the commit's. The change the tests have not run is the one from
    // the kept text to the diff's new side, so that is what is read.
    const rebased = rebasedChange(file, frame.text, options.sourceAt?.(file, coverage.commit), run.hunks.get(file) ?? []);
    if (rebased === undefined) frame = 'stale';
    else if (rebased.ranges.length === 0) {
      // The record was taken over the text the diff arrives at, and a test
      // carried onto it from an earlier text of an edited region was demoted
      // when it landed. No parser was asked, so the reading says so rather
      // than claim equal runtime text. An undone file read empty is one the
      // diff never named, and no reading is made of it.
      if (!undone) run.readings.push(ranOverReading(file));
      return;
    } else {
      ranges = rebased.ranges;
      reader = { ...run, hunks: new Map([...run.hunks, [file, rebased.hunks]]) };
    }
  }
  if (frame === 'stale') {
    // FIXME: of the rows charged whole here, those whose digest is the arrived
    // text's and for which no text was kept need not be: the record does not
    // say the landing that cut them demoted what it carried, and a per-module
    // landing marker would let the digest stand in for the kept text.
    for (const name of rows.keys()) run.stale.add(name);
    chargeLoaded(coverage, file, rows, run.charge);
    return;
  }
  if (frame === 'unchecked') run.readings.push({ file, unread: 'source' });
  else if (ranges.length > 0 && patched) {
    const read = readChange(reader, file, ranges, frame, rows);
    run.readings.push(read.reading);
    if (read.charged) return;
  }
  chargeLines(coverage, file, rows, ranges, run.charge);
}

/**
 * Reading: a changed file the record holds no row for, read where a reading
 * can be made, its readers charged. A file read that way is answered, and the
 * walk over its importers — which charges them whole — is for what the reading
 * left. Whether it charged anything is returned.
 */
export function readUnmeasured(run: Run, file: string, lines: readonly unknown[]): boolean {
  // Lines with no hunks arrive at no text to read: the walk over its importers answers it.
  const read = lines.length === 0 || hunksFor(run.hunks, file) === undefined ? undefined : readRowless(run, file);
  if (read !== undefined) run.readings.push(read.reading);
  if (read?.charged !== true) return false;
  for (const name of run.knownAs(file)) run.rowed.add(name);
  return true;
}

/**
 * The changed files with lines and no row, and the digest of the text each
 * arrives at: a test that declared one and already ran that text has nothing
 * left to run of it (`testsGovernedBy`).
 */
export function arrivedAt(
  run: Run,
  changed: Iterable<readonly [string, readonly unknown[]]>,
): { readonly rowless: readonly string[]; readonly arrived: ReadonlyMap<string, string> } {
  const rowless = [...changed].filter(([file, lines]) => lines.length > 0 && routed(run, file).rows.size === 0).map(([file]) => file);
  return { rowless, arrived: arrivedDigests(run.coverage, rowless, run.hunks, run.knownAs, run.options.sourceAt) };
}

/** Preconditions: every test that declared a name, for that name. A declaration is unconditional, and nothing here narrows it. */
export function selectDeclared(run: Run, governed: ImporterAnswer['governed']): void {
  for (const [test, names] of governed.tests) for (const name of names) run.pick(test, { kind: 'precondition', name });
}

/**
 * The importer walk asked of the run: from `changed`, and from every whole a
 * reading left, with `also` asked of the precondition table in the same read.
 */
export function walked(
  run: Run,
  ask: { readonly changed: readonly string[]; readonly ignored: ReadonlySet<string>; readonly also?: ReadonlySet<string>; readonly arrived?: ReadonlyMap<string, string> },
): ImporterAnswer {
  return answerByImporters(
    run.coverage,
    { ...ask, rowed: run.rowed, disowned: run.disowned, wholes: [...run.wholes.keys()].sort(codeUnitOrder) },
    run.options,
  );
}

/**
 * The importer walk's answer selected into the run: the preconditions it read,
 * the chains it walked, and every whole a reading left, with the reasons the
 * reading gave. Returns each reading's file and test a whole reached, which
 * the reading followed its way to and so did not leave `unseen`.
 */
export function selectAnswered(run: Run, answered: ImporterAnswer): ReadonlySet<string> {
  selectDeclared(run, answered.governed);
  for (const [test, reasons] of answered.selected) for (const reason of reasons) run.pick(test, reason);
  const through = new Set<string>();
  for (const [test, files] of answered.wholes) {
    for (const reason of files.flatMap((file) => run.wholes.get(file) ?? [])) {
      run.pick(test, reason);
      through.add(`${reason.file}\0${testPathOf(run.coverage, test)}`);
    }
  }
  return through;
}

/** `readings` less every `unseen` test a whole reached (`selectAnswered`). */
export function seenThrough(readings: readonly FileReading[], through: ReadonlySet<string>): FileReading[] {
  return readings.map((reading) =>
    'unseen' in reading && reading.unseen !== undefined
      ? { ...reading, unseen: reading.unseen.filter((test) => !through.has(`${reading.file}\0${test}`)) }
      : reading,
  );
}
