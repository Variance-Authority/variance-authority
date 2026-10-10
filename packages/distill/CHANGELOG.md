# @variance-authority/distill

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
