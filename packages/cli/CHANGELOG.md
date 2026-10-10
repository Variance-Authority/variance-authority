# @variance-authority/cli

## 0.15.0

### Minor Changes

- b834b44: A case names its preconditions

  `variancePrecondition({ name: value })`, from `@variance-authority/sense/precondition`,
  says what state a case arranged: `variancePrecondition({ network: 'mocked', 'seeded-cart': true })`.
  A value is a string, number or boolean. Said in a case body it is the case's;
  said in a `beforeEach` it is the case the hook runs for, at the level of the
  `describe` that declared it. The body overrides a `beforeEach` and an inner
  `describe`'s overrides an outer one's; two values said at one level are kept as
  a contradiction. A call where no case is running — a `describe` callback, a
  `beforeAll` or `afterAll`, a file's top level, work that outlives its case —
  throws with its call site. Each value lands on the case's row in `coverage.bin`
  with the `file:line` of the call. Vitest, Jest and Rstest listen under
  `withTestSelection` and their seams, and Playwright under its fixture. Without a
  recording the call returns, and the entry imports nothing. A precondition never
  selects or excludes a test.

  `ExecutionTest.preconditions` holds the row, each entry with the level it was
  said at: empty for a case that said nothing, absent for a record nobody
  listened to. `PreconditionValue` types a value.
  `listenForPreconditions`, `PreconditionListener` and `PreconditionStanding`,
  from `@variance-authority/sense/journal`, let a runner seam listen, and
  `createExecutionRecorder` takes the standing case as a third argument.

  `variance covering --where <name>[=<value>]` keeps the cases that said it, and
  repeats to require several. A record made before cases said anything is refused
  as unmeasured. Every case line prints what it said and where, and where
  `names.axes` declares the name, the case one step toward the axis's base is
  named as its twin.
- 9c8f81d: A selection skips the cases a change did not reach, under `VARIANCE_AUTHORITY_GRAIN=case`

  A selected test file ran every case it declares, though the record knew which
  of them entered the changed code. With `VARIANCE_AUTHORITY_GRAIN=case`, the
  Jest and Vitest seams skip the cases of each selected file that entered none of
  the changed regions. The worker marks them skipped through the runner's own
  task modes, as `it.skip` would, so nothing reaches argv. The stderr line counts
  them: `selected 2 of 340, skipping 31 cases in 2 of them`.

  A file runs whole whenever the record cannot say which cases a change reached:
  the test file changed, a reason other than a region selected it, the region ran
  while its module loaded, or no recorded case entered it. A case that shares its
  full name with a reached case runs too. A file run in part is recorded
  incomplete, so the next selection runs it whole. A selection in which some test
  last ran at an earlier commit than the latest run, as one does after a commit
  between runs, runs every file whole. File grain stays the default,
  and any value other than `file` or `case` fails the run.

  `SuiteSelection` gains `cases`, each test file run in part to the names of the
  cases it may skip, and `variance`'s `selectSuite` takes `grain`.
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
- 76e7340: `variance layers --against` names a package that started or stopped importing another package and kept its layer. `layerMoves` returns these packages as `held`. A package that appeared or vanished is now named with its layer and every package it imports, and `layerMoves` returns it as a `LayerPresence` rather than a bare name. So every package edge that a change adds or removes is reported once, whether or not a layer moved.
- a9bcd21: `variance distill` walks dynamic imports of a quoted string beside static ones, so what
  only an `import()` reaches is listed under it, printed as `lazily imports`,
  rather than apart as unseen. A module a static and a dynamic import both reach
  is listed as shared, and a lazy import under an unused static import is owned
  by the static one. Only a dynamic import or `require` whose specifier is not a
  quoted string, or a load the runner made, is still unseen.

  `distillFile` and `distillScope` take an optional `lazy` lookup beside
  `imports`, and an import cause carries `lazy: true` when only a dynamic import
  brings its modules in.
- 69a3fcd: A mainline that gave no record is not asked again for 10 minutes. The window
  used to hold only for a remote that did not answer. It now also holds when the line has no record for
  the suite, or has one this version cannot keep. Within the window, every reader
  gets the same answer as the first. A record published in the meantime is read
  after the window closes, not halfway through a sitting or a CI run.
  `MainlineMissed.asked` and `earlier.asked` on a `MainlineRecord` give the time
  the line answered, and the reader's note includes it. An unreachable miss no
  longer appends that time to its `detail`.

  `readMissedMainline` and `writeMissedMainline` read and write that answer under
  a suite's read root. A job that is handed another job's read root can then
  stamp the answer as given now. `MissedMainline` is its type.
- ec42738: `variance distill --file` holds the test file's mocks against the file graph,
  whatever the record says. A mock of a module the file does not load, directly
  or through anything it imports, is an error: delete it. A mock of a module more
  than two imports away, past the subject's imports, is a warning naming the file
  that imports it. A file reading carries them as `mocks`, each `unloaded` or
  `beyond` with its `hops` and `importer`. `shadowReach` in
  `@variance-authority/sense/taint` gives each module a file shadows its shortest
  distance from the file along runtime edges, and `mayMock` says whether a file's
  text may mock at all.
- bd93f0e: `variance shards --at-distance <hops>` counts the shards of one leg of a change's selection, as `select --at-distance` cuts it, so a near wave run under `VARIANCE_AUTHORITY_AT_DISTANCE` starts only the shards its own files are worth.
- 5757e7c: The mainline's record fetched last stands until a nearer one can exist, not
  for 10 minutes. The line keeps only its newest record, and the nearest a
  checkout can use is the one at `HEAD`'s merge base with the mainline. A record
  at or past that merge base is read without asking the remote, and so is one
  fetched while the merge base was the one it is now. After a pull or a rebase
  moves the merge base, the line is asked once. `variance select` and
  `test:since` therefore stop waiting on the remote every 10 minutes in an edit
  loop, and every job of a CI run reads the same record however far apart the
  jobs start.

  `FetchedMainline.base` keeps the merge base the line was asked at, in
  `fetched.json`. `earlier.reused` on a `MainlineRecord` says why the record
  stands: `'nearest'` at or past the merge base, `'asked'` when the line was
  asked at this merge base. The reader's note says the same. A line's answer
  that it gave no record still stands for 10 minutes.
- 9e03085: `variance review --format handover` prints breadcrumbs to the coverage of a
  change's area as one collapsed block for the pull request body, read from the
  record this checkout already has. A review bot reads the body when the pull
  request opens, before CI has finished. It gets a line for each changed
  function no case reached, the change wrote, or a case reached only from far,
  from a distance not measured or only while its module loaded, those no case
  reached first, with the test file to open; functions reached from near are
  counted. Past twelve lines the rest are counted, and the block ends with the
  `variance covering` command for one file. A suite run on the change answers
  alone for every changed file it read; when nothing is left unreached, what
  only a record from before the change reached is counted apart. Markers around the block mark what a later run's
  block is pasted over.
