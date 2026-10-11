# @variance-authority/mcp

## 0.15.0

### Minor Changes

- 4426cef: A file argument names one file, spelled from the checkout

  `variance_run_signals` kept every test whose spec file contained the `file`
  argument, so `tests/cart.spec.ts` also took `tests/cart.spec.tsx`, and `cart`
  took both. It now keeps the tests of the one file named, spelled as the listing
  spells it, from the repository root: `tests/../tests/cart.spec.ts` and an
  absolute path name `tests/cart.spec.ts`. Through `variance ask run-signals`, a
  relative path is read from the directory the question is asked in, as a shell
  reads it; through `variance-authority-mcp --watch`, from the repository root. A
  path outside the checkout is refused.

  The `varianceWatched` Playwright fixture names each watched test's file from
  the repository root, as the rest of the record does, rather than from the directory the runner was
  started in: a suite run from `packages/web` lists `packages/web/tests/cart.spec.ts`,
  not `tests/cart.spec.ts`. The watcher and `variance ask` take their checkout from
  git the same way.

  `variance distill --from` reads its directory from `--root`, the working
  directory by default, and spells it the same way. An absolute
  directory, or one with `..` in it, names the directory it resolves to instead of
  finding no test file under it, and a directory outside the checkout, which was
  answered as holding no test file, is refused.
- d5cc0c3: A baseline painted under another identity is compared, and the identity is the cause

  There is no `incomparable` verdict: a subject with two images is always
  compared, and reads `unchanged`, `changed`, `new` or `ignored`. When the two
  were painted under different identities, such as another browser version,
  platform, scale factor, font stack or recipe of this tool, the observation
  carries `signals.identity` (`recipe` or `machine`) and `signals.moved`, each
  moved field with both values, and its `because` opens with that cause. A
  `changed` subject fails the gate whatever its cause, and `variance accept --all`,
  Playwright Test's `--update-snapshots` and Vitest's `--update` adopt it like any
  other change. An `unchanged` subject under a moved identity is re-stamped
  under this run's identity by the same three, so an upgrade is named once rather
  than on every later run. A re-stamp approves nothing: `variance accept` counts
  it in `restamped` and its summary, not among the accepted subjects or the
  commit message, and the `variance_changelog` preview says so. A durable store's
  `put` moves a baseline along its line, one engine family on one platform at one
  scale: the line's older copy is removed, so a lookup never compares against a
  superseded image, while a matrix of engines or machines keeps one baseline
  each. A lookup that misses its own identity reads its line first. `variance_explain` names the moved identity as the
  cause of a change, and the tribunal no longer counts or lists an
  `incomparable` verdict. `@variance-authority/raster` exports `identityCause`,
  which says whether two identities differ in the recipe alone or in the machine,
  with its `IdentityCause` and `ComparedSides` types. `variance doctor` reports a
  store painted by another machine as `PAINTED ELSEWHERE` and exits `0`: the run
  compares it. Its `baselines.comparable` field is now `baselines.paintedHere`.
  The pull-request comment groups these
  subjects under "Painted under another identity", one line per identity that
  moved. Its section for subjects with no image to point at is headed "Nothing to
  point at", which was "Not compared".
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
- 42599cc: `variance ask discover` answers the files in every one of several sets

  Each set is read whole, with no cap: what a path reaches (`--from`) or what
  reaches it (`--to`), who imports a name (`--imports module#name`, through the
  barrels that pass it on when the module is a file, as `ask uses` reads it), who
  declares a name matching a pattern (`--declares`), and a path pattern (`--path`). Each
  has an `--except-` twin that takes its files out, and `--text` runs ripgrep over
  the files the other sets kept. The answer lists the files nearest the paths
  first, each with the line that put it in each set.

  `readTree` hands each file's declared and imported names to a `names` callback
  during the same scan, read off the parse it already made; a file whose parse
  holds no declarations, as on a checkout large enough for the addon to read
  whole, is read again for them, and the source index keeps what that read
  found. `readNamedTree` takes the question and reads names only for an operand
  that needs them. Over MCP,
  `docs_discover` answers `from`, `to`, `path` and a name imported out of a
  repository file, and refuses `declares` and any other `imports`, because the
  reading an MCP host serves holds no names.
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
- f65a928: The share token reads what review settled, and never decides

  A Tribunal deployment now serves `GET /review/changelog`, the new
  `GET /review/decisions` and `GET /review/concerns` to the share token as well as
  the review token, and refuses the ingest token there with 403. Every route that
  decides, or raises or moves a concern, still wants the review token. The
  deployment's API is 5. A share token you already handed
  out reads reviewer names and notes once you redeploy.

  `variance changelog` on a `remote` store reads the deployment's changelog with
  the share token instead of refusing; `--since` takes an instant there.
  `variance ask decisions` and the MCP tool `variance_decisions` on
  `variance serve` list the approvals and rejections on a subject or a build,
  newest first, with who made each and their note. Declare the share token as `{ "env": "VARIANCE_SHARE_TOKEN" }`.
