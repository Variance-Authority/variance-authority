# @variance-authority/sense

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
  never possible is absent rather than zero (ADR-0002).

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
  - @variance-authority/wire@0.1.1

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
