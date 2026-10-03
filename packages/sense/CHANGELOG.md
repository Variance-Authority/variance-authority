# @variance-authority/sense

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
- d584e71: A snapshot names the case it was taken in, and what that case had arranged

  A snapshot taken with the Playwright `variance` fixture now carries `case`: the
  spec file, the declaration path and `testInfo.testId` — the case id the record
  already keeps — and the preconditions the case had said with
  `variancePrecondition` by the moment its document was captured, each with its
  call site. A call made after the capture, while the snapshot is still being
  compared, lands on the case's row and not on the snapshot.
  `VarianceRuntime.arranged` is the read `observeLocator` makes at capture. The same line closes a failing `toBeUnchanged` message and is added as
  a `variance` annotation that Playwright's report shows under the test, passing
  or not. Without `varianceExecution` nothing listens: no annotation is added,
  and a failing message reads *preconditions unmeasured* rather than *nothing
  arranged*.

  `PreconditionListener.held(key)` returns what a running case has said so far,
  resolved as its row would be, without taking it from the row.
  `@variance-authority/sense/journal` exports `CasePrecondition` and
  `preconditionText`, the one rendering `variance covering`, `variance review` and
  the snapshot share: `flag=ff-on (spec.ts:9)`, a bare `true` as its name, a
  contradiction with both values. `ExecutionRecorder.arranged(owner, test)` reads a case's view
  from a Playwright worker's recorder.
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
- 988d0a2: An export's doc comment can declare its role with `@testOnly` or `@production`, and `variance restrictions` checks it with no `.relations.json`. It lists every shipped file that imports a `@testOnly` export, directly or through re-exports; every `@production` export that only tests import; and every export that declares both. What a `*.stories.*`, `*.story.*` or `*.examples.*` file imports from its own directory or below is held to its role as shipped code is, while what it imports from elsewhere stays test code; the code map counts `*.examples.*` files as tests. `Export.roles` gives the declared roles, and `declaredRoles()` runs the check. The source index format is version 16, so `variance index` rebuilds it once.
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
- 36c40d5: `@variance-authority/sense/test-selection` reads the `names` grammar

  The `names.axes` grammar is now exported from `@variance-authority/sense/test-selection`:
  `parseNameGrammar`, which checks a `names` value and throws `NameGrammarError` naming
  the field, `nameIndex` and `structuralParent` for a subject id, and
  `heldValues`, `outsideVocabulary` and `caseTwins` for what a case said on the same
  axes. `variance run` pairs a subject with its parent, and `variance covering
  --where` reads a case's axis and twin, through this one implementation, so a
  reader outside the CLI holds a case to the same vocabulary and base. The config
  refuses what it refused, with the same messages.
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

### Patch Changes

- 0b57de8: A landing names every case its shards ran as the last run

  After `variance journeys --suite` (or `landCases`) lands several shards of one
  run, the record's last-run layer names the cases every shard recorded. It named
  only the last shard's, so `variance covering --cases last` on a landed record
  answered from that shard alone. A case a later shard retired is not named.
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
- f4cf1fc: A Vitest run that loads one module as its source and as its build — a package's
  own tests import `src/cart.ts` while another package's reach it as
  `dist/cart.js` — records the same regions for it on every run. Both readings
  are named `src/cart.ts`, and the record used to be whichever the runner
  transformed last, so its regions and digests changed between runs over the same
  code and tests. The source reading is now the record whenever the run loaded it,
  which is the record a run that never loads the build writes too.

  In watch mode, a rerun keeps the readings of the files that did not change and
  drops the reading of each file that did, along with every build's reading of a
  source that did. The record never describes text that is no longer on disk.
- fa48984: A Vitest, Rstest, Jest or Playwright Test run removes the scratch it made and
  nothing else. It no longer prunes the rest of the cache once a day as it ends,
  so whichever run finished first no longer clears what other runs left. Run
  `variance prune` to clear it, or let `variance run` do it at its end.
- 525d1a6: A changed value that a file converts at top level as it loads is read as a load
  of that file, so the tests that load it are selected. `const doubled = feature * 2`,
  `` `${feature}` ``, `-feature`, `feature == 1`, `key in feature`,
  `feature instanceof Base` and `{ [feature]: true }` each convert the value, and
  the conversion can throw or run the value's own `valueOf`, `toString` or
  `Symbol.toPrimitive` when the file loads — `1n * 2` throws. A test file holding
  one is selected even when nothing reads the binding afterwards. A plain copy, an
  object value, `===`, `!==`, `!`, `typeof`, `??` and a condition convert nothing
  and still select only the tests that read the binding.
- 73f40a8: `variance_changed_tests` prints what each case said, with the call that said it, on the case's line, as `variance covering --since` does.

  `variance covering` prints what each case said, and its twin, in every answer that lists cases. The `--since` text carries them on each case line, and the whole-file and plain `--line` or `--function` answers print each case's twin without `--where`; under `--format json` the answer carries `twins` in every form. A twin comes from the case's own test file, and a large set prints as its count and the first three names. `--where` counts out of the cases that covered what you asked about, not the whole record. When a case says one value twice, the row keeps the site that said it first. The `afterEach` warning, the invalid-value warning and the misplaced-call error name the call site from the checkout, as the row does, under every host that knows the checkout, including a runner built on `@variance-authority/sense/runner`.
- 5cd0075: The first run laid over a record that crossed a checkout — a seeded worktree, a
  mainline record fetched in CI, a shared one — names the commit that record's
  coverage stands at as the commit of the cases it replaced. A crossed record keeps
  its cases and drops the run that wrote them, so that commit used to go unnamed,
  and `variance review` and `covering --cases last` after the CI record job folded
  its shards over the mainline's record had no commit to diff the replaced cases
  from.
- 10336d0: A file a package's `exports`, `main`, `module` or `bin` names now ships in the
  code map whatever its name says, and so does every file it loads. A package
  that publishes `./src/jest.ts` as `./jest`, or `./src/playwright.ts` as
  `./playwright`, used to have it read as a test because a runner is named on
  the path, which left it out of the package's closure in `variance layers` and
  out of the shipped files a transitive rule in `variance restrictions` starts
  from. A package whose manifest names none of its files still starts at the
  files its own code never imports, and a test file is still not one of them. A
  package inside a test's fixtures directory ships nothing, as before.
- d2010f9: A Vitest run that loads one module as its source and as its build credits each
  test with the regions it ran. Both readings are recorded under `src/cart.ts`,
  and reading the build's crossings against the source's region table credited a
  test that ran the build with a branch it never took. Each
  reading's probes report under the file the transform was handed, and the record
  holds the regions both readings cut, with each reading's crossings read through
  its own table.
- e57edf9: An `else if` transformed by esbuild is recorded on the line it was written on.
  esbuild opens the `else` line with the origin of the `if` above it and gives the
  nested `if` none, so the `else` region was recorded from the line above, held
  the nested region strictly inside it, and a line query on the `else if` line
  answered without the tests that ran the `else`. The same module loaded through
  its build was recorded on the right line, so the answer changed with which of
  the two a run transformed last.
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
- a17fd3c: A file whose tests already ran its text says so

  When your last run was recorded over uncommitted edits and the diff ends at the
  text those tests ran, the selector reads that file as
  `none (the recorded tests already ran this text)`. `none — the runtime text is
  equal` is printed only when the parser compared both texts and found them equal.
  The JSON reading for the first case is `none` with `kept: true`.
- 71c765f: A case that work outlived is one row in a Jest journey artifact

  A case is written when it settles, so work still running after it arrives as a
  second frame under the same file, name and id. The native fold behind Jest
  journey artifacts wrote that frame as a second case, `file > name#1`, and
  charged its coverage and what it said there. It now joins every frame of a case
  into one row, as the JavaScript fold does: the regions any frame entered,
  `stopped` only when no frame finished, and what every frame said. A stitch of
  shard artifacts carries the same rows.
- 2cf7575: Reading the recorded text in a partial clone now works on Git before 2.44, including the 2.43 that Ubuntu 24.04 ships. That Git exits at the first object it would have fetched instead of answering `missing`, and every module read as unverified; now the paths are fetched together in one request.
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
- 0eb4156: A cache prune that cannot remove an entry now says so. `applyPrune` returns each such entry in `unremoved`, with its error, and `prunedLine` prints one line for it: `cache: could not remove <path>, <rule>: <error>`. `variance prune` exits 2 when any entry stayed, where it used to print `cache: nothing to prune` and exit 0.
- 89d177b: A region that a test file which did not run still reaches no longer reads as having lost every case

  When only some test files ran at a commit, `variance review` and `variance covering --cases last` compared only the cases of the files that ran. Two kinds of region were reported wrongly. A region the files that ran stopped reaching read as `lost`, and the review said "Lost every case against the base", though test files that did not run still reached it. A region those other files had reached all along read as `gained` as soon as a file that ran reached it too.

  The cases of test files that did not run at the commit keep their earlier recordings, and they now count at both ends of the comparison. A region they reach keeps them: it reads as `thinned` when only one case is left, and as unchanged otherwise. A case recorded by any run at the commit is not counted this way. Each test file's own reach is still reported. `caseMotion` takes these cases as `retained`.
- 98b31be: Two callbacks on one line stay two regions when a run reads the module twice

  When a run loads one module as its source and as its build, the two readings
  are joined into one record. A region the two readings share is matched by its
  kind, name, path and lines, and two callbacks handed to one call on one line —
  `items.find(a) ?? items.find(b)` — match on all of them: both are
  `f/find.arg0`. The join kept the first and landed every crossing of the second
  on it, so the record held one region where the code has two. The tests that
  reached only the second callback were credited to the first, and a review
  reported the second as code no case ran, while the function it alone calls
  was reached. Regions of one shape are now matched by their place among each
  other, the n-th onto the n-th, in the record a run writes, in case indexes
  merged across shards and in the journeys stitched from a run's stores.
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
- 316e56f: A function written in front of an anonymous one no longer takes its tests

  An anonymous function is addressed by its place among its siblings. When you
  write a new one in front of a recorded one and run only the new test, the run
  used to carry the older tests' crossings by address onto the new function, and
  the function they ran read as entered by nobody. A run landed over such a shift
  now carries nothing across it, in the record and in the case index alike, and
  the tests that were on the module are run again, as a merged record already
  did.
- 8694a2d: A run whose workers finish in a different order now folds the same way. The test-file journals Jest and Vitest workers write, the trees a Vitest case runner writes, and the contributions staged Playwright and Jest workers leave were read in whatever order the file system listed them, and the fold sums durations, joins what each case said it arranged and keeps one fixture digest per name in the order it reads. The same run could record a different duration, precondition or head order each time it ran. Each is now read in an order decided by what it holds, which no worker's finishing time changes.
- afa40da: Stitched shards keep two cases that share a name apart. A shard that ran only the second of them numbered it as the first, so the stitch joined them and the first case took the second's regions and preconditions. Each shard artifact now carries the runner's id for each case. The stitch joins cases by that id and numbers the union as one fold over every shard would.

  A fold now refuses a file where a repeated name would be numbered onto a case literally named that way, such as a second `pays` and a case named `pays#1`. The error names the file and both names.

## 0.14.0

### Minor Changes

- b71e2ed: A checkout's record moves onto a newer mainline record its HEAD contains

  A checkout's record keeps a ledger beside it, `coverage.layer.json`: the mainline record it was laid on, and the test files its own runs observed with the commit and working tree each ran over. When `select` or `variance share --suite` reads a newer mainline record whose commit HEAD contains, the record moves onto it, and every test file this checkout did not run reads the newer one. A record of a commit HEAD does not contain changes nothing. The `record of "<suite>":` line names the mainline commit, the distance to HEAD, and the test files this checkout ran.

