// compass: variance-authority.reach
import { codeUnitOrder } from '@variance-authority/core/segment';
import { causesOf } from './charging.js';
import type { TestCoverageView } from './format-view.js';
import { testPathOf } from './lookup.js';
import { changeOfDiff, ignoredChange, type Change } from './change.js';
import { declarable, ranOverAll, withRanOver } from './ran-over.js';
import { recordedOverKept } from './kept-texts.js';
import { rowlessNames } from './reading.js';
import { ignoreMatcher } from './route.js';
import { byRelations, withGraph } from './precision.js';
import { arrivedAt, chargeMeasured, namedAs, readUnmeasured, routed, runOf, seenThrough, selectAnswered, selectOwn, walked } from './stages.js';
import type { ExecutionNarrowing, ExecutionNarrowingOptions } from './narrowing.js';

/** Both halves of the question, from one pass over the same columns. */
export function narrowByExecutionFromView(
  coverage: TestCoverageView,
  diff: string,
  options: ExecutionNarrowingOptions = {},
): ExecutionNarrowing {
  return narrowByChangeFromView(coverage, changeOfDiff(diff), options);
}

/**
 * The narrowing of a change handed over as a value (`change.ts`) rather than
 * written as a diff: the stages of selection (`stages.ts`), called in the order
 * spec 0091 sets — ignore, route, then the record, the reading, the
 * preconditions and the graph — over files and ranges a caller may have
 * invented.
 */
export function narrowByChangeFromView(
  coverage: TestCoverageView,
  change: Change,
  options: ExecutionNarrowingOptions = {},
): ExecutionNarrowing {
  const whole: string[] = [];
  const incomplete: string[] = [];
  for (let test = 0; test < coverage.testPath.length; test += 1) {
    (coverage.testComplete.at(test) === 1 ? whole : incomplete).push(testPathOf(coverage, test));
  }

  return {
    whole: whole.sort(codeUnitOrder),
    incomplete: incomplete.sort(codeUnitOrder),
    ...readDiff(coverage, change, options),
  };
}

/** Query the binary columns without materializing the coverage graph. */
export function selectTestFilesFromView(
  coverage: TestCoverageView,
  diff: string,
  options: ExecutionNarrowingOptions = {},
): readonly string[] {
  return readDiff(coverage, changeOfDiff(diff), options).entered;
}

/**
 * Every changed file, asked of the snapshot under every name it may be held by.
 *
 * A file with an instrumented row under any of its names is answered by the
 * regions its changed lines fell in, from every such row. Every name is asked
 * of the preconditions. A file with no instrumented row under any name is asked
 * of the graph, whose nearest importers with a row answer for it, and is
 * reported as unread under the name the diff gave it when neither the record
 * nor the graph holds it.
 */
