# @variance-authority/distill

## 0.22.0

### Minor Changes

- 704c49d: `variance covering` says how fresh and how actual its answer is for the question you asked

  A partial run moves the record to its commit, and every test file it did not run keeps where it last ran, so one answer can name a test file that ran a minute ago over your text beside one that ran days ago over a text that was never committed. Every answer about a file, a line, a run of lines or a function now ends with where its line numbers stand in your text, then, for the test files it names, whether they ran over your text and when their runs landed, a group the record holds no time for first, then the oldest:

  ```
  The recorded lines of src/pay.ts are placed in its text as it is now.
  src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 9 hours ago; `pay` is the same in both.
  src/pay.ts is the text the other test file named here ran over, in a run that landed 6 minutes ago.
  ```

  Each test file is placed by the run that last finished it, a run that ran it whole or one the record held no cases of, and each case the answer names is dated and compared by the run that last ran it: a later run in part under `-t`, a filter or a skip names the cases it ran, so a test file whose named cases last ran apart is said part by part, each part with its time and text; a run in part that kept no cases names none, so its cases are dated by the run before it and its lines by both; and a run that executed none of a file's cases, every one skipped or filtered out, runs it in part and names none of them either. A run that finishes a test file and keeps no cases drops the case index, as `variance journeys` does for such a shard, rather than date the cases an earlier run laid by it; and a run that keeps cases writes an index into a record that holds none only once it has finished every test file the record holds that the checkout still has, which `journeys` says when its shards did not. `variance select` reads the same place: a test file a run at a newer commit ran only in part is compared from the commit where a run last finished it, and counted among the test files that last ran before the journal's commit. Your text is the `--text` buffer, else the file on disk, compared by digest with the texts that run kept where they were not committed, else the committed one at its commit. For `--line`, `--lines` and `--function`, a test file that ran over another text is told whether the asked region is the same in both, gone from yours, or why that is not known. The time is when that run landed in the record; a commit's date is never used. A group the record holds no time or no texts for says what it does not hold, as a record seeded before landings does of its time, and a test file the record does not place, or every one when no runs record of the snapshot's commit lies beside it, is dated where it is assumed and its text is not known. A test file is compared only on the files its runs read: the asked file its cases entered or hold as a precondition, and under `--since` each changed file its cases are named for, entered or hold as a precondition, so a file its runs never loaded is neither another text nor one that did not exist. A file the commit a run stood at did not hold is said not to have existed where it ran, and every file a test file read is said, so no file's verdict hides another's. Runs outside a git checkout stand at one place, each dated by its landing, and a test file read from a newer mainline record is dated by the run that published it. Under `--execution`, a record that names its commit is read as the suite's own: the answer's `at` is that commit, its lines are framed against it, and it is dated by the runs record beside it. `--since` says the same under its regions and names a changed file not on disk instead of comparing it, and an answer that names no test file is dated by the test files that entered the file, and compared over it, else by every case it read, and compared over nothing.

  The frame line replaces the `, placed in the text as it is now` the file answer's heading ended with, and `frame` is now on `--function` answers too: under `mapped` a part no case ran that an edit touched prints as `edited`, and under `stale` the answer names the function's cases and no parts. In JSON, `at` is the record's commit on every answer whose record names one, `ran.stands` holds the groups the lines are read from (`commit`, `assumed`, `tests`, `cases`, `landed`, `partly`, `files`, `text`, `other`, `absent`, `held`, `unknown`, `region`) with `ran.assumed`, `ran.unheld` and `ran.named` beside them, `ran` is `{ tests, unread }` when where they ran cannot be read, `moved: true` marks a `--function` answer and each `unrun` part an edit touched, and `unheld: true` a file not on disk. A line a case ran over, where a run over another text has landed since, is named in `overwritten` instead of `written`, and said to be in a text a case ran over, so which case ran it is not known, whatever text the record's lines are numbered in: a line your text holds and the record's does not, which a case that entered the file ran over, every line of a region a run in part landed an edit over, which the cases that ran it before ran in another text, and every line of the module when that run cannot find the text they ran over, under `--line`, `--lines` and `--function` unless a case called into a region that holds the line, and of the range or region under the whole file and `--since`. A branch inside an asked function is read like the same line asked alone. `written` keeps the lines the record shows no case ran over: a line your text holds and the record's does not, where the record cannot say which text a case that crossed the file ran over, since its runs record names no texts or no commit there, or that text is not kept, is named in `unknown`, with `why`, and the answer prints that whether a case has run it is not known. Over the whole file, a range names those cases in its own `overwritten`, and `variance select` runs them for a change to the region. `variance review` says of a region no case is known to have run, in its comment, its text and its handover, that none is known to have run it, and counts it apart from the regions no case covered: its `reach` in JSON is `overwritten`, `changedPackages[].overwritten` counts the functions of a package that hold one and no code no case ran, and the comment marks it ❔ in its legend, its callout, a Where fold of its own, its diagram and a packages column shown when a package holds one. A region no case entered, where the record cannot say whether a case stopped first, stays `unknown` and still reads as one no case covered. `@variance-authority/distill` names a declaration a test's case ran only in another text neither among the regions the test `entered` nor among the ones it never reached (`unentered`).

  The runs record keeps one landing per run at its commit, with the test files it finished, the ones it ran in part and the cases of each it laid into the case index, none when it kept no cases, when it landed, its install and the texts it ran over where those were not committed, and a run at another commit leaves the test files of each landing standing where they ran, with that landing's time and texts. A test file a checkout takes from a newer mainline record keeps the time and texts of the run that published it, and one your checkout ran itself keeps the place its own runs record gave it, with that run's time, install and texts and the runs that ran it in part, or, where that record places it nowhere, is assumed to stand where those runs started. Beside the landings the record keeps `latest`, when a run last wrote it, and `runs`, how many did, and no longer stores the install or when its first run landed: the install is what the landings say together, and a record written before landings reads as one landing of its run, with its time. It still lists, as `files`, the test files the landings finished, which an earlier release reads as the test files that ran at its commit, so that release reads and lands on the record, and compares a test file a run there ran only in part from where it stands. A record whose list an earlier release rewrote beside the landings it carried unread is read as that release wrote it. `variance review`'s JSON `runs` reads its test files and install off the landings and no longer holds `first`. `@variance-authority/sense/test-selection` exports `commitRunsIn`, which reads a runs record's text, `whatLanded`, what its landings say together, `testPlaces`, where and when each test last ran and over which texts, `assumedOf`, how placing some of the tests one reading placed fell back where the record could not say, `lastRunsOf`, which of a place's runs last ran each named case, `ranOver`, over which text of a file a placed run ran, `readsTheSnapshot`, whether that is read from the snapshot's rows, `placeAcross`, which places a range of one text in another, `placeInTexts`, which frames many held texts against one snapshot, `casesRan`, the cases the run that last wrote a record's case index laid there, by test file, `overwrittenIn`, the cases flagged on a module's regions that called into none of them, `overwrittenOn`, the cases a target's regions hold that ran them in another text and called into none of them, `lostText`, the sentence that says which case ran such a line is not known, `shardsTexts`, and the `TestPlace`, `CasesLastRan`, `RanOver`, `NotHeld`, `RanOverEvidence`, `OverwrittenOn`, `KeptTexts`, `ShardRuns` and `WhatLanded` types.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