- 44f04f3: A review names what each case arranged

  The markdown `variance review` writes lists, under each changed function a case
  ran, up to 30 cases with the preconditions each said, in the form `covering`
  prints: `flag=ff-on (src/checkout/total.test.ts:31)`, and counts the rest. When those cases said more than
  one value of a name, the function's line names every value: `ran under
  flag=ff-off, flag=ff-on`. A record made before cases said anything says what
  they arranged is unmeasured, and cases nobody listened to are counted apart
  from the cases that said nothing. `review.json`, from `--format json` or
  `--out`, carries every case: `ReviewCase.preconditions` holds what it said, and
  `ReviewCase.id` tells apart two cases that share a file and a title.

  `variance covering --where` that keeps none of the cases that covered a line or
  function says the filter left none of them, and how many there were, rather
  than that no named test covered it. `CoveringWhere.ran` holds that count.
- 5c5b2f6: A review says what it read

  `variance review --format markdown` names what it read: the commit reviewed, the commit the change starts from, the commit the cases ran at, and the commit of each recording coverage is compared with. On a pull request CI checks out GitHub's merge of it, so the comment names the pull request's head and the merge it was tested as, and says it describes an earlier commit once the head moves on. Each changed place links to its lines at the commit reviewed.

  Each changed region is `new`, `modified` or `moved`, in place of `written`: moved when the lines the change wrote are text the diff removed, and `movedFrom` names the file it came from. `changedLineCases` counts the cases that ran a changed line, as `variance covering --line` names them for each one, beside `cases`, which counts the cases that entered the region. Changed functions are one table with both counts, how the edit wrote each, and the first three test files; the cases by title stay in `review.json`. The cases added and removed come first, and a legend explains the marks. The Mermaid graph of changed functions follows the table, folded, and gives each function its edit and both counts.

  Coverage changes are said in plain words, each signed by what it does to the count: `+51 newly run · −2 no longer run · +19 run in 22 added regions`. The markdown prints a suite's count at the base and now beside those parts, and says so when they do not add up. The review no longer folds in the source no suite recorded; `variance coverage` still prints it.

  `hunksOf` is exported from `@variance-authority/sense/test-selection`, the hunks of a diff under the names `changedLines` gives. `workingTreeChanges` is exported from `@variance-authority/sense`, the paths the working tree disagrees with `HEAD` about.
- 14aefbf: Ask what one test, or one story, checks that the narrower ones inside it do
  not.

  - `variance ask test-composition --file <test> --name <words>`, and
    `docs_test_composition`, read one recorded test as the smaller tests whose
    regions sit inside its own, the larger tests holding it, and the regions no
    smaller test entered: modules only it enters, and paths through a smaller
    test's module only it takes.
  - `variance_composition {subject}` closes with the same reading for a story:
    the smaller stories inside it, the larger ones holding it, and what no
    smaller story renders — components only it mounts, and components a smaller
    story renders another way. The run carries it per subject in the report's
    structure section; `piecesOf` in `@variance-authority/core/attribute`
    computes it.
  - A component mounted by more than half the suite's subjects is structure. A
    subject that mounts a component many times now counts once, where every
    mount used to count: a chip story is an example of the chip again when the
    pages around it mount chips many times over.
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
- 1fd0cf7: `variance ask packages` (`docs_packages`) counts and lists no import site: one
  row per published specifier, one per package that declares no entry with how
  many of its names and files other packages import by path, under the heading
  "N packages that declare no entry are imported by path", and per package the
  number of imports from other packages that reach past a published entrypoint.
  It ends with the `variance ask entrypoint --package <name>` questions behind
  those counts.

  `variance ask entrypoint --package <name>` (`docs_entrypoint`) asked by a
  package's name now also counts the imports that reach past its entry, or, for a
  package that declares no entry, the imports of its files by path, one row per
  file: its specifier, how many names are taken from it and how many files import
  it, the most imported first. Asked by one of those specifiers, it counts the
  imports written as it per name, each name with how many files import it, where
  it listed every import with the importer's file and line, and names `uses` on
  the first name for its sites. Under a package that
  declares no entry, a specifier's count is of distinct names taken in distinct
  files, where every import of a name was counted again: fifty files importing
  one name read "50 names" and now read "1 name". Asked by the name of a package
  whose `exports` opens only subpaths, it lists the specifiers the package opens
  where it used to refuse with "does not open `.`". `--subpath .` answers exactly
  as the package name alone, where it left out the imports past the entry, or
  refused for a package that opens only subpaths.

  An import into a published package whose declared entry leads to no source
  file, such as a `main` naming a build output the checkout does not hold, is
  kept, where every one was dropped and `variance ask entrypoint` said no other
  package imports it. An import that names a declared entry is counted as an
  import of an entry this reading could not follow to a source file, not as one
  reaching past the entry; only an import past every declared entry reaches past
  it. `variance ask packages` counts those packages and their imports,
  `variance ask entrypoint` counts them, and `uses` and `symbol` answer for the
  names taken from them. `landing` says where one import between packages
  lands: opened by an entry, at a declared entry the reading could not follow,
  past every declared entry, or by path into a package that declares none.
  `Help` and `Usage` carry the imports of an entry the reading could not follow as
  `unfollowed`, and `gatheringUsage` is the one place a `Usage` is gathered.

  `variance ask entrypoint` on a package that declares no entry says it has "no
  `exports`, `main`, `types` or `typings`", where it left out `typings`, the
  fourth key read for an entry, and says so of one no other package imports too,
  where it said that package "opens no entry". A manifest that writes
  `"exports": null` is read as one that writes no `exports`, as Node reads it: its
  `main` opens the bare name, and without a `main`, `types` or `typings` it
  declares no entry. `Offering` and `Documented` carry whether a
  manifest declares an entry as `entry`, read from the whole manifest whichever
  keys `declared` records.

  On a repository whose packages declare no entry, `variance ask packages` went
  from 200,330 lines in 29.9 to 45.9 seconds to 1,339 lines in half a second,
  `variance ask entrypoint --package @kbn/core` went from 23,463 lines to 13, and
  `variance ask entrypoint --package @kbn/core/server` answers in 241 lines, one
  per name.

  Breaking:

  - `variance ask entrypoint --package <name>` (`docs_entrypoint`) counts the
    imports past a package's entry, or of its files by path, one row per file, and
    asked by one of those specifiers counts its imports per name. It printed
    every import with the importer's file and line; `variance ask uses --name
    <name> --package <specifier>` lists those for one name.
  - `readUnentered` and `publishes` are removed from
    `@variance-authority/package/help`. `readImportTargets` reads the published
    packages, the ones that declare no entry and the specifiers each published
    manifest declares, in one pass.
  - `readHelp` from `@variance-authority/sense` takes those three as its third
    argument, `{ published, unentered, declared }`, where it took the packages
    that declare no entry; the native `read_help` it calls takes `published` and
    `declared` as two more arguments.
  - `Offering` and `Documented` carry `entry`, and `Help` and `Usage` carry
    `unfollowed`: a value built by hand adds them.
- f1c1b64: A bumped package and a moved manifest are read as the repository files they
  change, once, before anything else is asked. `beyondReach` in
  `@variance-authority/core/relate` walks a bump through the install to the first
  files whose runtime imports load it, and stops there: a test that entered
  anything further along evaluated that file on the way. A moved manifest becomes
  every file beside it. `variance select`, `variance reach` and `variance run
  --since` hand those files on as changed whole, so the suite's `before` and the
  record answer for them as they do for an edited file.

  `before` now holds files alone. A bump of a package your setup imports runs the
  whole suite and names the setup file, not the package. `changedBefore` takes the
  changed files only, and `BeforeReach.packages` is gone.

  The `packages` option of `narrowByJourneys`, `narrowByExecution` and
  `selectJourneyFile` is removed: pass the files `beyondReach` returns, each with
  no line ranges.
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
- da0cdbc: `variance collect` writes the suite index without a visual run: no baseline,
  no comparison, no image. Each CI job collects its shard into a part, and
  `variance collect merge evidence-*.json --out suite.index` folds them:

  ```bash
  variance collect --shard 1/4 --workers 2 --out evidence-1.json
  variance collect merge evidence-*.json --out suite.index
  ```

  Each part records its plan, its build (Storybook digest, commit, and every
  source file under `source.dirs` as it is on disk), the config that shaped the
  reading, the environment its engine reported, and an outcome for every
  subject its shard owns. The merge refuses parts from different builds, plans,
  configs or environments, a missing or repeated shard, and sharded and
  unsharded parts together, and names the shard to collect again. While any subject failed, it leaves the index at `--out` as it was,
  writes `<out>.incomplete`, and exits `2`.

  The suite index is version 2: it carries landmarks, the file that declares
  each subject, fields the reading did not reach apart from fields it read as
  empty, coverage with the reason each subject was not observed in a run
  report's words, and the build it came from. Version 1 indexes still open, without those facts.

  `variance run --workers` keeps where every worker located a component. Before,
  the report's lexicon carried only the last worker's locations, so a component
  another worker located fell back to the source scan's candidates.

  `variance share` refuses an unsharded part beside sharded ones, and two
  unsharded parts, rather than composing them into one index. A suite part that
  exists but cannot be read stops the command with its path.
- 988d0a2: An export's doc comment can declare its role with `@testOnly` or `@production`, and `variance restrictions` checks it with no `.relations.json`. It lists every shipped file that imports a `@testOnly` export, directly or through re-exports; every `@production` export that only tests import; and every export that declares both. What a `*.stories.*`, `*.story.*` or `*.examples.*` file imports from its own directory or below is held to its role as shipped code is, while what it imports from elsewhere stays test code; the code map counts `*.examples.*` files as tests. `Export.roles` gives the declared roles, and `declaredRoles()` runs the check. The source index format is version 16, so `variance index` rebuilds it once.
- 86a05ca: `variance distill` finds a test by its file and title: `--file` takes any part
  of the test file's path, and `--test` takes the recorded id, the exact title or
  a part of it, in the record's case index, and reads the case's journals by
  its id. When more than one test fits, the command prints their ids. `distill()` takes
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
- a07d9aa: `variance distill` reads the execution index your last recorded run left, the
  one `covering` reads, so a run wrapped in `withTestSelection` needs no
  `executionFile` and the command needs no `--execution`. `--suite <name>` picks
  one declared suite's index. `--execution <path>` still reads any other index,
  including JSON from another tool. With nothing recorded, `distill` refuses as
  `unrecorded`.
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
- f9486f1: A base your clone cannot diff from is refused rather than compared. `variance
  coverage` against a base, `variance covering --against` and `--cases last`, and
  `variance review` with `--against` or `--coverage` exit 2 with an `undiffed`
  refusal when the base names no commit, or names one this clone does not have.
  The message names the commit and how to get it: `git fetch origin <sha>`, or
  `fetch-depth: 0` on `actions/checkout`. A review job in CI fails with it rather
  than posting a comment that compared regions which may not be the same code.
  They used to pair those regions by their place among regions of one name, which
  reads a function written between two siblings as one losing every case and
  another gaining them.

  `covering --since --against` refuses the same way when git cannot say what the
  base's branch changed after the base was recorded, which a shallow clone cannot
  answer, instead of comparing without leaving those files out.

  `--cases last` after a second run at one commit that ran a test file again is
  refused too: that run's replaced cases mix the commit's own cases with the ones
  they replaced, so they name no commit to diff from. The first run after a commit
  compares with the last run at the commit before.

  `caseMotion` and `coverageChange` take `diff` as a required option; it is the
  only way they pair regions.
- 05996d4: A record without coverage

  A run that keeps its cases and instruments no module writes `coverage.bin` with
  its case sections and none of the coverage sections. A record already at the
  path keeps its coverage as it was, under the new run's cases; a run that keeps
  no cases and instruments nothing writes nothing. A file it could not finish
  measuring is still recorded incomplete, which selects it. Its warning now says
  the run recorded no coverage and narrows no later selection.

  Such a record is unmeasured, not a record of tests that reach nothing.
  `readTestCoverage` refuses it with `RecordWithoutCoverage`, and selection
  narrows nothing over it: `variance select` skips nothing and says the record
  holds no coverage, `variance run --since` runs every test file, and
  `variance journeys` carries no partings, and `yarn test:since` runs the whole
  slice and says why. Landing shards with `variance journeys` folds them over no
  coverage and keeps the record's cases; a shard that holds cases and no coverage folds
  nothing and lands its cases, and landed where no coverage stands it writes a
  record of cases and no coverage. A shard that names no last run, as one that
  crossed a checkout does, lands its cases for the files they are of.
  `variance share` publishes such a record under the commit its cases were
  recorded at, without the whole-run check a record that narrows would need, and
  a mainline fetch keeps it as the base. A worktree seeds from it and lays it with
  its cases and no runs record. A record that holds some coverage sections and
  not the others is still refused as broken.

  `recordOfCases` writes a record from case sections alone, and
  `withoutCoverage` answers from a record's header whether it holds no coverage.
- a9f503d: `variance select --at-distance <hops>` cuts the selection to one leg: the
  selected test files that many imports from the change. The selected files
  outside the leg join the skip list, so `0-2` and then `3-` run every selected
  file in one of the two.

  A leg is still a skip list. A selection that declines to narrow skips nothing
  in any leg. A test the change did not enter and the record holds incomplete
  runs in the leg of the shortest import path it ran to a changed file it
  loaded. One with no such path, such as a file whose every case skipped and
  that loaded nothing changed, runs only in the open leg, the one with no upper
  bound. A test new since the recording is named nowhere, so it runs in every
  leg. The execution narrowing names the incomplete tests as `incomplete`. A
  test the change entered by no import it executed has no hop count, and runs in
  the one leg that holds the furthest hop measured, or in the open leg when
  nothing was measured. stderr counts the tests the change entered at each hop
  count, names the leg that runs those with none, counts the incomplete tests the
  leg runs by their path, and names how many selected files the leg left and the
  command that runs them. `--format json` gives the leg as `leg`, those files as
  `left`, and each entered or placed test's hops, bearing and, where none was
  measured, the reason as `distances`. A leg over a journey file is refused,
  because a journey file records no imports to count hops by.
- bd98c3a: `--shard` in Vitest and Jest is placed by recorded time, and `variance shards` says how many to start

  A Vitest or Jest config wrapped by `withTestSelection` now places the files of
  `--shard k/n` by the time each took on the last recorded run, rather than
  leaving the runner to divide them by count. Each shard computes the whole
  placement from the same record and keeps its own part: files go longest first
  to the shard with the least time so far, and a file the record has not seen is
  priced at the median of the ones it has. The run says on stderr which record
  placed it and what each shard was given:

  ```text
  variance-authority: shard 1/2 by the times recorded at 8e3b0f0e9028: 1 of 5 files, 9.0 s (shards 400 ms to 9.0 s)
  ```

  When the times cannot be read, the runner's own split runs instead, and the
  line says why. A failed read never fails the run. A Jest config that names no
  `testSequencer` finds Jest's own through Jest, so a layout that does not hoist
  `@jest/test-sequencer`, as pnpm does not, runs as before. Under
  `VARIANCE_AUTHORITY_SINCE`, only the files the selection keeps are placed.

  `variance shards --setup <seconds>` prints how many shards a recorded suite is
  worth, and with `--format json` a `matrix` of `k/n` strings for a CI job to
  start. Every shard is charged its setup, so a shard is added only when it
  shortens the wait by more than it spends, and the count stops at the slowest
  test file, which the answer names with its slowest case. `--budget` asks for
  the fewest shards that finish within it, `--workers` divides a shard's share
  among its runner's workers, and `--since` leaves out what the change lets the
  run skip, so a change that reaches no test answers `0 shards`. `--collected
  <file>`, the runner's list of test files, counts a test file the record has not
  seen, priced at the median.

  It always answers, and names what it could not weigh, in `notes` under
  `--format json`. Without `--setup` the count weighs no setup. A budget no
  longer than the setup is out of reach at any count, and the answer is the count
  that finishes soonest, with `why` set to `setup over budget`. `--since` without
  `--collected` counts only recorded files and never answers fewer than one
  shard, and `--at-distance` without `--since` counts the whole suite. With
  nothing recorded it answers one shard until `--unrecorded <n>` names the count
  to start.

  `@variance-authority/core/shard` is the placement and the count, which
  `variance run --shard` places stories and routes by too.
  `@variance-authority/sense` exports `recordedTimes` and `fileCases`, and
  `@variance-authority/cli` exports `suiteTimes`.
- af6b022: `before` moves out of `source` and is declared where the suite is. The top-level
  `before` is what every suite rests on — a CI workflow, a `.nvmrc` — and a
  suite's own `before`, beside its `kind`, is its runner config and its setup
  files, each listed, since a config names its setup as a string and a string is
  not an import. `variance select` now reads both for the suite it reads: each
  entry is walked down the file graph, and a change to any file it reaches, a
  `package.json` whose `exports`, `main` or `type` moved over one of those files,
  or a bump of a package those files import, runs the whole suite and names what
  moved. A directory in either list is walked from every file under it. `select
  --execution` reads the same lists for the suite `--suite` names, the only one
  declared, or every declared suite when none is named; beside a snapshot
  `--execution`, `--suite` is refused, since both name the record. A manifest move
  is read when the diff leaves every lockfile alone. A
  config below the repository root inherits the root's `before`, as it inherits
  its suites. A suite that declares nothing has nothing before its reach, and
  `select` says so.
  `variance run --since` reads the top-level list as it read `source.before`.

  `source.before` is refused: move it to the top level.
- 8be004e: A suite may decline the import graph: `"relations": false` beside its `kind`.
  A changed file its record measured is answered by the record, as before; one it
  did not measure — a file added since the run, a stylesheet — is answered by the
  first tests that import it, unless the suite declines relations, and then it
  selects nothing in that suite. An end-to-end suite imports none of the app it
  drives, so the graph names none of its tests; it lists what it rests on in its
  own `before` instead. `variance select`, `select --execution` and `variance run
  --since` name each declined file, and `select --json` carries them as
  `declined`, apart from `unread`.

  `narrowByExecution`, `narrowByJourneys` and `selectJourneyFile` take
  `unmeasured: 'nothing'` to decline, and their narrowing carries `declined`
  when they do. `unmeasuredOf(suite)` reads it off a declared suite.
- ebff21a: A Vitest or Jest configuration wrapped by `withTestSelection` runs only the test
  files a change reached when `VARIANCE_AUTHORITY_SINCE` is set:

  ```bash
  VARIANCE_AUTHORITY_SINCE= npx vitest run
  ```

  The runner drops the files the selection skips before it shards, sorts or lists
  them: Vitest through a wrapping `sequence.sequencer`, Jest 30 through a `filter`
  module chained after the project's own. No path travels through argv, the
  environment or a file. Set and empty, the variable reads the base from the
  record; set to a ref, that ref is the base when the record names no commit.
  `VARIANCE_AUTHORITY_AT_DISTANCE` cuts the selection to a range of import hops,
  as `variance select --at-distance` does.

  The run prints what it read on stderr: `selected 12 of 672`, `selected none of
  672`, or `declined:` and the reason every file runs. A test file the record never
  saw runs. Watch mode does not select, nor does Jest under `--filter` or
  `--skipFilter`, and each says so. A Vitest run whose selection is empty passes.

  The reading is `selectSuite` from `@variance-authority/cli`, the function
  `variance select` prints, so the project installs the cli to select. It is
  resolved from the configuration's directory, so a package can hold the cli as
  its own devDependency. `@variance-authority/sense` declares `jest ^30.0.0` as an
  optional peer beside Vitest: Jest 29 reads the files a filter keeps as none, so
  a configuration that selects under it throws while it loads and names the
  version.

  A change to a source file now reaches the tests that loaded only its built
  copy when the record holds the file under both names, in `variance select` as
  in the runner. The `tsconfig` that builds the package says which recorded names
  are built from which source.

  `variance select --format vitest` and `--format jest` are deprecated, and say so
  on stderr: they put the selection on the runner's command line, which a large
  one outgrows. They are removed in a later minor release. `--format plain` and
  `--format json` stay.
- fa48984: `variance prune` removes the cache entries whose checkout, worktree, process or
  commit is gone, now, and prints what it freed. It reads no project
  configuration, so a repository that only runs its test suites can keep its
  cache bounded in a CI cleanup step or a scheduled job.

  `variance doctor --prune` is removed; `variance prune` does what it did.
  `variance doctor` still prints what the next prune removes.

### Patch Changes

- 8877994: `variance select` compares the install from the one the suite ran on, and names the lockfile when a bump keeps tests in the run

  A suite recorded over a lockfile you had not committed yet was compared from the
  lockfile at the journal's commit, so the bump the suite had already run on was
  read as a change, and selecting with nothing edited ran every test that loads
  the bumped packages: `skipping 0 of 198`. The comparison now starts from the
  install the recording kept, so the same selection skips the whole recorded
  suite, and a lockfile or manifest you change after recording, or undo, is
  compared from the recorded one. Tests a later run leaves where they last ran
  are compared from the install they ran on too, so committing the bump and
  running the selection does not put them back in the run. A recording that kept
  no install is compared from its commit as before; one whose kept texts this
  cache does not hold is compared from its commit too, and a note says so for each
  commit it happened at. A suite that ran with its lockfile deleted is no longer
  said to be missing it from the commit: the note says the suite ran without one.

  A package the lockfile resolves differently is walked back to the files that
  import it, and those files are read as changed whole. The selection then said
  that no skipped test "covered a changed line", named no lockfile and no
  package, and a suite that ran in full over a dependency bump looked like a
  recording that had stopped narrowing. Now the reason says a test may also have
  entered a file the install moved, and a note names the lockfile, where it was
  compared from, each package it moved with the package most of its files
  imported it through (`tinyglobby through vitest`), and the files that import
  them. A manifest whose `name`, `exports`, `main` or `type` moved is named the
  same way. `variance select --format json` gives the lockfile, the packages, the
  moved manifests and the count of files under `install`.
  `variance review --format json` names the same lockfile under `beyond`.
- 596743a: The skill reads the state each covering test ran under

  The `variance-authority` skill has a `case-preconditions` reference: which tests
  ran a function with discounted prices mocked, the state each test covering a
  function ran under, a test's flag-off twin, how a test helper records the state
  it sets, and what to do when `--where` answers unmeasured. The skill's config
  table and its `covering` reference say that `covering` reads `names` from the
  root `variance.config.json`. The `@variance-authority/sense` and
  `@variance-authority/cli` READMEs say a case precondition records the state a
  test ran under, and link to the public case preconditions page; the
  `@variance-authority/playwright-test` README links to the renamed section.
- 8187fb1: Each `variance` command loads only the modules it calls. Every command used
  to load every other command's modules first, Storybook, the pixel stores,
  history, the MCP tools and the help among them. On this repository:

  - `variance --version` takes about 85 ms, where it took about 170 ms.
  - `variance index` takes about 165 ms, where it took about 245 ms. The help
    is loaded only by the follow-ups `index` hands to another process.
  - `variance select --suite unit` takes about 445 ms, where it took about
    565 ms; part of that is fewer git processes.
- 29a82be: A commit between partial runs no longer widens the selection to every test of a changed file

  A test a partial run leaves out stands at the commit it last ran at. What
  changed between that commit and the record's was charged whole for it, so one
  commit made between two runs selected every test that loaded a file it touched,
  whatever the edit was. In this repository, two committed edits to `columns.ts`
  with a partial run between them selected 291 of the unit suite's 678 test files.
  They now select the 4 that entered the regions the edits changed.

  `variance select` and `askPerStand` now read that change from both texts, the
  way a change in the tree is read. The record's text is the old side, so the
  change lands on the regions the test's rows hold. A test still runs for an edit
  to a region it entered, and no longer for one elsewhere in the same file. The
  merge base with a ref named on purpose is still read whole, and so is a file a
  later run landed over an uncommitted edit to, whose rows for the test were
  never re-cut onto the record's text.

  `Stand` gains `changed`, every file changed from the stand to the record's
  commit. `whole` holds only what a stand charges whole, and is empty for a stand
  the runs recorded. `askPerStand` hands its selector a `StandQuestion` in place
  of the files to charge whole and the stand's commit, so a selector passed to it
  is rewritten to read the question; `standDiff` writes the change a `stand`
  question reads, and a `stand` question is read without the texts a landing
  kept.
- 8dbc834: The components a module declares are read from its code. A declaration written
  in a block comment, a JSDoc example or a template literal no longer names a
  component, so a commented-out `function Retired()` no longer makes its file
  the one that declares `Retired`. A name is declared by a statement of the
  module itself: a function, class or binding inside a function body belongs to
  that function and no longer counts. An `export async function Page()`, an
  abstract class, a generator, a second name in `const A = 1, B = 2`, and a name
  that starts with a non-ASCII capital or carries a `$` are now declared too.

  `variance run`, `variance collect`, the Storybook collector and the route
  collector resolve a component to its `file:line` from the same reading, through
  `indexDeclarations`, which `sense` now exports. What that changes in the index
  they build from `source.dirs`:

  - The line is the first line of the declaring statement. A decorated class
    sits at its first decorator, or at its `export` when the decorator is written
    above the `export`, and a second name in a multi-line `const` at the line of
    the `const`.
  - `.d.ts` files, and test, spec and story files your own `exclude` lets
    through, declare nothing.
  - A file the parser cannot read declares nothing, where the text scan found
    the components in it. That covers a Flow-annotated `.js` file, and a `.vue`,
    `.svelte` or `.mdx` file you add to a collector's `extensions`, which is
    parsed as TSX and fails. The index built from `source.dirs` or a collector's
    `source` does not say so: the file's components are missing, and nothing
    names the file. Only `sense`'s source index, for a file it records, names the
    parse error in that file's record.
  - Building the index needs `sense`'s native addon, which ships for macOS on
    arm64, Linux on x64 and arm64 with glibc, and Windows on x64. On any other
    machine, including an Intel Mac, an Alpine image and Windows on arm64, a
    configured `source.dirs` fails at its first file and names why the addon did
    not load, where the text scan ran anywhere. The route collector depends on
    `sense` for it.

  `indexSource` is removed from `@variance-authority/core/attribute`. Build a
  `SourceIndex` with `indexDeclarations` from `@variance-authority/sense`, or
  write one as plain data: a map from component name to `{ file, line, via }`.
  `SourceRef['via']` loses `'declared'`, which nothing produced, and
  `readCapture` in `@variance-authority/unit-test` refuses a capture whose source
  index carries it.

  The source index format moves to version 18, so an index written before this
  release is rebuilt once instead of keeping the names it read from comments.
- 21438bc: Reading the mainline's record no longer throws when the daily prune of the
  cache is due and finds something to remove. `variance review`, `select`,
  `coverage`, `share --suite` and the `suiteBase` export failed with `Cannot read
  properties of undefined (reading '0')` on the first fetch of the day whose prune
  removed an entry or failed to. The record note that `variance select` and `share --suite`
  print now ends with what the prune took, in the words `variance prune` uses,
  such as `cache: freed 8.0 MiB in <cache>: 1 directory nothing writes any more`.
- f8e70fe: `variance select --execution` runs every test `variance covering --line` names for a changed line

  A journey file selected the cases that entered the innermost region holding a
  changed line, and nothing else. A line that opens a region carries the text of
  the region around it, so a change to the condition in `if (ready) {` skipped
  every case that evaluated `ready` and never took the branch, while `variance
  covering --line` named those cases for the same line. Each changed line is now
  charged as `covering --line` and file-level `select` charge it: the innermost
  region, the region around it when the line opens one, and the `else` nobody
  wrote on the brace that closes a branch. `narrowByJourneys` and
  `selectJourneyFile` give the same answer, with the addon and without it.
- 261a6b2: `3-` runs the near tests the run `0-2` saved did not run

  `0-2` saves its run before `3-` is cut, so `3-` reads another record: the tests
  `0-2` ran are at HEAD, and every other test is read from where it last ran. That
  reading can bring a test within two imports of the change that the reading `0-2`
  was cut from did not select, and neither leg ran it. In this repository, an
  inserted function selected 5 such tests at 2 hops after `0-2` had run.

  A leg that starts past 0 hops, cut after a run was saved at HEAD, now also runs
  every selected test nearer than its first hop that still last ran before HEAD,
  and says how many on stderr. A test `0-2` ran is at HEAD, so none runs twice.
- f62f217: A config below the repository root loads when the root's suites carry to the root's share

  `variance run`, `adjudicate` and every other command reading a
  `variance.config.json` below the repository root used to exit 2 with
  `` `suites.<name>.carry` is "share", and the file has no `share` section to carry it `` whenever the root declared its suites with `"carry": "share"`. A suite carries
  to the root config's `share` section, which is where `share --suite` and
  `select` read it, so that is the section the check now reads. A member config
  needs no `share` of its own. A root whose suites carry to a share it has no
  section for is still refused, and a member config under it is refused naming
  the root file, which is where the section goes.
- 0fc98d7: A base row on a region of another path is not read as motion

  When the diff carried a base row onto lines where no region now has its
  structural path, case motion took whichever region stood there: a base
  `if#0/then` that landed on `if#1/then` was compared with it, and review said
  that branch lost every case it had. Now a row pairs with a region of its own
  path, or with the same branch renumbered or nested deeper by an edit inside its
  function, before it. Any other row is not compared: `CaseMotion.mismatched`
  names it with the region it landed on, coverage counts neither of them deleted
  or written, and `variance covering` and `variance review` list it as not
  compared.

  A row an edit touched pairs only with a region of the same branch, so a `then`
  never pairs with an `else`.
- 86bd9f5: `variance ask stack`, and `docs_stack` on the MCP server, list the agent
  skills an installed package ships. A skill is a `skills/<name>/SKILL.md` beside the package's
  `package.json`, the layout TanStack Intent set for npm. Each is listed under
  its package with its name, the file to read and the first sentence of the
  description in its front matter. Nothing is installed or copied: your agent reads the file from
  `node_modules`, at the version you installed. A `SKILL.md` deeper inside a
  package is not listed.

  The dependency lexicon moves to version 9 and records each package's skills.
  A lexicon written before this release still answers, and `stack` says that
  skills were not read until `variance index` refreshes it.
- 211bbcd: Shards landed with `variance journeys <shard>...` keep the install they ran on

  Each shard's seam keeps the lockfiles and manifests that differed from its
  commit in the runs record beside its snapshot. The landing kept none of that,
  so `variance select` after it compared the install from the commit. A bump the
  shards had already run on, not yet committed, read as moved, and every test
  that loaded the package ran again. Now the landing reads each shard's
  `coverage.runs.json` and records the install they all name. A shard whose runs
  record is missing, does not name its snapshot's commit, or did not observe
  every test its snapshot holds names no install, and neither do shards that ran
  on different installs: the landing then keeps none, and a later selection
  compares from the commit. `@variance-authority/sense` exports `shardsInstall`,
  the rule the landing reads them by.
- 8844d8d: A suite is set up by how it reaches the code

  The agent skill now covers setting up a suite's `before` and `relations` in
  `variance.config.json`, not only fixing a selection that came back wrong. It
  starts from how the suite reaches the code: a suite that imports what it tests
  keeps `relations`, and one that drives an app or a built Storybook from another
  process sets `"relations": false`. It lists which files the Vitest, Jest and
  Rstest integrations already record, and which you name yourself: `globalSetup`
  in every runner, Jest's `globalTeardown`, Jest's and Rstest's config file, Jest's `moduleNameMapper` and `transform`
  targets, and everything a Playwright config names. For a suite over Storybook,
  it names `.storybook/`.
- e87d26a: `distanceFromView` and `distanceByExecution` also place a test the record
  holds incomplete and the diff did not enter, by the shortest import path it
  ran to a changed file it loaded. So `distances` can hold a test outside
  `narrowing.entered`. A test with no such path is left out of `distances`.
- 2ba40f7: An execution index is told JSON or columns by its frame, not its first byte

  A JSON execution index that opens on a tab, a carriage return or a byte order
  mark now reads as JSON; it was taken for columns and refused as "not a
  variance-authority execution index". `isEncodedExecutionIndex` now answers
  true for bytes framed as a column file — a header length that fits and a JSON
  header naming a version and its sections — whatever the low byte of that
  length is, and otherwise looks for `{` past a byte order mark and JSON
  whitespace.
- 29d0bf1: Comparing the install at a commit reads every changed `package.json` and the lockfile at that commit in one git process, instead of one `git show` per file. A diff that touched 46 workspace manifests made `variance select` 0.35 s faster on this repository. A patch handed to `variance select` is read the same way: every blob its `index` lines name, in one `git cat-file --batch`, where it started two `git cat-file` processes per manifest at once. Which manifests count as moved is unchanged.
- 879baa1: Undoing an edit to a module your tests ran now selects those tests

  A run over an uncommitted edit records the edited text, and the next selection
  reads your change from that text. When you put the file back the way the commit
  has it, the diff from the commit no longer names the file, so the selection
  never read it and skipped the tests that had run the edit: you could edit a
  module, run the tests it reached, put it back, and the next run selected none
  of them. A module whose rows were recorded over a kept text, and that the diff
  does not name, is read from that text to the commit's, so putting it back
  selects the same tests the edit did. A patch handed in with `--diff` is still
  read as the whole change.
- 10ab2ee: `variance distill` resolves its suite as `review` does

  In a repository that declares several suites, `variance distill` without
  `--suite` exits as an operator error that lists the declared suites and asks
  for `--suite <name>`, where it failed as a defect in the tool with a stack
  trace. With one suite declared, it reads that suite's record.
- c272d0a: `variance share --publish` refuses a shard's part it cannot read

  When a `report.suite-part.json` beside a shard's run report is there but cannot
  be read, such as one in another format or version, the command publishes
  nothing, exits 2, and names the part and why it cannot be read. It used to
  report a defect in the tool and print a stack trace.
- cb8a52f: A source index another release wrote is no longer reported as damaged

  After an upgrade, the first command that read the source index said it was
  damaged and read only up to its first bad segment, and in CI it refused with
  the same words. The segments were whole: an earlier release had written them in
  another format version. Now the reader names both versions, for example that
  the index was written in format version 15 and this release reads version 18.
  On a workstation it rebuilds the index and says so, and `variance index` prints
  `source index rebuilt over one written in format version 15`. In CI the refusal
  names both versions and asks you to run `variance index` with this release
  before the command that reads it. `ask orient --files` over such an index says
  which version wrote it and that `variance index` rebuilds it.
- 337b108: `variance ask` refuses a word after the question when the question reads no
  report, and exits 2. Every word after the question is a report path, so a
  question about the code and a question asked of a watcher had no use for one
  and dropped it: `ask packages @kbn/name` listed every package, and `ask search
  --query rule executor` searched for `rule`. The refusal names the word and the
  flags the question takes, in the sentence a flag it does not take is refused
  in:

  ```
  `executor` is not an argument `variance ask search` takes; it takes --query, ...
  A value of more than one word is one argument, in quotes.
  ```

  To ask about one package, ask `variance ask entrypoint --package <name>`.
- 8fa094e: `variance carry restore` ends the restore keys for baselines and for an `actions-cache` report with each other mainline, as it does for a recording. A pull request into a branch that saves nothing, for example the base of a stacked pull request, restores what a mainline saved, instead of finding no store and reporting every subject as `new`.
- 7481996: `variance covering` across declared suites now prints the answers first, then
  any suite with no recording yet, and names every suite that never loaded the
  file on one closing line, `Not loaded by chromium (e2e): …`, instead of opening
  with a paragraph per suite that carried the record's cache path and file count.
  A suite whose record holds the path under another root, which most likely ran
  the file, keeps its full refusal among the answers. When no suite answers, each
  still explains in full, with the record it read and the recorded files of the
  same name. `--format refs` follows the text; `--format json` adds `spelled`, the
  recorded paths under another root, to an `unloaded` refusal that has any.
- ef496ad: `covering --where` and `review` name what was recorded

  `covering --where` prints `Kept the 2 of 4 cases that covered … and recorded
  prices=discounted.`, and `none recorded prices=sale` when it keeps none. A case
  recorded without preconditions is counted as `1 case was recorded without
  preconditions, so whether it ran under any of that is unmeasured.`; `review`
  prints `the state it ran under is unmeasured` for the same case. The refusal on
  a record with no preconditions says it was made before preconditions were
  recorded, or by a runner that does not record them. Anything that matches on
  the old `and said` or `not listened to` text needs the new wording.
- 73f40a8: `variance_changed_tests` prints what each case said, with the call that said it, on the case's line, as `variance covering --since` does.

  `variance covering` prints what each case said, and its twin, in every answer that lists cases. The `--since` text carries them on each case line, and the whole-file and plain `--line` or `--function` answers print each case's twin without `--where`; under `--format json` the answer carries `twins` in every form. A twin comes from the case's own test file, and a large set prints as its count and the first three names. `--where` counts out of the cases that covered what you asked about, not the whole record. When a case says one value twice, the row keeps the site that said it first. The `afterEach` warning, the invalid-value warning and the misplaced-call error name the call site from the checkout, as the row does, under every host that knows the checkout, including a runner built on `@variance-authority/sense/runner`.
- 5cd0075: The first run laid over a record that crossed a checkout — a seeded worktree, a
  mainline record fetched in CI, a shared one — names the commit that record's
  coverage stands at as the commit of the cases it replaced. A crossed record keeps
  its cases and drops the run that wrote them, so that commit used to go unnamed,
  and `variance review` and `covering --cases last` after the CI record job folded
  its shards over the mainline's record had no commit to diff the replaced cases
  from.
- 951a696: Every shard of a landing is compared with the base, and a module cut from another text is unmeasured

  When `variance journeys --suite` (or `landCases`) lands several shards at one
  commit, every shard's before layer is now cut from the case index the landing
  began with. A later shard's was cut from the index the earlier shards had
  already laid, where the modules they recorded stand at the new text. The layer
  was still named at the base commit, so `variance review` and `covering --cases
  last` paired those rows through the diff onto the wrong regions, and reported
  cases that had not moved as lost.

  The record's last-run layer now names the text each before module was cut from
  (`beforeTexts`). A module whose text at the base commit is another one is not
  compared, and the motion lists it as `Not compared, the cases before were
  recorded over another text than <commit> holds`. A record written before this
  names no texts, and is compared as it was.
- 9bb6f47: An `incomparable` verdict names what differs, and a recipe change can be re-baselined

  The reason now names only the identity fields that differ between the baseline
  and this run, and says whether they are the machine (renderer, engine, platform,
  scale, fonts) or only variance-authority's recipe (the stabilization or
  rasterization digest). It used to print both identities in full and blame the
  machine either way. A refusal no longer says pixels are machine-bound and
  the two not comparable: it says nothing was compared because this tool
  compares images only within one identity, and that nothing measured whether
  another machine paints the same pixels. `incomparableBecause` and its `IncomparableSides` wording,
  whose `replaceable` says whether the reason may offer a re-baseline, are
  exported from `@variance-authority/raster` for a caller that writes the same
  sentence.

  When only the recipe differs, which an upgrade or a changed renderer option does
  on an unchanged machine, the run still paints each subject. The reason says
  whether the document is the one the baseline was painted from. If it is, only
  the recipe moved: review the images and adopt them with `variance accept --all`,
  or with `--update-snapshots` in Playwright or `--update` in Vitest. If the
  document changed too, the new image is a change no comparison has read, and the
  reason says so. Before, the run left no image, so `accept` had nothing to
  promote and the old baselines had to be deleted by hand.

  The refusal stands for another machine's baseline, for a side that recorded no
  recipe digest, and for an identity that differs in a field this version does
  not name: in each, nothing shows the machine is the same. `settle` takes the
  run's identity as an optional third argument, as before, and refuses a recipe
  re-baseline when it is absent.

  `variance accept --all` skips an `incomparable` subject unless its
  `signals.document` is `unchanged` and its `signals.identity` is `recipe`, names
  the command that adopts it alone, and
  exits non-zero as for any refusal; `variance accept <subject>` adopts it. A
  report written before the signal was carried is skipped too. In
  `@variance-authority/report`, `promotionOf` takes a `PromotionOptions` with
  `bulk` for that rule, `bulkSkips` answers the rule alone, and the refusal for a
  subject with no image now says the baseline is another machine's or cannot be
  shown to be this machine's. In `@variance-authority/playwright-test`,
  `--update-snapshots=changed` skips the same subject and `=all` adopts it;
  `VarianceRun` carries `overwriting`, set under `=all`.
  `@variance-authority/playwright-test` now depends on
  `@variance-authority/report` and asks `bulkSkips`, so the two cannot adopt
  different images. Deferred capture paints against an older recipe, so both flags
  have an image to adopt. In-place mode's `=changed` now also skips another
  machine's image, which it used to write over the baseline; `=all` still writes
  it, as naming the subject does.

  An incomparable observation from `@variance-authority/observe` carries
  `signals.document`, saying whether the document is the one the baseline was
  painted from, and `signals.identity`, `recipe` when only the recipe digests
  differ and `machine` otherwise, as `recipeOnly`, now exported from
  `@variance-authority/raster`, answers it. `signals.pixels` is optional,
  since no pixels were compared.
  TypeScript code that reads `Observation.signals.pixels` must now handle it
  being absent.

  `@variance-authority/vitest-browser` asks `bulkSkips` too, and now depends on
  `@variance-authority/report`: Vitest's `--update` reaches every selected test,
  so it skips the same `incomparable` subjects. It used to promote every candidate
  it painted, including another machine's image and a re-painted recipe whose
  document moved. A plugin declared `accept: true` still adopts them.

  `variance ask summary` prints a reason that several subjects share once, with a
  count, and lists the subjects under it, so an upgrade that leaves every subject
  `incomparable` reads as one line rather than one per subject. It groups the
  same way the pull-request comment does, through `byReason`, exported from
  `@variance-authority/report`.