### Patch Changes

- d5a51ca: A partial clone fetches the texts at a recorded commit in one request

  In a clone made with `--filter`, such as `actions/checkout` with `filter: blob:none`, the files changed since a recording's commit are on the remote until something reads them, and `git cat-file --batch` fetched each one in a request of its own. Reading a recording's text now asks without fetching first, fetches every blob it found missing in one request from the remote that promised them, then reads those again. On a blobless clone of Material UI from GitHub, fifteen texts took 9.0 s fetched one at a time and 0.7 s fetched together. A fetch that fails falls back to fetching one object at a time, as before. A full clone runs nothing extra.
- cf7d8d4: A test a partial run did not observe runs again after its code was edited under that run

  When a run of some tests lands over an uncommitted edit, the record keeps the edited text and selection reads later changes from it. A test that was not in the run but had entered an edited region kept its crossing and stayed whole, and the next selection, diffing from the kept text, saw no change and skipped it — though it never ran over the edit. Landing now demotes every such test to incomplete, so it runs at the next selection and is recorded again. An edit at a module's top level demotes every test that loaded the module and was not in the run.

## 0.13.0

### Minor Changes

- ebbec80: A call the source leaves short is placed from what the case ran, and no test runner's config is read

  The journeys walk no longer reads Vite's or Vitest's `resolve.alias`. When an import resolves to no function, the walk places the call on the one function the case entered that a file of the checkout exports under the imported name. That is the default export for a default import, and the member for a call through a namespace import. When the import names a workspace package, the function must be exported from that package. An import of a Node builtin, or of a package a manifest declares and no workspace holds, is never placed this way. When several entered functions match, the call is reported as ambiguous, and the walk's other inferences still get a turn. An import that resolves to a function the case did not enter stays where it resolved. `variance index` counts both outcomes in its journeys line, and the orient legend names a recorded caller.

  `@variance-authority/sense` no longer exports `runnerAliases`, `runnerConfigs`, `runnerDigest`, `keptRunnerAliases`, `unlistedRunnerAliases`, or the types `RunnerAlias` and `RunnerAliases`. `NativeJourneysPrepared` loses the `aliased` and `runnerUnread` fields, and `prepareJourneys` on the native binding takes the Node builtin names as a new last argument.
- 7dda58a: A worktree's first test run lays the mainline record last fetched on this machine, with its runs record, into its own layer, and falls back to the primary checkout's record only when nothing was fetched. `seedTestCoverage` returns which one it laid and `noteSeeded` prints it. The runner integrations never fetch: `lastFetchedMainline` reads the name a fetch writes last, as `fetched.json` beside `<cache>/share/read/<suite>/`, and `layFetchedMainline` lays what it names. `FETCHED_MAINLINE`, `mainlineReadRoot`, `readFetchedMainline` and `writeFetchedMainline` are exported for a fetcher of your own.
- 573afba: A third-party name in `ask search` and `ask symbol` says whose manifest offers it

  Each installed third-party name in a `variance ask search` answer gives its version, the manifest that offers it, how that manifest declares it (`dependency`, `optional`, `peer` or `dev`), and how many times the code under that manifest imports it, with the first import as `file:line`. `variance ask symbol` prints the same line above the declaration. With `--from` or `--to`, `ask search` offers a name only when the manifest that owns one of those paths declares or imports its package. A package that only another workspace declares is left out, even when the path imports that workspace. When no third-party name matches, the answer says how many packages it searched and under which manifests. The next `variance index` rewrites the dependency lexicon with these fields.
- 573afba: `variance ask stack --from <path>` lists every third-party package a path can use

  It takes no words. `variance ask stack`, and the `docs_stack` tool on the workspace API server, read the manifest that owns the path and list each package it declares or that the code under it imports: the version, the role (`runtime`, `dev` or `types-only`), how the manifest declares it, and how many times the code imports it, with the first import as `file:line`. Imported packages come first, then the ones declared and not imported, then the ones whose imports were not read. A declaration the resolver could not read is listed with the reason. A page is 40 rows unless `--limit` says otherwise, and `variance ask` takes `--offset <n>` to skip rows. Each page ends with how many rows remain and the `--offset` that asks for the next page. The answer reads only the dependency lexicon that `variance index` writes and opens no installed package. `dependencyStackNative` in `@variance-authority/sense` is the call it makes.
- 573afba: Python, Rust, Swift, Java and Kotlin files store their size

  The source index stores the bytes and the lines of code of every file a tree-sitter grammar reads, as it does for JavaScript and TypeScript. A line of code is a line with something other than a comment or whitespace, and a comment is a node the language's grammar names as one, such as `line_comment` and `block_comment` in Rust. A Python docstring counts as code. A file with a syntax error is still sized, and a comment inside the part the parser could not read counts as code. A file the grammar cannot parse at all has no size. `fileSizes` returns these files without `blocks`, because the instrument does not cut them into regions. The source index format moves to version 15, so an existing index is rebuilt once.
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
- 573afba: `variance ask orient --files` names the cases that ran a file by importing it, and gives every share and package flow as counts

  The recording credits no case with code that ran while a module was evaluated. For such a file, `orient --files` finds the recorded test files that import it, over the source index, and counts their cases: `5 cases ran it, 3 of them by importing it`. When the source index names no importers, the line says so. In the packages part, every share has its count beside it, and a share over fewer than 10 uses is printed as the count alone, for example `3 of 7`. The package flows of the recorded cases are headed `Observed:` and count the packages each case ran code in together, as combinations and not as calls from one package to another. A `variance ask search` answer that lists exported names ends with the `variance ask orient --files` question for the first file it names. `orientAround` in `@variance-authority/sense` reads the packages and the external dependencies around a set of files in one pass.
- 573afba: `variance ask search` finds an installed package by what it says it does

  `variance ask search --query "state management"` lists, after the name matches, the installed packages that describe that job. When `variance index` refreshes the dependency lexicon, it stores the word stems each installed package uses: from its manifest `description` and `keywords`, its README headings, its package name, and its exported names with the first sentence of their documentation. A package is listed when those stems contain at least half of the distinct stems of the query. A package whose own description, keywords or headings contain them comes before one that matches only through its names. Each row gives the version, the manifest that offers the package and how it declares it, how many times the code imports it, the package's description, and the query words it matched. A question reads only the stored stems and opens no package. A dependency lexicon written before this release answers without these rows until the next `variance index` rewrites it.
- 573afba: `variance ask symbol --from <path>` answers as the workspace that owns the path

  For an installed third-party name, `--from` takes a file or a directory, and the answer uses the manifest that owns it: the version installed for that workspace and the signature declared in that version. Two workspaces that install different versions of one package each get their own signature. When that manifest neither declares nor imports the package, the answer says the name is not usable from the path and lists every manifest that offers it, each with its version.
- 573afba: `variance journeys` lands each shard's case index with its snapshot

  `variance journeys`, given shard snapshots, merges them into the record this checkout reads, which is landing them. It now also merges the `<coverageFile>.cases.bin` beside each shard into the case index beside the landed snapshot, replacing the cases of every test file that shard ran to the end, and `covering`, `coverage` and `review` answer from the result. The landing prints `cases of N snapshots laid over <index>`. A shard that ran a test file to the end with no case index beside it removes the index, and the landing says why. When another process holds the record's lock, nothing is written and `journeys` exits non-zero with `nothing landed at <path>: another process is holding <file>.lock. Land again once that run ends.`

  `@variance-authority/sense/test-selection` exports `landCaseIndexes` and `withIndexLock`, the two a landing of your own needs to write the snapshot and its case index under one lock. The Storybook and Playwright recorders merge a run's cases into the case index rather than replacing it. When another process holds the case index lock, they keep the snapshot they wrote and print `variance-authority recorded this run's files, but not its cases: …`. Every reader opens the case index beside the snapshot it reads.
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

### Patch Changes

- cbd3b60: A test run that fails before it ends takes its shims off

  The setup and case-runner modules the Vitest and Rstest seams write under `.variance-authority/` are now removed when the process exits, if the run's own end did not remove them. Before, a Vitest run that failed before any file ran — a typecheck whose checker could not start is one — exited without calling a reporter or closing its server, and left both files in the project.
- af7e1b5: `variance journeys <shard>...` now writes `coverage.runs.json` beside the snapshot it lands. Before, it left the record describing the runs before the landing. The fold counts as one run at the shards' commit and follows the same rules as `landRun`. At a new commit, `standing` is carried forward from the record it replaces, and `over` names the commit the snapshot stood at. A test that record cannot place is listed in `standing` at that record's `over`, marked `assumed: true`, and carried there, so a later run's `over` no longer moves where `test:since` reads it from; `test:since` reads an assumed entry as an assumption and says so. A test that last ran at the commit a run lands at, and that the run did not observe, is listed there rather than left out. At the commit the record already names, the fold's test files are added to `files` and `over` is kept. `over` is written whatever the history between the two commits, without asking git, so a landing outside the checkout records the same thing as one inside it. `variance review` now asks git, where it runs, whether the runs' commit descends from `over`. When it does, the change is read from `over`. When it does not, as when the main line's shards land over a branch's runs, the review takes the path it takes for runs laid over nothing: the mainline record, or a refusal. When git cannot say, because the clone does not hold `over` or is shallow and its history between the two is cut, the review is refused, naming the commit to fetch. A record with no `commit` is asked about the checked-out commit. A record whose `over` is its own `commit`, which a first run at a snapshot already at that commit writes, starts there. A record whose commits are not full object names is refused. The review sets `GIT_NO_LAZY_FETCH`, so git 2.45 or later never fetches `over` from a partial clone's remote; older git ignores the variable, and a partial clone that lacks `over` fetches it from its promisor remote when asked. A snapshot at the run's commit beside a record of another commit is read as a landing that renamed its snapshot and not its record: the run names the commit the record names as `over`, and carries `standing` from that record, so landing again repairs the runs record. The same shape is left by a snapshot landed by an earlier `variance journeys`, which never updated the record, and by a snapshot restored without its runs record beside an older one: the first run at the snapshot's commit then starts at the commit that record names, and a review whose runs do not descend from it takes the path runs laid over nothing take. Outside a checkout, where neither names a commit, no start is written. A runs record the landing cannot read is written afresh, as `landRun` writes one, and the landing names it on stderr. The record is staged and renamed under the snapshot's lock, like the snapshot. A landing that fails leaves both unchanged. `@variance-authority/sense` exports `commitRunsAfter` and `writeCommitRuns`, the rules and the write `landRun` uses, and the `RecordedTests` type they read.
- dd303b6: A line deleted above a module's first statement or below its last selects no test

  The recorder starts a module's region at its first statement and ends it at its last, so a license comment above the imports, or a comment after the last function, is in no region. Selection read a deleted line there as a line the recording never saw, and charged every region of the module: deleting a license comment beside a change to one function selected every test that ran any function of the file. That line now charges nothing, the same as a line inserted between two functions. Text inserted above the first line of such a file is read the same way.
- b3c1bdf: `variance ask uses` and `ask symbol` answer for a name that no entry publishes but that another package imports by the path of its file, such as `addTax` from `@acme/lib/src/internal/math`. They no longer refuse it. Each import is listed with its file and line and marked as a deep import, past the entry the package declares, or as an import by path from a package that declares none. `symbol` also says where the name is declared and why nothing publishes it. A name that is exported without being published and that nothing imports is still refused, and the refusal names the file and line that export it.

  A workspace package with none of `exports`, `main`, `types` or `typings` is no longer skipped. `ask packages` and `ask entrypoint` list it by the files and names other packages import from it, each with the importer's file and line, and none of those imports are called deep. A `.js` `main` with no `types` and no `.d.ts` beside it opens at the `.ts` or `.tsx` source of the same stem, as TypeScript reads it.
- e3a1af5: A `pnpm-lock.yaml` that opens on `---` compares its install

  A pnpm that pins itself writes the lockfile as two YAML documents: the package manager and its configuration dependencies first, the install second. TanStack Query's lockfile has this shape. The reader refused it at line 1, so every lockfile change made `variance select` and `yarn test:since` run the whole suite. It now splits the file where pnpm does, reads both documents, and a bumped package selects the tests that entered a module importing it. A byte-order mark and CRLF line ends read the same as pnpm reads them. A refusal names the line in the file, not the line in the document.
- a91e761: A test run recorded over an edit keeps the text it ran over

  A run's line ranges count lines in the text on disk while the suite ran, and the commit the recording names holds a different text whenever the tree was dirty. Selection used to charge every region of such a module and ask for a recording over a clean tree, so the ordinary loop — edit, `yarn test`, then revert or commit — ran every test that ever entered each file it touched. On Zod that was 2 of 199 test files skipped where 197 could be.

  Landing a run now keeps the text of every recorded module git reports as changed, in the cache under `.texts/`, named by the digest the recording already holds. `variance select`, `variance covering` and `yarn test:since` read a change to such a module from the kept text to the text on disk. A module is still charged whole when its text was not kept: edited again while the suite ran, or the cache cleared since. The note then says so, and that the next run that loads the module records it again.
- 573afba: A test run refused by a busy snapshot lock prints only that it recorded nothing

  When another process keeps `coverage.bin.lock` for the ten seconds a writer waits, the Vitest and Rstest plugins and the Jest reporter write neither the snapshot nor the case index, and print one warning: `variance-authority recorded nothing from this run: another process is holding <file>.lock: nothing was recorded rather than merged over whatever it is writing.` When the snapshot was written and the case index lock beside it is the busy one, they print `variance-authority recorded this run's files, but not its cases: another process is holding <file>.cases.bin.lock, and the cases were dropped rather than merged over whatever it is writing.` The warning that a run instrumented 0 modules, so selection from its snapshot will select nothing, is printed only when the run wrote a snapshot.