### Minor Changes

- d61417a: Expose each test file’s recorded phases in distill --format jsonl as an optional time object, preserving unavailable phases and measured zero values.

### Patch Changes

- 1e5d9df: A case records what the code under test read, beside what the test said. `varianceBreadcrumb(dimension, key, value)` from `@variance-authority/event` returns its value and, under a Vitest, Jest or Rstest run in Node recorded with `@variance-authority/sense`, lays `dimension:key` and the value on the case that made the read; a read made while the test file loads lands on every case of the file. `variancePrecondition` now takes a dimension and a record, `variancePrecondition('flags', { discount: true })`, which records `flags:discount`, and holds any value JSON can hold; the one-name form and the `PreconditionValue` type are gone. `variance covering` prints `read flags:discount=false said true` beside each case and takes `--read <name>[=<value>]` to keep the cases by what the code read. `variance review` splits each changed region's cases by what they read, `flags:express read false by 1, true by 1, not by 6`, and `review.json` gives each case its `reads`. The review handover's breadcrumbs are now called pointers. `@variance-authority/distill` reads the new recorded form.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.16.0

### Minor Changes

- 80db3dc: A test file costs what running it took, the time before its first case included

  Vitest's file duration is its cases alone, so a file that spent 5.4 s on its
  environment, setup files and imports and 33 ms in its cases was ranked and
  placed as a 33 ms file. Every reader that weighs a file by its time now reads
  one figure: the larger of the runner's duration and the file's phases summed.
  A Jest file still costs its runtime unless its phases add up to more, and a
  file recorded without phases still costs its duration.

  - `variance ask slowest-tests` and `docs_slowest_tests` rank files by it.
  - A sharded run, and `variance shards`, place and count files by it.
  - `variance distill`'s "loading" is everything before the first case —
    `prepare`, `environment`, `setup` and `collect` — rather than `collect`
    alone, as `timeBeforeCases` from `@variance-authority/sense/test-selection`
    reads it, and a file is load-bound when that outlasts its cases. In
    `--format json`, each `loadBound` entry is `{ file, loading, cases }`; its
    `collect` field is gone.

  The stored `tests.duration` is unchanged: it stays the runner's own figure.