- b106be3: `variance journeys <shard.bin>... --suite <name>` lands the shards in a repository whose root `variance.config.json` declares its suites and configures no visual project. It used to stop on ``variance.config.json: `profile` must be a string``. Under `--suite` the command reads the root config only, the way `share --suite` does, and reads the suite's whole record, because no report names subjects to narrow it to. The pool line says so. `--config` next to `--suite` is refused.
- d043a1b: A mainline publish with `--collected` retires every test file the record holds
  and the runner no longer collects: its row, what it crossed, its cases and
  their Eyes journals leave the published record, and `variance share --suite`
  says how many it retired and names one. A record is laid over the one before
  it, so a test file that was deleted, renamed or moved to another suite kept its
  row in every record after, and every reader carried it: `variance select` read
  each file changed since it last ran as changed for it. A runner list that
  names none of the record's test files is refused, rather than retiring every
  row.
  `collectedRecord` in `@variance-authority/sense/test-selection` makes the cut.
- f11d94e: A region written between two siblings no longer costs its neighbours their
  cases. `variance coverage`, `variance covering` and `variance review` pair each
  base region with the region its lines moved to through the diff from the commit
  the base was recorded at, rather than by its place
  among regions of the same name. Three `.filter` callbacks where there were two
  used to report the last one as having lost every case and a new one as having
  gained them; it now reports the inserted callback as written and nothing lost.

  `caseMotion` and `coverageChange` take the diff as `diff`, read by
  `hunksByFile` from `@variance-authority/sense/test-selection`.

  A diff read from a directory reached through a symbolic link, as every
  temporary directory on macOS is, now names its files from that directory rather
  than climbing out of the link and back in, which matched nothing.
- 36c40d5: `@variance-authority/sense/test-selection` reads the `names` grammar

  The `names.axes` grammar is now exported from `@variance-authority/sense/test-selection`:
  `parseNameGrammar`, which checks a `names` value and throws `NameGrammarError` naming
  the field, `nameIndex` and `structuralParent` for a subject id, and
  `heldValues`, `outsideVocabulary` and `caseTwins` for what a case said on the same
  axes. `variance run` pairs a subject with its parent, and `variance covering
  --where` reads a case's axis and twin, through this one implementation, so a
  reader outside the CLI holds a case to the same vocabulary and base. The config
  refuses what it refused, with the same messages.
- d1789f5: Printed messages say what was recorded

  A Playwright test's precondition line reads `ran under network=mocked` instead of
  `arranged network=mocked`, and `no preconditions recorded` instead of `nothing
  arranged`. With `varianceExecution` off it reads `so no variancePrecondition call
  was recorded`. `variance review` prints `nothing records where this change
  starts`, `variance journey` prints that the execution journal `has no entry for
  this run’s subjects`, and the Vitest selection reason reads `worker reported
  which files passed`.
- 0eb4156: A cache prune that cannot remove an entry now says so. `applyPrune` returns each such entry in `unremoved`, with its error, and `prunedLine` prints one line for it: `cache: could not remove <path>, <rule>: <error>`. `variance prune` exits 2 when any entry stayed, where it used to print `cache: nothing to prune` and exit 0.
- 89d177b: A region that a test file which did not run still reaches no longer reads as having lost every case

  When only some test files ran at a commit, `variance review` and `variance covering --cases last` compared only the cases of the files that ran. Two kinds of region were reported wrongly. A region the files that ran stopped reaching read as `lost`, and the review said "Lost every case against the base", though test files that did not run still reached it. A region those other files had reached all along read as `gained` as soon as a file that ran reached it too.

  The cases of test files that did not run at the commit keep their earlier recordings, and they now count at both ends of the comparison. A region they reach keeps them: it reads as `thinned` when only one case is left, and as unchanged otherwise. A case recorded by any run at the commit is not counted this way. Each test file's own reach is still reported. `caseMotion` takes these cases as `retained`.
- ba72ac6: Retired cases that do not read are refused

  `variance covering --cases last` and `variance review` compare a run with the
  cases it retired, kept in the record's `cases.before` section. When that section
  was there but did not decode, the report said the record held none of these
  cases, as if nothing had come before. It now stops with an error that names the
  record and why the section did not read. A record that kept no `cases.before`
  still says there was nothing to compare.
- bea4c97: The skill's producers reference says that the Vitest, Jest and Rstest recording
  seams hand an RTL `watchTest` journal to the case under its attempt, and that a
  run that does not record keeps it out of every record.
- dcb6301: A shard that cut unchanged text differently keeps every other file's cases

  When you land shards with `variance journeys --suite`, or a runner lands a run
  into its record, a module the run recorded from the same source text as the
  record keeps the cases the record held for it, by address, as its coverage rows
  already did. Before this fix, the cases were dropped wherever the two cuts
  numbered a site's seats differently. The same text is cut differently when a run
  reads a file through both its source and its build: that run keeps only the
  regions both readings cut alike, such as a multi-line `await`. The dropped cases
  belonged to test files the shard never ran. CI's coverage comment then reported
  hundreds of regions as having lost every case on a pull request that did not
  touch those files.

  When the texts differ, or one side's text is not known, the numbering still
  decides, as before. `landCases` and `layCases` take the text each held module
  was cut from as a new last argument, which `textsOf(coverage)` builds. A run's
  `modules` on `LaidRun` give its own texts, and `CaseRunFiles.sameText` passes
  the answer to `layerCaseIndex`.
- 8187fb1: `variance select` starts fewer git processes and waits on fewer of them in
  turn:

  - Where the clone keeps its shallow list is asked once per run, not once per
    distance counted.
  - A record made at the merge base is zero commits away, and counting that
    starts no git process.
  - The two directions of a distance are counted at once, and alongside the
    shallow-list lookup.
  - Whether each commit this checkout ran tests at is on the branch is asked
    once per commit, and all of them at once.
  - The merge base with the mainline is asked once, not again for each distance
    measured from it.
  - The top of the checkout is asked once for every diff and commit read from it.
  - The changed files and the untracked ones are listed at once, and the
    untracked ones diffed a few at a time.
  - Every changed `package.json`, and the lockfile at each commit a group of
    tests last ran at, is read by one `git cat-file --batch`, not a `git show`
    apiece.
  - `textAtRecording` reads the paths a jump ahead left unasked in one more
    window, not a process apiece, and asks whether the checkout is a partial
    clone once rather than for each window that answers a path missing.
  - `repositoryRoot` answers a directory holding `.git` without starting git,
    unless `GIT_DIR` or `GIT_WORK_TREE` is set.

  `@variance-authority/sense` exports `textsAt`, which reads paths at several
  commits from one `git cat-file --batch`.
- 3716ab5: `variance select` no longer waits for the code map, the journeys, the
  dependency lexicon and the questions that `variance index` leaves to a process
  of its own on your machine. It reads none of them. It waits only while that
  process brings the index up to date and folds its working layer into its base,
  which it does before the four, and prints `waiting for process <pid> to fold the source index`
  on stderr while it does. `variance index` followed at once by `variance select`
  no longer pays for the follow-ups. Every other command still waits for all of
  them, and the `follow-ups:` line now says the next command that reads them
  waits. When that process ended before it finished, `select` reads the index as
  it stands and leaves the follow-ups to the next command that reads them, which
  makes them as before.
- 4fe70b5: `variance ask symbol` and `ask uses` answer a name a file exports and no entry publishes

  They used to refuse it. `symbol` gives the file and line that export it, the
  line as the checkout holds it, and how many imports resolved to that file, one
  count per file when several export the name. An installed name it matches is
  said after it, since a file that passes an installed binding on exports it.
  `uses` lists each of those imports, within the package as well as from another
  one, read from the source index; an import through an `export *` file and a
  call through a qualified path are not counted. A name nothing exports is still refused.
  `@variance-authority/sense` adds `importersOf`, every import of a name out of
  given files that the source index resolved.
- 55f1bc9: The Playwright and Vitest integrations keep the render cache out of the baseline directory

  The store the `variance` fixture opens, the store `createVariance` and `observe`
  open, and the store the Vitest plugin opens all paint into `renders/` in the
  checkout's cache, where `variance run` paints. Each one prunes that directory by
  the rules `variance run` applies: the fixture when a worker tears down, a
  `createVariance` session when it closes, once per process, and the Vitest
  plugin when the run closes. The baseline directory holds baselines only, so the
  `.variance/baselines/**/by-document/` line in `.gitignore` and a store built only
  to set `cacheRoot` are no longer needed: delete any `by-document/` directory
  left under your baseline root, since nothing prunes it there. A `store` you pass
  in is unchanged. Finding the cache reads the root `variance.config.json` the
  way `variance run` does, so a file that is not JSON, or a `cacheRoot` that is
  not a path, now fails the fixture and the plugin as it fails the CLI.

  `renderCacheIn(cache)` from `@variance-authority/store/durable` returns the
  `renders` directory inside a cache directory, so a store you build can share
  that cache and its bound. `cacheRootFor` from the new
  `@variance-authority/sense/cache-root` entry finds the checkout's cache without
  loading the rest of Sense. `@variance-authority/vitest-browser` now depends on
  `@variance-authority/sense` for it, which installs Sense's parser and resolver
  with the plugin; the plugin does not load them.
