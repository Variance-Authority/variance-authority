import { codeUnitOrder } from '@variance-authority/core/segment';
import { causesOf, chargeAt, chargeLines, chargeLoaded, entering, selector } from './charging.js';
import { builtNamesOf } from './built-names.js';
import type { TestCoverageView } from './format-view.js';
import { answerByImporters } from './importers.js';
import { instrumentedRows, testPathOf } from './lookup.js';
import { changeOfDiff, ignoredChange, type Change } from './change.js';
import { arrivedDigests, declarable, ranOverAll, ranOverReading, withRanOver } from './ran-over.js';
import { frameOf } from './frame.js';
import { recordedOverKept } from './kept-texts.js';
import { rebasedChange } from './text-diff.js';
import { readChange, readRowless, rowlessNames, type FileReading } from './reading.js';
import { disownedIn } from './shadowed.js';
import { ignoreMatcher, routeOf } from './route.js';
import { byRelations, withGraph } from './precision.js';
import type { ExecutionNarrowing, ExecutionNarrowingOptions, SelectionReason } from './narrowing.js';

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
 * written as a diff: every step of selection, composed in the order spec 0091
 * sets — ignore, route, then the record, the reading, the preconditions and the
 * graph — over files and ranges a caller may have invented.
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
  const hunks = kept.hunks;
  // A checkout to read layouts in lets the record say which of its names are
  // built from which source, and the graph's walk asks under the same names.
  const known: ExecutionNarrowingOptions =
    asked.knownAs !== undefined || asked.root === undefined
      ? asked
      : { ...asked, knownAs: builtNamesOf(coverage, asked.root, named.keys()) };
  // Every changed name the loop below reads a recorded text under, named to
  // `sourceAt` with each ask: filled before the first ask, so a reader fetches
  // those texts together and none of the rest of the diff.
  const asking: string[] = [];
  const sourceAt = known.sourceAt;
  const options: ExecutionNarrowingOptions =
    sourceAt === undefined ? known : { ...known, sourceAt: (file, commit) => sourceAt(file, commit, asking) };
  const knownAs = options.knownAs ?? ((file: string): readonly string[] => [file]);
  // A graph step adds what the import walk reaches to what `file-use` reads, so
  // it runs every test any finer step runs.
  if (byRelations(options.precision)) return withGraph(coverage, readDiff(coverage, change, { ...asked, precision: 'file-use' }), [...changed.keys()], hunks, options);
  const { selected, select } = selector();
  // An ignored file is cut from what selection infers, not from what a test declared: its names still govern.
  const governing = new Set<string>(ignoring.flatMap((file) => [...knownAs(file)]));
  const rowed = new Set<string>();
  const stale = new Set<string>();
  // A test that mocked the module is not the audience of what it only loaded there (`shadowed.ts`).
  const disowned = disownedIn(coverage, options.relations);
  const readings: FileReading[] = [];
  const seen = new Set<string>();
  const charge = chargeAt(coverage, options.precision, entering(coverage, disowned, select));
  // An importer a reading could not read and holds no row for is answered by
  // the graph's walk over its importers, with the reasons the reading gave.
  const wholes = new Map<string, Array<Extract<SelectionReason, { readonly kind: 'reader' }>>>();
  const whole = (file: string, reason: Extract<SelectionReason, { readonly kind: 'reader' }>): void => {
    wholes.set(file, [...(wholes.get(file) ?? []), reason]);
  };
  const context = { coverage, options, knownAs, hunks, charge, pick: select, whole };

  // Every row recorded under every name. Two builds reading a path are two
  // rows, each with its own crossings, and the answer is all of them.
  // `instrumented: false` is the build saying it never read this module, and
  // its zero blocks take nothing from the instrumented row beside it.
  const rowsByFile = new Map<string, Map<string, readonly number[]>>();
  for (const [file, lines] of changed) {
    // Every changed name is asked of the precondition table, whatever its
    // rows say. A row and a declaration answer different questions: the row
    // says which tests entered which regions of this module, the declaration
    // says the observation is void if the file's text moves at all. No
    // recorder writes the second where it can write the first, so what is
    // left in the table is what no row can answer: a test's own file, a
    // configured setup file, a module some other run never instrumented.
    for (const name of knownAs(file)) governing.add(name);
    const rowsOf = instrumentedRows(coverage, knownAs(file));
    for (const name of rowsOf.keys()) rowed.add(name);
    rowsByFile.set(file, rowsOf);
    if (rowsOf.size > 0) asking.push(file, ...knownAs(file));
    // A declared rowless file's commit text is read for the digest its tests ran over (`arrivedDigests`).
    else if (lines.length > 0 && declarable(coverage, knownAs(file))) asking.push(file);
    if (rowsOf.size === 0 && lines.length > 0 && routeOf(false, options.unmeasured) !== 'nothing') asking.push(...rowlessNames(context, file));
  }

  const rowless = [...changed].filter(([file, lines]) => lines.length > 0 && rowsByFile.get(file)!.size === 0);
  const arrived = arrivedDigests(coverage, rowless.map(([file]) => file), hunks, knownAs, options.sourceAt);
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
      : recordedOverKept(coverage, options.keptDigests(), (file) => named.has(file) || knownAs(file).some((name) => rowed.has(name)))
          .filter((file) => ignores?.(file) !== true),
  );
  for (const file of undone) {
    // Under every name, as a changed file is: a built twin's rows are in frame
    // exactly when the source's are.
    rowsByFile.set(file, instrumentedRows(coverage, knownAs(file)));
    asking.push(file, ...knownAs(file));
  }

  for (const [file, lines] of [...changed, ...[...undone].map((file) => [file, []] as const)]) {
    let ranges = lines;
    const rowsOf = rowsByFile.get(file)!;
    if (rowsOf.size === 0) {
      // Nothing measured it under a row, and a suite that declines relations
      // asks nothing else; the tests that declare it are read below either way.
      if (routeOf(false, options.unmeasured) === 'nothing') continue;
      // No row to charge, so its readers answer for it where a reading can be
      // made. A file read that way is answered, and the walk over its importers
      // below — which charges them whole — is for what the reading left.
      const read = ranges.length === 0 ? undefined : readRowless(context, file);
      if (read !== undefined) readings.push(read.reading);
      if (read?.charged === true) for (const name of knownAs(file)) rowed.add(name);
      continue;
    }
    // A caller that writes one file's hunks under each of its names hands the
    // same change over twice, and every name of it was charged the first time.
    const held = [...rowsOf.keys()].sort(codeUnitOrder).join('\n');
    if (seen.has(held)) continue;
    seen.add(held);
    // At file use a measured file is every test that loaded it, whatever its lines say.
    if (options.precision === 'file-use') {
      chargeLoaded(coverage, file, rowsOf, charge);
      continue;
    }

    // Everything below reads line numbers, and a line number is only a place
    // in the text it was cut from. The recorder wrote a digest of that text,
    // so whether these numbers mean anything here is a question the snapshot
    // answers about itself.
    let frame = frameOf(coverage, knownAs(file), rowsOf, options.sourceAt, options.keptText);
    let reader = context;
    // An undone file read in the commit's own text, or not read at all, ran
    // what is on disk: nothing changed for it.
    if (undone.has(file) && (typeof frame !== 'object' || frame.kept !== true) && frame !== 'stale') continue;
    if (typeof frame === 'object' && frame.kept === true && (ranges.length > 0 || undone.has(file))) {
      // The rows were cut from a text the landing kept, and the diff is written
      // against the commit's. The change the tests have not run is the one from
      // the kept text to the diff's new side, so that is what is read.
      const rebased = rebasedChange(file, frame.text, options.sourceAt?.(file, coverage.commit), context.hunks.get(file) ?? []);
      if (rebased === undefined) frame = 'stale';
      else if (rebased.ranges.length === 0) {
        // The record was taken over the text the diff arrives at, and a test
        // carried onto it from an earlier text of an edited region was demoted
        // when it landed. No parser was asked, so the reading says so rather
        // than claim equal runtime text. An undone file read empty is one the
        // diff never named, and no reading is made of it.
        if (!undone.has(file)) readings.push(ranOverReading(file));
        continue;
      } else {
        ranges = rebased.ranges;
        reader = { ...context, hunks: new Map([...context.hunks, [file, rebased.hunks]]) };
      }
    }
    if (frame === 'stale') {
      for (const name of rowsOf.keys()) stale.add(name);
      chargeLoaded(coverage, file, rowsOf, charge);
      continue;
    }
    if (frame === 'unchecked') readings.push({ file, unread: 'source' });
    else if (ranges.length > 0) {
      const read = readChange(reader, file, ranges, frame, rowsOf);
      readings.push(read.reading);
      if (read.charged) continue;
    }

    chargeLines(coverage, file, rowsOf, ranges, charge);
  }

  // A row answers for its file, and the graph is walked only for a file no
  // name of which has one: `rowed` says which, so the walk does not ask the
  // snapshot again. The changed names go to the graph's own walk with the
  // modules it reached that carry no probes, which need the same table:
  // handed over together they are one read of it rather than two, and that
  // table is the only part of a snapshot large enough for the difference to
  // be the query.
  const answered = answerByImporters(
    coverage,
    {
      changed: [...named.keys()].sort(codeUnitOrder),
      ignored: new Set(ignoring),
      rowed,
      disowned,
      also: governing,
      wholes: [...wholes.keys()].sort(codeUnitOrder),
      arrived,
    },
    options,
  );
  // A file every test declaring it ran the arrived text of reads so, whatever its reader made of the diff.
  const unread = new Set(answered.governed.unread);
  const ranOver = new Set(rowless.map(([file]) => file).filter((file) => ranOverAll(knownAs(file), unread, answered.governed.ranOver)));
  // A declaration is unconditional — *if this file's text moves, retire this
  // observation* — and nothing here narrows it. It is the one thing a record
  // says that no region of any row can say.
  for (const [test, held] of answered.governed.tests) {
    for (const name of held) select(test, { kind: 'precondition', name });
  }
  for (const [test, reasons] of answered.selected) {
    for (const reason of reasons) select(test, reason);
  }
  // A test a whole answered for reached the declaring file through it, so the
  // reading followed its way there and it is not `unseen`.
  const through = new Set<string>();
  for (const [test, files] of answered.wholes) {
    for (const reason of files.flatMap((file) => wholes.get(file) ?? [])) {
      select(test, reason);
      through.add(`${reason.file}\0${testPathOf(coverage, test)}`);
    }
  }
  // A name is answered when something recorded holds it: a row with probes
  // behind it, or a test declaring it. The table is asked for every changed
  // name now, so its silence about a name is no longer the same sentence as
  // *nothing measured this* — a row measured it, whether or not any test wrote
  // the name down.
  const unmatched = new Set(answered.governed.unread.filter((name) => !rowed.has(name)));
  // A file is measured when *some* name it may be held under was answered for.
  // `knownAs` exists because one file is two names — a package's own suite
  // loads `src`, every other package loads the built twin — and each name
  // selects the audience its own rows and declarations carry. A name the
  // snapshot holds nothing under selects nobody and takes nothing from the
  // name beside it. A file `knownAs` gives no name at all was asked about
  // under nothing, and is reported.
  const measured = (file: string): boolean => knownAs(file).some((name) => !unmatched.has(name));
  const unmeasured = [...answered.unread.filter((name) => !measured(name)), ...answered.unheld].sort(codeUnitOrder);
  // A suite that declines relations never asked the graph, so nothing it
  // holds is unread: what the record did not measure was declined.
  const declining = options.unmeasured === 'nothing';

  const because = causesOf(coverage, selected);

  return {
    entered: because.map((cause) => cause.test),
    unread: declining ? [] : unmeasured,
    ...(declining ? { declined: unmeasured } : {}),
    ...(asked.ignore === undefined ? {} : { ignored: ignoring }),
    stale: [...stale].sort(codeUnitOrder),
    because,
    readings: withRanOver(readings, ranOver).map((reading) =>
      'unseen' in reading && reading.unseen !== undefined
        ? { ...reading, unseen: reading.unseen.filter((test) => !through.has(`${reading.file}\0${test}`)) }
        : reading,
    ),
  };
}