- c337278: The share token reads what reviewers flagged, and why

  `variance ask concerns` and the MCP tool `variance_concerns` on `variance serve`
  list the concerns reviewers raised on a render: the title, the state (open,
  investigating or resolved), the region and component it is about, what the
  reviewer pointed at, and every step since with its note and hypothesis.
  `--subject` or `--build` names which; `--build` reads the concerns on every
  subject the build showed, whichever build raised them, and counts them by state;
  `--state` keeps one state. It reads the same deployment with the same share token
  as `variance ask decisions`, and raises, moves or resolves nothing.

  Every tool in `REVIEW_TOOLS` is a `ReviewTool`, naming the route its subject is
  read from and the query a call sends there, so a host reads each one the same way.
- 8187fb1: `didYouMean` and `nearest` are exported from `@variance-authority/core` and no
  longer from `@variance-authority/mcp/tools`. Import them from
  `@variance-authority/core`. A mistyped command or flag is refused, with the
  nearest right one, without loading the MCP server's tools.

### Patch Changes

- 73f40a8: `variance_changed_tests` prints what each case said, with the call that said it, on the case's line, as `variance covering --since` does.

  `variance covering` prints what each case said, and its twin, in every answer that lists cases. The `--since` text carries them on each case line, and the whole-file and plain `--line` or `--function` answers print each case's twin without `--where`; under `--format json` the answer carries `twins` in every form. A twin comes from the case's own test file, and a large set prints as its count and the first three names. `--where` counts out of the cases that covered what you asked about, not the whole record. When a case says one value twice, the row keeps the site that said it first. The `afterEach` warning, the invalid-value warning and the misplaced-call error name the call site from the checkout, as the row does, under every host that knows the checkout, including a runner built on `@variance-authority/sense/runner`.
- 9bb6f47: A moved identity names only the fields that differ

  When the baseline was painted under another identity, the `because` sentence
  names only the identity fields that differ between the baseline and this run,
  and says whether they are the machine (renderer, engine, platform, scale, fonts)
  or only variance-authority's recipe (the stabilization or rasterization digest).
  `recipeOnly`, exported from `@variance-authority/raster`, answers which.

  An observation from `@variance-authority/observe` carries `signals.document`,
  saying whether the document is the one the baseline was painted from, so a
  recipe change over an unchanged document reads apart from one that moved the
  page too. `signals.pixels` is optional, since a subject that occupies no pixels
  has none to measure; TypeScript code that reads `Observation.signals.pixels`
  must handle it being absent.

  `variance ask summary` prints a reason that several subjects share once, with a
  count, and lists the subjects under it, so an upgrade that moves every subject
  reads as one line rather than one per subject. It groups the same way the
  pull-request comment does, through `byReason`, exported from
  `@variance-authority/report`.
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

### Patch Changes

- 644520a: `variance_locate` and `variance_composition` name the run that has no lexicon or composition by what it read, not by its retention

  A run writes its lexicon and its composition whenever its collector gives a semantic snapshot, whatever its retention. When a report has neither, `variance_locate` and `variance_composition` said the run was raster-only or ephemeral. They now say the run read no markup: a raster-only capture, or a run whose collector gave only images. `variance_composition` also names the other report with no composition, a report merged from shards, instead of saying that no subject gave a snapshot.
- a7e7c9e: A changed subject with no difference shape is explained by what the run read, not by its retention

  A run fingerprints the regions of a changed subject whenever its collector gives a semantic snapshot, whatever its retention. When a subject has no shape, `variance_changes`, the PR comment and the review service's changelog page said the run compared without a document, in the ephemeral mode or on a raster-only path. They now say the run read no markup for that subject, or only its accessibility tree changed.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

### Minor Changes