- 90358a4: A proposed mock names the module, not a runner's call

  `distill` spelled its mock proposals in one runner's API: a file reading
  proposed `jest.mock('../src/editor', () => ({ edit: jest.fn() }))` for a test
  file Vitest runs, and a case reading proposed `vi.mock(...)` with a note that
  `jest.mock` and `sb.mock` said the same. Both now name the module and why, and
  leave the call to the test file's runner. A file reading reads
  `Or mock src/editor.ts in this file, so src/dialog.ts does not load it: stand a
  function in for each value it exports (edit, format); an automock loads the
  module to read its shape.` A case reading reads `substitution to try: mock
  src/heavy-chart.tsx in this test's file; loading it is all this test used of
  it. Stand in for what it exports: an automock loads the module to read its
  shape`. The module is the repository-relative path the rest of the reading uses,
  not a specifier relative to the test file. A script that matched either line's
  old text has the new wording to match.
- add7c98: A recording keeps where each test file's time went, and `variance distill` shows it

  Beside its duration, each test file now carries the time it spent in five
  phases: readying the file in its worker, the test environment, the setup
  files, collecting the file — importing it and everything it loads — and its
  cases. Vitest reports all five. Under Jest, `perfStats` times the environment
  and the setup files, and the setup module marks where collecting ended, so the
  rest splits into collect and cases.

  `variance distill` over a folder, a suite or the repository sums the phases of
  the test files it reads, gives each its share, and names the files whose
  loading took over ten times as long as their cases: the files where what a
  test imports, not what it checks, is what the run pays for.
- 1741299: Distill reads its records in the native addon

  `variance distill` over a whole suite read every test file's coverage rows and
  case index as objects, which a suite of tens of thousands of test files cannot
  afford: one of about 30k test files ran for most of a minute and several
  gigabytes of memory, and a larger one did not finish. The sense addon now reads
  each record once into what the question needs — per test file the modules it
  loaded, per module how many of its cases entered it — and answers the scope,
  one test file, and the import behind each module no case entered, in columns.
  On a synthetic suite of that shape a whole-suite reading takes a few seconds
  in place of most of a minute, and every output there is the same, byte for
  byte. Outputs change only where a function is run while its module loads, as
  the fix below says. `--file` still opens the whole record, a fifth of a second there, and reads the
  file graph, about a second more, only when a module no case entered needs its
  import named.

  Breaking: `distillFile` and `distillScope` take the record's bytes as `record`
  and the file graph as `relations`, in place of the decoded `coverage` and
  `execution` and the `imports`, `lazy` and `republishes` callbacks; drop
  `execution`, since the cases and the regions a charge reads come from `record`.
  `scopeRows` reads the scope, and refuses one it cannot read, when it is called,
  and makes each row as it is reached. They require the addon, and throw naming
  why where it did not install.

  Fixed: an import referenced in a function the importer calls while it loads
  is read as one used at load, and never proposed as a `jest.mock`. Over a record
  whose case index is in the set spelling, such a function was charged as if no
  case ran it, since that spelling keeps a run at load as a flag that names no
  case, and distill could propose a mock that breaks the test; the same held
  over the row spelling where only another test file's case ran it while
  loading. A run at load is now read as this test file's, whichever file's case
  made it.

  A record whose case index is in the row spelling, which no current writer
  emits, is converted to the set spelling as it is read, and needs nothing from
  you. Which spelling is written does not change. A record whose module says it was instrumented and has no regions, or
  the other way round, is refused, as reading its coverage already refused it.

  `readDistillRecords` and `rankDistillCauses` are exported from
  `@variance-authority/sense/test-selection`. The records answer `cases` and
  `regions` for one test file, and `NativeDistillRegion` is the region they
  answer; `rankDistillCauses` orders a test file's load causes as a scope's
  reading orders them, so one test file's reading and a scope's rank them alike.

  `variance distill --format jsonl` makes each row as it writes it, and `json`
  writes its answer as it serializes it, a piece at a time. A reader that closes
  the pipe early, `| head`, ends the command quietly with exit 0.

### Patch Changes