- bcc9eaa: The README leads with the runner selecting itself, and the skill shows the edit loop

  `@variance-authority/sense`'s README now opens with a wrapped Vitest or Jest
  run that leaves out what a diff cannot reach once `VARIANCE_AUTHORITY_SINCE` is
  set, and the selection API follows as the way to ask for the skip list
  yourself. Its retirement paragraph describes how a run over an edited module
  reads the edit from both texts, rather than marking every test that ran it.

  The `variance-authority` skill's test-selection reference adds the loop an agent
  runs after each edit, nearest tests first, and says that a wrapped runner
  resolves `@variance-authority/cli` from the project.
- 2de1f7b: `variance share --publish` writes the suite index as `suite-index-v2`, the
  format its bytes are in. It was written as `suite-index-v1`, so a CLI that reads
  only version 1 fetched it and failed to decode it, instead of saying `it holds
  suite-index-v2, a format this version does not read`. `variance share`, and
  every command that reads the mainline's suite index, reads `suite-index-v2` and
  still reads a line that holds `suite-index-v1`.
- 24a1932: `covering --where` narrows the cases listed, not the state

  `variance covering --where` reads the state of a line, a function, a range of
  the file or a changed region over every case that covered it, and lists only
  the cases that said what was asked. A line three cases ran no longer reads
  `alone`, or *the only case that could have*, because `--where` kept one of
  them; a region a stopped case could have reached stays a hole when `--where`
  leaves that case out. `stopped` names every case that could have reached it and
  stopped first, since it is the evidence for the state. In the whole-file text, a
  range none of the kept cases covered says so rather than that no named test
  covered it.

  `formatCoveringChange` takes an optional `state` on each region and words the
  region from it: a region only an unlisted case ran reads *covered only by cases
  not listed here*, not as a hole, and is not counted as nothing covered.

## 0.14.0

### Minor Changes

- b71e2ed: A checkout's record moves onto a newer mainline record its HEAD contains

  A checkout's record keeps a ledger beside it, `coverage.layer.json`: the mainline record it was laid on, and the test files its own runs observed with the commit and working tree each ran over. When `select` or `variance share --suite` reads a newer mainline record whose commit HEAD contains, the record moves onto it, and every test file this checkout did not run reads the newer one. A record of a commit HEAD does not contain changes nothing. The `record of "<suite>":` line names the mainline commit, the distance to HEAD, and the test files this checkout ran.
- 34c5e6b: `variance carry --format github` names the suites given to the share

  When the root `variance.config.json` gives any suite `"carry": "share"`, `variance carry restore --format github` and `variance carry save --format github` print `shared-suites=<name> <name>`: those suites, separated by spaces. A workflow loops over it to read, compare and publish each suite's base record, so it names no suite the config already names. A shared suite whose name holds a space is refused, because the loop reading the line would split it.

### Patch Changes

- 57307e3: A shallow clone no longer prints a distance its history cannot count

  In a shallow clone, `git rev-list --count` stops at the commits the clone was cut at and exits 0 with a smaller number. The distance a mainline lookup prints (`N commit(s) behind the merge base with this checkout`), the `record of "<suite>":` line's `N commit(s) before HEAD`, the merge base a reader uses to pick between mainlines, and how far HEAD is past a branch record all used that number. Each now prints `at a distance this clone cannot count` when the walk between the two commits reaches the cut, and the same number as before in a clone that holds the whole history between them.
- 73fb12d: A diff that a shallow clone cannot read names the checkout that can

  When `variance run --since` or `variance review` cannot read the diff from the base, the error names a checkout of every commit and no trees: `git clone --filter=tree:0`, or `fetch-depth: 0` with `filter: tree:0` on `actions/checkout`. That checkout has an exact merge base. On material-ui it took 20 s and 252 MB, against 14.7 s and 231 MB for a depth-1 checkout; the cost depends on the repository's history.
- a7e7c9e: A changed subject with no difference shape is explained by what the run read, not by its retention

  A run fingerprints the regions of a changed subject whenever its collector gives a semantic snapshot, whatever its retention. When a subject has no shape, `variance_changes`, the PR comment and the review service's changelog page said the run compared without a document, in the ephemeral mode or on a raster-only path. They now say the run read no markup for that subject, or only its accessibility tree changed.
- d567e21: An unattributed change is named by what is missing, not by how it was grouped

  The `title` on the `shape only` marker in `variance report --format html` said the change was "grouped by silhouette alone", as though a change with a component were grouped by more. Every change is grouped by its fingerprint, a digest of the changed pixels that does not include the component. The marker now says that no region with that shape was attributed to a component.

  In the same way, `variance adjudicate` and the `variance_adjudicate` MCP tool named an unclaimed change with no component "(no component resolved; grouped by shape alone)". The line reads "(no component resolved)".

  The `@variance-authority/report` README said a change's fingerprint is built from the component responsible, so the same-looking change in two components stays two changes. It is built from the pixels alone: those two are one change, `accept --shape` on it promotes both, and `change.component` names the first component a region in it was attributed to. The `@variance-authority/tribunal` README's definition of a shape is corrected the same way.
- 58d3332: The help server and `variance serve` describe every source question they answer

  `variance-authority-help --help` said `serve` answers "all six" questions, and the instructions `variance serve` sends an MCP client said "nine"; both serve eleven. Neither states a count now, and the `variance serve` instructions name the two they had left out: which third-party packages a location can use (`docs_stack`) and which code the recorded tests ran around a file (`docs_journey_map`). The verb list in `--help` is padded to its longest verb, so `slowest-tests` and `journey-map` no longer run into their descriptions.

  The READMEs of both packages link the documentation on variance-authority.dev instead of a repository-relative path, which does not resolve where npm shows them.
- b29dd6f: `variance restrictions` outside a git checkout is refused in one line

  `variance restrictions` lists the `.relations.json` files git tracks. Run in a directory that is not in a git checkout, it printed git's own error and a stack trace calling itself a defect in the tool. It now exits with code 2 and one line naming the directory, saying it is not in a git checkout and that `--root` names one.
- ddc33fc: `variance run` no longer refuses to start in a repository that declares more than one suite. Without `--suite`, it does not read where its subjects parted in the source, and its report has no section for that. `--suite <name>` reads that suite's record, as before.
- 8d3d515: The skill states what the commands do now, in fewer words

  An audit checked every command, flag, exit code and quoted output in the `variance-authority` skill against the code. The skill now covers `journey-map`, `stack`, `costs` and `variations`, the per-suite answer of `covering`, and the `--suite`, `--since`, `--diff` and `--limit` flags it left out. It corrects what `ask` reads when the configured report is absent, the exit codes of `adjudicate` and of a `symbol` miss, the `--root` flag `variance ask` refuses, the recording path and read order when suites are declared or the checkout is a worktree, and which MCP tools a server serves. `orient`, `journey-map`, `stack` and `slowest-tests` move to their own reference, and the selection API moves out of the test-selection reference, so a name lookup loads about half of what it did. Text that restated what a command already prints is gone.
- 5dfaa50: The skill tells an agent where to look past the comment above a name

  `symbol` prints the comment above a declaration or, when there is none, the nearest README's passage if it names the name; a docs folder, an architecture chart, a decision record or a wiki is never read. The `variance-authority` skill now routes a question about why a name exists or what it connects to to a new reference, `written-about-a-name.md`. It has the agent search those documents for the declaring file's path and then each parent directory, stopping at the first chart or decision record or at the package root, then for the name and its specifier, then open any address the file names, ask a wiki outside the checkout only through a tool the session already has, and say which places it searched.
- 439b21b: The skill's MCP client config names `variance-authority-help` as its `command`, as the published workspace API page does, instead of a `node_modules/.bin` path.
- 59b4332: Present test evidence in one PR summary, with execution changes first and coverage inventories folded behind disclosures.

## 0.13.0

### Minor Changes

- ebbec80: A call the source leaves short is placed from what the case ran, and no test runner's config is read

  The journeys walk no longer reads Vite's or Vitest's `resolve.alias`. When an import resolves to no function, the walk places the call on the one function the case entered that a file of the checkout exports under the imported name. That is the default export for a default import, and the member for a call through a namespace import. When the import names a workspace package, the function must be exported from that package. An import of a Node builtin, or of a package a manifest declares and no workspace holds, is never placed this way. When several entered functions match, the call is reported as ambiguous, and the walk's other inferences still get a turn. An import that resolves to a function the case did not enter stays where it resolved. `variance index` counts both outcomes in its journeys line, and the orient legend names a recorded caller.

  `@variance-authority/sense` no longer exports `runnerAliases`, `runnerConfigs`, `runnerDigest`, `keptRunnerAliases`, `unlistedRunnerAliases`, or the types `RunnerAlias` and `RunnerAliases`. `NativeJourneysPrepared` loses the `aliased` and `runnerUnread` fields, and `prepareJourneys` on the native binding takes the Node builtin names as a new last argument.
- cbea135: Every base is main's record: `variance select`, `yarn test:since` and a runner of your own measure a change from the record your mainline's CI published, and the primary checkout's record is only the offline fallback.

  `variance share --suite <name>` reads one suite's execution record from its mainline, or with `--publish` publishes it to the line the run belongs to, taking the suite and the share from the root `variance.config.json`, so a repository with no visual project and no run report can share its unit suite's record. A `suite-v1/<suite>` entry carries the runs record beside the execution record.

  A mainline takes the entry only when the whole suite ran at the commit it names. `--collected <file>` names the test files your runner collects, one per line, repository-relative or absolute, as `vitest list --filesOnly` or `jest --listTests` prints them; without it the files git holds at that commit are counted, listed once from the top of the tree. A test standing on an entry at the publish commit counts as run there, and a commit git does not hold is named. A mainline publish that writes nothing exits 2; a branch line, or a run with no line, still exits 0.

  `suiteBase` answers which record a checkout measures from: its own, else the mainline's, else, where no mainline record was ever fetched on this machine, the primary checkout's, with `missed` saying why the mainline's was not read. `variance select` asks it, so a worktree that has run nothing selects from main's record and says `record of "<suite>": read from mainline <name>, published at <commit>`. A fetch is reused for ten minutes and a remote that did not answer is not asked again for ten minutes; past the window, an unanswered remote leaves the record fetched earlier as the base, and the reader names when it was fetched. `variance share --suite <name>` always asks. Each fetch runs the daily cache prune, which keeps the record the last fetch named. `layMainline` copies the mainline's record, its per-case index and its runs record into a fresh CI checkout's own layer; `mainlineRead`, `mainlineMissed` and `primaryRead` are exported beside them.
- 573afba: `variance ask stack --from <path>` lists every third-party package a path can use

  It takes no words. `variance ask stack`, and the `docs_stack` tool on the workspace API server, read the manifest that owns the path and list each package it declares or that the code under it imports: the version, the role (`runtime`, `dev` or `types-only`), how the manifest declares it, and how many times the code imports it, with the first import as `file:line`. Imported packages come first, then the ones declared and not imported, then the ones whose imports were not read. A declaration the resolver could not read is listed with the reason. A page is 40 rows unless `--limit` says otherwise, and `variance ask` takes `--offset <n>` to skip rows. Each page ends with how many rows remain and the `--offset` that asks for the next page. The answer reads only the dependency lexicon that `variance index` writes and opens no installed package. `dependencyStackNative` in `@variance-authority/sense` is the call it makes.
- 573afba: `variance index` refreshes the dependency lexicon from what changed

  Each refresh records what the dependency lexicon was built from in `dependency-lexicon.built.json` beside it: the digests of the source index segments, the files beside `source-index.bin` that hold its data, and the modification time and size of every installed file and `node_modules` directory it read. When all of them are the same at the next `variance index`, the refresh reads nothing and prints `dependency lexicon: unchanged, nothing read: …`; `refreshDependencyLexiconNative` in `@variance-authority/sense` returns `unchanged: true`. When source files changed, `dependency-lexicon.merge.json` lists the import requests each source file writes. The refresh opens only the source index segments added since the record, replaces the requests of a file written again, drops those of a deleted file, and copies every workspace and package pair whose inputs are the same. A source index that does not extend the recorded one, a changed manifest, or a segment whose digest does not match makes the refresh read everything. Either way the lexicon it writes is the file a refresh from nothing writes. Workspaces that resolve a package to the same install share one reading of it, and import specifiers that resolve to the same entrypoint share one entry, so two refreshes over one install write the same entry and a refresh over an unchanged install reuses it rather than reading the package again. An edit that keeps an installed file's modification time and size is not seen until that stamp changes.
- 573afba: `variance index` returns once the source index is written

  Outside CI, `variance index` writes the source index, starts a process of its own for the code map, the journeys, the dependency lexicon and the questions `variance ask` answers from, and returns. Its last line names that process and the log its lines are written to:

  ```text
  follow-ups: the code map, the journeys, the dependency lexicon and the questions are being made by process 48213, and the next variance command waits for it; their lines are written to <cache>/test-selection/<digest>/source-index.bin.follow-ups.log
  ```

  Every later `variance` command waits for that process before it reads anything, and says on stderr that it is waiting. When the process ended before it finished, the next command makes what it left and prints those lines on stderr. In CI, or with `--wait`, `index` makes all four before it returns. `--follow-ups` is what the started process runs, and is refused together with `--wait`.

  The source index is a base and one working layer over it that holds the files changed since the base was written. An update reads again only the files whose bytes changed, rewrites the working layer and never the base, and writes nothing when nothing changed. The started process folds the working layer into the base, writing the two as one new base, once the working layer has a tenth as many records as the base, counting added and deleted files. On Kibana (107,163 files), the update after a one-file edit takes 165 ms over an empty working layer and 220 ms over eleven thousand changed files, and the fold takes 620 ms.

  `prepareCodeMap` in `@variance-authority/sense` and `refreshDependencyLexicon` in `@variance-authority/help` return a promise. `@variance-authority/sense` exports `readySourceIndex`, which folds the working layer into the base, and `@variance-authority/help` exports `refreshWorkspaceFromIndex` and `publishedGeneration`.
- 573afba: `variance ask journey-map` draws the code around a file from the recorded tests that match your words

  `variance ask journey-map --file <path> [--query <words>]`, and the `docs_journey_map` tool on the workspace API server, read the latest recording. They run nothing and open no source. A test is kept when its file path or its name contains any of the `--query` words; with no words, every test that ran the file is kept. The answer says how many recorded tests ran the file and how many were kept, and lists the kept tests smallest first. Then it lists each function of the file with the paths the kept tests took through it. Beyond the file, it lists the functions most kept tests ran, nearest first, and then the functions only some of them ran, grouped with the smallest test of each group. A function beyond the file that at least half of all recorded tests ran is counted and not listed. Every suite with a recording answers under its own name. `journeyMaps(root, file, terms)` in `@variance-authority/sense` returns the map for every suite.
- 573afba: One `variance index` works at a time on a machine

  The update and the follow-ups of `variance index` each use every core, so two checkouts indexing at once, for example a repository and one of its git worktrees, take turns. The second waits for the first, and prints once on stderr which process it waits for and which checkout that process indexes:

  ```text
  waiting for process 48213, which is indexing /home/you/other-checkout: one index at a time uses this machine's cores
  ```

  The update and the follow-ups each take the turn separately, so a short update in one checkout does not wait for the follow-ups of another. The turn is an operating-system file lock at `<temporary directory>/variance-authority-<user id>/index-turn`: a process that crashes lets it go, and two users on one machine do not wait for each other. `variance index` stops with an error that names that directory when it is a link, belongs to another user, or others can write in it; remove it, or set `TMPDIR` to a directory of your own. `@variance-authority/sense` exports `inIndexTurn`, which runs a function in the turn, `indexTurnPath` and the `IndexTurnHolder` type.
- 573afba: `variance layers` gives each package its dependency layer and its tier, and against a base names the packages whose own code changed them

  A package that imports no other package of the repository is layer 1. Any other package is one more than the highest layer among the packages it imports. `variance layers` lists every package by layer, read from the code map that `variance index` writes beside the source index. `variance layers --against <index>` compares the checkout with a source index built at a base. It lists each package whose own dependencies changed its layer, with the packages it started or stopped importing, and gives the number of packages that import it and changed layer only as a result. Packages that appeared or vanished are listed apart. The command exits 0 whatever it finds. With `--format markdown` it prints nothing when nothing changed, and its first line is `<!-- variance-authority:layers -->`, so a CI job can post, update or delete one pull-request comment from it. `--format text` and `--format json` are the other two formats.

  Declare `tiers` in the root `variance.config.json` to also place each package by how much code it pulls in. It is a list of line budgets, largest first, for example `"tiers": [200000, 20000, 1000]`. Each entry is one tier, numbered from 0: here tier 0 is 200000, tier 1 is 20000 and tier 2 is 1000. A package is in the highest-numbered tier whose budget fits its size, so a package of 15,000 lines is tier 1 and one of 500 lines is tier 2. Tier 0 holds every package, whatever its size, so its budget only labels it. The size is the lines of code, without blank lines and comments, in the files the package ships and every file they import, through `import()` and through further imports, up to the imports of installed packages. The files a package ships are its files that are not tests and not used only by tests. Type-only imports are not counted. Nobody writes a package's tier down; its imports decide it.

  With `tiers` declared, `variance layers` prints each package's tier, lines and files next to its layer. When part of a package's code could not be sized, such as a stylesheet, a file the index could not parse or an import it could not resolve, the tier prints as `tier ≤ 1`: tier 1 or a lower-numbered one. It names, once, the packages whose manifest has no `exports`, `main`, `module` or `bin` naming a file of theirs, because their shipped code is then taken to start at the files the package's own code never imports. Against a base, it reports tier changes the same way as layer changes, with each package's own lines before and after.

  `variance ask orient` numbers dependency layers from 1. The code map format changes, so a checkout indexed by an earlier version has no layers to read until `variance index` runs again. `packageLayers`, `layerMoves`, `tierMoves`, `declaredTiers`, `parseTiers`, `tierOf` and `tierLabel` in `@variance-authority/sense` are what the command reads.
- 573afba: `variance restrictions` checks imports, import chains, layers and package sizes against the rules in `.relations.json` files

  A `.relations.json` is a list of rules, or an object whose `rules` is one. A rule is `{ "from": …, "to": …, "type": "allowed" | "restricted", "message": … }`, where `from` and `to` are a folder, a glob or `*`, written relative to the directory of the file. It is the `restrict` rule of `eslint-plugin-relations`, written as JSON and checked over the imports in the source index. For each import, every tracked `.relations.json` in the directory of either end, or in a directory above it, applies. The deepest file is read first, the first rule that matches decides, and an import no rule matches is allowed. `variance restrictions` prints each restricted import with the rule file that decided it and exits 1 when anything is restricted, 0 when nothing is. `--format json` prints the findings as `violations`, `chains`, `capped` and `tiers`.

  Three more kinds of entry are checked:

  - **`"transitive": true`** on a rule checks it along chains of imports, type-only imports included: from each file a package ships to every file its imports lead to. A test file never starts a chain. Each finding is the last import in the chain, the one into the restricted file, because that is the line to change. It is printed with the shortest chain and the number of shipped files that lead to it.
  - **`{ "for": "packages/*", "maxLayer": 5 }`** fails the check for each package under `for` whose layer is above 5, as `variance layers` numbers it. When several entries name one package, the lowest ceiling decides.
  - **`{ "for": "packages/*", "maxTier": 1 }`** fails it for each package whose size is over the tier 1 budget of the `tiers` in the root `variance.config.json`, the second entry of that list: 20000 for `[200000, 20000, 1000]`. When several entries name one package, the smallest budget decides. A package whose measured lines fit the budget, but with files that could not be sized, is printed as undecided and does not fail the check.

  A transitive rule or a `maxTier` stops and asks for `variance index` when the code map was built from an older source index. The command refuses, with the file and the rule number, an entry that mixes `for` with `from`, `to`, `type` or `transitive`; an entry with both `maxLayer` and `maxTier`; `maxTier: 0`; a tier the config does not declare; and any `maxTier` when the config declares no `tiers`. `relationBetween`, `chainBetween`, `restrictedImports`, `restrictedChains`, `cappedLayers`, `cappedTiers` and `shippedFiles` in `@variance-authority/sense` are what it reads.