- 947337c: A test-selection recording keeps each test file's and each test case's duration as its runner reported it

  The coverage file gains a `tests.duration` column: the whole milliseconds Vitest, Jest or Rstest reported for the file, or the `duration` you pass to `startRecording().finish()`. The case index gains the same column for each case: Vitest's task result, Jest's assertion result, Rstest's test result, or the `duration` of a case in the `cases` you pass to `finish()`. A file or case the runner reported nothing for has no duration, never zero, and recordings written before this open with every duration absent.

  `variance ask slowest-tests` (`docs_slowest_tests`) lists the files, then the cases, the latest recorded run spent longest in. `--from <path>[,...]` keeps the tests declared under those paths, `--to <path>[,...]` keeps the tests the recording says entered code in them, and the two combine; counts are within that scope, a `to` path the recording has no row for is named as unrecorded, and a path in neither the recording nor the checkout is refused with the nearest recorded path. `recordedDurations` and `recordedPaths` in `@variance-authority/sense` are the reading behind it. `didYouMean` and `nearest` move to `@variance-authority/mcp/tools`, so both binaries suggest a name the same way.

## 0.9.0

### Patch Changes

- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

### Patch Changes

- 846ab0d: A source index written before package names joined its dictionary could name a package after the file's first relative specifier. A package imported only by subpath, such as `@variance-authority/core/segment`, had no string of its own in the segment, and its id became row 0: whatever sorted first, which is usually a `../` request. The graph then held a package node called `../exit.js` whose importer never wrote `exit`. A cold cache showed nothing, because it encoded again with the fixed build. The index is now format 9, so every older segment is rebuilt rather than trusted. A decode refuses a stored package name that `packageOf` would not produce, and reads the segment as damaged. The source index, the execution indexes and the MCP source tree now intern through `intern` in `@variance-authority/core/segment`, which throws on a string the dictionary never collected rather than writing row 0.

## 0.6.0

### Minor Changes

- 03984ae: A file whose imports could not all be read no longer widens selection

  A `require(name)` or `import('./' + name)` has no written target. The walk uses
  the edges that were read in such a file, and the recorded run answers the one
  that was not: the module loads under the test however it was named.
  `affectedBy` seeds only the changed files, the closure digest does not mark such
  a file volatile, and it does not void a deviation baseline.

  Removed, not kept as aliases: `Affected.opaque`, `Hole`, `ReachReport.opaque`,
  `ReachHole` and `ReachedComponent.throughUnread`.

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

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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
- 26ae9ed: Distinguish the React component instance that initiated a commit from every
  component whose render body ran because of it.

  The commit tap retains `memoizedUpdaters` as bounded structural component paths,
  and Eyes records those commits in the authored test chronology. The MCP testing
  surface places update initiators inside or outside the component paths a test
  addressed while keeping whole-test source execution separate.

  Export bounded read-only Fiber subtree, parent-chain, component-path, and source
  location helpers for diagnostics that already hold a Fiber.
- a87d008: Hold what a running suite is saying in a process an agent can ask, so a test in
  flight is something to look at rather than something to wait for.

  A suite already knows what nothing outside it can see: which realms answered and
  in what order, which work began and never finished, that a service is plainly
  talking while the test hearing it hears nothing. All of it is spent settling
  waits and then discarded, so nobody can ask it while it is true. A runner's
  timeout reports what a test *wanted* — the last thing the failure knows and the
  first thing the reader already knew.

  `@variance-authority/vantage` is the second reader. A watching process listens,
  the run reports, and the signals live in memory that outlives the test.
  `variance-authority-mcp --watch` is that process for an agent: it prints the one
  line the suite has to be started with, then answers `variance_run_signals` for
  where the run has got to and `variance_test_signals` for everything one
  execution has heard, in order, with the realm that said each and the work that
  started and never ended. Both answer while the test is still running, which is
  the point.

  The address is in the handshake, not only on stderr. A `Served` may carry
  `instructions`, and the watching one does: a set of tools about a run nobody has
  started yet reads as broken, and an agent told the variable after it has started
  the suite has been told one run too late.

  None of it is about visual regression. A test that takes no screenshot reports
  exactly what one that does reports, and a run started without
  `VARIANCE_AUTHORITY_VANTAGE` pays one environment read per worker.

  The medium is the wire the announcements already travel: one participant, `run`,
  and `channelTo` for a participant handed an address rather than sent one.
  `createEventLog` takes `onRecord` and `onRemark`, called at the moment of
  recording rather than at teardown — an answer that arrives when the test
  finishes answers a different question. `varianceWatched` is automatic so a
  listing has no holes.

  Still nothing written down. There is no report directory and no artifact to
  mistake for evidence later; what changes is only how long one execution lasts
  when somebody is watching.