- 8bab581: A refusal names what is missing instead of asking you to run the suite again

  Running a whole suite again to refresh a record is rarely yours to do, so no
  message tells you to. Where something can still be answered, it is:

  - `variance_composition {subject}` against a report with no per-subject
    structure lists the components the census holds in that subject and the
    renderings it shares, and says the report holds no order, depth, mount or
    count within it.
  - `variance_locate` with `under`, `above` or another spatial relation, against
    a run that resolved no layout, prints where the anchor is on each surface that
    says it, and says the run cannot tell what sits in that relation to it.
  - `variance_composition` against a report merged from shards says each shard's
    report still holds its composition, and the suite index the build composes
    from every shard's part holds the census across them.

  Where nothing can be answered, the refusal stays and names the condition, not a
  rerun: shards that started from, or chose their tests from, different records
  are not combined, and the record before the build stands; shards written by
  another version, or of which only some kept cases, are not combined;
  `variance shards --unrecorded 0` says a matrix of none starts no job; a Vitest
  run whose `--reporter` replaced the recording reporter says the record is as it
  was; a distill reading withheld for an incomplete coverage row, and a missing
  unit-test capture directory, name what is missing.
- e4e1b5b: What a case said it arranged is stored once, and read the same way everywhere

  The record keeps each distinct precondition once, with the cases that said it
  as a set in the pool coverage already uses, so a `beforeEach` that every case
  of a file runs costs one entry rather than one per case. Every item is kept,
  including one a narrower level overrode, and a case's row is resolved when it is
  read: per name, the narrowest level wins, two values there are a
  contradiction, and a value said at several sites is printed at the first.

  Two runs, two shards or two frames of one case now give the same row whichever
  arrived first. Before, a value said at two sites could print either site, and a
  fraction could print as `0.000001` or `1e-6`, depending on which writer laid
  the record. A contradiction's values now print in the code-unit order of their
  JSON text.

  A record written by an earlier release opens with every case unmeasured: `variance
  covering --where` counts them as such until the suite is recorded again.

  **Breaking:** on `ExecutionIndex` and `ObservedCase`, a test's `preconditions`
  rows are replaced by `said`, the unresolved items as one string; `rowOf(test)`
  returns the resolved rows. `encodeExecutionIndex` refuses a test that carries
  `said`; `encodeAsSetExecutionIndex` writes it.

## 0.15.0

### Minor Changes

- 6755276: `variance distill --file <path>` lists each module no case entered under the
  import that made the test file load it: the topmost import every path from the
  test file to the module runs through, with nothing behind it that a case
  entered, often in a module the test used rather than in the test file. A module
  two imports reach is listed as shared, with the nearest file every path to it
  runs through; one no static import reaches, such as a dynamic import's, is
  listed apart. The file graph is read from the checkout only when the reading
  has a module no case entered. A module the file mocked with a factory was never
  evaluated, and its import is not walked.

  `@variance-authority/core/relate` exports `dominatorsOf`, each node's immediate
  dominator from a root. `distillFile` takes an optional `imports` lookup and
  sets `cause` on each module no case entered; `@variance-authority/distill`
  exports `LoadCause`.
- fd7ad21: `variance distill --file <path>` without `--test` reads the whole test file: the
  modules it loaded before its first case that no case entered, and those only
  some of its cases entered, each with its length in lines. A runner evaluates a
  test file's imports once, when it loads the file, so the file pays for each of
  these whichever cases use it.
  The fix is at the import that brought a module in, in the test file or a module
  it used, not a mock of the listed path.
  `--file` alone used to read the file's only case; name it with `--test` for
  that reading.

  The reading needs the coverage rows of a recorded run, and is refused for a
  case index named with `--execution`. It reads as unmeasured when a case
  stopped or did not say whether it finished, or when the file's coverage row is
  incomplete, as it is once source changed since the run; run the file again. A
  module that declares no function below
  its top level, such as a barrel or a file of constants, is not counted.

  `@variance-authority/distill` exports `distillFile` and
  `formatFileDistillation`. `@variance-authority/sense/test-selection` exports
  `decodeTestCoverage`, for a caller that already holds the record's bytes.
- a9bcd21: `variance distill` walks dynamic imports of a quoted string beside static ones, so what
  only an `import()` reaches is listed under it, printed as `lazily imports`,
  rather than apart as unseen. A module a static and a dynamic import both reach
  is listed as shared, and a lazy import under an unused static import is owned
  by the static one. Only a dynamic import or `require` whose specifier is not a
  quoted string, or a load the runner made, is still unseen.

  `distillFile` and `distillScope` take an optional `lazy` lookup beside
  `imports`, and an import cause carries `lazy: true` when only a dynamic import
  brings its modules in.