function readDiff(
  coverage: TestCoverageView,
  change: Change,
  asked: ExecutionNarrowingOptions,
): Required<Pick<ExecutionNarrowing, 'entered' | 'unread' | 'because' | 'stale' | 'readings'>> &
  Pick<ExecutionNarrowing, 'declined' | 'ignored'> {
  const named = change.lines;
  const ignores = ignoreMatcher(asked.ignore);
  const { kept, ignored: ignoring } = ignoredChange(change, asked.ignore);
  const changed = kept.lines;
  // A checkout to read layouts in lets the record say which of its names are
  // built from which source, and the graph's walk asks under the same names.
  const known = namedAs(coverage, asked, named.keys());
  // Every changed name the loop below reads a recorded text under, named to
  // `sourceAt` with each ask: filled before the first ask, so a reader fetches
  // those texts together and none of the rest of the diff.
  const asking: string[] = [];
  const sourceAt = known.sourceAt;
  const options: ExecutionNarrowingOptions =
    sourceAt === undefined ? known : { ...known, sourceAt: (file, commit) => sourceAt(file, commit, asking) };
  // A graph step adds what the import walk reaches to what `file-use` reads, so
  // it runs every test any finer step runs.
  if (byRelations(options.precision)) return withGraph(coverage, readDiff(coverage, change, { ...asked, precision: 'file-use' }), [...changed.keys()], kept.hunks, options);
  const run = runOf(coverage, options, kept.hunks);
  const { knownAs } = run;
  // A changed test file is entered by definition, before anything is read of
  // the record: whether it was seen whole, declared its own source, or ran
  // this text does not decide whether an edit to it runs.
  const own = selectOwn(run, named.keys());
  // An ignored file is cut from what selection infers, not from what a test declared: its names still govern.
  const governing = new Set<string>(ignoring.flatMap((file) => [...knownAs(file)]));

  const routes = new Map<string, ReturnType<typeof routed>>();
  for (const [file, lines] of changed) {
    // Every changed name is asked of the precondition table, whatever its
    // rows say. A row and a declaration answer different questions: the row
    // says which tests entered which regions of this module, the declaration
    // says the observation is void if the file's text moves at all. No
    // recorder writes the second where it can write the first, so what is
    // left in the table is what no row can answer: a test's own file, a
    // configured setup file, a module some other run never instrumented.
    for (const name of knownAs(file)) governing.add(name);
    const route = routed(run, file);
    for (const name of route.rows.keys()) run.rowed.add(name);
    routes.set(file, route);
    if (route.route === 'coverage') asking.push(file, ...knownAs(file));
    // A declared rowless file's commit text is read for the digest its tests ran over (`arrivedDigests`).
    else if (lines.length > 0 && declarable(coverage, knownAs(file))) asking.push(file);
    if (route.route === 'relations' && lines.length > 0) asking.push(...rowlessNames(run, file));
  }

  const { rowless, arrived } = arrivedAt(run, changed);
  // A row cut from a kept text whose file the diff does not name ran an edit
  // that is gone: the tree is back at the commit's text, which is a change the
  // tests that ran the edit have not run. The diff from the commit cannot say
  // so, and the record can: its rows name the text they ran over. Asked only
  // where that text can be read, so the change is read rather than assumed.
  // FIXME: an undone edit whose text was not kept, or whose file has no
  // instrumented row (a test file, a setup file), is found by nothing here and
  // selects nothing; the ledger's dirty-run tree names every undone file. An
  // undone file governs no precondition: a test that declared it is not re-run.
  const undone = new Set(
    options.keptDigests === undefined || options.keptText === undefined || options.sourceAt === undefined
      ? []
      : recordedOverKept(coverage, options.keptDigests(), (file) => named.has(file) || knownAs(file).some((name) => run.rowed.has(name)))
          .filter((file) => ignores?.(file) !== true),
  );
  for (const file of undone) {
    // Under every name, as a changed file is: a built twin's rows are in frame
    // exactly when the source's are.
    routes.set(file, routed(run, file));
    asking.push(file, ...knownAs(file));
  }

  // The state machine: a measured file goes to coverage, one the record did
  // not measure to the reading and then the walk, and one the suite declines
  // relations for to nothing but the preconditions read below.
  for (const [file, lines] of [...changed, ...[...undone].map((file) => [file, []] as const)]) {
    const { rows, route } = routes.get(file)!;
    if (route === 'coverage') chargeMeasured(run, file, rows, lines, undone.has(file));
    else if (route === 'relations') readUnmeasured(run, file, lines);
  }

  // A row answers for its file, and the graph is walked only for a file no
  // name of which has one: `rowed` says which, so the walk does not ask the
  // snapshot again. The changed names go to the graph's own walk with the
  // modules it reached that carry no probes, which need the same table:
  // handed over together they are one read of it rather than two, and that
  // table is the only part of a snapshot large enough for the difference to
  // be the query.
  const answered = walked(run, { changed: [...named.keys()].sort(codeUnitOrder), ignored: new Set(ignoring), also: governing, arrived });
  // A file every test declaring it ran the arrived text of reads so, whatever its reader made of the diff.
  const unread = new Set(answered.governed.unread);
  const ranOver = new Set(rowless.filter((file) => ranOverAll(knownAs(file), unread, answered.governed.ranOver)));
  const through = selectAnswered(run, answered);
  // A name is answered when something recorded holds it: a row with probes
  // behind it, or a test declaring it. The table is asked for every changed
  // name now, so its silence about a name is no longer the same sentence as
  // *nothing measured this* — a row measured it, whether or not any test wrote
  // the name down.
  const unmatched = new Set(answered.governed.unread.filter((name) => !run.rowed.has(name)));
  // A file is measured when *some* name it may be held under was answered for.
  // `knownAs` exists because one file is two names — a package's own suite
  // loads `src`, every other package loads the built twin — and each name
  // selects the audience its own rows and declarations carry. A name the
  // snapshot holds nothing under selects nobody and takes nothing from the
  // name beside it. A file `knownAs` gives no name at all was asked about
  // under nothing, and is reported.
  const measured = (file: string): boolean => knownAs(file).some((name) => !unmatched.has(name));
  // A test's own file was answered by being the test: nothing about it is unread.
  const unmeasured = [...answered.unread.filter((name) => !own.has(name) && !measured(name)), ...answered.unheld].sort(codeUnitOrder);
  // A suite that declines relations never asked the graph, so nothing it
  // holds is unread: what the record did not measure was declined.
  const declining = options.unmeasured === 'nothing';

  const because = causesOf(coverage, run.selected);

  return {
    entered: because.map((cause) => cause.test),
    unread: declining ? [] : unmeasured,
    ...(declining ? { declined: unmeasured } : {}),
    ...(asked.ignore === undefined ? {} : { ignored: ignoring }),
    stale: [...run.stale].sort(codeUnitOrder),
    because,
    readings: seenThrough(withRanOver(run.readings, ranOver), through),
  };
}