- db025cb: A worktree's first run, or its first landing, seeds a runs record beside the snapshot it copies from the primary checkout: a copy of the primary checkout's runs record, with no run of the worktree's in it. So after partial runs in the worktree, a test it never ran is read from where the primary checkout's record says it last ran, and is selected once a change reaches it. A test that record does not place is read from where its runs started and reported as assumed, in the worktree as in the primary checkout. When the primary checkout has no runs record, or one naming another commit than its snapshot, nothing is seeded. `variance review` in a worktree that has not run still asks for `--since`, and the worktree's first run at the primary checkout's commit starts its own change rather than counting as another run of the primary checkout's.
- f80460c: `variance index` keeps a file it declined until the file changes

  A file the scan declines by its bytes — over the size it opens (`largestFile`, one megabyte by default), or a module that is not UTF-8 — is recorded with its reason and no edges. That record names the bytes it declined, by Git's object name, so an update over an unchanged checkout keeps it and reports `0 read again`, without opening the file to decline it again. On Material UI that file is `packages/mui-icons-material/lib/index.js`, at 2.4 MB. A decline for size holds only while the checked-out file is still over the limit, because under `core.autocrlf` or LFS Git's object is other bytes than the file. A file that could not be opened or read is tried again on the next update, and so is a declined file Git names no bytes for: one reached through a symbolic link, an ignored file, or any file outside a Git checkout. A scan that passes its own `largestFile` counts that limit as part of its configuration, so raising the limit reads the declined files.
- b2317fa: `variance ask journey-map` says why a file has no map

  When the recording lists nothing for the file you asked about, the answer says why.

  - A test file is named as a test file, with the three modules its recorded tests ran most. Each module shows how many of the file's tests ran it and how many of all recorded tests did.
  - A directory is named as a directory: the map is drawn around one file, so the answer asks for one of the files in it.
  - A path that git does not list in the checkout and the recording does not hold is refused as not in the checkout. The refusal names the recorded path one typo away, as `ask slowest-tests` already does, or else the recorded files with the same name in other directories. A file on disk that git ignores is named as ignored instead.
  - A file that existed at the commit the recording was made at and is gone from the checkout is named as deleted since, from the CLI and from `journeyMap` alike.
  - A file that did not exist at that commit is named as new since the recording.
  - For any other file, the answer says no recorded test loaded it only when git lists it at that commit, the test run instruments files of its kind, and the recording lists other files in the same directory. Files in the directories below do not count, and a file at the repository root is judged by the files at the root. Even then the answer names the one case the recording cannot rule out: a module the test run is configured to leave uninstrumented. Otherwise the answer says the recording cannot tell, and why.
  - The path may be spelled through `..` or from the root of the file system; the map names it from the root of the checkout. A path outside the checkout is refused as outside it.
  - `journeyMap` and `journeyMaps` take the listing `checkoutListing` returns, so a caller that already asked git about the path does not ask again.
  - `ask journey-map` and `ask slowest-tests` share one check for a path that is not in the checkout. It accepts a new file that git lists as untracked and not ignored, which `ask slowest-tests` refused before.
- 2f75494: `review --since` compares only the test files a run before this commit recorded

  After a whole run into an empty cache and a selected run at the same commit, `review --since HEAD` reported every region the unselected files entered as gained: 231 on TanStack Query, 153 on Zod, where nothing moved. A run laid over no case index now names its files as having no base until a run at the commit runs them again, and `review` leaves them out of the comparison and lists them: "Not compared, no case of these was recorded before this commit's first run".
- 9d9c635: `variance select` no longer skips a test that a partial run left out when a file it entered changed after it last ran. It reads each test from the commit `coverage.runs.json` says it last ran at, reads the files changed since then whole for that test, compares the install at that exact commit, and prints a note for each such commit. When the runs record does not say where a test last ran, the note says which commit it was read from instead. A test file that is no longer on disk is left out of the reading and named in a note; a test git does not list, such as a generated or untracked one, is still read from where it last ran. An install that cannot be compared, because git cannot resolve the commit it is compared from, skips nothing. A patch handed in with `--diff` is read as the whole change, and a note says so when some test last ran before the journal's commit. `readCommitRuns` refuses a `coverage.runs.json` that is there and cannot be read, or is not a JSON object, with an error that names the file; `variance select` refuses it too, except under `--diff`, where it leaves out the note and says why. The lockfile in the working tree is read and parsed once per selection. `@variance-authority/sense/test-selection` exports this reading as `standsAt` and `readingFrom`, with `askPerStand`, `withoutFiles` and `wholeEntry`, and `yarn test:since` uses the same code, so both read a `standing` entry marked `assumed` as an assumption and say so. A runner's `landRun` and `variance journeys` write a `coverage.runs.json` they cannot read afresh and name it on stderr, through `heldCommitRuns`, which is exported with the `StandingEntry` type of a `standing` entry.
- 1b227e5: `coverage.runs.json` carries `standing`: for each test in the snapshot that the runs at its commit did not observe, the commit it last ran at, oldest first. `landRun` carries it forward from the record it replaces, so after partial runs at two commits a test that neither ran still names the commit before both. A record written before this field reads as every such test standing on `over`. `over` and `files` keep their meaning.

## 0.12.0

### Minor Changes

- 0d67928: `symbol` names the README of a dependency that ships no declarations, and the passage that names the symbol
- 509e699: `variance coverage` lists the files no suite recorded. The source index now stores each JavaScript and TypeScript file's bytes, lines of code and the regions the instrument would cut from it, so the report adds a `source:` block: how many product files are in scope, which of them no suite recorded, by directory, and a second ratio over every region in that source. The files the test harness loads, which are what the preconditions every test declares reach through their imports, are listed apart as before reach, counted within the scope's own entry points, and counted as run in that ratio, which says what share of the run they are. Without `--from`, the source is what every declared directory's entry points reach, and each directory gets a row of its own. `--packages` gives every workspace the root `package.json` names a row, counted over its own files and over everything they import. `--from <dir>` measures one part of a monorepo apart: what the directory's entry points reach along its imports, with shared packages it imports included. Entry points are declared in the root `variance.config.json` under `entrypoints`, for example `{ "packages/apps/next": ["app/**"] }`; a directory with none declared starts from every file under it. `sourceScope`, `fileSizes` and `matchesGlob` in `@variance-authority/sense`, and `parseEntrypoints`, `declaredEntrypoints` and `sharedPreconditions` in `@variance-authority/sense/test-selection`, are what it reads. The source index format moves to version 14, so an existing index is rebuilt once.
- dad30ec: `journeysAmong` answers with the calls a chosen set of tests placed

  The prepared journeys now keep which cases placed each call, not only how many. `journeysAmong(root, cases, suite)` takes cases by their position in the recording and returns every call those cases placed, counted among them, with how many cases placed it in all and how the call is known. Nothing is truncated. So a question that kept 15 of the 50 tests through a file maps what those 15 reach, and a call only the other 35 made is left out. Journeys prepared by an earlier walk are prepared again on the next `variance index`.
- 63751d2: `variance ask orient --files` names the calls into and out of each file

  `variance index` now walks each case of the latest recording over the static call graph and writes the result beside the source index. `orient --files <path>[:<line>]` reads it: for each file, the functions the most cases ran, the functions in other files that call into it and those it calls, each with its case count and how the call is known, and the package flows those cases take through the file. With a line, the calls narrow to the function holding it, and a line written after the recording says so. When the recording or the index changed after the walk, the answer says `not prepared` and why, and never answers from an older walk. The walk resolves an import the way the test runner did, through each Vite or Vitest config's `resolve.alias`.

### Patch Changes

- 6cee6cf: The dependency lexicon no longer enumerates every file a package's `./*` export opens; a subpath through a pattern is read when a source file imports it
- 4bea04c: A region an edit beside it renumbered, such as the second of two callbacks after the first was deleted, is no longer read as one region lost and another gained. Siblings of the same name are paired by their cases first, and `caseMotion` returns the ones it paired this way as `renumbered`, which the motion text counts on a line of its own. Each test file's line now names the functions it entered and left, grouped by file, instead of a count of regions. `variance review --format markdown` draws the same motion as a Mermaid diagram, from test files to directories, above the folded text. `variance review --from-run <run id or URL>` downloads the `variance-review` artifact with `gh run download` and prints the review the run made.

## 0.11.0

### Minor Changes