- ec42738: `variance distill --file` holds the test file's mocks against the file graph,
  whatever the record says. A mock of a module the file does not load, directly
  or through anything it imports, is an error: delete it. A mock of a module more
  than two imports away, past the subject's imports, is a warning naming the file
  that imports it. A file reading carries them as `mocks`, each `unloaded` or
  `beyond` with its `hops` and `importer`. `shadowReach` in
  `@variance-authority/sense/taint` gives each module a file shadows its shortest
  distance from the file along runtime edges, and `mayMock` says whether a file's
  text may mock at all.
- 23d783b: `variance story`, `variance journeys`, `variance distill` and the test tools read a file and a name exactly

  `variance story --file` and `--name` kept every story whose test file path or
  test name held the text you typed, so `--file a.test.ts` also kept
  `data.test.ts`, and `--name adds` kept `data > adds one`. `--in` kept every
  step whose file held its text, and `variance journeys --file` kept a module
  whose path ended with, or whose name held, the text in any case. Each now
  names one thing. `--file` and `--in` are a path in the checkout, read as
  `variance covering --file` and `variance distill --file` read one, and a path outside the checkout is refused
  as one. `--name` is the test's whole name as the runner reports it, its
  `describe` blocks and its own name joined with ` > `. When nothing is that
  path or name, the answer says so, and `variance story` alone lists the stories
  that are written.

  `variance distill --test` took a case's id, its whole title, or any part of
  the title in any case, so `--test submits` read `checkout > submits` when it
  was the only title holding the word. It now takes the id or the whole title,
  `--test 'checkout > submits'`, and a part of either is answered as no case.
  `variance_test_signals` (`variance ask test-signals --test`) and
  `variance_test_attention` did the same and now take the id or the whole title
  too.

  The steps through one workspace package, which `--in @acme/ui` used to open by
  matching the package name as text, are now `variance story --package @acme/ui`.
- bd56956: `variance distill --file` says, under an import a used file writes, where that
  file references what it imports, and what to change: delete an import it never
  references; move a reference that runs when it loads, such as a map of
  components, into the function that needs it; move the functions no case of the
  test file ran out of the file, or import lazily inside them, with how many of
  the test files that load the file run one; make lazy a reference a case ran
  without calling into the module. A re-exported import is left to the file's
  importers. A reference on a line the record keeps no region for, or a file with
  a `require` or `import()` no name traces, reads as unmeasured.

  `@variance-authority/sense/test-selection` exports `importReferences`, which
  lists each reference a file makes to what it imports by the repository file the
  import resolves to, and `innermostAt`. `distillFile` takes an optional
  `references` lookup beside `imports`, and an import cause carries `charge`.
- 24da158: `variance distill --file` says, under each import that loads what no case
  entered, what the test file can do about it, by how far from the test file the
  importer is. An import the test file writes is an error, with "delete the
  import" when the file references none of it. An import a file the test file
  imports writes is proposed as a `jest.mock` with a factory that stands
  `jest.fn()` in for every value the module exports, where that file reads none
  of it or reads it only in functions no case ran, and the module's exports are
  known. An import further away is a warning to fix it in its importer. A reading
  names a function by its name, not its region's path. An import cause carries
  `reach`: `test`, `subject` or `beyond`, and for a subject's import `exports`.
- 3e6a370: A run's cases travel in its record

  The case index, the cases a run replaced and the run that replaced them are
  sections of `coverage.bin`, no longer a `coverage.bin.cases.bin` beside it. The
  one file is landed, layered, seeded, repinned, sharded and shared by the same
  rules and under the same lock as the coverage it was recorded with, so the two
  always answer for the same runs. A share, a seed or a fetch carries the index
  and drops the replaced cases and the run that names them, which belong to the
  machine that ran.

  A record that carries cases is format 10, and a reader that knows only coverage
  refuses it rather than misreading it. A record without cases keeps format 9. A
  `coverage.bin.cases.bin` left from an earlier run is not read; the next run
  writes its cases into the record.

  The `executionFile` option is removed from `withTestSelection`, the Jest and
  rstest seams, `startRecording`, the Playwright reporter and the Storybook
  collector, along with the JSON it could write. `decodeExecutionIndex`,
  `readExecutionIndex`, `variance covering --against`, `variance review` and
  `distill --execution` read the index out of a record; JSON stays readable as
  the spelling a foreign tool supplies. `landCaseIndexes` is replaced by
  `landCases`, which returns the sections for the record you write, and
  `lastCaseRunOf` reads the run they name. `caseLayerFiles` and
  `executionIndexBytes`, which named and read the file beside the record, are
  removed. `CaseSections`, `caseSectionsAt`, `caseSectionsOf`, `caseIndexOf`,
  `recordedCases`, `withCaseSections`, `keepsCases` and `sharedRecord` read and
  write the sections.