- 573afba: `variance review` follows a changed installed package to the files that import it

  When the change moves an installed package, the review lists each one with the chains of packages that lead from it to the files that import it, how many files depend on it, and how many test files run them: `` `pkg`: N files depend on it, and M test files run them. `` A package nothing here imports, directly or through another package, is named on one closing line. The block is printed in both the text and the markdown formats, and `--format json` gives it as `packages`.
- 573afba: `variance review --format markdown` names the changed functions no case ran

  The comment opens with up to five changed functions that no recorded case runs, and folds the rest: the places where no case ran, the cases that ran each changed function, and a Mermaid graph of the changed functions with an arrow from a test file only where its cases call into one. That graph replaces the diagram of test files and directories. When the record was taken before the change, the heading reads "What this change might do", and the cases listed are the ones that ran the changed lines as they stood then. In `--format json`, each changed region lists the test files and the cases that call it as `tests` and `called`, and `record` says which reading the review gives: `ran` or `before`. The text format is unchanged.

### Patch Changes

- 50fcb44: `variance coverage --format markdown` answers a change no suite loads in one sentence: which files changed since the base was recorded, and that no suite loads them. It prints this when every suite has a base recorded at one commit, no suite's count changed, and none of the changed files is a module, a test file or a harness file a suite loads. Otherwise it prints the whole report. The line about the source index now uses whole sentences, and the harness column is named for the test harness. `variance review` no longer lists a test file under "Not compared" when the case index holds no case of it, such as a browser suite whose every case is skipped on a machine with no browser. The text format is unchanged.
- af7e1b5: `variance journeys <shard>...` now writes `coverage.runs.json` beside the snapshot it lands. Before, it left the record describing the runs before the landing. The fold counts as one run at the shards' commit and follows the same rules as `landRun`. At a new commit, `standing` is carried forward from the record it replaces, and `over` names the commit the snapshot stood at. A test that record cannot place is listed in `standing` at that record's `over`, marked `assumed: true`, and carried there, so a later run's `over` no longer moves where `test:since` reads it from; `test:since` reads an assumed entry as an assumption and says so. A test that last ran at the commit a run lands at, and that the run did not observe, is listed there rather than left out. At the commit the record already names, the fold's test files are added to `files` and `over` is kept. `over` is written whatever the history between the two commits, without asking git, so a landing outside the checkout records the same thing as one inside it. `variance review` now asks git, where it runs, whether the runs' commit descends from `over`. When it does, the change is read from `over`. When it does not, as when the main line's shards land over a branch's runs, the review takes the path it takes for runs laid over nothing: the mainline record, or a refusal. When git cannot say, because the clone does not hold `over` or is shallow and its history between the two is cut, the review is refused, naming the commit to fetch. A record with no `commit` is asked about the checked-out commit. A record whose `over` is its own `commit`, which a first run at a snapshot already at that commit writes, starts there. A record whose commits are not full object names is refused. The review sets `GIT_NO_LAZY_FETCH`, so git 2.45 or later never fetches `over` from a partial clone's remote; older git ignores the variable, and a partial clone that lacks `over` fetches it from its promisor remote when asked. A snapshot at the run's commit beside a record of another commit is read as a landing that renamed its snapshot and not its record: the run names the commit the record names as `over`, and carries `standing` from that record, so landing again repairs the runs record. The same shape is left by a snapshot landed by an earlier `variance journeys`, which never updated the record, and by a snapshot restored without its runs record beside an older one: the first run at the snapshot's commit then starts at the commit that record names, and a review whose runs do not descend from it takes the path runs laid over nothing take. Outside a checkout, where neither names a commit, no start is written. A runs record the landing cannot read is written afresh, as `landRun` writes one, and the landing names it on stderr. The record is staged and renamed under the snapshot's lock, like the snapshot. A landing that fails leaves both unchanged. `@variance-authority/sense` exports `commitRunsAfter` and `writeCommitRuns`, the rules and the write `landRun` uses, and the `RecordedTests` type they read.
- b3c1bdf: `variance ask uses` and `ask symbol` answer for a name that no entry publishes but that another package imports by the path of its file, such as `addTax` from `@acme/lib/src/internal/math`. They no longer refuse it. Each import is listed with its file and line and marked as a deep import, past the entry the package declares, or as an import by path from a package that declares none. `symbol` also says where the name is declared and why nothing publishes it. A name that is exported without being published and that nothing imports is still refused, and the refusal names the file and line that export it.

  A workspace package with none of `exports`, `main`, `types` or `typings` is no longer skipped. `ask packages` and `ask entrypoint` list it by the files and names other packages import from it, each with the importer's file and line, and none of those imports are called deep. A `.js` `main` with no `types` and no `.d.ts` beside it opens at the `.ts` or `.tsx` source of the same stem, as TypeScript reads it.
- 59be40a: A pnpm workspace's packages open, and `reach` walks past a file the diff deletes

  A root manifest with no `workspaces` reads its members from `pnpm-workspace.yaml`, so `ask entrypoint --package @mui/material` answers on Material UI. The list is read as YAML and its entries as globs, so an entry starting with `!` excludes what it matches, a `**` glob reads every member under it, and a list written at its key's own indent, in flow style or under a byte-order mark reads the same as any other. A member two entries match is read once. A bare `.js` export opens by the `.d.ts` written beside it, and a published name followed through a JavaScript module reads that declaration. A workspace that publishes no package says so in a sentence, where it printed an empty list.

  `variance reach --since <ref>` takes the files the diff deletes out of the walk and names them on stderr. A diff that only deletes refuses, and the refusal names the deleted files.
- a91e761: A test run recorded over an edit keeps the text it ran over

  A run's line ranges count lines in the text on disk while the suite ran, and the commit the recording names holds a different text whenever the tree was dirty. Selection used to charge every region of such a module and ask for a recording over a clean tree, so the ordinary loop — edit, `yarn test`, then revert or commit — ran every test that ever entered each file it touched. On Zod that was 2 of 199 test files skipped where 197 could be.

  Landing a run now keeps the text of every recorded module git reports as changed, in the cache under `.texts/`, named by the digest the recording already holds. `variance select`, `variance covering` and `yarn test:since` read a change to such a module from the kept text to the text on disk. A module is still charged whole when its text was not kept: edited again while the suite ran, or the cache cleared since. The note then says so, and that the next run that loads the module records it again.
- db025cb: A worktree's first run, or its first landing, seeds a runs record beside the snapshot it copies from the primary checkout: a copy of the primary checkout's runs record, with no run of the worktree's in it. So after partial runs in the worktree, a test it never ran is read from where the primary checkout's record says it last ran, and is selected once a change reaches it. A test that record does not place is read from where its runs started and reported as assumed, in the worktree as in the primary checkout. When the primary checkout has no runs record, or one naming another commit than its snapshot, nothing is seeded. `variance review` in a worktree that has not run still asks for `--since`, and the worktree's first run at the primary checkout's commit starts its own change rather than counting as another run of the primary checkout's.
- 573afba: A git worktree that has not recorded reads the primary checkout's record

  In a worktree whose own cache layer holds no record, `variance select`, `covering`, `coverage`, `review`, `journeys` and `ask orient` read the record, and the case index beside it, from the primary checkout's layer. For a suite with `carry: share`, `select` says so: `record of "<suite>": read from the primary checkout, because this worktree has recorded none of its own; kept at <path>; the mainline's is read only when neither has one`. The first test run in the worktree copies the primary checkout's record, and the case index beside it, into the worktree's own layer and records on top of the copy, so the worktree's case index starts with the cases of the whole suite. The runs log is the worktree's own, because it says where this checkout's change starts, so `review` in a worktree that has not run asks for `--since <ref>` rather than starting where the primary checkout's runs did. `variance journeys`, given shard snapshots, merges them into the worktree's own layer, and the first such merge starts from the same copy.
- 2f75494: `review --since` compares only the test files a run before this commit recorded

  After a whole run into an empty cache and a selected run at the same commit, `review --since HEAD` reported every region the unselected files entered as gained: 231 on TanStack Query, 153 on Zod, where nothing moved. A run laid over no case index now names its files as having no base until a run at the commit runs them again, and `review` leaves them out of the comparison and lists them: "Not compared, no case of these was recorded before this commit's first run".
- 9d9c635: `variance select` no longer skips a test that a partial run left out when a file it entered changed after it last ran. It reads each test from the commit `coverage.runs.json` says it last ran at, reads the files changed since then whole for that test, compares the install at that exact commit, and prints a note for each such commit. When the runs record does not say where a test last ran, the note says which commit it was read from instead. A test file that is no longer on disk is left out of the reading and named in a note; a test git does not list, such as a generated or untracked one, is still read from where it last ran. An install that cannot be compared, because git cannot resolve the commit it is compared from, skips nothing. A patch handed in with `--diff` is read as the whole change, and a note says so when some test last ran before the journal's commit. `readCommitRuns` refuses a `coverage.runs.json` that is there and cannot be read, or is not a JSON object, with an error that names the file; `variance select` refuses it too, except under `--diff`, where it leaves out the note and says why. The lockfile in the working tree is read and parsed once per selection. `@variance-authority/sense/test-selection` exports this reading as `standsAt` and `readingFrom`, with `askPerStand`, `withoutFiles` and `wholeEntry`, and `yarn test:since` uses the same code, so both read a `standing` entry marked `assumed` as an assumption and say so. A runner's `landRun` and `variance journeys` write a `coverage.runs.json` they cannot read afresh and name it on stderr, through `heldCommitRuns`, which is exported with the `StandingEntry` type of a `standing` entry.
- 573afba: `variance journeys` lands each shard's case index with its snapshot

  `variance journeys`, given shard snapshots, merges them into the record this checkout reads, which is landing them. It now also merges the `<coverageFile>.cases.bin` beside each shard into the case index beside the landed snapshot, replacing the cases of every test file that shard ran to the end, and `covering`, `coverage` and `review` answer from the result. The landing prints `cases of N snapshots laid over <index>`. A shard that ran a test file to the end with no case index beside it removes the index, and the landing says why. When another process holds the record's lock, nothing is written and `journeys` exits non-zero with `nothing landed at <path>: another process is holding <file>.lock. Land again once that run ends.`

  `@variance-authority/sense/test-selection` exports `landCaseIndexes` and `withIndexLock`, the two a landing of your own needs to write the snapshot and its case index under one lock. The Storybook and Playwright recorders merge a run's cases into the case index rather than replacing it. When another process holds the case index lock, they keep the snapshot they wrote and print `variance-authority recorded this run's files, but not its cases: …`. Every reader opens the case index beside the snapshot it reads.
- 573afba: `variance review` compares only the test files a run at this commit wrote to the case index, and its markdown fits in one GitHub comment

  A test file is compared against the base only when the last run to write the case index wrote its cases at this commit. A test file the runs at this commit ran, and the case index holds a case of, but whose cases that last run did not write, is not compared, and the review lists it: `Not compared, no case index was written at this commit for: …`. When that last run was at another commit, no file is compared and every such file is listed. A test file the case index holds no case of is not listed, because there is nothing to compare: for example, a browser suite whose every case is skipped on a machine with no browser. In `--format json` those files are `motion.unwritten`, and `motion.lastRunUnread` names the file of the last run when it cannot be read, in which case nothing is compared. The markdown lists 40 moved regions and 40 test files, and says how many more `--format json` lists. A comment longer than GitHub's 65,536 characters is cut with every open fold and code fence closed, and a line saying how many characters are not shown. `variance comment` closes folds and fences the same way.

## 0.12.0

### Minor Changes

- 509e699: `variance coverage` lists the files no suite recorded. The source index now stores each JavaScript and TypeScript file's bytes, lines of code and the regions the instrument would cut from it, so the report adds a `source:` block: how many product files are in scope, which of them no suite recorded, by directory, and a second ratio over every region in that source. The files the test harness loads, which are what the preconditions every test declares reach through their imports, are listed apart as before reach, counted within the scope's own entry points, and counted as run in that ratio, which says what share of the run they are. Without `--from`, the source is what every declared directory's entry points reach, and each directory gets a row of its own. `--packages` gives every workspace the root `package.json` names a row, counted over its own files and over everything they import. `--from <dir>` measures one part of a monorepo apart: what the directory's entry points reach along its imports, with shared packages it imports included. Entry points are declared in the root `variance.config.json` under `entrypoints`, for example `{ "packages/apps/next": ["app/**"] }`; a directory with none declared starts from every file under it. `sourceScope`, `fileSizes` and `matchesGlob` in `@variance-authority/sense`, and `parseEntrypoints`, `declaredEntrypoints` and `sharedPreconditions` in `@variance-authority/sense/test-selection`, are what it reads. The source index format moves to version 14, so an existing index is rebuilt once.
- 4bea04c: A region an edit beside it renumbered, such as the second of two callbacks after the first was deleted, is no longer read as one region lost and another gained. Siblings of the same name are paired by their cases first, and `caseMotion` returns the ones it paired this way as `renumbered`, which the motion text counts on a line of its own. Each test file's line now names the functions it entered and left, grouped by file, instead of a count of regions. `variance review --format markdown` draws the same motion as a Mermaid diagram, from test files to directories, above the folded text. `variance review --from-run <run id or URL>` downloads the `variance-review` artifact with `gh run download` and prints the review the run made.
- 63751d2: `variance ask orient --files` names the calls into and out of each file

  `variance index` now walks each case of the latest recording over the static call graph and writes the result beside the source index. `orient --files <path>[:<line>]` reads it: for each file, the functions the most cases ran, the functions in other files that call into it and those it calls, each with its case count and how the call is known, and the package flows those cases take through the file. With a line, the calls narrow to the function holding it, and a line written after the recording says so. When the recording or the index changed after the walk, the answer says `not prepared` and why, and never answers from an older walk. The walk resolves an import the way the test runner did, through each Vite or Vitest config's `resolve.alias`.

### Patch Changes

- 7b9e936: `variance coverage --format markdown` leads with the share of loaded regions that ran, with an arrow and the change in points when there is a base. The table of what the regions the suites loaded ran has a share column and a mark per row (🟢 run, 🟡 one kind alone, ⚪ only at load, 🔴 no suite). The source line states its share first; the files no suite recorded, by directory, and the test files whose regions changed most are folded under summaries that count them. A suite with no base is printed as a note. The text format is unchanged.
- c15251a: `variance review --format markdown` leads with what the table adds up to, as a GitHub alert: a warning when changed regions have no case that covers them, a note when some are covered only from further away, a tip when every one is covered by a test that imports its file. The changed-regions table marks each row (🟢 near, 🟡 far, 🟠 unplaced, ⚪ loaded, 🔴 no case). A line says how many of the suite's test files ran at this commit and names `variance select --since <ref>`, which lists the files a change reaches. The edits, the cases, the files not in the record, the cases changed against the base and each changed file are folded under summaries that count them. The text format is unchanged.

## 0.11.0

### Minor Changes