- c2c4a55: `variance coverage` counts how much of the code your suites load each declared suite runs, from the case index each suite already records: one share per suite, all over the same total, how many regions more than one kind of suite runs, and how many only one kind runs. With a base, which is each suite's mainline record in the share, or `--suite <name> --against <record>`, it prints each count at the base and now, and the regions gained, lost, written and deleted that add up to the change. `--format markdown` prints a table for a job summary. It exits `0` whatever the numbers are. `countCoverage` and `coverageChange` in `@variance-authority/sense/test-selection` are the counts it prints.
- 7556a03: The cache is inside the checkout. Without `cacheRoot` in `variance.config.json`, it is `node_modules/.cache/variance-authority` at the repository root, so a coding agent whose sandbox allows writes only in the working tree records and reads the same cache as your terminal and CI. `XDG_CACHE_HOME` is no longer read; `VARIANCE_AUTHORITY_CACHE`, an absolute path, names the cache directory for a harness that keeps its runs apart. A recording under `~/.cache/variance-authority` is not read, so the first `yarn test` after upgrading records again. `variance index` also publishes the value `variance ask` answers from, so `ask search` answers in a fresh checkout, and prints a `questions:` line saying where it is or why it could not be written. [The cache](https://variance-authority.dev/docs/cache) page describes the order.

  `readWorkspace` in `@variance-authority/help` takes `packs`, whether the scan reads bytes from Git's object store, and `saveIndex`, whether publishing also writes the scan's records back to the source index; `variance index` turns it off, because it has just published that index itself.

### Patch Changes

- 73d6aff: Reading a journey file for a change decompresses only the runs the question reads: the changed modules' regions, their test sets, and the strings they name. A module is found by a binary search of the file's sorted paths, and a file whose module rows are out of order is answered through a table of every path instead. Every journey file is now written with its module rows in code-unit order of path.
- 2418e90: Instrumented code, worker journals and module records name every module by its repository-relative path, and the cache no longer keeps `names.bin`. Every record file already stores its paths in its own sorted table, so a `coverage.bin` or `journeys.bin` reads the same on any machine and needs no table from the one that wrote it. A Jest run no longer transforms a file a second time after its first recorded run, because the module's id is no longer part of the transform's cache key. The first run after upgrading transforms every file once, as Jest's cache key changes.

  A worker journal whose module row carries a number, and a module record filed under one, are no longer read: nothing writes either. The native addon is now installed by renaming a copy over the old one, because macOS kills a process that loads a `.node` file rewritten in place.
- 56282b1: `variance index` exits `2` with `source index not written: <reason>, at <path>` when the file system refuses the index, instead of reporting it built. `updateSourceIndex` returns the refusal as `refused`; a scan anywhere else still treats an unwritable cache as a cold next run. A `variance ask` question no longer narrows the source index it reads: a workspace whose path runs through a link, such as a checkout under macOS's `/var`, is scanned whole, and a scan of only some of a repository's directories publishes its answer without writing over the index of the whole. Before, either one could leave `variance select` unable to trace a lockfile bump to the tests it reaches.

## 0.10.0

### Minor Changes

- 947337c: A test-selection recording keeps each test file's and each test case's duration as its runner reported it

  The coverage file gains a `tests.duration` column: the whole milliseconds Vitest, Jest or Rstest reported for the file, or the `duration` you pass to `startRecording().finish()`. The case index gains the same column for each case: Vitest's task result, Jest's assertion result, Rstest's test result, or the `duration` of a case in the `cases` you pass to `finish()`. A file or case the runner reported nothing for has no duration, never zero, and recordings written before this open with every duration absent.

  `variance ask slowest-tests` (`docs_slowest_tests`) lists the files, then the cases, the latest recorded run spent longest in. `--from <path>[,...]` keeps the tests declared under those paths, `--to <path>[,...]` keeps the tests the recording says entered code in them, and the two combine; counts are within that scope, a `to` path the recording has no row for is named as unrecorded, and a path in neither the recording nor the checkout is refused with the nearest recorded path. `recordedDurations` and `recordedPaths` in `@variance-authority/sense` are the reading behind it. `didYouMean` and `nearest` move to `@variance-authority/mcp/tools`, so both binaries suggest a name the same way.
- 486caa3: Declare the test suites your repository runs, each with its kind, under `suites` in the root `variance.config.json`: `{ "suites": { "unit": { "kind": "unit" }, "stories": { "kind": "visual" } } }`. The kind is one of `unit`, `integration`, `e2e` and `visual`. Each declared suite records on its own, under `suites/<name>/` in the cache, with its case index and runs log beside it, so a run of one suite never replaces what another recorded. A worktree seeds each suite from the same suite in the primary checkout.

  Every recording integration takes a `suite` option: the Vitest, Jest and Rstest seams, `startRecording`, `recordExecution`, the Playwright reporter and `varianceExecution`, and the Storybook collector's `tests`. Once `suites` is declared, a run that names no suite, names one the file does not declare, or names both a suite and a `coverageFile` stops before it starts. A repository that declares no suites keeps its one record. `testCoverageFile` and `readableTestCoverage` take `{ suite, cacheRoot }` as their second argument, where they took a bare `cacheRoot` string, and `declaredSuites`, `parseSuites`, `recordFileFor`, `SUITE_KINDS` and `SuitesError` are exported from `@variance-authority/sense/test-selection`. The CLI refuses `suites` in a config file below the repository root.
- 75417b5: Python, Rust, Java, Kotlin and Swift are read only by the grammars built into the native addon, and a scan needs the addon to start. The WebAssembly readers are gone, and so are `web-tree-sitter` and the grammar packages that came with them. On a machine where the addon does not load, a scan stops before it opens a file and says why the addon did not load. It no longer lists files it cannot read. If the addon is built without the grammars, files in those five languages are recorded as unknown, with that reason. A scan whose native batch fails now fails with that error. It used to retry file by file without saying so.

  Kotlin files now read their package and imports. Until now the addon's Kotlin reader looked for node names from a different Kotlin grammar, so every Kotlin file was recorded as asking for nothing. It also publishes a top-level `typealias` and `val` now.
- daf1de1: A service with no host filesystem, such as a Cloudflare Worker, can now write journey parts. Set `parts` or `VARIANCE_AUTHORITY_PARTS` to an `http(s)://` address, and start `receiveParts(directory)` from `@variance-authority/sense/journey` on the host to serve it. Each journey's frame is sent before its scope's promise settles, so a runtime that ends a request's work with its response still delivers it.

  `testSelectionProbes({ journeys: true })` installs the journey head under the build's `label` before any instrumented module runs. A realm now holds one collector: `collectJourneys()` returns the installed one until it is closed. A part file is named on its first write, so a head can be installed at a Worker's global scope.
- d68ad38: A Playwright run's recording times its spec files and test cases with `testInfo.duration`

  Each test's `testInfo.duration` — the body, its `beforeEach` hooks and the fixtures set up for it — is recorded on its case in the case index and summed onto its spec file in the coverage file, so `variance ask slowest-tests` ranks Playwright tests beside Vitest, Jest and Rstest ones. A retried test is timed as the sum of its attempts. A run whose workers stage their contributions carries the durations, and each case's retry outcome, through the fold the reporter makes.
- 7b431e0: `variance review` says what a change did, after the suite ran it: how each changed module was edited, the changed regions no case covered and those only tests further than one import away covered, the cases added and removed, the changed files the tests declare as preconditions, and the installed packages the lockfile changed. It prints `text`, `markdown` or `json`, and `--out <dir>` also writes `review.json` and `review.md`. The markdown starts with a hidden marker line, so a pipeline edits its own pull request comment instead of posting another.

  Every run of the suite now writes `coverage.runs.json` beside the recording: the commit it ran at, the commit the recording stood at before the runs at that commit, and the test files they ran. A retry or a second shard at the same commit keeps that starting point. `variance review` with no `--since` starts there. `commitRunsFile`, `readCommitRuns` and `landRun` read and write it from `@variance-authority/sense/test-selection`, and `testsGovernedBy`, which names the test files that declare a given file as a precondition, is exported beside them.
- e6d586a: Runs at one commit add to `cases.before.bin` instead of replacing it, so a suite split over several invocations keeps the replaced cases of every file it ran. `cases.last.json` names the commit those cases were recorded at under `before`, and drops it once a run at the same commit runs a file again, because that file's replaced cases are then the commit's own. Its `files` lists every test file the runs at the commit announced.

  `variance review` compares with those cases and leaves out, and names, what the base's branch changed after their commit. `--against` is no longer needed in a pipeline, and no copy of the case index is either. `variance covering --cases last` names that commit too.

### Patch Changes

- 86e9f94: `variance select` and `variance review` read the record your mainline published when the root config gives the suite to the share with `"carry": "share"` and your checkout has no base of its own: `select` when the suite has no recording here, and `review` when the runs here were laid over no recording and no `--since` names a start. The record is kept under `<cache>/share/read/<suite>/<commit>/`, never where the suite records. `select` says on stderr which record it read, and its `--format json` journal adds `from`, `mainline` and `distance`. `review` starts at the commit the mainline published at and compares cases with that record's; for a record published past the merge base it starts at the merge base, names both commits, and leaves the record's cases out. Its `base` is `mainline`, with a `mainline` field naming the line, suite, commit, distance and kept path. When the mainline's record cannot be read — a share section that does not parse, a share that refused or could not be reached, a record that cannot be kept, or one that does not read, names no commit, or was recorded at a commit other than the one it was published at — a note says so and what the share answered, `select` skips nothing, and `review` is refused with the same note. A per-case index that does not read is named and left out. The record a branch published to its `branch/<name>` line is never read. `@variance-authority/sense/test-selection` exports `rootConfig`.
- e341793: A relative import of a declaration-only sibling resolves to its `.d.ts`

  In a package of shared types, where `config.d.ts` imports `./context` and only `context.d.ts` exists, the import was unresolved, and a change to one declaration reached none of the files that import it. A declaration file is now tried last, when the request finds no other file inside your repository or outside it, and `./context.js` finds `context.d.ts` the way `nodenext` writes the request. A module, a stylesheet or a `.json` file of the same name stays the target, and so does a `.js` beside the declaration, because the `.js` is what a runtime import loads. A declaration under a build's `outDir` never answers this way, so a request into built output resolves the same whether you have built or not. Stored records are read again once, because the rule changes what they hold.
- 68c9240: `export default name` records `name` as the export's `local`, where it recorded `default`. The exported name already says `default`, and the identifier is what joins the default to the file's own declaration or to the import it republishes, through that request's bindings. A default that is an expression or an anonymous declaration still has no `local`. Stored parses are read again once, because the source index they are kept in moves to a new version.

  Help follows `export default name` to its import by that `local`, so a comment between `default` and the name no longer stops it with "no declaration there says what it is". A name the file declares is still answered by its declaration: `export const logger = OriginalLogger` is a `const`, as TypeScript's declaration emit publishes it.
- 46bc11b: An import into a `build/` directory Git tracks lands on the file it names. The scan already read a tracked `build/` as source, but it declined any resolved target under a directory named `build`, so an import such as `./build/build` in Docusaurus's `src/commands/cli.ts` kept its specifier under `unresolved`, and an edit to that command reached nothing that imports it. A tracked `build/` file is now a target like any other, whichever way the scan reads the tree. An import of one that your change adds or removes lands on the same file, so selection walks from it when it asks the `sideEffects` field what loading it does. A `build/` your `.gitignore` covers stays declined, a scan with `digests: false` declines every `build/` because it does not ask Git, and `dist/` and the other output directories stay declined whatever Git tracks. Stored records are read again once, because records change where they point.
- c4b2e6e: A `tsconfig` whose `extends` names one of your workspace's own packages, such as `"@company/tsconfig/base.json"`, no longer makes every run cold after a file is added, moved or deleted. The source index follows that `extends` the way the resolver does, through the package's `node_modules` link and its `exports`, back to the tracked `tsconfig` it names, and reads the `paths` and `baseUrl` there. One added file then rebuilds only the records whose imports could have been answered from the directory it landed in. Until now any package `extends` removed that bound for the whole tree, so one added file rebuilt every record. The bound still does not hold when an `extends` names a package that is not installed, a base installed from a registry, a file outside your checkout, an absolute path, or a file not named `tsconfig*.json` or `jsconfig.json`. In a repository whose `tsconfig` extends a workspace package, the first run after upgrading rebuilds every record once, because the configuration digest the records are keyed on changes.
- fd1f3fc: An import that resolves into a workspace package's built output is read as the source file it is emitted from, taken from the `outDir` and `rootDir` the package's `tsconfig` names. A workspace whose manifests export only `./dist/index.js` now has file edges between its packages, so `variance reach` walks from a changed source file into the packages that import it, and the answer is the same whether or not the packages were built. Output whose source was deleted is not a target. A config that sets `noEmit` is skipped, so a package that type-checks with `tsconfig.json` and builds with `tsconfig.build.json` is read through the second. When two configs write into one `outDir`, the first whose `rootDir` holds the source answers. A config that sets `emitDeclarationOnly` maps only declarations, so code a bundler writes beside them is read as it is. A package under `node_modules` is never read this way. A `sideEffects` pattern that names built output, such as `./dist/register.js`, matches the source it is built from. Stored records are read again once, because the rule is part of their key.

## 0.9.0

### Minor Changes

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
- 9b0c94d: `variance covering --cases last|<test file>` answers from the chosen cases instead of the whole suite

  `last` is the run that wrote the case index last. A test file is every case the
  index holds for it. The answer starts by saying which cases it was read from,
  and `--format json` names them under `scope`. `caseLayerFiles` in `@variance-authority/sense/test-selection` names
  the files beside the index that record the last run and what that run replaced.
- 0b81e06: Sense has one module reader now: the native addon. The JavaScript reader it used without the addon is gone. On a machine where the addon does not load, reading a module fails with the reason instead of falling back to a slower second copy. That copy had already fallen behind: it never recorded the names read off `import()` or a namespace.

  A React component in a `.js`, `.mjs` or `.cjs` file now reads with its JSX, both in the file graph and when test selection reads a change. The addon used to leave JSX off for those extensions. A scan without the addon hid the problem, and on a machine with the addon those files got no edges, and a change to one was charged as a file that does not parse.
- 2958674: `variance reach` and `variance run --since` walk from the exports a JavaScript or TypeScript edit changed, not from the whole file. A file that imports only exports the edit left as they were is not reached, and a barrel passes each changed export on under the name it republishes it as. Stderr names the changed exports of each file, and `variance reach --format json` lists them under `exports`. A namespace import, a `require`, a dynamic `import()` and an import that binds nothing are still walked whole. `affectedBy` in `@variance-authority/core/relate` takes `moved`, the exports each seed changed, and `relationsOfFiles` takes `uses`, the names each import binds; `readPublishedSources` in `@variance-authority/sense` returns that lookup, read from the parses the index already stores.

### Patch Changes

- A scan of a Swift package no longer crashes Node 24 and 25. `Package.swift` is now read by the addon's Swift grammar. The WebAssembly grammar made V8 abort with `Fatal process out of memory: Zone` while it compiled.
- fce1fd6: `variance covering --format refs` numbers each case once and names every range's cases by number

  The table at the end lists each test file once with its cases under it, and a
  range reads `1-5 walked: 1,3-11,2*`, where `*` marks a case that was inside only
  while the module evaluated. The text answer names each test file once, prints
  a case's id only when it is not the file and the name, and a range walked by
  cases already listed points at the range that listed them.
- f7e5b66: `variance select --execution` reads each changed module from both of its texts before charging its lines, as a selection from the snapshot already does. A comment added above a function sits between two declarations, in the region the module ran as it loaded, and it was charged to every file that imports the module: one comment in a widely imported file selected thousands of test files where the runtime change beside it selected six. The old text is the blob the patch names. A change that proves to run nothing now charges nothing, and one that leaves what the module does as it loads charges only the functions its lines fall in. A patch without `index` lines is charged by its lines, as before, and `select` prints each file's reading.
- f529451: A Vitest run started with `--reporter` records

  A command-line `--reporter` replaces the configured reporters, and an editor that runs a test from the gutter passes its own. `withTestSelection` now folds such a run when its server closes, from what its case runner wrote, so the record and the case index are written as for any other run. A project with its own `runner` is told the run recorded nothing, instead of getting no record and no message.
- c1fdf46: A `pnpm-lock.yaml` that aliases a package to a tarball URL is read. pnpm writes that key unquoted, `zod443@https://registry.npmjs.org/zod/-/zod-4.4.3.tgz:`, and the reader split it at the first colon, refused the file, and `variance select` ran every test on any commit that changed the lockfile. A plain key now ends where YAML ends it, at the first colon followed by a space or the end of the line.
- aa57273: `ask uses` finds a name your code reads off `import()` or `import * as`. It used to answer that nothing imported `narrowByJourneys` when `select-command.ts` read it as `selection.narrowByJourneys` after `const selection = await import(…)`. Such a site now names the line that loads the module, and an `import()` site says the module loads when that call runs, not when the file loads.

  The parse carries these reads as `members`, apart from each request's `bindings`, so test selection reads exactly what it read before. The source index moves to version 12 and the help snapshot to version 3, and each is rebuilt on the first question after the upgrade.
- 0580380: A subpath import such as `import { x } from '#polyfill'` is an edge in the file graph. Both scanners cut every specifier at its first `#`, which is right for a stylesheet's `url(#gradient)` and left a subpath import empty, so a change to the file a `package.json` `imports` map names reached none of its importers. A leading `#` in a module specifier now resolves through the `imports` field, a stylesheet fragment stays external, and `select --execution` can resolve a `#` import a diff added to ask whether its package declares `sideEffects`.
- b04ad08: A type in a decorated class is now read as a load-time change. Under `emitDecoratorMetadata`, TypeScript writes the types of a decorated class's constructor parameters and decorated members into metadata calls that run when the class is defined, and a dependency-injection container reads them. Changing the type of an injected service used to read as `none` and select nothing. A changed parameter decorator such as `@Inject(TOKEN)`, which also runs when the class is defined, used to read as a function body. Types inside method bodies, and in classes with no decorator, still select nothing.
- dea658f: A JSX pragma comment that is added, removed or given another argument (`@jsx`, `@jsxFrag`, `@jsxImportSource`, `@jsxRuntime`) is now read as a load-time change, so it selects every test that loaded the file. It used to read as `none` and select nothing, although it decides what every element compiles to and which runtime the module imports.
- f7d90dc: A project's configuration governs its own tests. In a Vitest run with `projects`, a project's config file, the local modules it imports and its setup files are preconditions of that project's tests only, and the setup files are resolved against the project's own root, so one named relative to it is declared rather than missed. Jest reads each test's setup and environment files from the project it ran under, and Rstest keeps a named project's setup files for its own tests. The configuration that lists the projects stays a precondition of every test, and a test whose project the runner does not name rests on every project's files.
- 28c7086: `@variance-authority/sense/runner` records a suite from a runner this package has no seam for. `startRecording` opens the run and folds it, `registerRecording` instruments ES modules, CommonJS and Node-stripped TypeScript through `module.registerHooks` (or `instrumentModule` from the runner's own transform), and `observeTestFile` brackets each test file and case. Processes a runner forks join the recording through `VARIANCE_AUTHORITY_RECORDING`, and the snapshot is the one `variance select` already reads.
- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.
- 990ac1a: The agent skills name the commands that ship

  The test-selection skill no longer says there is no command line: it routes
  to `variance select`, `reach`, `index` and `covering`. The CLI skill lists
  every command that reads no config, and covers `covering --hops`, `--cases`,
  the per-file rows, `gained` motion and the `unrecorded` refusal. The workspace
  skill names `variance ask` as the same six questions.
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
- 9b0c94d: A run of one test file no longer erases every other case from the case index

  `cases.bin` held the last run's cases and nothing else. After `vitest run
  src/cart.test.ts`, `covering` and both editors marked every region that file did
  not reach as unwalked, even though the rest of the suite reaches it. The index is
  now updated the way the snapshot is. A test file that ran to the end has its
  cases replaced. A file that did not finish keeps its old cases, and the ones that
  ran again are updated. A test file that is gone from the checkout loses its
  cases. Every other case is kept. Kept cases are matched to the regions recorded
  now by name, structural path and kind. A region that no longer matches drops
  them instead of moving them to a guessed place.

  Two files now sit beside the index. `cases.last.json` names the run that wrote it
  last: its commit, time, test files and cases. `cases.before.bin` holds what the
  index had for those test files before the run replaced them.
- 743385a: A file resolves under the `customConditions` of the `tsconfig` that governs it, added to `source`, `import`, `require` and `default`. A workspace whose packages export source under a condition of their own, such as `"@tanstack/custom-condition": "./src/index.ts"` beside an `import` that names built output the checkout does not hold, now has edges into that source, so `variance reach` walks from a changed package into the packages that import it. `extends` is followed the way TypeScript follows it: a config that sets the option replaces what it inherits, and `null` or `[]` clears it. A named `tsconfig` supplies its own conditions, and `conditionNames` you pass stay the whole set. Stored records are read again once, because the conditions a record was resolved under are part of its key.

## 0.8.1

### Patch Changes

- 96a50bf: A changed file that one module imports as an asset and another declares with `/// <depends path>` selects the tests behind both. The walk from an asset now follows `depends` edges as well as `asset` edges.
- 96a50bf: `variance run --since` and `variance select` print one line per changed file saying how it was read, or why it was not, and name each test that loaded it through an import the file graph does not list; `variance select --format json` gives the same readings as `readings`, and `@variance-authority/sense/test-selection` exports the formatter as `readingLines`.

## 0.8.0

### Minor Changes

- 3cb0ce8: An edit at a module's top level is now charged by what it does, not by the
  lines it sits on. Before, any such edit selected every test that loaded the
  module. With `sourceAt`, each changed file is read from the recorded text and
  the text the diff makes of it, and gets one verdict. A comment, a type or
  formatting selects nothing. A new function, or an edit inside one, selects the
  tests that entered the changed regions. A changed top-level value, such as
  `LIMIT = 10` becoming `20`, also selects the tests that entered a function
  reading it, in the file or in a file that imports it. An edit that changes what
  the module runs as it loads still selects every test that loaded it.

  `narrowByExecution` returns `readings`, one per changed file: the verdict and
  the names whose values moved, or why the file could not be read (`source`,
  `hunk`, `parse` or `addon`). A test selected through a read carries a `reader`
  reason naming the value, the file that declares it and the file that reads it.
  `test:since` prints a line per reading.

  A change travels by use. A new module selects nothing until something calls it,
  and an import added to a file charges the functions that use its names, not
  every test that loads the file. With `root`, the nearest `package.json` of a
  changed file, and of every file an added or removed import loads that the file
  did not already load, is asked for `sideEffects`: a declared file, or an
  importer that starts or stops loading one, is read as `load`, and its reading
  lists the declared files in `effects`. A test that loaded a changed module through no
  importer the graph holds is listed in the reading's `unseen` and no longer
  selected.
- 97e1ce6: A module can name a file it reads without importing it:
  `/// <depends path="./schema.graphql" />`, anywhere in the file. The scan draws
  a `depends` edge to that file, so a change to it reaches the tests that load
  the module. TypeScript and every runtime read the line as a comment. A directive
  that names no `path` is reported in the file's `unknown`. The source index
  format moves to version 11, so an existing index is read again once.
- 956ef8b: A function's region now starts at its parameter list, not at its body. An edit
  to a parameter selects the tests that called the function. Before, it selected
  every test that loaded the module around the function. A function in a
  parameter's default value is now owned by the function whose parameter it is.
  The instrumentation ids are now `sense:instrument/presence-v5` and
  `sense:instrument/entries-v2`, so a recording made under the old ids is read as
  stale and recorded again.
- 4250eda: Every run records which case entered each region. The `cases` option is removed
  from `withTestSelection` for Vitest, Jest and Rstest, from the Playwright
  recorder and reporter, and from the Storybook recorder: each writes
  `<coverage file>.cases.bin` beside the file-level snapshot, or `executionFile`
  when you name one. A test file that runs in a page is still recorded per file,
  and says so.

  Without `continuations: true`, a file whose cases overlap no longer fails the
  run. It is recorded as a whole, so a change it reaches runs every case in it, and
  the run names the two cases that were open at once.
- e3f608d: Instrumentation now runs in the native addon only. `instrument()` without the
  addon throws and names the package that did not load, rather than recording
  nothing. The addon now names a regular-expression key as `String(regex)` does,
  and writes a lone surrogate in a key as `\uXXXX`. A source whose text holds a
  lone surrogate is left uninstrumented. The `Edit` type is removed from
  `@variance-authority/sense/instrument`.
- e4ee0da: The repository names its cache. Set `cacheRoot` in the `variance.config.json` at the repository root, for example `".variance/cache"`, and every command, every test runner integration and every function that takes a `cacheRoot` option uses that directory. The path resolves against the repository root. Without the key the cache is `$XDG_CACHE_HOME/variance-authority`, or `~/.cache/variance-authority`, as before, so an existing recording stays where it is. The key is read before the environment, so a sandboxed agent that sets `XDG_CACHE_HOME` to a temporary directory no longer splits the recording away from your own runs. [The cache](https://variance-authority.dev/docs/cache) page describes the location, what is in it, worktrees and CI.

  `@variance-authority/sense` exports `cacheRootFor(root)`, which returns that answer, and `CACHE_CONFIG`. `defaultCacheRoot` is removed; call `cacheRootFor(root)`. A `cacheRoot` option now names the variance-authority directory itself, and `test-selection/` is created under it. `testCoverageFile`, `seedTestCoverage`, `readableTestCoverage`, `moduleNamesFile`, `openModuleNames`, `recordStore`, `recordStores` and `repositoryLayers` take an optional `cacheRoot`. An empty or relative `XDG_CACHE_HOME` is ignored rather than resolved against the working directory. A root `variance.config.json` that is not JSON, or whose `cacheRoot` is not a non-empty string, is an error.

  `@variance-authority/cli` accepts `cacheRoot` in the config and in the schema, and refuses it in a `variance.config.json` below the repository root. `variance run`'s render cache and suite indexes are under it. `renderCacheRoot` and `suiteIndexPath` take the config.

### Patch Changes

- 3cb0ce8: A call that throws while a function's parameters bind now counts as entering
  the function. Before, `f('label')` against `function f(label, { required })`
  threw before the body ran, so the test was never recorded as entering `f`. An
  edit that gave the parameter a default then selected nobody. The function's
  `length`, its `arguments` and the order its parameters bind in are unchanged.
  The one exception is a first parameter that is an object pattern: its text
  stays as written, because Vitest, Playwright and Rstest read fixture names from
  it.

  An edit to any line of a multi-line `await` now also selects the tests that
  entered the function, not only the tests that resumed after it. The awaited
  expression is evaluated before the await settles, so a test whose promise
  rejected ran that line too.
- 3cb0ce8: A region that a transform writes with no source-map origin is now recorded with
  no lines. Before, it was given the line it had in the generated text. The main
  case is the helpers esbuild writes above the first line of a module with a
  decorator, which landed on the lines below them. An edit to a function after a
  decorated class then selected the test that ran the helpers instead of the test
  that called the function. Selection, `covering` and journeys skip a region with
  no lines. A module recorded before this change keeps the old lines until a run
  records it again.
- 1ce9a2e: `@variance-authority/sense-linux-arm64-gnu` carries the prebuilt scanner for
  Linux on arm64 against glibc 2.17 or newer, so Docker on Apple Silicon and arm
  CI runners load the addon rather than building it.

## 0.7.0

### Minor Changes

- c6543c7: A head's account that lands after the last spec is recorded

  A head reports a request when what its handler returned settles, which can be
  well after the response went out: a streamed body, a write behind, a log flushed
  after `end()`. When that happened in the last spec a worker ran, the account
  reached a worker that had already stopped listening, and it was dropped without
  a word. If every account from a head went that way, the run blamed the head for
  reporting nothing.

  A head now says a request opened before the handler runs, and every account
  says it settled. At teardown the worker waits up to five seconds for every
  opened request to settle before it records. One still open after that retires
  the run with a reason that names the head, as a silent head does.
  `unsettledScopes`, exported from `@variance-authority/sense/journey`, gives a
  driver of its own the same count to wait on.
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
- 03d5589: `withTestSelection` records a browser-mode suite, under Vitest and under Rstest

  A test file that ran in a page recorded nothing. The setup module wrote its
  journal with `node:fs`, which a page does not have: Vitest stopped at the first
  import, and Rstest refused to build the suite.

  In a page, the setup module now installs the collector a Storybook preview
  uses. It attaches what the file ran to the file's own task in Vitest, or to the
  file's context in Rstest, and the runner carries it back to the reporter. The
  snapshot is the one a jsdom run writes, per test file, whether browser mode is
  set in the configuration or with `--browser.enabled`. Measured on Vitest 2, 3
  and 4, with and without isolation, and on Rstest 0.12.

  `cases` is not recorded in a page. A run that asks for it gets the file-level
  snapshot and a warning, rather than an empty case index.

### Patch Changes

- cb58788: A case index is replaced whole, never written in place

  `recordExecution` and the case fold wrote `.cases.bin` over the previous file.
  A worker killed during the write left an index the next `--since` could not
  decode. The index is now written beside the old one and renamed over it, as the
  snapshot already was.
- 3dc39cc: A mock no longer disowns what a case crossed. The runner installs a mock before the file's first case, so every crossing recorded inside a case or a hook ran the real module and selects that case, even in a module its file mocks. A mock still cuts what ran only while the module was evaluated, which is how a runner shapes an automock.
- 46f513e: A changed `package.json` is set aside only when the install comparison reads all of its change. A diff that moves `exports`, `imports`, `main`, `module`, `browser`, `type`, `sideEffects`, `name` or any field outside the dependency and publishing fields selected nothing and printed that the diff changed only manifests, while every importer of that package now loaded a different file. Each changed manifest is now read at both revisions, and one that moved a field the lockfile does not hold makes its package a changed directory: the walk reaches every importer, and a journal read charges every file of the package whole. `manifestMoved` in `@variance-authority/sense/lock` owns which fields the install speaks for.
- 66371ac: An update where nothing moved took about 2.8 s and 1.19 GB on 288,197 paths. It now takes about 1.5 s and 0.95 GB. Three things caused the extra cost. `updateSourceIndex` decoded the published chain twice, and now opens it once. At the top of a checkout the tree snapshot asked `git status --untracked-files=all -- .`, which git's untracked cache cannot answer. It now asks `--untracked-files=normal` with no pathspec, and lists each directory that `status` collapses with `git ls-files --others --exclude-standard`. With `core.fsmonitor` and `core.untrackedCache` set, that call costs 17 ms on a 41,171-path clone, down from 55 ms. The native snapshot no longer sorts a listing that git has already printed in order.

  This also fixes a defect in the native snapshot. A new directory in the working tree made `git hash-object` fail, and every path in the same batch was dropped, so files that existed were missing from the index. The directory is now expanded into its files before hashing.
- 846ab0d: A source index written before package names joined its dictionary could name a package after the file's first relative specifier. A package imported only by subpath, such as `@variance-authority/core/segment`, had no string of its own in the segment, and its id became row 0: whatever sorted first, which is usually a `../` request. The graph then held a package node called `../exit.js` whose importer never wrote `exit`. A cold cache showed nothing, because it encoded again with the fixed build. The index is now format 9, so every older segment is rebuilt rather than trusted. A decode refuses a stored package name that `packageOf` would not produce, and reads the segment as damaged. The source index, the execution indexes and the MCP source tree now intern through `intern` in `@variance-authority/core/segment`, which throws on a string the dictionary never collected rather than writing row 0.
- 6bb7386: What a handler's unreturned promise runs is recorded against its request

  A handler can start work it does not return: a write behind, an analytics
  call, a cache warmed after the response. That work still runs as the request,
  but once the request's scope had reported, the head forgot where the request's
  reports went. So everything the promise ran was dropped, with nothing counted
  and nothing said, and the next `--since` could skip the spec that caused it.

  The head now remembers where each journey reports after its scope closes, for
  the last 4096 journeys. What such a promise runs goes back as a scope of its
  own, which the driver waits for like any other. If a journey is too old to be
  remembered, the account is counted as lost, which retires the run.
- cf11776: The mock reader reads `jest.requireActual` and `vi.importActual` anywhere in a test file as an import of that module, and a mock of the same module no longer shadows it. A test that hands its mock the original implementation — `jest.fn(jest.requireActual('./x').X)`, or a `beforeEach` that restores it — is selected again when that module or anything under it changes. Cached mock readings from earlier versions are read again once.
- 23123e6: A driver a head first hears from late still gets every subject's initialization

  A head reported what ran outside any request, and what a module ran while it
  initialized, to whichever driver's request happened to be open. Under two
  workers the second never heard it, so its subjects missed the lines every
  request depends on, and a change to a module's top level could skip them.

  A head now keeps that account and sends each driver the part it has not been
  told, the first time that driver's request settles. `Channel.home` names the
  driver a channel reaches, which is what the head keys on.
- 2747428: A page with two instrumented bundles reports what it ran

  Every bundle built with `testSelectionProbes()` brings its own copy of the page
  collector. When a page loaded two of them, such as an application and a widget
  built separately, or a collector module that was evaluated a second time, the
  second copy wrote its crossings to the first copy's log. It then replaced the
  first copy's drain with its own, which reads a log nothing writes to. The driver
  then drained an empty journal, recorded that the page ran nothing, and the next
  `--since` skipped the subject over lines it had run.

  The drain now belongs to the collector that installed the log. A later copy
  adds its crossings to that log and leaves the drain in place.
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
- 16f6dd6: Recorded file names are relative to the repository root

  The Jest, Vitest and Rstest wrappers, the Playwright reporter and the Storybook
  collector now name every file relative to the root of the git checkout the run
  starts in. Before, when the config was inside a package, file names were
  relative to Jest's `rootDir` or Vitest's `root`. A recording made from
  `packages/cart` said `src/cart.ts` where a diff says `packages/cart/src/cart.ts`,
  and the two never matched. `rootDir` and `root` still resolve the config and the
  relative paths in its options. Outside a git checkout, names are relative to the
  directory the run starts in.

  A recording that an earlier version made from a package-level config uses the
  old names, so record it again. `repositoryRoot`, exported from
  `@variance-authority/sense/test-selection`, returns the directory that file
  names are relative to.
- 1b4c0db: The Vitest integration declares the config file it ran under

  The config file Vite loaded, and the local modules it bundled into it, are
  preconditions of every test the seam records, beside the setup files. An edit to
  `vitest.config.ts`, or to a module it imports, now selects the whole suite; a
  package the config imports is read as the install. A configuration that lists
  projects declares its own file too. Jest and Rstest do not say which config file
  they loaded, so name it in `preconditions` there.
- 03984ae: A file whose imports could not all be read no longer widens selection

  A `require(name)` or `import('./' + name)` has no written target. The walk uses
  the edges that were read in such a file, and the recorded run answers the one
  that was not: the module loads under the test however it was named.
  `affectedBy` seeds only the changed files, the closure digest does not mark such
  a file volatile, and it does not void a deviation baseline.

  Removed, not kept as aliases: `Affected.opaque`, `Hole`, `ReachReport.opaque`,
  `ReachHole` and `ReachedComponent.throughUnread`.

### Patch Changes

- c92543d: Write the per-case execution index with far less time and memory

  When a Jest or Vitest run records cases, the reporter now writes the index
  beside the snapshot with the bounded fold, which reads the case journals a
  slice at a time. On a 200-case run over a thousand ambient modules it takes
  51 ms and 7 MB of heap, where building the whole index as objects first took
  440 ms and 158 MB, at the end of the run, when workers have used most of the
  memory. A late second frame for a case that had already settled is joined into
  that case, as before. An `executionFile` ending in `.json` is written as it was.
- 1b4c0db: `import { type X } from './x'` is a runtime import

  A request is `type` only when its statement is written `import type` or
  `export type`, and a re-export only when every statement naming it is. An import
  whose names are all marked `type` inline stays a runtime edge, because under
  `verbatimModuleSyntax` TypeScript emits `import {} from './x'` and the module
  loads; which setting applies is in a `tsconfig` the scan does not read. Each
  binding still says it is a type. The JavaScript and native scans agree on this,
  and the source index moves to version 7, so a parse cached under the old rule
  is parsed again rather than read.
- 76fdc4d: A test that mocks a module is no longer selected when that module changes

  `vi.mock` and `jest.mock` without a factory still evaluate the real module so
  the runner can shape the automock. The recording saw that evaluation, so an
  edit to a mocked module selected every test that had replaced it. Now, when the
  file graph carries the taints' shadows, a test is not selected for a module it
  mocks, or for anything it reaches only through the mock, whatever the record
  shows it crossing there: the test ran against the mock, and a mock whose shape
  drifted from the real module is a type error. `coveringChange` takes the graph
  as `relations` and drops those cases the same way. `auditTaints` reports
  `shadowed-but-entered` only when the test called into the real module, which is
  a mock that did not take; loading it to shape the automock is the mock working.
- 8adc864: `--no-git` reads source from disk, and a scan no longer makes Git fetch in a partial clone

  `variance select` and `variance reach` take `--no-git`: source is read from the
  disk rather than from Git's object store, and Git still supplies the diff. The
  scan walks directories instead of Git's list of tracked files, and cached parse
  results, which are keyed by Git object names, are not reused.

  Without the flag, a file whose object is missing from the local Git store is
  read from the disk. Before, in a partial clone, reading it made Git fetch the
  object from the remote.
- 83409da: A recorded test run spends less time in instrumented code

  The probe in each instrumented region now sets one flag the first time a test
  runs the region, where it used to increment a counter on every run. A hit costs
  1.2 to 3.2 ns, down from 2.6 to 4.4 ns. Recordings are byte-identical to the
  ones earlier versions wrote.
- fdc698f: Read the collector once per module, which makes recording under Jest much faster

  Jest runs each test file inside a `vm` context. Every global read there passes
  through an interceptor, and the probe read `globalThis.__VA__` on every hit.
  Now each instrumented module reads it once and keeps it. On the same loop in a
  `vm` context, 729 ms of probing drops to 12 ms or less. That read was most of
  what recording cost under Jest, and it was the likeliest reason recorded cases
  ran past their timeouts. Vitest runs in the main realm and gains nothing
  measurable.

  A collector must now keep the object on `globalThis.__VA__` for the life of the
  realm, and redirect counts through its `s` resolver instead of replacing it.
  Every collector shipped in this package now does. Jest's transform cache now keys
  on the probe text as well, so the first run after the upgrade instruments again
  rather than serving the old probe from cache.
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
- 8adc864: Coverage from two builds that divide a file into different regions is recorded against the regions both have

  Two transforms of the same source can divide it into regions differently, so a
  region number from one build names a different region in the other.
  `variance journeys stitch` refused such shards, and folding them recorded
  coverage against the wrong region. Now a region that only one build has is
  recorded against the smallest containing region that every build has, or
  against the whole file when there is none. A changed line there selects every
  test that ran the containing region: the selection is wider, and it does not
  miss a test. `variance journeys finalize` and `stitch` print the files this
  applies to.

## 0.5.10

### Patch Changes

- 118424a: Write each case's journal when it settles, not when its file ends

  With per-case recording on, a test worker used to hold a counter array for
  every module every case touched until the file's `afterAll`. A file of a
  thousand cases held a thousand sets, mostly zeros. Each case is now written and
  dropped as soon as it settles, so a worker holds one case's counters and the
  file's union. What ran before the first test is closed in the first
  `beforeAll` as a record of its own, rather than copied. Work that outlives its
  case arrives as a second frame for that case, and the reader joins the two.

  Writing a journal reads each counter array once instead of six times, which
  takes the encoding of a thousand-case file 7.5 times faster, and byte for byte
  the same.

## 0.5.9

### Patch Changes

- 50be015: Instrument modules in the native scanner

  `instrument()` now parses, walks and splices in the addon, so the syntax tree
  never crosses into JavaScript: 64 µs a module instead of 161 µs over this
  repository's sources, byte for byte the same output. Without the addon, the
  JavaScript walk answers as before.

  A module whose first statement after its imports is a top-level `await` no
  longer loses its probe runtime: the header used to land inside the `await`'s
  probe and was not declared.

  The scanner on Apple Silicon hashes with the ARMv8 SHA instructions, five
  times faster than before, which every digest it takes shares.
- c52c84f: Say why the native scanner did not load

  Finalizing or stitching journeys without the scanner now carries the loader's
  own message — a missing package, or a `dlopen` refusal naming the glibc symbol —
  instead of only naming the addon.

## 0.5.8

### Patch Changes

- afafa47: Build the native scanner without the tree-sitter grammars when they are what failed

  The five grammars are C parsers compiled by whatever toolchain the machine has,
  which is a way for the build to fail that the rest of the crate does not have. A
  failed build is now retried with them dropped, and says so loudly. Python, Rust,
  Java, Kotlin and Swift are then read by the JavaScript readers that are the
  implementation of record; nothing else about the scanner changes.

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

### Patch Changes

- Publish the Jest journey finalizer

  The Sense package includes the `sense-journeys` command and its native fold and
  stitch implementation. A Jest journey run can now be finalized after Jest exits
  using the files installed from the package.

## 0.5.2

### Patch Changes

- 1e64a5a: Record Jest journey coverage after the test run

  Sense seals each Jest shard's per-test region journals before Jest exits. The
  `sense-journeys finalize` command folds one shard into a compressed artifact,
  and `sense-journeys stitch` combines downloaded shard artifacts on another
  machine. Both commands process the crossing relation in the native addon and
  write the result without transferring artifact bytes through the JavaScript
  heap.

## 0.5.1

### Patch Changes

- 65374a4: Add recording-only Jest journey coverage, deterministic assembly of shard artifacts,
  and one case scope for table-driven tests.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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

### Patch Changes

- 838f187: Layering a recording onto a snapshot costs the change, not the snapshot

  Publishing decoded every module the snapshot held. A path string and an array
  per row, a map from path to rows, and one object a module — so a run that
  re-recorded ten modules of two hundred thousand still built two hundred
  thousand of each, and the heap a publish needed grew with the file it was
  layering onto rather than with the run it was layering.

  The rows are in code-unit order and so is the dictionary above them, so a
  path's place among the strings decides its place among the rows. Both searches
  are now binary and integer, the modules nobody touched are never decoded or
  compared, and the output's order is one `Int32Array` — four bytes a carried
  module — in place of the objects. Heap is flat in snapshot size at 6.6 to 7.7
  MB, where it was 9.4 MB at ten thousand modules and 18.6 MB at eighty
  thousand. What still scales is the columns themselves: total live memory falls
  from 1.07 to 0.89 MB per thousand modules.

  The bytes are the bytes. This is an optimization of a function that already
  existed, and the gate test still asserts the output is identical to the merge
  and encode it replaces.

## 0.3.0

### Minor Changes

- fc59417: A case survives Vitest 4, and an uninstrumentable file says why

  `withTestSelection({ cases: true })` reported *no tests*, wrote an execution index
  with nothing in it, and exited zero. Green, and empty — which is the worst shape a
  failure can take, because nothing downstream has any reason to look.

  The setup shim and the case runner were virtual ids this plugin resolved and
  loaded. Vitest 4 loads `setupFiles` and `test.runner` through Vite's module
  runner, which resolves them *before* any plugin of the test config is consulted,
  so both came back `ERR_MODULE_NOT_FOUND`. They are real files on disk now, at
  absolute paths, written under `.variance-authority/` and named after the run — a
  path needs no plugin on any major, and the per-run name keeps a watch run and a
  CLI run over one project from writing each other's shim. The files are removed once the
  journals are folded, though the directory itself stays; git does not track an
  empty directory, but add `.variance-authority/` to your ignore file if you would
  rather not see it, or if a crashed run leaves a shim behind.

  The `vitest` peer range was `^2.1.9`, so installing beside Vitest 3 or 4 either
  failed outright or required an override to attempt at all. It is now
  `^2.1.9 || ^3.0.0 || ^4.0.0`.

  **A `globalSetup` file is no longer instrumented.** It runs once, in the Vitest
  process, before any test environment exists — the shim that installs
  `globalThis.__VA__` is a `setupFiles` entry and has never run there. Instrumented,
  such a file threw at its first probe and took the whole suite down before a single
  test loaded. The resolved config names these files, so they are excluded by path
  rather than guessed at from their names.

  **And when a probe does find no factory, it says so.** `globalThis.__VA__ is not a
  function` names a missing global and leaves you to discover that the global
  belongs to a transform you did not ask for, on a file you did not expect it on.
  The error now names the file, says an instrumented module ran outside the
  environment the shim initialises, lists the contexts where that happens — a
  `globalSetup` file, a config file, a build script — and tells you to narrow
  `include`.
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
- f075738: The native scanner arrives prebuilt, for three platforms

  The Rust scanner that reads, parses, resolves and records a cold checkout used
  to exist only where somebody had a Rust toolchain and had run the build. It now
  ships: `@variance-authority/sense-darwin-arm64`,
  `@variance-authority/sense-linux-x64-gnu` and
  `@variance-authority/sense-win32-x64-msvc` are optional dependencies of this
  package, your package manager unpacks the one your machine matches, and nothing
  compiles on install — there is no install script here and no `cargo` in the
  picture.

  **Three platforms, not nine.** An Apple Silicon laptop, a Linux x64 CI runner,
  a Windows x64 desktop. The list is short because it can afford to be: the
  TypeScript scanner is the implementation of record and the addon is an
  acceleration of it, held to the same answers by differential tests, so a Linux
  arm64 runner or an Alpine image builds the same source index and pays what the
  TypeScript scan costs. Adding a platform is a decision about a machine somebody
  ships from, not a completeness exercise.
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

- 4bf6682: A file two projects both ran is one row, and a region the transform inverted keeps its span

  Two ways a recording was lost rather than narrowed, both found by recording
  public repositories that were not written with this in mind.

  **A test file matched by two projects destroyed the whole record.** A runner's
  projects exist to run the same files under different conditions — Zod reruns its
  entire suite with ahead-of-time compilation turned on — and each project
  announces its own finished file for the same path. The snapshot is keyed by
  path, so the second announcement met a key the encode already held and threw
  `duplicate test coverage observation`. Nothing was written: one project
  configured that way and the run produces no record at all, on a workspace where
  selection would otherwise have been worth the most.

  The unit is the path, because the unit of the answer is the path — a selector
  names files to skip, and skipping one skips it in every project that matched it.
  `complete` is now the conjunction of the runs: a file whose compile-mode run
  stopped early recorded less than it reaches, and the other project passing does
  not put the missing regions back.

  **A region could close above where it opened.** Solid's JSX compiler hoists each
  element into a template above the function that returns it, so a region opening
  inside the template reads back to a lower original line than it started on. A
  source map answers one position at a time and both answers are right; it is the
  pair that has to be an extent. The record now clamps the pair, where before the
  inverted span was refused when it was read back — quietly, and only for the
  files a JSX transform had moved.

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
- d50e020: A selection says how far the change travelled, and a loop runs the near end
  first.

  `distanceByExecution` reads the coverage file once and returns the narrowing
  together with, per selected test, the shortest path from the change to it
  **through the modules that test entered**. A walk over the import graph alone
  returns a shortest path from any change to any file, and it is the wrong one: it
  runs through modules the test never loaded, and a distance has to be true of the
  graph and of the record at once. `relations` is the graph, `knownAs` gives every
  name one module is held under so a built copy and its source are one node,
  `faces` says where a unit's public entry point is, and `enumerated` says whether
  the graph read a given file's imports at all. `distanceFromView` is the same
  reading over a snapshot already open, and `nearestFirst` is the comparison every
  consumer sorts by.

  Each `TestDistance` carries a `bearing`. `precondition` is the change being the
  test's own source — zero hops, and the only zero there is. `direct` and
  `transitive` are one hop and more, every hop landing on a module's public entry
  point. `reach-through` is a hop that landed inside a unit instead, and names the
  importer, what it reached, and the entry it went around. `unexplained` is a test
  the change reached along no chain of imports it executed, reported only when the
  rest of that run is accounted for. `unmeasured` is the opposite of a finding —
  the graph could not answer — and carries `because` saying which; a walk that was
  never possible is absent rather than zero.

  `indexFaces` reads the entry-point convention most repositories keep — a
  directory with an `index` module — and `eitherFace` stacks a caller's own
  provider in front of it, which is where a manifest reader belongs.

  `atDistance` takes the selected tests a given number of imports from the change,
  `remaining` names what a range left behind, `groupByDistance` reports the whole
  reading as one group per hop count, and `distanceRange` reads `2`, `0-2` and
  `3-` and refuses anything else rather than quietly running one distance. The
  range is hop counts rather than positions in a list, so it asks the same
  question whatever the reading turned out to hold: a change whose nearest test is
  five hops away answers `0-2` with nothing. Start a near range at `0` — zero is a
  test whose own source the edit touched, and a range starting at one leaves it
  until last. A test nobody could place runs with the range that reaches the end,
  so `0-2` and then `3-` runs every selected file exactly once.
- 0718464: Jest selects from a change.

  `@variance-authority/sense/jest` wraps a Jest configuration the way the Vitest
  seam wraps one: the project's transformer — `@swc/jest`, `ts-jest`,
  `babel-jest` — still runs first, its setup files and reporters stay in their
  order, and probes land on the transformed text. The probes ride Jest's own
  transform cache, so an unchanged module is neither transformed nor parsed again
  on a later run or in another worker, and the record of what its probes mean
  lives beside the cached text under the same key. Each test file journals to
  disk from `afterAll`, the reporter folds the journals when the run completes,
  and the result lands in the snapshot the Vitest and journal seams write. A
  file two projects of one run transformed under different options has two
  inventories, and the reporter records it as one the build could not read rather
  than fold one project's tests into the other's regions.
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

### Patch Changes

- e546e21: A run that instrumented nothing says so

  A vitest project inherits neither plugins nor setup files from the configuration
  around it, so the wrap that looks right — one at the root, projects beneath it —
  transforms no product module. Nothing fails: the suite runs, the reporter runs,
  the snapshot is written. It says every test reaches no source,
  `narrowByExecution` reads that as an answer, and every selection made from it
  narrows to the empty set. The first sign is a green pipeline that stopped
  testing.

  The reporter warns on the one state that is indistinguishable from a clean run
  and is not one: zero modules instrumented across one or more test files. Said
  rather than thrown, because zero is legitimate — a run filtered to a single test
  file that imports no source has nothing to instrument — and the message names the
  two misconfigurations it usually is, since "0 modules" on its own does not say
  which. Zero test files is left alone; the runner has already said that.

  Wrap each project, and keep one wrap at the root for the reporter that folds the
  run. The README carries the shape.
- f4b328b: A run leaves behind what its suite looked like, in bytes another checkout can read

  A run report answers about *this run*. Nothing answered about the suite from
  somewhere else: which components exist, which subjects hold them, which of them
  has an example of its own, and every name the run indexed. A branch asking any
  of that against `main` had nothing to ask, because `main`'s answers were computed
  on a machine that has since gone away — which is why *this component is not
  covered anywhere* was a question with no reader, and why a second run could only
  re-derive what the first already knew.

  `@variance-authority/report/suite-index` is that artifact. `suiteIndexOf` takes
  the baseline-bearing half of a report — the census, the subject denominator it is
  counted against, and the lexicon — and `encodeSuiteIndex` writes it as one
  segment, with `readSuiteIndex` and `writeSuiteIndex` beside the report's own file
  functions. The other half of a composition does not travel: `movements` is what
  moved since a comparison nobody else made, and `divergences` and `echoes` are
  readings of one commit's snapshots. None of the three is a fact about the suite.

  It carries the commit it was written at and nothing else about where it is, which
  is the rule the selection index already settled — a commit answers *what changed
  since this was written* exactly, and a timestamp says when a machine was rather
  than where a tree was. An index that cannot name itself is the honest record of a
  run that could not, and a reader holding one has nothing to diff.

  It is not JSON. A lexicon is the same few thousand strings written once per
  subject that holds them, and in JSON the repetition *is* the payload. Interned
  once and referenced by number it stops being one, and equal facts encode to equal
  bytes — a sorted dictionary, so a cache that keys on content actually hits.

  `@variance-authority/core/segment` is the arithmetic underneath: named columns,
  alignment, interned strings, and the validation a decode performs before it
  believes a file. A column's width comes from the array's own type, so a mismatch
  is a compile error rather than a decode against the wrong stride, and a malformed
  reference rejects the whole file — a segment is a cache or a baseline, both of
  which may be rebuilt, and half of either is worse than neither. The source index
  now reads and writes through it and keeps its own bytes; what it still owns is the
  part that is about source.
- 0718464: A layered run no longer turns a test's *entered this region* into *did not*.

  A subset run — one file by hand, a watch loop — layered over a full one
  positions the index where the subset stands and drops the crossings of every
  test it did not re-record on every region it rewrote, while still calling those
  tests whole. The next diff of such a region then skipped the one test known to
  have reached it. `mergeCoverage` now carries such a test incomplete: it runs at
  the next selection regardless of what changed, and that run records it whole.

## 0.1.1

### Patch Changes

- fe578c8: Record one coverage row for a subject the run read twice.

  Stabilization reads a subject again whenever the first read was not trusted, so
  a changed or unstable subject reaches `recordExecution` twice. It built one
  `CoverageTest` per observation and keyed them by owner, and the encoder refuses
  to intern two rows under one name: every second run of a moving Storybook suite
  died with `duplicate test coverage observation` and wrote no journal, which is a
  selection index that silently stops existing exactly when the suite starts
  moving.

  `recordExecution` now folds its subjects through `joinObservations` before
  anything reads them — the same join `@variance-authority/playwright-test`
  already applied at its call site and `@variance-authority/storybook-collector`
  did not. Folding inside the recorder rather than in each collector is what makes
  the one-row-per-owner invariant hold for collectors not yet written.

## 0.1.0

### Minor Changes

- 9587133: Stamp the coverage index with the commit it was recorded at, and read the module
  row that says the build never parsed a file.

  There is one master branch; every other checkout is that branch plus a diff, or
  minus one where it is behind. So the index now carries one field — the commit it
  stands at — and the distance from it is `git diff` and the working tree. Nothing
  is walked, nothing is scored, and a recording made outside a checkout carries no
  commit, which is the honest record of an index that cannot say where it is.

  `instrumented: false` was written to disk and read by nobody at selection time. A
  module the build could not parse has no blocks, so a changed line inside one
  selected the empty set and returned it as an answer — a subject that entered the
  file was skipped on the strength of a measurement that was never taken. That row
  is now read as the silence it is: the file comes back under `unread`, and
  selection widens the way the shape of the column always promised.

  Recording no longer refuses when the index it is about to write over cannot be
  decoded. That read happens under the index lock inside a runner's teardown, and
  refusing there stopped every later run from recording anything until somebody
  deleted the file by hand.
- f09528d: Carry announcements and coverage on one medium, under one execution id.

  A run said two kinds of things about the same execution and had two ways of
  saying them: journeys reported coverage, events announced decisions, and each
  had its own idea of where home was. Configuring one did not configure the other,
  and a service that could talk about what it decided still could not say what it
  executed.

  `@variance-authority/wire` is that one medium. It resolves the carrier from the
  realm — a sink the driver installed, for a server the suite started inside
  itself, or a loopback return address the request arrived with on a cookie — so
  the same `collectEvents()` and `collectJourneys()` calls serve a page, a service
  in another process, and an in-process server without knowing which they are in.
  Told neither, a participant reports to nobody, which is what a request the run
  did not drive should do. The return address is refused unless it is `http:` on
  loopback, because whoever is talking to the service writes that cookie.

  Two guarantees ride the one wire, chosen by what a loss costs. An announcement
  is fire-and-forget with per-endpoint ordering: a lost one is a wait that times
  out loudly in the driver, holding the diagnosis. A coverage account is
  acknowledged and retried: a lost one is a test silently skipped on the next run,
  so a head counts what it lost and carries the count on later accounts, and a
  head that lost everything is silent, which already retires the run.

  Nothing at this level writes a file. A service is handed a `Cookie` header
  naming the execution and where to answer, and nothing else; the driver alone
  writes the coverage index.
- cfb333d: Record what a driven page executed, so Storybook and Playwright select like Vitest.

  The execution selector had one origin: a Vitest run instrumented its own modules
  and wrote them down in the same process. A page cannot do that — the names and
  spans that make a block ordinal mean something are produced by whichever process
  ran the bundler, and for a driven run that process finished on Monday. So the
  two halves are now written separately and joined by the driver.
  `testSelectionProbes()` instruments product source in the adopter's own build
  and persists the block inventory; the collector it hoists counts crossings in the
  page; `recordExecution` merges drained journals into the same coverage
  index, with the same probes and the same ordinals.

  `@variance-authority/storybook-collector` records with `tests`, where a story is
  its own owner because this tool shows one at a time.
  `@variance-authority/playwright-test` records with the `varianceExecution`
  fixture option or `tests` on `createVariance`, where every observation in one
  spec file joins that file, because the file is the runner's unit of execution.
  Module-kind blocks go to every subject the run drained, since a module
  initializes once per page and charging it to whichever subject was first would
  leave the rest unselected by an edit they all read. Workers merge under a lock on
  the index. A missing inventory, a foreign probe recipe, and a page with no
  collector each record nothing and say why.

### Patch Changes

- 48d32eb: Select the tests a changed file governs, not only the tests that entered it.

  Selection asked coverage which module a changed file is and stopped when there
  was none. A test file is never a module — nothing enters a test — so editing or
  adding one selected nothing, and a CI job following the documented workflow ran
  zero tests on a commit that was entirely new tests. A declared `preconditions`
  entry is never a module either, so changing the runner configuration that governs
  every test also selected nothing. Both were silent: an empty list and a green
  run. A changed file with no module now selects every test whose recorded
  preconditions name it.