- 86a05ca: `variance distill` finds a test by its file and title: `--file` takes the test
  file's path in the checkout, and `--test` takes the recorded id or the whole
  title, in the record's case index, and reads the case's journals by its id.
  When more than one test fits, the command prints their ids. `distill()` takes
  the same `file`, and `test` is optional when `file` names a file with one test.
- c06fa28: `variance distill` with neither `--test` nor `--file` reads every test file of
  the record, or with `--from <dir>` every one under a folder or a package, and
  ranks each import by the lines it loads for nothing, counted once in every test
  file it reaches. With no `--suite`, it reads every declared suite and names one
  that has not recorded. The file graph is read once, and only when some test file
  loaded a module no case of it entered.

  `@variance-authority/distill` exports `distillScope` and
  `formatScopeDistillation`, with `ScopeRecord`, `ScopeDistillInput`, `ScopeDistillation`,
  `Spill` and `SpillCause`.
- 8fa1aac: `variance distill --file <path>` reads the test file the path names, and no other

  `--file` takes the test file's path, relative to the checkout or absolute, and
  reads it as the record spells it: repository-relative, with `/`. A recorded
  path that contains the one you gave, or ends in it, is another file, so
  `--file test/dialog.test.ts` is refused when the record holds only
  `test/dialog.test.tsx`, and so is `--file dialog`. The refusal names no
  other path, and says the record names each test file from the repository root. A path outside
  the checkout is refused as outside it. The same holds when `--file` narrows
  `--test`. From Node, `distillFile` and `distill` take `file` as the
  repository-relative path and match it exactly.
- cdf87c6: Distill writes a row a test file

  `variance distill --format jsonl` writes the scope reading one line a test file:
  its suite, its `cases`, what it `loaded` (modules that declare a function, and
  their lines), and of that what no case of it entered as `unentered`, or
  `withheld` with the reason. A suite that kept no record is named on stderr.
  `--test` and `--file` refuse it. `scopeRows` from `@variance-authority/distill`
  yields the same rows, and `FileDistillation.lines` sums the lines of what a file
  loaded.

  A script that reads a record too large to decode reads it with the CLI's own
  readers: `recordedExecutionFile` from `@variance-authority/cli` names the record
  `distill` and `covering` read, and `@variance-authority/sense/test-selection`
  exports `openSetColumns` with its `SetColumns`, `TestColumns` and `StringTable`
  types for the case index, and `BLOCK_KINDS` for the region kinds of an opened
  snapshot.