- c2c4a55: `variance coverage` counts how much of the code your suites load each declared suite runs, from the case index each suite already records: one share per suite, all over the same total, how many regions more than one kind of suite runs, and how many only one kind runs. With a base, which is each suite's mainline record in the share, or `--suite <name> --against <record>`, it prints each count at the base and now, and the regions gained, lost, written and deleted that add up to the change. `--format markdown` prints a table for a job summary. It exits `0` whatever the numbers are. `countCoverage` and `coverageChange` in `@variance-authority/sense/test-selection` are the counts it prints.
- 7556a03: The cache is inside the checkout. Without `cacheRoot` in `variance.config.json`, it is `node_modules/.cache/variance-authority` at the repository root, so a coding agent whose sandbox allows writes only in the working tree records and reads the same cache as your terminal and CI. `XDG_CACHE_HOME` is no longer read; `VARIANCE_AUTHORITY_CACHE`, an absolute path, names the cache directory for a harness that keeps its runs apart. A recording under `~/.cache/variance-authority` is not read, so the first `yarn test` after upgrading records again. `variance index` also publishes the value `variance ask` answers from, so `ask search` answers in a fresh checkout, and prints a `questions:` line saying where it is or why it could not be written. [The cache](https://variance-authority.dev/docs/cache) page describes the order.

  `readWorkspace` in `@variance-authority/help` takes `packs`, whether the scan reads bytes from Git's object store, and `saveIndex`, whether publishing also writes the scan's records back to the source index; `variance index` turns it off, because it has just published that index itself.

### Patch Changes

- 2418e90: Instrumented code, worker journals and module records name every module by its repository-relative path, and the cache no longer keeps `names.bin`. Every record file already stores its paths in its own sorted table, so a `coverage.bin` or `journeys.bin` reads the same on any machine and needs no table from the one that wrote it. A Jest run no longer transforms a file a second time after its first recorded run, because the module's id is no longer part of the transform's cache key. The first run after upgrading transforms every file once, as Jest's cache key changes.

  A worker journal whose module row carries a number, and a module record filed under one, are no longer read: nothing writes either. The native addon is now installed by renaming a copy over the old one, because macOS kills a process that loads a `.node` file rewritten in place.
- 56282b1: `variance index` exits `2` with `source index not written: <reason>, at <path>` when the file system refuses the index, instead of reporting it built. `updateSourceIndex` returns the refusal as `refused`; a scan anywhere else still treats an unwritable cache as a cold next run. A `variance ask` question no longer narrows the source index it reads: a workspace whose path runs through a link, such as a checkout under macOS's `/var`, is scanned whole, and a scan of only some of a repository's directories publishes its answer without writing over the index of the whole. Before, either one could leave `variance select` unable to trace a lockfile bump to the tests it reaches.

## 0.10.0

### Minor Changes

- 86e9f94: `variance select` and `variance review` read the record your mainline published when the root config gives the suite to the share with `"carry": "share"` and your checkout has no base of its own: `select` when the suite has no recording here, and `review` when the runs here were laid over no recording and no `--since` names a start. The record is kept under `<cache>/share/read/<suite>/<commit>/`, never where the suite records. `select` says on stderr which record it read, and its `--format json` journal adds `from`, `mainline` and `distance`. `review` starts at the commit the mainline published at and compares cases with that record's; for a record published past the merge base it starts at the merge base, names both commits, and leaves the record's cases out. Its `base` is `mainline`, with a `mainline` field naming the line, suite, commit, distance and kept path. When the mainline's record cannot be read — a share section that does not parse, a share that refused or could not be reached, a record that cannot be kept, or one that does not read, names no commit, or was recorded at a commit other than the one it was published at — a note says so and what the share answered, `select` skips nothing, and `review` is refused with the same note. A per-case index that does not read is named and left out. The record a branch published to its `branch/<name>` line is never read. `@variance-authority/sense/test-selection` exports `rootConfig`.
- 947337c: A test-selection recording keeps each test file's and each test case's duration as its runner reported it

  The coverage file gains a `tests.duration` column: the whole milliseconds Vitest, Jest or Rstest reported for the file, or the `duration` you pass to `startRecording().finish()`. The case index gains the same column for each case: Vitest's task result, Jest's assertion result, Rstest's test result, or the `duration` of a case in the `cases` you pass to `finish()`. A file or case the runner reported nothing for has no duration, never zero, and recordings written before this open with every duration absent.

  `variance ask slowest-tests` (`docs_slowest_tests`) lists the files, then the cases, the latest recorded run spent longest in. `--from <path>[,...]` keeps the tests declared under those paths, `--to <path>[,...]` keeps the tests the recording says entered code in them, and the two combine; counts are within that scope, a `to` path the recording has no row for is named as unrecorded, and a path in neither the recording nor the checkout is refused with the nearest recorded path. `recordedDurations` and `recordedPaths` in `@variance-authority/sense` are the reading behind it. `didYouMean` and `nearest` move to `@variance-authority/mcp/tools`, so both binaries suggest a name the same way.
- 486caa3: Declare the test suites your repository runs, each with its kind, under `suites` in the root `variance.config.json`: `{ "suites": { "unit": { "kind": "unit" }, "stories": { "kind": "visual" } } }`. The kind is one of `unit`, `integration`, `e2e` and `visual`. Each declared suite records on its own, under `suites/<name>/` in the cache, with its case index and runs log beside it, so a run of one suite never replaces what another recorded. A worktree seeds each suite from the same suite in the primary checkout.

  Every recording integration takes a `suite` option: the Vitest, Jest and Rstest seams, `startRecording`, `recordExecution`, the Playwright reporter and `varianceExecution`, and the Storybook collector's `tests`. Once `suites` is declared, a run that names no suite, names one the file does not declare, or names both a suite and a `coverageFile` stops before it starts. A repository that declares no suites keeps its one record. `testCoverageFile` and `readableTestCoverage` take `{ suite, cacheRoot }` as their second argument, where they took a bare `cacheRoot` string, and `declaredSuites`, `parseSuites`, `recordFileFor`, `SUITE_KINDS` and `SuitesError` are exported from `@variance-authority/sense/test-selection`. The CLI refuses `suites` in a config file below the repository root.
- 6088ea6: `variance carry restore` and `variance carry save` print what a CI host moves between jobs: the path, the cache key and the restore keys of every artifact whose `carry` is `actions-cache`, plus the report, images and review directory to upload. `--format github` writes them as step outputs, so a workflow passes them to `actions/cache` and names no path the config already names. Only a push to a mainline saves a recording. On any other run, and when no mainline can be found, `carry save` prints no key for it and says why.
- 79173c4: `variance covering` asks every suite the root `variance.config.json` declares, and answers under each suite's name and kind: a suite that never loaded the file is refused as `unloaded`, and one with no recording as `unrecorded`. `--suite <name>` asks one record alone.
- 8aedf2f: `variance select`, `variance run --since` and `variance journeys` take `--suite <name>`. Once the root `variance.config.json` declares suites, each of these commands reads one suite's record: the one `--suite` names, or the only one declared. With more than one suite declared and no `--suite`, the command stops and lists the suites. Passing `--suite` together with `--execution` or `--into` is refused, because both name the record.
- 25297df: `variance ask orient` takes the files you already have, and searches no text

  `orient --files <path>[,...]` (`files` on `docs_orient`) answers each file in the order you gave it: its package, or that the source index does not hold it, then what those packages take from other packages and what other packages take from them, and the recorded cases that ran each file. `--query` is gone: finding a file is what `search`, `symbol` and `grep` are for, and a call without files names them. Nothing in the answer reads a file's text, so it no longer runs `git grep` over every tracked file once per word.
- 6e5d53a: A file-backed baseline store files each baseline under a directory named for the renderer identity that painted it: a digest of the renderer, engine, platform, scale and fonts. That directory is now named `v1-<hex>`. It was named with the digest as written, `v1:<hex>`. NTFS refuses a colon in a file name, so a baseline root that still holds a `v1:` directory cannot be checked out on Windows, and `actions/upload-artifact` refuses to upload it. The render cache, which is in your cache directory unless `cacheRoot` says otherwise, now uses `v1-` for its identity directories and for each entry's file name.

  A store treats `v1:<hex>` and `v1-<hex>` as the same identity and reads both. When `v1-<hex>` has no baseline for a subject, the store looks in `v1:<hex>`. A baseline under another machine's identity, in either spelling, still makes the subject `incomparable`.

  `variance accept` writes each subject it accepts under `v1-<hex>` and deletes that subject's copy under `v1:<hex>`. It does not touch a subject whose pixels did not change, so a baseline that never changes stays under the old name, and the root stays unreadable on Windows until you move it. For each `v1:` directory, `variance doctor` prints how many baselines it holds and the `v1-` directory to move them into. Move the files with `git mv`. Render-cache entries under the old names are never read again, and the sweep every run applies to the cache deletes them.

  `@variance-authority/core/format` exports `digestFileName`, which spells a digest as a path segment, and `digestOfFileName`, which reads a digest back from either spelling.
- 700f1de: `variance review --suite <name>` reads the record of the suite you name. Without it, `review` reads the only suite the root `variance.config.json` declares, and refuses when several are declared, the same rule `select` and `run --since` follow.
- 7b431e0: `variance review` says what a change did, after the suite ran it: how each changed module was edited, the changed regions no case covered and those only tests further than one import away covered, the cases added and removed, the changed files the tests declare as preconditions, and the installed packages the lockfile changed. It prints `text`, `markdown` or `json`, and `--out <dir>` also writes `review.json` and `review.md`. The markdown starts with a hidden marker line, so a pipeline edits its own pull request comment instead of posting another.

  Every run of the suite now writes `coverage.runs.json` beside the recording: the commit it ran at, the commit the recording stood at before the runs at that commit, and the test files they ran. A retry or a second shard at the same commit keeps that starting point. `variance review` with no `--since` starts there. `commitRunsFile`, `readCommitRuns` and `landRun` read and write it from `@variance-authority/sense/test-selection`, and `testsGovernedBy`, which names the test files that declare a given file as a precondition, is exported beside them.
- 6b4a6b8: A pull-request comment now groups subjects that have no baseline under one reason instead of listing each subject as its own cause. The reason for `new` and `incomparable` no longer repeats the subject id, which every line already shows: `no baseline under this renderer; nothing to compare against`.

  `variance report --format html --embed-images` writes the report as one file with its images inside it, so it opens anywhere, including on a phone. On GitHub Actions, upload it with `actions/upload-artifact@v7` and `archive: false`, and the artifact link opens the page instead of downloading a zip.

  `variance comment --to-accept <text>` tells the reviewer how to accept in your repository. When `--run-url` is given, the comment links the report and no longer prints the `variance report --subject <id>` command, which needs the report on disk. The GitHub action takes `to-accept` and `report-page` inputs. `report-page` writes, uploads and links that page.

  The comment now fits a phone's first screen: the count, the leading cause and its file, the report link and how to accept, then any font warning as an alert. The causes, the collateral count, what was skipped and what painted the images sit under one `<details>` fold.

  In the HTML report, each subject's commands (`accept`, `again`, `alone`, `report --subject`) sit folded under **Commands for a checkout**, each with a line saying what it does. The mark on a subject whose inspection found nothing reads `no defects found`. On a narrow screen the header scrolls away instead of staying pinned.

  On a phone, the HTML report shows each subject with its reason and images, and nothing else. The grouped changes, region tables, commands, composition, history, settled subjects, what was not observed and coverage stay on wider screens. A line at the top names the ones this report holds, so you know there is more.

  `variance comment --image-root <url>` shows the leading cause's before and after on the comment's first screen, and each further cause's pair in the fold. The address is where you published the report's directory. The GitHub action takes an `image-ref` input that pushes those images to a ref outside `refs/heads/`, as one commit, and links them by that commit.
- 3d15479: A Storybook run's recording times each story with the time the run spent on it

  The run hands its collector the time it spent on each subject, from the first collection to the decision, as the collector closes — `close(costs)`, where `costs` maps a subject id to whole milliseconds. The Storybook collector records that figure as each story's duration, on the story's row and on its case, so `variance ask slowest-tests` ranks stories by the same time `variance ask costs` reports and the next run shards on. A story read more than once is timed once, and a story the run did not time has no duration.
- e6d586a: Runs at one commit add to `cases.before.bin` instead of replacing it, so a suite split over several invocations keeps the replaced cases of every file it ran. `cases.last.json` names the commit those cases were recorded at under `before`, and drops it once a run at the same commit runs a file again, because that file's replaced cases are then the commit's own. Its `files` lists every test file the runs at the commit announced.

  `variance review` compares with those cases and leaves out, and names, what the base's branch changed after their commit. `--against` is no longer needed in a pipeline, and no copy of the case index is either. `variance covering --cases last` names that commit too.

### Patch Changes

- 5c970a8: `variance share --publish` publishes a suite's record only under the commit the record names, because its regions are line numbers in that commit's text. A record made at another commit, one that names no commit, and one that does not read are left out, and the publish names each with the reason: `left out suite-v1/unit: its record at <path> was recorded at <commit>, not at <commit>.` The rest of the run is still published.
- 6b3642c: `share.token` is read from its environment variable when a share command reads it, not when the config loads. A job without that variable still loads the config and runs, and `variance share`, `variance ask` and `variance serve` report the share as unconfigured, naming the field and the variable. When no mainline is known and a run's branch was written to its own line for that reason, `variance share --publish` says so and names the answers that were missing; a pull request's line is its head branch either way, and it says nothing of the mainline. When it writes the report, it also says how many images the report names that this machine could not read, and names the first. `createDirectoryLineCell` answers an entry or image path that resolves outside its root as `refused`, from `store` and from `blob`, and the detail names the path.
- 46bc11b: An import into a `build/` directory Git tracks lands on the file it names. The scan already read a tracked `build/` as source, but it declined any resolved target under a directory named `build`, so an import such as `./build/build` in Docusaurus's `src/commands/cli.ts` kept its specifier under `unresolved`, and an edit to that command reached nothing that imports it. A tracked `build/` file is now a target like any other, whichever way the scan reads the tree. An import of one that your change adds or removes lands on the same file, so selection walks from it when it asks the `sideEffects` field what loading it does. A `build/` your `.gitignore` covers stays declined, a scan with `digests: false` declines every `build/` because it does not ask Git, and `dist/` and the other output directories stay declined whatever Git tracks. Stored records are read again once, because records change where they point.
- c9852fa: A tribunal serves the share under `/share/`, so an `http` share whose `endpoint` is `<deployment>/share` stores its lines there. The ingest token reads and writes it. The new optional share token (`shareToken`, `SHARE_TOKEN` on Cloudflare, `VARIANCE_TRIBUNAL_SHARE_TOKEN` for the Node executable) only reads it. Every other route answers it with 403, except `GET /version`, which answers every token. The review token is refused under `/share/`. A manifest is replaced only on the version it was read at, so two writers publishing to one line keep both sets of entries. A manifest write with neither `If-Match` nor `If-None-Match` answers 428. `createTribunalRoutes` exports `PUT`, and `authorize` may return `'share'` when `tokens.share` is set. `R2Like.put` takes R2's `onlyIf` and returns the written object's `httpEtag`. The API version is 3. The note `push` prints about an older deployment names every capability it lacks, and names the share only when `PushOptions.share` is an `http` share under the deployment's endpoint, so a push to a deployment at API 2 whose share is elsewhere prints no note.
- fd1f3fc: An import that resolves into a workspace package's built output is read as the source file it is emitted from, taken from the `outDir` and `rootDir` the package's `tsconfig` names. A workspace whose manifests export only `./dist/index.js` now has file edges between its packages, so `variance reach` walks from a changed source file into the packages that import it, and the answer is the same whether or not the packages were built. Output whose source was deleted is not a target. A config that sets `noEmit` is skipped, so a package that type-checks with `tsconfig.json` and builds with `tsconfig.build.json` is read through the second. When two configs write into one `outDir`, the first whose `rootDir` holds the source answers. A config that sets `emitDeclarationOnly` maps only declarations, so code a bundler writes beside them is read as it is. A package under `node_modules` is never read this way. A `sideEffects` pattern that names built output, such as `./dist/register.js`, matches the source it is built from. Stored records are read again once, because the rule is part of their key.
- 6a62a0c: `variance carry` names where the baseline store sits on disk: `baselines-root` under `--format github`, and a `baselines:` line in text. A host step that commits what an accept wrote stages that directory, whichever carrier moves it. A `remote` store prints none, because the checkout does not hold it.

## 0.9.0

### Minor Changes

- fce1fd6: `variance covering --format refs` numbers each case once and names every range's cases by number

  The table at the end lists each test file once with its cases under it, and a
  range reads `1-5 walked: 1,3-11,2*`, where `*` marks a case that was inside only
  while the module evaluated. The text answer names each test file once, prints
  a case's id only when it is not the file and the name, and a range walked by
  cases already listed points at the range that listed them.
- be8f5fa: `variance covering --since <ref> --against <record>` says which regions a change's tests moved

  Two case indexes are compared region by region, and each region whose cases
  moved is lost, hidden, thinned or gained. Each test file says how many regions
  it now enters and no longer enters. The files the base branch changed after the
  base was recorded are left out and named. `--cases last` makes the same
  comparison against the cases the last run replaced. `--format refs` names each
  moved region's cases by number. `caseMotion` in
  `@variance-authority/sense/test-selection` is the comparison, and each region
  carries the cases at both ends as the records hold them.
- 2f0b151: A changed JavaScript or TypeScript file whose edit is a comment, a type or formatting no longer seeds the file-graph walk. `variance reach` leaves it out of the list and names it on stderr, and refuses a diff made only of such files. `variance run --since` reaches no component through it and no longer runs the whole suite over it. `runsAsBefore` in `@variance-authority/sense/test-selection` reads, for each file of a diff, which of its exports changed since a commit; an empty list is a file that runs what it ran.
- b48283a: `variance covering` names a line's test files with their share, and `--hops` orders them nearest first

  A line or function answer carries `files`: each test file once, with how many of
  its cases went through the line out of how many it declares. `--hops` adds each
  file's import hops and sorts the files by them, so an editor can list thousands
  of cases as a few hundred files, the nearest on top.
- 9b0c94d: `variance covering --cases last|<test file>` answers from the chosen cases instead of the whole suite

  `last` is the run that wrote the case index last. A test file is every case the
  index holds for it. The answer starts by saying which cases it was read from,
  and `--format json` names them under `scope`. `caseLayerFiles` in `@variance-authority/sense/test-selection` names
  the files beside the index that record the last run and what that run replaced.
- 2958674: `variance reach` and `variance run --since` walk from the exports a JavaScript or TypeScript edit changed, not from the whole file. A file that imports only exports the edit left as they were is not reached, and a barrel passes each changed export on under the name it republishes it as. Stderr names the changed exports of each file, and `variance reach --format json` lists them under `exports`. A namespace import, a `require`, a dynamic `import()` and an import that binds nothing are still walked whole. `affectedBy` in `@variance-authority/core/relate` takes `moved`, the exports each seed changed, and `relationsOfFiles` takes `uses`, the names each import binds; `readPublishedSources` in `@variance-authority/sense` returns that lookup, read from the parses the index already stores.
- 665b527: `variance reach --whole-files` walks from every changed file whole without reading the edit, which is the list a file-by-file import graph gives. It is never shorter than the default list, so running both shows what the reading left out. Its JSON has no `quiet` and no `exports`, because no edit was read.
- 93d53c8: One `variance-authority` skill ships in `@variance-authority/cli`, with a reference file per question, and `variance doctor` says whether your agent can find it

  The skill lives at `skills/variance-authority/`, where skill finders that read
  `skills/<name>/SKILL.md` see it. Its `SKILL.md` routes each question to one file
  under `references/`: reading a run, locating a subject, a live run, producers,
  covering, test selection and its wiring, distillation, the workspace API and
  MCP. It now also holds the test-selection guidance that shipped in
  `@variance-authority/sense` and the workspace-API guidance that shipped in
  `@variance-authority/help`; neither package ships a skill any more.

  `variance doctor` looks in `.agents/skills` and `.claude/skills`, in the project
  and your home directory, and reports each shipped skill as a link, a matching
  copy or a stale copy. For a skill it cannot find, it prints the `ln -s` that
  would serve it. It writes nothing, and the finding never changes the exit code.

### Patch Changes

- f7e5b66: `variance select --execution` reads each changed module from both of its texts before charging its lines, as a selection from the snapshot already does. A comment added above a function sits between two declarations, in the region the module ran as it loaded, and it was charged to every file that imports the module: one comment in a widely imported file selected thousands of test files where the runtime change beside it selected six. The old text is the blob the patch names. A change that proves to run nothing now charges nothing, and one that leaves what the module does as it loads charges only the functions its lines fall in. A patch without `index` lines is charged by its lines, as before, and `select` prints each file's reading.
- aa57273: `ask uses` finds a name your code reads off `import()` or `import * as`. It used to answer that nothing imported `narrowByJourneys` when `select-command.ts` read it as `selection.narrowByJourneys` after `const selection = await import(…)`. Such a site now names the line that loads the module, and an `import()` site says the module loads when that call runs, not when the file loads.

  The parse carries these reads as `members`, apart from each request's `bindings`, so test selection reads exactly what it read before. The source index moves to version 12 and the help snapshot to version 3, and each is rebuilt on the first question after the upgrade.
- 1c5f88c: `variance covering --format json` names an unrecorded project as `{"refused":"unrecorded"}` on stdout

  A project no run recorded is refused with exit 2 as before, and the sentence
  still goes to stderr. An editor asking on every edit reads the kind, stops
  asking in that project, and asks again when the window comes back to the front.
- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.
- 990ac1a: The agent skills name the commands that ship

  The test-selection skill no longer says there is no command line: it routes
  to `variance select`, `reach`, `index` and `covering`. The CLI skill lists
  every command that reads no config, and covers `covering --hops`, `--cases`,
  the per-file rows, `gained` motion and the `unrecorded` refusal. The workspace
  skill names `variance ask` as the same six questions.
- b1ee579: The `variance-authority` skill's description is one line that names the CLI, so an agent opens the skill whenever it is about to run `variance`. The documentation gives the lines to put in `AGENTS.md`, which an agent reads every session, to send it to `variance ask` before it searches the code, and the link Claude Code needs in `.claude/skills`, which it reads instead of `.agents/skills`.
- 743385a: A file resolves under the `customConditions` of the `tsconfig` that governs it, added to `source`, `import`, `require` and `default`. A workspace whose packages export source under a condition of their own, such as `"@tanstack/custom-condition": "./src/index.ts"` beside an `import` that names built output the checkout does not hold, now has edges into that source, so `variance reach` walks from a changed package into the packages that import it. `extends` is followed the way TypeScript follows it: a config that sets the option replaces what it inherits, and `null` or `[]` clears it. A named `tsconfig` supplies its own conditions, and `conditionNames` you pass stay the whole set. Stored records are read again once, because the conditions a record was resolved under are part of its key.

## 0.8.1

### Patch Changes

- 96a50bf: `variance run --since` and `variance select` print one line per changed file saying how it was read, or why it was not, and name each test that loaded it through an import the file graph does not list; `variance select --format json` gives the same readings as `readings`, and `@variance-authority/sense/test-selection` exports the formatter as `readingLines`.

## 0.8.0

### Minor Changes

- e4ee0da: The repository names its cache. Set `cacheRoot` in the `variance.config.json` at the repository root, for example `".variance/cache"`, and every command, every test runner integration and every function that takes a `cacheRoot` option uses that directory. The path resolves against the repository root. Without the key the cache is `$XDG_CACHE_HOME/variance-authority`, or `~/.cache/variance-authority`, as before, so an existing recording stays where it is. The key is read before the environment, so a sandboxed agent that sets `XDG_CACHE_HOME` to a temporary directory no longer splits the recording away from your own runs. [The cache](https://variance-authority.dev/docs/cache) page describes the location, what is in it, worktrees and CI.

  `@variance-authority/sense` exports `cacheRootFor(root)`, which returns that answer, and `CACHE_CONFIG`. `defaultCacheRoot` is removed; call `cacheRootFor(root)`. A `cacheRoot` option now names the variance-authority directory itself, and `test-selection/` is created under it. `testCoverageFile`, `seedTestCoverage`, `readableTestCoverage`, `moduleNamesFile`, `openModuleNames`, `recordStore`, `recordStores` and `repositoryLayers` take an optional `cacheRoot`. An empty or relative `XDG_CACHE_HOME` is ignored rather than resolved against the working directory. A root `variance.config.json` that is not JSON, or whose `cacheRoot` is not a non-empty string, is an error.

  `@variance-authority/cli` accepts `cacheRoot` in the config and in the schema, and refuses it in a `variance.config.json` below the repository root. `variance run`'s render cache and suite indexes are under it. `renderCacheRoot` and `suiteIndexPath` take the config.

### Patch Changes

- 4250eda: Every run records which case entered each region. The `cases` option is removed
  from `withTestSelection` for Vitest, Jest and Rstest, from the Playwright
  recorder and reporter, and from the Storybook recorder: each writes
  `<coverage file>.cases.bin` beside the file-level snapshot, or `executionFile`
  when you name one. A test file that runs in a page is still recorded per file,
  and says so.

  Without `continuations: true`, a file whose cases overlap no longer fails the
  run. It is recorded as a whole, so a change it reaches runs every case in it, and
  the run names the two cases that were open at once.
- 5ecdc81: Selection asks the repository's `package.json` files for `sideEffects`, so a
  module a package declares is charged to every test that loads it or an importer
  of it.

## 0.7.0

### Minor Changes

- 6261ebe: `variance select --execution` traces a changed lockfile to the tests it reaches, and refuses a list of paths.

  A lockfile in the patch is compared as an install: the patch's `index` line names both blobs, git produces them, and every package that resolved differently is walked back through the packages resting on it to the files that import them. Those files' test files run, and so does every case the journey saw enter one of them. A lockfile the patch changes without naming its blobs keeps every test. `narrowByJourneys` and `selectJourneyFile` take the moved names as `packages`.

  A journey file selects by changed lines, so `git diff --name-only` handed to `--execution` is refused with a pointer to `variance reach`, which answers a list of paths from the import graph.
- dfab8cd: `variance select` reads a journey file against a change you hand in

  `variance select --execution journeys.bin` names the test files a change can
  skip, read off the journey file `journeys finalize` or `journeys stitch` wrote.
  The change comes from `--diff <patch>`, from `--diff -` on stdin, or from
  `git diff` against `--since`. A patch with hunks selects the cases that entered
  the innermost function holding each changed line. A case's crossings into a
  module it mocks do not select it.

  The reading happens in the native addon: `selectJourneyFile` answers a stitched
  file of hundreds of millions of crossings in milliseconds, where decoding it in
  JavaScript ran out of heap. `projectJourneyFile` returns only the regions a
  change lands on, and `variance covering --execution` reads through it.

  `variance covering --since <ref> --execution <journey-file>` diffs from the ref
  you give. It used to diff from the commit of the recorded snapshot, which a
  journey file does not have.

### Patch Changes

- 3dc39cc: A mock no longer disowns what a case crossed. The runner installs a mock before the file's first case, so every crossing recorded inside a case or a hook ran the real module and selects that case, even in a module its file mocks. A mock still cuts what ran only while the module was evaluated, which is how a runner shapes an automock.
- 46f513e: A changed `package.json` is set aside only when the install comparison reads all of its change. A diff that moves `exports`, `imports`, `main`, `module`, `browser`, `type`, `sideEffects`, `name` or any field outside the dependency and publishing fields selected nothing and printed that the diff changed only manifests, while every importer of that package now loaded a different file. Each changed manifest is now read at both revisions, and one that moved a field the lockfile does not hold makes its package a changed directory: the walk reaches every importer, and a journal read charges every file of the package whole. `manifestMoved` in `@variance-authority/sense/lock` owns which fields the install speaks for.
- a006512: `run --since` observes a subject the recording saw enter the change

  A subject could be skipped by what its baseline names and the imports the file
  graph could read, even when the execution record showed that it entered the
  changed lines. That happened in two cases: the chain to the change ran through
  an import the scan could not read, or the baseline did not record the component,
  which is always true of a server component. The recording was consulted only
  about the subjects that survived the first check, so it could not keep this one.

  A subject that the recording saw enter the changed lines is now observed,
  whatever its baseline names, and the run names every subject it kept this way.
  The recording still rules out only subjects that passed the first check.
- a2dac26: The scan now records what each file mocks in its parse, in both the JavaScript and the native reader. It does not apply the result: records keep every edge, including type-only and mocked ones, so a question such as which files a test imports gets the whole graph. `mockTaint()` gets its answer from the cached parse and no longer opens or re-parses test files, which matters in a repository with tens of thousands of them. A `mockTaint` given its own `callers` asks something the scan did not, so it still reads the file. `files`, `taintFile` and `taintTable` work as before. `updateSourceIndex` no longer runs a separate taint pass. The source index is now format 10, so an older segment is rebuilt rather than read without its mock columns. The module reader no longer treats a computed member (`vi[mock]`) as a mock, or a computed `['spy']` key as `{ spy: true }`.

## 0.6.0

### Minor Changes

- 1b4c0db: A changed file the record has no row for no longer runs the whole suite

  A changed path the record has no row or declaration for, and the graph does not
  list — a README, a fixture a test reads with `fs`, a script a test spawns — is
  listed in `unread` and selects nothing by itself. `unread` is a report: the skip
  list is `whole` less `entered` whatever it lists. `variance select` and
  `variance run --since` name those paths on stderr, and `variance select --format
  json` lists them under `unread`. A file the suite rests on without importing it
  goes in the `preconditions` option of the Vitest, Jest or Rstest integration,
  and a change to it then selects every test that declared it.

  A changed module with no instrumented row under any of its names — one the
  recording did not instrument, or one added since it — is walked to the files
  that import it along every runtime edge, never `type`, and each chain stops at
  the first test file or instrumented module it reaches. A module with a row but
  no probes is walked past, and the tests that declare it are selected. A test
  that mocked the changed module, or a file between it and the row, is cut. A
  stylesheet, image or JSON file is walked along `asset` edges, as before.

  Each importer answers for itself. A changed file whose importers the record
  measured only in part selects the tests of the measured ones: an importer with
  no row selects nobody and no longer voids what the chain beside it selects. A
  file known under two names, its source and its built twin, is answered when
  either name has a row, and each name selects the tests recorded under it.

  A bumped package is never `unread`. It is walked to every file that imports it
  at any distance; the measured ones select their tests, and one the record never
  measured selects nothing. Declaring that file as a precondition does not change
  this: a precondition selects on a change to the declared file's own text, not on
  a bump beneath it.

  `variance select` compares the install. It reads the lockfile at the diff's base
  and in the working tree, answers a bumped package through the files that import
  it, and declines to narrow when the lockfile cannot be compared. The lockfile
  and `package.json` are left out of `unread`, because the comparison has already
  said what moved. `variance run --since` reads the execution journal after the
  baselines and the file graph, and narrows past their whole-suite answers, except
  after a change to a `source.before` entry or an install it could not compare:
  the journal never saw either, so the run stays whole.

  `foldTestCoverage` keeps the instrumented rows where shards disagree about
  whether a module could be read. The tests another shard watched run that module
  keep their crossings and stay whole, rather than being demoted to incomplete and
  running at every selection; the tests that loaded the uninstrumented copy
  already declare it as a precondition.

  A workspace package imported only with `import type` is not a runtime import.
  The native scan records a package edge beside an unresolved bare specifier, with
  the kind it was read as, the way the JavaScript scan does, so a caller bridging
  workspace specifiers can tell an erased import from a loaded one. The record
  cache is discarded once, so a record the native scan wrote without those edges
  is read again rather than reused.
- c9a35ca: `@variance-authority/core/relate` exports are renamed, and the old names are removed

  The old names are removed, not kept as aliases:

  | Was | Is |
  |---|---|
  | `movedBy` | `affectedBy` |
  | `Reached` | `Affected` |
  | `MovedOptions` | `AffectedOptions` |
  | `movedBefore` | `changedBefore` |
  | `Reach` | `Traversal` |
  | `ReachOptions` | `TraversalOptions` |
  | `Reach.reached` | `Traversal.nodes` |
  | `Reached.reach` | `Affected.traversal` |

  `dependentsOf` and `dependenciesOf` return a `Traversal`, and `trailOf` takes
  one as its argument.
- 8adc864: Code that runs when a module loads no longer counts as covered by every test in the file

  A module's top level runs once per test file, while whichever test is running
  at the time. Before, every test in the file was recorded as covering it, so
  each line at module scope looked as covered as the function bodies in that
  module. The record now marks such a region as loaded and lists no test as
  covering it. `variance covering` works out, from the import graph, which tests
  loaded it, and leaves out test files that mock the module. When no import graph
  names a recorded test, for example a module that runs in the page and that a
  browser spec never imports, `variance covering` prints no tests for it rather
  than an empty list.

  Recordings written by an earlier version still read. Their module-scope regions
  are marked as loaded when the recording already said so, and are unmarked
  otherwise.
- 03984ae: A file whose imports could not all be read no longer widens selection

  A `require(name)` or `import('./' + name)` has no written target. The walk uses
  the edges that were read in such a file, and the recorded run answers the one
  that was not: the module loads under the test however it was named.
  `affectedBy` seeds only the changed files, the closure digest does not mark such
  a file volatile, and it does not void a deviation baseline.

  Removed, not kept as aliases: `Affected.opaque`, `Hole`, `ReachReport.opaque`,
  `ReachHole` and `ReachedComponent.throughUnread`.

### Patch Changes

- 8adc864: `variance covering --since` resolves a symlinked `--root`

  `variance covering --since` resolves a symlinked `--root` before making paths
  relative to it, so changed paths no longer print as `../../private/var/...`.
- 8adc864: `--no-git` reads source from disk, and a scan no longer makes Git fetch in a partial clone

  `variance select` and `variance reach` take `--no-git`: source is read from the
  disk rather than from Git's object store, and Git still supplies the diff. The
  scan walks directories instead of Git's list of tracked files, and cached parse
  results, which are keyed by Git object names, are not reused.

  Without the flag, a file whose object is missing from the local Git store is
  read from the disk. Before, in a partial clone, reading it made Git fetch the
  object from the remote.
- 1b4c0db: A recording made from a package is found from the repository root

  The coverage snapshot, the module-name table and every record store are now kept
  under the repository the directory you pass sits in, not under that directory
  itself. The recorders already wrote there. The readers — `variance select`,
  `variance covering`, the recording position `variance run` reports, and
  `testCoverageFile(root)` itself — used
  the directory they were given, so a suite recorded from a package-level config
  read as unrecorded from anywhere but that package, and a run from the package
  could not find a recording made from the root. `repositoryLayers(root)`, exported
  from `@variance-authority/sense/test-selection`, returns the directories a record
  of that repository lives in. The source index is still kept per scan root.
- 8f65bcf: `variance select` and `variance covering --since` build the file graph, so a change inside a module a test mocked, or behind that mock, no longer selects that test.

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

### Patch Changes

- Finalize and stitch journey artifacts through `variance journeys`

  `variance journeys finalize <journey-file>` seals a Jest run after Jest exits,
  and `variance journeys stitch <shard-file>... --into <journey-file>` assembles
  downloaded CI shards. Both commands work without `variance.config.json`. Sense
  no longer publishes a second executable for these operations.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

### Minor Changes

- 8e2a8e5: One connection answers about the run and about the code

  `variance serve` served the report tools and nothing else. An agent in a
  workspace that already had the CLI still had to configure
  `variance-authority-help` as a second MCP server to ask what a package
  publishes or where a name is declared — and that second server was the only
  place a start point could be said at all, because `serve` passed no checkout
  root, so `from` and `to` were refused over the transport the workspace was
  already using. The six source questions had been on `variance ask` since the
  fold began; the fold stopped at the shell.

  Both tool sets now mount over one composite subject, so `tools/list` on
  `variance serve` returns the twelve questions about the run and the six about
  the source, and the six read the checkout the server was started in. Which
  half is read is decided by the question: a report is a file and is re-read on
  every request, a workspace reading is a scan and happens only when one of the
  six is what was asked, so a connection that never asks about the source never
  pays for one.

  Two options on `serve` in `@variance-authority/mcp` carry that, and are useful
  to anyone hosting these tools over more than one subject. `subject` is now
  handed the name of the tool a request calls, where it calls one, so a host can
  read only the half the question needs. `remember` says what is worth keeping
  for the next request, in place of the default structured clone of the whole
  subject: the one tool that compares this request with the last one compares
  reports, and cloning a whole workspace reading on every successful call would
  buy that comparison nothing.

  `@variance-authority/help` is unchanged as a package. What changed is what its
  pages say: a workspace that has the CLI needs nothing from it over either
  transport, and the standalone binary is for the workspace that runs no visual
  suite.

## 0.4.1

### Patch Changes

- Say who expands the query

  `variance_locate` and `docs_search` match the words they are given and expand
  nothing: no thesaurus, no stemming past a trailing plural, no model. That was
  true before and said only in the source, so an agent holding `auth` against a
  repository that writes `CredentialGate` read a miss as an absence rather than as
  a wrong vocabulary, and asked the same question again in longer words.

  Both tools now say it in the description the caller reads, and both skills say what
  to do instead: ask again in a different kind of name — what the screen says, what a
  component is likely called, the file it is likely declared in — rather than a
  reworded description of the same thing. The caller holds the ticket and the
  codebase the word came from, which is the context a shipped synonym table would
  be guessing at.

## 0.4.0

### Minor Changes

- da23004: The per-case execution index is columns, and fits a CI artifact limit

  `cases: true` wrote its index as JSON, one object per crossing. On three real
  projects that measured 31 to 37 bytes per crossing: a suite whose snapshot is
  0.3 MB left a 27.2 MB file beside it, and every CI has a cap on what a job may
  upload.

  It goes through the same column codec the snapshot uses — a dictionary, parallel
  integer columns, zstd run coding — and the same three projects now write 0.46 MB,
  0.46 MB and 0.21 MB. Nothing about the model changed: `decodeExecutionIndex`
  returns the index `encodeExecutionIndex` was handed, field for field, and the
  optional `loaded` keeps the difference between unsaid and denied.

  The default path is `<coverage file>.cases.bin`. An `executionFile` you name
  `.json` is still written as JSON, at the size JSON costs, for a reader that has
  to have it — and `variance covering` and `variance distill` read either, telling
  them apart by the first byte, so a cache recorded before this still answers.

## 0.3.0

### Minor Changes

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
- fc59417: `accept` refuses without a run, and `--help` tells you what each exit code means

  Two ways the CLI left you to guess.

  **`variance accept` before any run crashed.** There was no report to promote from,
  and the failure surfaced as an uncaught exception — a stack trace, from a
  situation that is ordinary the first time anyone uses the tool. It now exits `2`
  and names the path it looked for, the config key that decides that path, and the
  one dead end worth calling out: a `playwright-test` project records through the
  runner and has no report here to accept.

  **`variance <command> --help` printed the global usage.** The per-command block
  existed and the flag was rejected before anything could reach it. Each command now
  answers with its own synopsis and flags, and with the exit codes *that command*
  can actually return. Only `run`, `report` and `adjudicate` can exit `1`, because
  only those three reach the review path; every other command exits `0` or `2`, and
  saying so uniformly would have been wrong for twelve of the fifteen.

  The three codes keep their meanings: `0` nothing needs review, `1` the run
  happened and found something a person must decide, `2` the run did not happen as
  configured.
- 05d6683: Changes before and beyond reach

  A run reads left to right: the harness starts it, the tests enter your code,
  your code goes out into the install and never comes back. Selection lives in the
  middle, and both ends were invisible for opposite reasons.

  The far right already arrived — a package is a node, a bump is a seed, the same
  backwards walk answers it. The far left is this. Nothing imports a
  `vitest.config.ts`, a setup module, a CI workflow or a `.nvmrc`, so no walk
  reaches one and the honest structural answer about a change to one is *no
  component moved*: a skipped suite over the file that decides how every test in
  it runs. A diff that was *wholly* outside the graph already widened. The hole
  was a config edited beside an ordinary source file, where the walk had a seed
  and answered confidently about a change it never looked at.

  `source.before` names those files, repository-root-relative, and a directory
  claims everything under it. What a declaration buys beyond its own name is
  everything below it: `beforeReach` in `@variance-authority/core/relate` walks
  *along* the arrows from each entry — the one question whose subject has no
  dependents — and collects the setup module, the fixture only that setup
  imports, and the packages the environment rests on. The descent stops at the
  first file `source.dirs` already covers, because that file has dependents and a
  change to it is answered exactly by walking them; everything below it is
  reached through it and does not arrive either.

  The two ends meet there. A `jsdom` bump is named by the install comparison,
  reaches `jest-environment-jsdom`, and reaches a config no file in the
  repository imports — a change beyond reach arriving before it.

  `scanRelations` takes `before` to seed those paths by name, since a harness
  lives above every directory a component scan is pointed at. A named path that
  is absent or has no reader is dropped rather than recorded unreadable: an
  unknown file seeds every walk forever, so a typo would otherwise widen every
  run in the repository. A declared entry the graph does not hold contributes
  only its own name, which is the whole answer for a `.nvmrc` and a symptom for a
  harness config, so the run reports it as a note rather than guessing.

  `source.before` requires `source.relations: true`.

### Patch Changes

- f42e141: `select --format vitest` names each file's place on disk

  A Vitest project matches an exclude pattern against its own directory, not
  against the root the record counts from. The exclusions were printed relative to
  that root, so in any workspace of more than one project they matched nothing:
  the command answered, the runner accepted the arguments, and the whole suite ran
  anyway. Nothing failed, which is the worst shape for this to take — a selector
  that is silently ignored looks exactly like a selector with nothing to say.

  `--format vitest` now resolves each path against the root it was recorded from,
  so the argument means the same thing from wherever the runner is invoked. The
  other formats are unchanged: `plain` and `json` are answers for you to read or
  parse, and they stay in the record's own coordinates.

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
- f4b328b: Mainline's evaluation can travel, so the next machine does not derive it again

  A suite index is bytes addressed by the commit they were written at, which is
  exactly the shape a cache already wants. What was missing was anywhere to put
  them: every checkout that wanted to know what `main` looked like had to run
  `main`, and in CI that is the whole suite, twice, on every pull request.

  `@variance-authority/core/share` is the transport, and it has two backends
  because there are two. A **directory** is what `actions/cache`, `aws s3 sync`, a
  network mount and a laptop all are once the bytes are on disk; an **HTTP
  endpoint** is what a bucket, a presigned URL and a tribunal deployment all are.
  `createDirectoryShare` in `@variance-authority/store/share` is the filesystem
  half, kept out of `core` because `core` takes no platform.

  A share never fails a run. `get` answers `null` and `put` resolves, whatever the
  network did — a share that is down, misconfigured or empty is indistinguishable
  from a cold one, and the run derives its own index and continues. The cost is
  deliberate: a typo in an endpoint is a suite that quietly got slower rather than
  a build that went red, and the `behind` count `variance share` prints is the
  signal that publishing has stopped.

  The CLI gained a `share` section in its config, a `variance share` command that
  says what the share holds for mainline or publishes what this run derived, and a
  line on `variance run` naming where the index went. A lookup walks the lineage —
  `merge-base` with the configured `mainline`, then first-parent — and asks this
  machine's own cache for every commit before it asks the share, because the run
  that just published is usually the one asking.

  `docs/sharing.md` is the arrangement end to end, GitHub Actions first.
- e546e21: A subject with no pixels is a baseline without an image, not a subject that got away

  A wrapper whose only child went to a portal, or a conformance mount with no
  children, occupies nothing. Refusing to photograph it is right; refusing the
  subject was not. On Material UI's unit tier that was 1109 of 4371 subjects
  reported as unobserved while the capture held their markup, their rules, their
  component hashes and their accessibility tree — none of which was in doubt.

  `Raster` makes the image optional: `bytes`, `width` and `height` are absent
  together or present together, and `pictured` is the one place that narrows all
  three. Absent means *this subject has no pixels*, which is a measurement — it
  never means the image was lost. `occupiesPixels` asks the same question of a
  record read without bytes, which is the only form a sidecar takes. `observe`
  gets a second tier in `unpictured.ts`, where the comparison such a subject can
  still take — document digest, component hashes, accessibility — is the whole
  verdict. `promotionOf` promotes the sidecar alone when there is no `after`,
  because the subject reached a verdict and the only missing half is the one a
  camera would have produced.

  The file-backed store carries the same nullable pair, and with it the split of a
  baseline's two halves into two path prefixes. `identities` scans the record root,
  because a subject with no pixels has no image directory to be found in and the
  sibling scan would otherwise call another machine's baseline new.

  Capture stops handing this to Playwright to fail on. Both screenshot paths used
  to refuse a zero-area subject in terms of their own arguments — the clip path
  with `Expected options.clip.height to be greater than 0`, the element path by
  spending the full actionability timeout and then complaining about visibility —
  so a reader had a component that rendered nothing and a sentence about a
  rectangle. `captureSubject` decides it now, and the renderer names the subject.

  **Operators:** this is schema **18**. `baselines` and `render_cache` drop
  `NOT NULL` from `width` and `height`, shipped as `0016_pixel-less-baselines.sql`.
  Apply it before pointing a CLI of this version at the deployment; `GET /version`
  reports the schema a build expects.
- 53e96ad: `variance push` asks what the deployment already holds, and uploads only the rest

  Objects in a tribunal deployment are addressed by their content, which made most
  of what a push sent redundant without anything being able to notice: a run's
  `before` **is** the baseline that deployment handed it over `/baseline/find`, and
  an unchanged subject's `after` is a second copy of that same picture. Every run
  re-encoded and re-uploaded them, and the second and every later copy landed at a
  key the store already had.

  A push now opens with one `POST /review/have` naming the SHA-256 of every image
  it is holding. Images the deployment can already produce travel as a digest; the
  rest travel as bytes. A suite where nothing moved sends its report and almost no
  pixels, and `variance push` reports how many images it did not have to upload.

  The digest form is re-checked on ingest rather than trusted. A digest this
  deployment does not hold — invented, or collected by retention between the
  question and the build — refuses the build naming the subject and the remedy,
  because the run still has the image on disk and may push it again. Recording a
  subject whose picture is not there would surface as a 404 on a review page days
  later instead.

  A deployment that does not answer `/review/have` gets the push this command made
  before the route existed: larger, and correct. Upgrading the CLI ahead of the
  service is not a breaking change.
- 53e96ad: Say which halves are talking.

  A deployment answers `GET /version` with the wire contract it serves and the row
  shape it expects, and `variance push` asks before it reads a byte off disk. The
  pair is printed on the line the operator keeps, and a difference between them is
  named in a sentence rather than left to be inferred.

  It had to be inferred until now, and it was not. A CLI newer than its deployment
  asks `POST /review/have` which images are already there, is answered 404, reads
  that correctly as *nothing is*, and uploads every pixel it is holding — a push
  that is eight megabytes and thirty seconds instead of a few hundred kilobytes,
  with no error anywhere in it. The same mismatch promotes a retina baseline under
  the run's identity rather than the document's, which presents as a subject that
  stays `new` after an approval the page reported as recorded. Three symptoms, one
  cause, and nothing in the chain could state it.

  `variance --version` prints the tool on its own.
- 0718464: Fold shard snapshots into the one a checkout reads.

  A suite split across CI jobs recorded one execution snapshot per job, and
  nothing shipped could make them one: `mergeCoverage` was reachable only through
  the Vitest seam, layers rather than folds, and no writer was public at all. The
  README said a job combines shards with it, and no job could.

  `@variance-authority/sense/test-selection` now exports `foldTestCoverage`, the
  order-independent union of shards that refuses by name when two were not one
  run, `writeTestCoverage`, the whole-or-nothing writer every seam lands through,
  and `mergeCoverage` itself. `variance journeys` takes shard snapshots as
  positionals, folds them, layers the result over what this checkout already
  holds — or writes it where `--into` says — and reads the suite it just made.
- ff718d3: Distil one test to the behavior it witnesses.

  `@variance-authority/distill` combines an Eyes attention journal and a Sense
  execution index by exact test identity. It keeps authored Arrange, Act and
  Assert attention, React update initiators, and whole-test source entry separate,
  then names entered files without addressed source attribution as opportunities
  for a counterfactual check rather than safe mocks.

  `variance distill` reads the portable files from a shell and can emit text or
  JSON. A combined MCP connection exposes the same analyzer as
  `variance_distill`; the former `variance_testing_surface` name is replaced.
- faec91c: The difference mask is computed on the review page, not uploaded

  A mask is new bytes by definition whenever anything moved, so it is the one image
  content addressing can never deduplicate: `before` is always a hit and an
  unchanged `after` is a second copy of a baseline, but a mask matches nothing and
  never will. `variance push` now leaves it at home. The review surface holds both
  captures and makes its own when a reviewer opens the difference — through the
  same function, at the same policy, so the two cannot disagree about a threshold,
  an anti-aliasing rule, or what a grown capture does to the union box. Builds
  pushed by earlier versions kept a mask and are still served it.

  Runs are unchanged: the report still writes a diff PNG, because that is the
  picture a developer opens without a deployment, and a deployment is optional.

  `@variance-authority/png` gains a `./mask` subpath — the padding rule and the
  difference, over pixels somebody else decoded — so a caller holding RGBA reaches
  the arithmetic without a codec, and a bundler following it finds no `pngjs`.
- e546e21: `baselines.records` puts the sidecars where git is not looking

  A baseline is an image and a record of how it was painted. The image moves when a
  pixel moves; the record moves whenever the *document* does — a class name, a
  build id, a font that resolved somewhere else — so a record committed beside its
  image puts a tracked diff on every edit that moved nothing. At a few hundred
  subjects the baseline directory is the noisiest path in the repository, and a
  directory nobody reads is a directory that catches nothing.

  `"records": ".variance/records"` on a `directory` or `lfs` baselines section sets
  the store's `recordRoot`, and the rule it buys is worth stating plainly: if a
  change did not update an image, it updates no file under version control.

  Unlike `cacheRoot` beside it, this is not inferred. A lost cache entry costs a
  render; a lost record costs the run its `missingFonts` and its `findingMarks`,
  which are evidence a verdict is allowed to turn on — so where they go is your
  decision and the config is where you make it.

  It moves the record's directory and nothing else. Both halves are still written
  and both are still read, so half a pair still stops the run and still names the
  file it looked for, in whichever root it looked in. A repository that leaves
  `baselines.records` unset keeps `*.json merge=binary` as the stopgap it was.

### Patch Changes

- e546e21: A collector's complaints travel into the observation

  A finding produced at collection reached the CLI's record and nobody else. A
  suite driving this from its own runner asks the observation what is wrong with a
  subject, and the one diagnostic that explained the moved pixels — the host, not
  the stylesheet, chose the typeface — was produced, carried, and dropped one call
  short of the person reading the failure.

  `mergeDiagnostics` dedupes on every field, so the CLI, which now meets the same
  list twice, says a shared complaint once.
- 789405d: An `ignored` subject now ships the pair that makes it reviewable.

  `ignored` means pixels differed and every one of them fell inside a mask
  somebody wrote, which makes it the one verdict where the question is about the
  mask rather than about the render. The run shipped only the candidate for it —
  the single image that cannot answer *has this rule grown over a regression*,
  because inside a mask the candidate looks exactly as intended. A `before` and
  the difference mask are written and uploaded for it now, on the same terms as a
  changed subject, and the settled panel links each absorbed row to the page that
  shows all three.

  The browser accessibility snapshot a candidate sidecar could carry is stated as
  the missing acquisition it is, at the site that would have to close it: the CLI
  builds the sidecar from the render cache, which holds the renderer's output, and
  the collector contract has no field for one. The column, the transport and the
  promotion all carry it already.
- c8f0824: An approved candidate becomes a baseline a later run can find

  Every baseline lookup keys on the identity of the document that was painted —
  `identityAtScale`, which folds in the viewport's `deviceScaleFactor`. A build
  row carries the identity of the machine instead, whose own source says nothing
  may key a store on it: a run painting 1x and 2x viewports reports the scale
  there as 1. Promotion used that one. On any suite above 1x the approval was
  recorded, the page said so, and the next run looked under a digest nothing had
  ever been filed under — so the subject came back `new`, forever, and no amount
  of approving it helped.

  So `push` now sends the candidate's own sidecar identity, the service keeps it,
  and a promotion files under it. A push that predates the field still promotes
  under the build identity, which is what this did for every build and is correct
  at 1x.

  `components` and `findingMarks` travelled the same way and did not survive: the
  sidecar carries them, the request dropped them, and a baseline promoted through
  review came back without. Both describe the document that painted the image, so
  nothing downstream can recover them from the bytes — without the hashes a later
  run ranks causes by area, and without the marks it reports every standing defect
  as one the change under review introduced. Absent and `[]` stay apart end to
  end, because nobody having looked is not the same fact as having looked and
  found nothing.

  For the same reason `push` no longer defaults a missing `missingFonts` to `[]`.
  A sidecar that never said which fonts were missing now withholds the candidate
  with a sentence naming the file, rather than promoting a baseline that claims a
  font check it never ran.
- 53e96ad: `variance push` says where it is while it is there

  A push of a real suite spends most of its wall clock before the request exists:
  every image the report named is read off disk and base64-encoded into one body,
  and a few hundred subjects of that is tens of seconds of a command that has
  printed nothing. Silence there is indistinguishable from a hang against an
  address that is not answering, and the two call for opposite responses — wait,
  or interrupt and check the endpoint.

  So the two phases report themselves, on stderr, in the shape the reader is in.
  A terminal gets one line rewritten in place, cleared before the report lands on
  stdout. A log file gets one line per phase and nothing per subject, because a
  build log is read afterwards, where every intermediate count is noise.

  `sending` carries a size and no progress, which is the truth about it: the body
  is one POST, and the number that explains the silence after it is how large that
  body turned out to be.

  `PushOptions` gained an optional `onProgress`, and nothing computes an event for
  a caller that did not ask for one.
- e546e21: Four ways a large unit tier lost subjects, none of which said so

  **The styling was gone before the capture looked.** A capture taken from a setup
  file runs in the outermost `afterEach` a run has; every hook registered inside a
  `describe` has already finished, and `onTestFinished` runs later still. CSS-in-JS
  teardown lives in exactly those inner hooks — emotion's test renderer removes each
  `<style>` tag it inserted — so the capture read the page with the styling taken
  back off it. The class names were all still in the markup, they matched nothing,
  and every subject captured, compared and passed against a photograph of unstyled
  DOM. Measured on Material UI's unit tier: 399 of 400 captures carried no CSS at
  all, and 1201 subjects laid out to zero height because nothing was sizing them.
  `retainStyles` records style elements as they are inserted and puts the removed
  ones back, in insertion order, for the length of one capture. The next test still
  gets a clean page.

  **A subject id can be longer than a filename.** A suite that names subjects after
  the test that produced them — a file path and a full test name — passes 255 bytes
  on ordinary tests, and the point of that convention is that the id says where the
  subject came from. `fileNameFor` in core is now the one rule: a readable prefix,
  plus a digest of the whole id when the id does not fit, because truncation alone
  merges two tests into one file. The baseline store, the capture archive, the
  CLI's image directory, the Playwright evidence directory and the Eyes journal all
  use it; before this, each was one long subject id away from a raw `ENAMETOOLONG`
  that never mentions a subject. `@variance-authority/eyes` declares
  `@variance-authority/core` directly rather than reaching it through `react` — the
  host stacks it keeps optional are Playwright and Testing Library, and a filename
  rule is not one of them.

  **An inline `url()` is spelled in entities.** `style="background-image:url(&quot;/a.png&quot;)"`
  reaches the scan through HTML serialization, and reading it literally asked the
  caller for bytes at a URL that exists nowhere but in the escaping. The HTML half
  is scanned with the attribute's entities undone; the stylesheet half, which was
  never escaped, is scanned as before.

  **A stubbed `getComputedStyle` is not a broken asset scan.** Replacing
  `window.getComputedStyle` with a map of the two properties a component reads is
  the only way to drive some layouts in jsdom. The scan called `getPropertyValue`
  on the plain object it got back, and every test in the file died on a `TypeError`
  raised four frames below anything you wrote. There is nothing to scan and nothing
  to complain about — whatever those styles would have named, the stub already
  removed from the page. The attributes on the element are still read.
- 0718464: A changed file no probe can sit in is asked of the module that imports it.

  The record decides what a change reaches. A module nobody executed — every
  test that imports it mocks it, or nothing loaded it — has no row, and the tests
  that import it never ran a line of it: it selects nobody, and so does everything
  only it imports. A stylesheet, an image, a JSON file can hold no probe, so it
  never has a row, and whether a test ran it is a question about the module that
  imported it. `narrowByExecution` and `selectTestFiles` now take `relations` and
  walk from every changed file through `asset` edges — the stylesheets that import
  the stylesheet, the modules that import those, and no further — and select the
  tests that entered each module reached; a module reached without a row is dead.
  A file whose own edges the scan could not read may reach the asset by an edge
  nobody saw, so its tests are selected as well. `knownAs` looks the changed file
  and every module reached up under every name the journal holds them by. `unread`
  names the changed paths nothing recorded holds — no row, no precondition, no
  place in the graph — as a report rather than a widening: a suite that depends on
  a file that way declares it as a precondition.

  A diff is read the way `git` writes it. A pure insertion is placed after the
  line it follows, additions past the count of lines they replace are charged to
  the gap they open after the last one, a file the diff names without a hunk — a
  binary, a rename, a mode change — is charged whole, a quoted path is decoded,
  and the narrowest region on a changed line is measured over regions that have
  source, so the `else` nobody wrote never decides a line alone. A module the
  runner evaluates again after a registry reset keeps what it counted before it,
  a module a runner shares across files without isolation is counted for every
  file that consumed it, and what a module did while evaluating is credited to
  the files that entered it rather than to every file the run ran; a file that
  only reads a module another file evaluated is reached through `relations`. A line that
  opens or closes the narrowest region — the condition of an `if`, the props
  beside a one-line handler — is the enclosing region's line too, and charges it.

  The CLI's `--since` lists files from the merge base of the ref and `HEAD` to
  the working tree, untracked files included, so a branch behind `main` is not
  charged with what others merged and a watch loop is asked about the edit that
  was just saved; the hunks the journal reads are taken from the commit the index
  was recorded at, whose coordinates are the only ones its line ranges are in;
  a module the run did not load, carried from an earlier recording, has its text
  on disk compared with what its rows were recorded over, and every test that
  entered a module that has moved is marked partial rather than left standing on
  lines that are no longer there. A rename's hunks are read under the old name.
  Paths are read unquoted and under `a/` and `b/` whatever the operator's git
  configuration says, and the index is looked for at the repository root as well
  as the run's directory.

  The Jest seam instruments every project of a `projects` configuration and
  leaves a setup entry that names a package out of the preconditions; the Vitest
  seam does the same for its setup entries.

  The runtime's counter factory is installed before the project's own setup
  files — first in Vitest's `setupFiles`, and in Jest's `setupFiles` rather than
  `setupFilesAfterEnv` — so a setup file that loads an instrumented module finds
  it. Jest projects that name `@variance-authority/sense/jest-setup` by hand keep
  working; it installs the factory itself when nothing has.

  Every selection now says why. `because` names, per selected test, the changed
  region it entered, the precondition it is governed by, or the trail of importers
  it was found through. The CLI's `--since` hands its `relations` scan to the
  journal reader when the config asks for one.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Minor Changes

- 1d402d1: Carry the narrowing coordinate in the report, and print it in the summary header.

  A `RunReport` now holds `narrowing`: the ref the run was told to observe from,
  and where the recorded execution index stands — the commit it was written at and
  how many files the working tree differs from it by. A run that narrowed nothing
  carries the second half alone, so the coordinate is present whether or not it was
  spent.

  `variance_summary` prints it. Narrowing is an option and stays one; what this
  refuses is the state where an agent works against a suite for weeks without ever
  learning that an index is on disk and that the distance from it is a number. The
  line names the commit and spells out the `variance run --since` that would use
  it, and is omitted when there is no index, no position, or no distance.

  `run` takes the coordinate as `index` and acts on it for nothing else.
  `narrowingFor` resolves `since`, `against` and `index` together, so a caller
  assembling a run reaches one call rather than three.

### Patch Changes

- 355e668: Stop labelling a changed region with the path of the node that contains it.

  A page this project did not write in React carries no component names, and both
  docket renderers fell back to the containing node's path. A pull-request comment
  led with **`0/1`** in code voice, and a failing Playwright assertion printed
  `1510px — 0` three times, the three rows separated only by their pixel counts.
  Where no component and no landmark phrase exist, both now print the region's
  geometry, which at least finds the rect in the diff image. Collateral counts only
  regions that have a component, so a page with none no longer reports "in 1
  component(s)".
- 9dfa2bd: Run when invoked through the symlink a package manager installs.

  `npm install` writes `node_modules/.bin/variance` as a link into the package, so
  `process.argv[1]` is the link while `import.meta.url` is its target. The
  main-module guard compared the two as written, which is true only when the file
  is run by its own path — inside this repository. Installed, `variance run`
  evaluated the module, dispatched nothing, and exited `0`: a gate reporting
  success without opening a browser. Both executables now resolve each side
  through `realpath` before comparing, and `tools/bin-symlink.check.ts` runs every
  declared bin twice, by path and through a link, and requires the two to agree.
