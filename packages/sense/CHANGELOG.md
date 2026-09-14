# @variance-authority/sense

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