- 0a41a23: Eyes journals travel in the record

  A run that opts into Eyes writes each case's journal into `coverage.bin`, in an
  `eyes` section keyed by the case's id and its attempt, so a journal joins its
  case exactly and a retried case keeps every attempt. The attempt counts from 1
  (Playwright's `retry + 1`) and is a column of its own, never part of the id. A
  run that did not opt in writes no section. Source paths in a journal are
  relative to the repository root, as the case index's are.

  The Playwright fixture and `watchTest` hand their journal to the case the
  recording runs, never to `testInfo.testId`. The RTL `watchTest`, given no id,
  returns the journal and hands it to the running case where the recording seam's
  case scope takes one. The Vitest, Jest and Rstest seams hold each attempt's case
  from before its `beforeEach` until after its `afterEach`, so a journal closed
  in teardown lands under that case and attempt. A run that opts in lists every case it watched in
  the section, so a watched case that handed no journal reads apart from a case
  whose run did not opt in. Two different journals for one case and attempt keep
  the one whose JSON sorts first, and the run still records.

  A journal stays on the machine that ran it. It leaves with the record, through
  `variance share` or an `actions-cache` carry, and each says so: a share names
  every suite entry whose record carried journals, and a carry save notes each
  suite whose record goes into the cache with them. `sharedRecord` keeps the
  section, and drops one that is unreadable or of a newer version at the
  crossing, keeping the rest of the record. A repin keeps the journals of every
  case its index keeps.

  `variance distill` reads the checkout's own record, or the one `--execution`
  names, and prints every attempt of the case. It refuses an id the record does
  not hold and shows the ids it does. `--eyes` is removed, and so are the
  `@variance-authority/eyes/collect` and `@variance-authority/eyes/reporter`
  entries (`writeEyesArchive`, `gatherEyesArchive`, `recordEyesTest`,
  `resetEyesJournals`, `EYES_JOURNAL_SUFFIX`, the Eyes reporter and
  `EyesReporterOptions`). `eyesJournal` and `EyesJournal` give a test's journal,
  and `parseEyesJournal` reads one back. In `@variance-authority/distill`,
  `DistillInput` takes `execution` always and `eyes` as `EyesAttempt` rows, and
  `Distillation` reports `attempts` as `AttemptAttention` in place of
  `attention`, `joined` and `available`; `watched` names the cases a run that
  opted in watched, and distill says which of them kept no journal. The sense
  test-selection entry adds `keepsEyes`, `recordedEyesAt`, `recordedEyesOf`, `RecordedEyes`,
  `ObservedEyes`, `EyesSection` and `encodeAsSetExecutionIndex`. In
  `@variance-authority/mcp`, `serveEyesRecord` replaces `serveEyesArchive` and
  serves the journals a record keeps, read by `readEyesRecord` off one read of
  the record. A record a later run wrote without Eyes leaves it no journals to
  answer from; `readEyesRecord` refuses such a record with `RecordKeepsNoEyes`.
  `EyesArchive` carries `watched`, which `createEyesArchive` takes and
  `parseEyesArchive` reads, so the MCP `distill` tool tells an unwatched case
  from a watched one that kept no journal. That tool needs the runtime journey
  and reads a case by its exact id.

  Under Rstest, a case declared `it(name, options, fn)` is recorded per case, as
  `it(name, fn)` already was.

### Patch Changes

- 91d90f6: A JSON execution index keeps what the binary one keeps

  `parseExecutionIndex` rebuilt each case row from `id`, `file` and `name`, so a
  JSON index lost the `preconditions`, `stopped` and `duration` that the recorded
  `coverage.bin` spelling of the same cases keeps. `variance covering --execution
  index.json --where <name>` therefore refused a JSON index as unmeasured even
  when its rows said what they arranged. A JSON row carries all three, each
  validated: `stopped` a boolean, `duration` a non-negative integer of
  milliseconds, and each `preconditions` entry with `name` and `site` non-empty
  strings, `value` a string, number or boolean, and `level` a non-negative
  integer. A field a row leaves out stays absent; an empty `preconditions` list
  stays a case heard to say nothing.

  A row whose `preconditions`, `stopped` or `duration` field is malformed is
  refused with the row's position, and the entry's for a precondition, where
  before the field was dropped.
- a07d9aa: `variance distill` reads the execution index your last recorded run left, the
  one `covering` reads, so a run wrapped in `withTestSelection` needs no
  `executionFile` and the command needs no `--execution`. `--suite <name>` picks
  one declared suite's index. `--execution <path>` still reads any other index,
  including JSON from another tool. With nothing recorded, `distill` refuses as
  `unrecorded`.
- f8eb3da: `distill` no longer proposes mocking a module that declares nothing below its top level, such as a file of constants or a barrel of re-exports. Loading such a module runs everything it has, so `loadedOnly` is now false for it and it is not listed under "Loaded but not covered".
- ef496ad: READMEs name what the program does

  The package READMEs, and the `@variance-authority/vantage` and
  `@variance-authority/playwright-test` descriptions, no longer write a test, a
  record or a run as something that says, asks or knows. Each sentence names what
  the program does: a command prints, a record holds a field, a test runs or
  covers. Where a value is filled in from configuration or a default rather than
  recorded, the README says so. Four renamed headings change their anchors:
  `help`'s "Where the declaration is undocumented", `playwright`'s "Where a
  component is declared, read from the engine", `storybook`'s "What a pass sends
  the preview" and `sense`'s "Correct what a file's text declares it imports".

## 0.14.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.9.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

### Minor Changes

- 208fff4: An import is not a use

  Distill read an entered file and nothing smaller. Any crossing anywhere in a
  module made the file entered, at the shortest depth observed, and which region
  had been crossed was dropped on the way out. That is the reading test selection
  needs and it is built to over-answer: a module's initialization is attributed to
  every test that consumed the module, so a change cannot skip a test.

  Reduction asks the opposite question. `import { A } from './B'` runs `B`'s top
  level and nothing else — a spy answers in `A`'s place, or the branch that would
  have rendered it is never taken — and the module root is crossed either way. Run
  through a conservative file-level index, a component nothing rendered came back
  as source the test reached.

  `EnteredModule` is the second reading of the same crossings, one region at a
  time. `loadedOnly` marks a module whose every crossing is a consequence of
  loading it; `unentered` names the declarations the test never reached, at the
  outermost declaration that owns them. A module root has no caller a test could
  be, so both are derived from the region's own kind and ask nothing new of a
  producer. `ExecutionCrossing.loaded` is there for a producer that watched the
  evaluation and can say the same about a region below the root — a function the
  top level called — and that mark is believed over the kind.

  `formatDistillation` names those modules and the substitution to try against
  each. The substitution is a candidate: mocking takes the top level with the
  rest, and a top level that registers a handler, installs a polyfill or builds a
  singleton is one the test may be standing on. Make it, rerun the exact test,
  compare the witness.

  `parseExecutionIndex` also stops rejecting a module root. It required every
  block name to be non-empty, and a module root is the one region with no
  declaration to be named after — so no index carrying one could cross the CLI's
  JSON boundary.
- fc59417: Both halves must name the same test, and the same root

  `variance distill` joins two recordings that were made by different tools, and it
  joins them on exact equality. Two independent mismatches made that join fail, and
  neither of them said so.

  **The test id.** Sense keys a case by its coordinate — `<project-relative file> >
  <describe path and name>` — because a name is the coordinate. Eyes takes whatever
  id you hand it, and its collision error recommended the runner's own positional
  task id, which is the opposite: unique within a run, and moved the moment a case
  is inserted above it. Follow both pages and the third reading is unreachable, and
  the refusal named only the id you asked for — never the ids it held — so there was
  nothing in the output to compare. The refusal now prints the recorded count and up
  to five real ids beside it, and states the contract. The collision error asks for
  an id stable across runs and unique within one, and names where the journal will
  be joined.

  **The root.** Eyes records source provenance as absolute paths; sense records
  project-relative module files. Compared directly, nothing matched, and *the file
  that was addressed* therefore appeared in *the files with no addressed target* —
  the distillation opportunity list degenerated to every file the test entered,
  confidently and silently.

  `distill` takes an optional `root` (`--root` on the CLI, defaulting to the working
  directory) and reconciles the two shapes against it. Where it cannot, it withholds
  the list rather than printing a wrong one: if no addressed file matches any entered
  module under the given root, the two sides are rooted differently, and the output
  says so and offers nothing. Suffix matching was considered and rejected — it picks
  a winner among plausible matches and hides that it was choosing.

  A withheld list is the reading working. An opportunity list built on a root that
  does not reconcile is not a weaker answer than none; it is an answer that names
  every file you have.

## 0.2.0

### Minor Changes

- 8efba76: A run that changed ten files stops rewriting the whole selection index

  Every run after the first reads the selection index, lays its own recording over
  it, and writes it back. At a repository's scale almost all of that was spent
  making objects nobody reads: a run that re-records ten modules of twenty thousand
  decoded six hundred thousand regions into a model, merged ten of them, and
  encoded the model back — the other 99.95% of the index materialized and
  re-serialized to arrive at the bytes it was read from.

  `layerTestCoverage` does the merge and the encode as one pass over the columns
  the previous snapshot is already stored in. A module the run did not touch is
  never made an object: its rows are copied column to column as integers, its
  strings blob to blob as bytes, and the only thing that happens to either is the
  renumbering the new dictionary implies. Objects are made for what the merge has
  to reason about — the tests, the modules this run re-recorded, and the carried
  modules whose text moved on disk. Over twenty thousand modules that is 1855 ms to
  616, and it is byte for byte the same file, which a gate asserts across every
  case the merge distinguishes.

  The columns are now zstd rather than brotli, at two levels, because the runs are
  two kinds of data. A varint run is a dense stream of small integers and answers
  to a long search; a run of the string blob is file paths and hex digests, which
  zstd finds most of at level 1 and nothing more of above it. Against the brotli
  quality 4 it replaces, over the same snapshot: 319 ms to compress became 120, and
  the file got 86 KB smaller.

  `zlib.zstdCompressSync` arrived in Node 22.15, so that is the floor these
  packages declare. The snapshot's layout version moved with the codec, which means
  an index written by an earlier build is refused at its header and rebuilt — one
  full run, and nothing a reader has to think about.
- ff718d3: Distil one test to the behavior it witnesses.

  `@variance-authority/distill` combines an Eyes attention journal and a Sense
  execution index by exact test identity. It keeps authored Arrange, Act and
  Assert attention, React update initiators, and whole-test source entry separate,
  then names entered files without addressed source attribution as opportunities
  for a counterfactual check rather than safe mocks.

  `variance distill` reads the portable files from a shell and can emit text or
  JSON. A combined MCP connection exposes the same analyzer as
  `variance_distill`; the former `variance_testing_surface` name is replaced.
