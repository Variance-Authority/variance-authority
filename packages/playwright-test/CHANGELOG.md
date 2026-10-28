# @variance-authority/playwright-test

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

### Patch Changes

- a438b9a: Accept typed Playwright configurations without casts and preserve their custom fixture types. Return a mutable loader tuple from `testSelectionRule` so it can be used directly in Rspack rules.

## 0.17.0

### Minor Changes

- d0993fb: A Chromium shot no longer depends on what the page painted before it

  `CHROMIUM_RASTER_ARGS` adds `--disable-partial-raster`. With partial raster, an
  edit repaints only the damaged part of a tile, and those pixels come out one
  colour level off a whole-tile paint. A page that mounts subject after subject
  could shoot the same subject two ways: a baseline taken after another subject
  differed from the same baseline taken first. Every tile is now painted whole:
  240 mounts and shots on one page took 23.9 ms each with the flag and 24.0 ms
  without it.

  The flag is part of the ordered launch recipe, so a baseline recorded under the
  old recipe comes back as a change caused by `rasterization`, and `accept`
  adopts the new image. If you copy `CHROMIUM_RASTER_ARGS` into your own
  `launchOptions`, the next run reports the same `rasterization` cause. A launch
  list that spells the flags out by hand keeps the old recipe until you add
  `--disable-partial-raster` to it.

## 0.16.0

### Minor Changes

- 40a19b9: A committed baseline is named for its story or test

  Under `directory` and `lfs`, a baseline was written to
  `<root>/<identity digest>/<percent-encoded subject id>.png`, so a pull request
  that accepted one listed a 32-character hex directory nobody could check against
  the change, and each machine that accepted wrote its own copy. `baselines.path`
  is now a template rendered from what the subject is: `{dir}` and `{file}` (the
  file that declares it), `{title}`, `{name}`, `{id}`, `{project}` (the
  Playwright project's name, in the fixture's `varianceBaselinePath` only) and
  `{engine}` (the engine's family). The default, `{title}/{name}-{engine}`,
  writes `Ui/Button/Primary-chromium.png`;
  `{dir}/__baselines__/{file}/{name}-{engine}` with `root: "."` writes
  `src/ui/Button/__baselines__/Button.stories.tsx/Primary-chromium.png` beside the
  code. A label is spelled `Primary__dark-chromium.png`.

  The machine that painted a baseline is read from the record beside it. One file
  holds each subject per engine family, the last accept writes it, and a run on
  another platform, scale factor or engine version compares against it, reading
  unchanged or changed as the pixels say, with the moved field named as the cause.
  A laptop and CI that take turns accepting rewrite the record each time; set
  `baselines.records` to keep the records out of version control. The tribunal's
  bucket store answers the same way: a lookup reads the last accept on the
  engine family, where it used to prefer this machine's own row.

  Two subjects that render one path, compared case-folded, stop the run with an
  error naming both subjects and the template. Nothing is renumbered. The record
  names the subject it was accepted for, so a shard, a Playwright worker or a
  later run that renders the same path for another subject stops too. Two
  Playwright projects that differ only in scale factor, colour scheme or viewport
  render one path; the error names both projects and `{project}`. A record left by
  a project the config no longer runs is a renamed project's, and the first run
  under the new name takes it over.

  The Vitest plugin reads a test's `describe` path from the runner, so a title
  that contains ` > ` stays one directory under `{title}`.

  **Breaking:** `baselines.layout` is removed, and a config that sets it is
  refused with an error naming `path`. Baselines under the identity directories
  are still read: the subject is compared against them, unchanged or changed as
  the pixels say, with the move from the old path to the new one given as a cause,
  and the next accept writes the template's path and deletes the old pair, so the
  pull request shows a rename. An accept deletes only a pair this machine's
  identity or engine line painted; another machine's stays until that machine
  accepts. `BaselineKey` carries `file`, `title`, `name` and
  `project` in place of `path`; the Playwright fixture, the Vitest plugin and
  Storybook's index supply them, and `varianceBaselinePath` and `baselinePath`
  set the template for a suite run without the CLI.

  The git-LFS store's `.gitattributes` pattern and the action's commit-back
  pathspecs are the template's glob, so a collocated baseline is tracked and
  committed where it is written. An `lfs` config whose root is `.` and whose
  template has no directory of its own is refused, because its glob would track
  every hyphenated image in the repository; give the template a directory such
  as `__baselines__`, give the baselines a root of their own, or set
  `baselines.pattern`. A `directory` config at root `.` with such a template is
  refused for the same reason: the action would commit every hyphenated image
  back. An existing LFS root gets the template's pattern as a new
  `.gitattributes` line the next time a run opens it; commit it with the baselines.
- 0b6af81: A changed region is joined against the baseline's nodes as well as this render's

  A change that replaces an element paints over the old element's box and the new
  one's, and `attributeRegions` read only one snapshot. On todomvc's broken toggle,
  71% of the changed region is inside the checkbox that left and 88.75% inside the
  div that arrived. Neither reaches the 0.9 containment, so the region named the
  row around both.

  `AttributionOptions.before` is now required: the snapshot of the revision the
  pixels are compared against, or `undefined`. Each node is joined against the
  area its own box and the box of the node the differ's matcher pairs it with in
  `before` cover together: the two places, not the rectangle that holds both.
  A box that left is placed by where it was in its own image, whose corner is the
  new `AttributionOptions.beforeOrigin`: by default the before snapshot's root, so
  a subject the page moved between two clipped shots joins where its pixels are.
  A call that states `origin` with a `before` snapshot and no `beforeOrigin`
  throws, since a corner guessed from the other image is right only when the page
  did not move.

  A baseline keeps that snapshot. `Raster.snapshot` is a `PackedSnapshot`, the
  tree gzipped and in base64, written by the Playwright fixture, its promotion,
  the Vitest browser provider and the CLI's image sidecars. `packSnapshot` and
  `unpackSnapshot` are exported from `@variance-authority/observe`. Every store
  carries it as text: `sidecarFrom` keeps it, `variance push` forwards it, and
  tribunal stores it in new `baselines.snapshot` and
  `build_subjects.candidate_snapshot` columns (schema 21, migration
  `0019_baseline-snapshot.sql`) and promotes it on approval. On
  `cases/storybook-case` it adds 3.2–5.4 KB to each sidecar.

  A baseline without a snapshot says so. When a changed verdict has regions and
  its baseline kept no snapshot, or one that will not unpack, the reason ends
  *the baseline records no snapshot of its nodes, so regions were joined against
  this render's boxes alone: an accepting run records one on a revision where
  this subject is unchanged*. An accepting run — `--update-snapshots`, Vitest's
  `--update`, `variance accept` — now re-stamps an unchanged baseline that kept no
  snapshot, as it re-stamps one painted under another identity, and the
  observation marks it `signals.snapshot: 'unrecorded'`; `restamps` in
  `@variance-authority/core/judge` is the one rule all three ask. Every other
  verdict the mark is on ends *the baseline records no snapshot of its nodes, and
  an accepting run records this one*. Two images
  compared directly get the same clause, naming the before image, without the
  remedy, and are never marked.

  A subject whose document has not moved settles on its digest and builds no
  observation to mark, so `settle` now renders a pictured baseline that kept no
  snapshot when this run collected one, with the reason *the baseline records no
  snapshot of its nodes, so this run renders it for an accepting run to record
  one*. A suite of baselines accepted before this release renders them on every
  run until an accepting run re-stamps them. Tribunal records one on ingest
  instead: a pushed candidate's snapshot is written onto a baseline that has an
  image and kept none, when it was painted from the same document under the same
  identity, and never over one it kept, so such a subject renders once. The
  snapshot's runtime fields (`provenance` and its `createdBy`, `wiring`, `holding`,
  `styleProvenance`, `styleTokens`, `ignoredBy`) are then the recording run's: the
  first push, from a build on any branch, that drew that document, as they are the
  accepting run's on a re-stamp. `Described.keepsSnapshot`
  is the new required field it reads:
  the durable, LFS and tribunal stores derive it from the sidecar with
  `keepsSnapshot` from `@variance-authority/core/format`, and the remote store
  refuses a description without it. A packed snapshot now opens with a `v1:`
  header naming its format version, `PACKED_SNAPSHOT_HEADER`, and a snapshot
  without it counts as not kept. `unpackSnapshot` reads one as not recorded
  unless every node in it is one, with `isSemanticSnapshot`, new in
  `@variance-authority/core/format` beside `isRenderDocument` and
  `isSubjectRef`: the checks `@variance-authority/unit-test` already made of a
  capture file's snapshot, document and subject, which it now asks. Tribunal serves API 6, which describes a
  baseline with `keepsSnapshot`; `variance push` against an older deployment names
  the refused descriptions when the project's `remote` baselines are stored there,
  and the remote store's refusal names tribunal before API 6 and a
  `serveRasterStore` from an earlier `@variance-authority/remote`: upgrade the
  server, tribunal or your own, before the client. `settle` takes this run's snapshot as a
  fifth argument. `variance accept` and the MCP changelog call these subjects
  *unchanged and re-stamped* rather than re-stamped under this run's identity,
  which was untrue of them. The render cache no longer hands on a snapshot an
  entry kept.
- 9b95dc1: A shard takes whole files in every runner, and is balanced by file count without times

  Under `--shard k/n`, a Playwright config wrapped by `withTestSelection` now
  places each spec file whole in one shard, by the time it took on the last
  recorded run, as Vitest and Jest shards are placed. Playwright's own split,
  which under `fullyParallel` divides a file's tests between shards, does not run.
  The reporter places the shard in `preprocess`, after `--project`, `--grep` and
  `.only`, and prints one line on stderr:
  `variance-authority: shard 1/2 by file count: 2 of 3 files; no times at …`.
  A file several projects run, or `repeatEach` repeats, goes with all its copies
  to one shard; setup and teardown projects are not placed, and a project with no
  file in the shard is left out whole. Playwright runs a setup project in every
  shard that needs it, so combining the shards' records refuses its files as run
  by two shards. `PWTEST_SHARD_WEIGHTS` is ignored for placement, though
  Playwright still validates it.

  This needs Playwright 1.62 or newer. `withTestSelection` refuses a run that asks
  for a shard, by `--shard` or by `shard` in the configuration, when the
  configuration is evaluated, before any test starts: on an older Playwright with
  `variance-authority: refusing shard k/n: Playwright <version> would split it
  test by test, …; placing whole files needs Playwright 1.62 or newer`, and when
  a `--reporter` on the command line replaces the configuration's reporters
  without naming `@variance-authority/playwright-test/reporter`, by that
  specifier or by a path that resolves to it. The version is the one the
  configuration's directory resolves, from `-c`/`--config` or the working
  directory. A configuration that names the reporter without `withTestSelection`
  is not refused. A run with no shard runs as before.

  When the record has no times, or none for the files collected, a Vitest, Jest
  or Playwright shard prices every file the same and places them by the same
  rule, so the shards are balanced by file count and none is left empty while
  there are as many files as shards. The line reads
  `shard k/n by file count: <m> of <n> files; <why>`, in place of
  `split by the runner, by count: <why>`. A file the runner hands in more than
  once, for each project that runs it, is placed once at its recorded time, which
  already sums every project, with every copy in one shard.

  `place` in `@variance-authority/core/shard` is where that rule lives: with
  nothing recorded, every group weighs one and is placed longest first on the
  least-loaded shard like a timed one, ties broken by key in code-unit order and
  then by the lowest shard. Its `by` reads `count` rather than `checksum`, and
  its `cost` and `load` are always present, one per group when placed by count.
  `variance run --shard` and `variance collect --shard` place stories and routes
  by the same rule, and a subject another shard owns reads
  `assigned to shard k/n by count, …`.

  A Jest or Vitest configuration wrapped by `withTestSelection` and evaluated
  under `--shard` gets `passWithNoTests: true` unless it sets `passWithNoTests`
  itself, so a shard left no file, because there are fewer files than shards,
  passes as it does under Playwright. Vitest 4 refused such a run before any file
  was placed. An unsharded run that finds no file still fails.

  `shardOf(files, shard, times)`, `landingTimes(record, options)` and
  `shardArgument(argv)`, which reads the `--shard k/n` a command line asks for, are exported
  from `@variance-authority/sense/test-selection`, for a seam that places a shard
  by the same rule.

  A Vitest, Jest or Playwright shard that cannot read the record its times come
  from now fails before any test runs, with
  `variance-authority: the times this shard is placed by could not be read, …`
  and the reason: a share that did not answer or answered with what does not
  read, a record that is there and does not decode, or a CLI that throws as it
  loads. It used to place by file count, beside shards that may have read the
  times. A record that is not there, a share that holds none or is not
  configured, and a CLI that is not installed still place by count. An unsharded
  run reads no times and runs as before. `variance shards` fails the same way.

  **Breaking:**

  - A Vitest or Jest shard with no times is placed by file count, in code-unit
    order of path, not by your sequencer's `shard`. Your sequencer still sorts
    each shard.
  - A Playwright run below 1.62 that asks for a shard is refused. Upgrade
    Playwright, or run without `--shard`.
  - A sharded Playwright run whose `--reporter` leaves out
    `@variance-authority/playwright-test/reporter` is refused. Name it in
    `--reporter` too.
  - `variance run --shard` and `variance collect --shard` with no recorded costs
    place each file by count, not by a checksum of the file and the shard. The
    shards are balanced, but adding a file can move others to another shard.
    A collection part's `assignment`, and the `assignment` in the provenance of
    the suite index merged from it, read `count` where they read `checksum`. An
    index that reads `checksum` still opens. `variance collect merge` refuses
    sharded parts an earlier version cut by checksum; collect every shard again.
  - A sharded run whose share does not answer fails rather than placing by
    file count. Run the job again, or hand every shard the record fetched once.

### Patch Changes

- 8d1bcc1: A link in a doc comment opens from `node_modules`

  Doc comments linked to documentation by repository paths such as
  `../../../../docs/flakiness.md`, which resolve to nothing in an installed
  package. They now link to the page on variance-authority.dev, or to the file on
  GitHub when the site does not publish it, so the link works on hover in your
  editor and in what `variance ask symbol` prints.

  The MCP server's instructions and its observability answer linked to
  `/start-cli` and `/presentation`, which the site does not serve. They now link
  to `/start/cli` and `/docs/presentation`, and the `@variance-authority/cli`,
  `@variance-authority/help`, `@variance-authority/mcp` and
  `@variance-authority/vitest-browser` READMEs link to the guides where the site
  publishes them.

  `variancePrecondition`, `wiringOf`, `tapCommits` and `provenanceOf` carry an
  `@see` link to the section of the guide that documents them.
- 4aa7b16: Content inserted into a page is the inserted rows, not everything under them

  Two images of the same width are compared row by row after their rows are
  aligned: each row is hashed, runs of equal rows are one token, and Myers finds
  the shortest edit between the two sequences. Each after row is then compared
  with the before row that shows the same content, and `pixelmatch` still judges
  every pairing; a row that moved, came or went is a change in itself, so no
  pairing makes a page read as unchanged. A section added to a long page marks that
  section, and the content it pushed down matches. A pairing is kept only when it
  leaves fewer pixels differing than position does, a row it leaves unpaired
  charged in full, so a line that changed in place is not shifted against its
  neighbours. The rows a gap grew by are inserted, as the rows it lost are
  removed, so a button whose padding grew has a region where it grew. Images of
  different widths, or an edit longer than 2,000 runs of rows, are compared
  position by position on the union box, as before.

  An inserted row is marked edge to edge, since nothing says where its content
  begins, so a region inside one is joined by its rows rather than its area: to
  the tightest box whose rows span it. `attributeRegions` takes the inserted rows
  as `inserted`. Joined by area, every such band went to the subject's root, and
  a card whose button grew named the card rather than the button.

  `RasterComparison.alignment` carries the pairing as `RowAlignment`: the after
  rows `inserted`, the before rows `removed` with the after row they left from,
  and the rows `shifted` with how far. A comparison without it was not aligned.

  Content that moved is a change. A gap that grew in one place and shrank in
  another moves what lies between them and leaves the page as tall as it was, and
  every moved row matches the row it came from; such a subject reports `changed`,
  never `unchanged` or `ignored`. The reason names the edit:
  *120 pixels differ across 1 region; 3 pixel rows inserted in 1 place, moving
  the content under them by up to 3 rows, and the subject resized from 40×5 to
  40×8*. The Playwright fixture's evidence now writes a diff for a subject that
  resized, drawn on the after image.
- e6afc58: One recorder for every visual subject

  `@variance-authority/sense/journal` exports `createSubjectRecorder`, which keeps
  one row per subject of a visual run with the page and every head joined, and
  `driveJourneys`, the driver's listener, cookies and settling wait. The
  Storybook collector records through the first, the Playwright fixture through
  the second, so a story, a page and a test file record their journeys the same
  way.
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
- c2e059d: A custom runner and a Playwright spec record the test line that reached each region

  `startRecording` takes `cadence`, `registerRecording` cuts the test file it
  observes, and `cutTestFile` cuts one for a runner with its own transform, so a
  runner of your own records each case's lines as the Vitest, Jest and Rstest
  seams do. `withTestSelection` compiles every Playwright spec with a Babel plugin
  that waits before each statement while every frame of every page is drained,
  and charges what each drain finds to the statement before it. It also adds
  Sense's `dist/` to `build.external`, which Playwright would otherwise load as
  CommonJS. Over a probed Storybook build the lines add 2.4% to the record, and
  the duration stays inside its run-to-run spread. Draining before each statement
  also reads a document before a `goto` replaces it, so a case's crossings now
  include what that document reached. A test that ends while the page still
  holds a drain, as an open `alert` does, is recorded incomplete instead of
  waiting for its timeout. A drain, the teardown's included, no longer
  shows as an `Evaluate` step in the report, the trace or the inspector.
  `ExecutionRecorder.note` takes the optional `line` a drain followed. Pass
  `cadence: false` to compile specs as Playwright would and write no lines. `@variance-authority/sense/instrument`
  exports `cadence` and `columnBehindCut`, the cut and its column map, for a
  transform that cuts test files itself.
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
- ee79f41: A `variancePrecondition` said in a Playwright `beforeEach` sits at the level of
  the `describe` that declared the hook, as it does under Vitest, Jest and Rstest:
  `0` at the top of the file, one deeper for each `describe` around it. A
  `beforeEach` inside a `describe` overrides one at the top of the file for the
  same name, where both were read at the case's innermost `describe` and kept as a
  contradiction. A helper that declares a `beforeEach` from one line in a
  `describe` and again in one inside it is placed at the depth of the one running.

  Playwright does not publish which `describe` declared a hook, so a recording
  worker reads it from Playwright's internals: run on 1.62.1, and read in the
  source of 1.58, 1.59 and 1.63, whose test loader sits at either of two paths. A
  Playwright that lacks one of them fails every recorded test at setup, naming
  the internal and its version, rather than placing a `beforeEach` precondition at
  a guessed level.
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
- 1a0b845: A subject is read with nothing hovered, nothing focused, motion reduced and `Date` fixed

  Every layout and raster baseline made before this release is compared under a
  moved recipe once; a semantic baseline, read in jsdom, does not move. The
  default recipes gained tricks, so the stabilization digest every reading records
  has changed, and each subject names that recipe as the cause of whatever it
  reports. Review the changes and adopt them with `variance accept --all`, as for
  any recipe change.

  The standard collection recipe now also holds:

  - `no-hover`: the pointer is moved to `(-1, -1)`, off the page, once per page
    before it loads. On the `variance` fixture's page it is moved again before
    every observation, a frame each, and not put back: a menu a script opened on
    hover is closed for your test's next step.
  - `no-focus`: whatever holds focus is blurred before the subject is read,
    including an element inside a shadow root. On a page your test or agent goes
    on using, focus goes back to that element once the reading and any screenshot
    of it are taken, so a test types where it left off. The blur still ran the
    page's blur handlers, and what they did, such as a validate-on-blur error,
    stays.
  - `reduced-motion`: the browser reports `prefers-reduced-motion: reduce`, which
    stops the script animations of a page that honours it, and the reading
    declares the same preference among the conditions its `@media` rules are
    resolved against. A `prefers-reduced-motion` condition you declare through
    `createHarness`'s `features` wins, and the browser is asked for that value;
    a declared `no-preference` is not recorded as `reduced-motion`. Rules under
    `@media (prefers-reduced-motion: no-preference)` are not read by default;
    leave `reduced-motion` out to read them.
  - `freeze-clock`: `Date` reads one instant. A script added before the page's
    own replaces `new Date()`, `Date()` and `Date.now()`, and gives the same
    instant to `Intl.DateTimeFormat`'s `format()` and `formatToParts()` called
    without a date. Timers, animation frames and `performance.now()` are the
    browser's own, so a page that settles on a timer still settles. No Playwright
    clock is installed, so `page.clock` stays yours, and a clock your test
    installs replaces the fixed `Date`; the reading still records `freeze-clock`,
    so leave it out of the list when your test owns the clock. `Temporal.Now` and
    `Date` inside a worker are not fixed. The default instant is in the past, and
    the browser's cookie store keeps real time: a cookie your page's script sets
    with an expiry counted from `Date.now()` is already expired and is not
    stored, so a dismissed consent banner can come back after the next
    navigation. Set `varianceNow` or `now` near today, or leave `freeze-clock`
    out.

  The render and layout recipes gain `no-focus` alone, because a painted document
  still honours a collected `autofocus`. The other three have nothing to act on
  there: the date the page printed is already text in the document, and its
  `@media` rules were resolved when it was read. A `<script>` inside a subject
  root is carried into the render document and runs there under the real clock.
  Every document is painted under the render recipe, so a reading taken without
  `no-focus` is still painted blurred.

  The instant defaults to `DEFAULT_NOW`, `2024-06-15T12:00:00.000Z`, exported
  from `@variance-authority/core/format`. `routeCollector` and
  `storybookCollector` take a `now` option to choose another. It must be an ISO
  8601 instant with its zone; anything else is refused before a browser opens.
  An instant other than the default is spelled in the clock's id,
  `freeze-clock@<instant>`, so it is part of the environment key, and a baseline taken at one instant is compared
  with a run at another with the moved instant named as the cause.

  To read a subject hovered, focused, animated or at the real time, pass your own
  `stabilize` list without that trick: `DEFAULT_STABILIZE`, the ids of the
  default recipe, filtered, as in
  `DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock')`. It is exported from
  `@variance-authority/core/format`, `@variance-authority/route-collector`,
  `@variance-authority/storybook-collector` and
  `@variance-authority/playwright-test`. `storybookCollector` and `observe` in
  `@variance-authority/playwright-test` now take `stabilize`, as `routeCollector`
  already did.

  A trick needs a browser driver to apply it, and is recorded only where one did.
  The collectors apply all four. So does the `variance` fixture in
  `@variance-authority/playwright-test`: it sets `reduced-motion` and
  `freeze-clock` on the `page` it hands your test, before the test body runs, and
  takes the pointer off the page and releases focus before every observation,
  giving focus back after it. Two new fixture options, `varianceStabilize` and
  `varianceNow`, choose what it sets and the instant, and are set with
  `test.use`; `varianceDriven` holds the ids it set. A fixed `Date` stops code
  that times itself with `Date.now()`: a debounce or a throttle, such as lodash's
  `debounce`, sees no time pass and never fires, so a test that types into a
  debounced search box can stop getting results after this upgrade. A loop that
  waits for `Date.now()` to pass a mark hangs the page, an animation timed by
  `Date`, such as jQuery's `animate`, never calls its `complete`, and a client
  that checks a token's `nbf` or `iat` against `Date.now()` can refuse a token
  issued today. None of these failures names the clock. Leave
  `freeze-clock` out for such a test, and for one that sets `page.clock` itself:

  ```ts
  import { DEFAULT_STABILIZE } from '@variance-authority/playwright-test';

  test.use({ varianceStabilize: DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock') });
  ```

  On a page the fixture never handed your test,
  such as one opened from your own browser context, call the new
  `driveBeforeTest(page)` before `page.goto()` to set the same two; `observe` and
  `createVariance` there apply `no-hover` and `no-focus`.
  `@variance-authority/vitest-browser` reads from inside your page and has no
  driver; `@variance-authority/presentation` reads through the Playwright `Page`
  you hand it, a test's or an agent's live browser, and does not drive it. Both
  apply `no-focus` only, giving focus back once the reading is taken. A trick left out is absent from the
  reading's ids and digest, as a trick a tier cannot reach already is.
  `stabilizeForObservation` in `@variance-authority/dom` takes `driven`, the ids
  your driver applied, and returns `refocus()`, which gives focus back to the
  element the reading released. `stabilizeAsRequested` takes the recipe by id, as
  a page agent receives it. `createHarness` in `@variance-authority/playwright`
  takes a `stabilize` recipe to drive its page before the first navigation, and
  reports the ids it applied as `driven`. `createObservedHarness` opens one with
  `observeNetwork` started before its first navigation, as both collectors do.

  `createPlaywrightRenderer` no longer couples `no-focus` to `waitForFonts`:
  `waitForFonts: false` turns off the waits alone.

  `@variance-authority/core/format` exports `DEFAULT_STABILIZE`, `DEFAULT_NOW`,
  `driveBeforeLoad` and `driveBeforeRead`, which apply the driver tricks to a
  Playwright `Page`, `forDriver`, which drops the ones a host did not apply,
  `featuresOf`, which declares the motion preference a recipe drove, and
  `recipeToDrive`, which resolves a `stabilize` list and checks `now` before a
  browser opens.
- d432339: A page reads its clock in UTC and formats for en-US, not for the host

  The harness the route and Storybook collectors open, and the pages the renderer
  paints, took their timezone and locale from the machine. A date the page
  formatted read one way on a laptop in Sydney and another on a runner in
  Virginia, from one build, and the two compared against one baseline as
  `changed`.

  Both are pinned: `timezoneId` to `UTC` and `locale` to `en-US`. Declare either
  in `variance.config.json` (`"timezoneId": "Europe/Berlin"`, `"locale":
  "de-DE"`) and the collectors and the renderer pin that instead; an unknown
  timezone or a malformed language tag is refused by its field.
  `createHarness` and `createPlaywrightRenderer` take the same two options.
  `@variance-authority/core/format` exports their type, `PageRegion`, and
  `@variance-authority/playwright` exports `pinnedRegion`, which fills in `UTC`
  and `en-US` for a field left out.

  Both are part of the environment key, and the renderer's pair is part of
  `RenderIdentity.rasterization`. A capture read in another timezone or language
  is another environment, and an image painted in one is compared with a
  baseline painted in another, with `rasterization` named as the cause of
  whatever moved.

  `@variance-authority/playwright-test` paints each test in the timezone and
  locale its page runs in: whatever the Playwright project or `test.use` sets.
  When neither sets a `timezoneId`, `varianceFixtures` opens the page in `UTC`
  rather than the host's, so a laptop and a runner in UTC read it under one key;
  Playwright Test already opens it in `en-US` when nothing sets a `locale`. That
  reaches every test of a suite extended with `varianceFixtures`, including tests
  that never call `variance`, so a test that asserts a date formatted in your
  machine's timezone reads it in `UTC` after this upgrade; set `timezoneId` in
  `use` to keep your own. A page
  you hand to `createVariance` is read and painted in whatever its own context
  opened it in, which is the host's timezone when that context set none: open the
  context with `timezoneId: 'UTC'` to match. `varianceRenderer` is now a test fixture, chosen
  by the page, and `varianceRenderers` is the worker's set of renderers, one per
  timezone and locale; a project that overrode `varianceRenderer` at worker scope
  overrides it at test scope instead.

  **Every image painted by the Playwright renderer is compared under a moved
  recipe once after this upgrade**, because its recipe now carries the timezone
  and locale. Each subject names `rasterization` as the cause of what it reports,
  and one whose pixels moved is `changed`:

  - With `variance run`: the run exits `1` for each `changed` subject. Review
    them in `variance report --format html` and adopt them with
    `variance accept --all`. A rerun reports `unchanged`.
  - With `@variance-authority/playwright-test`: the suite fails each `changed`
    test, and `--update-snapshots=changed` adopts them.
  - With `@variance-authority/vitest-browser`: `vitest --update` adopts them, as
    `variance accept --all` does.

  `@variance-authority/vitest-browser` reads no `variance.config.json` and takes no
  timezone or locale, so it paints in `UTC` and `en-US` whatever its tab ran in,
  and neither it nor `@variance-authority/unit-test` writes a timezone or locale
  to the environment key.
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

- eb7c1bc: A case run by a named project carries the project's name in its id

  A test file run by two projects — two Vitest projects, two Jest `projects`, two
  Playwright projects — runs once under each, and the case index numbered the
  second copy, so `variance covering` listed
  `greets by name [test/greet.case.ts > greets by name#1]` with nothing to say
  which project the `#1` was. The index now carries the project each case ran
  under and spells the case by it, as Vitest prints it:
  `|compiled| test/greet.case.ts > greets by name`. The name is the case's own,
  so a run filtered to one project (`--project`, `--selectProjects`), or a shard,
  gives a case the same id a full run does. A repeated name inside one project is
  still numbered.

  The project's name is the one the runner gives it: Vitest's `test.name`, its
  `package.json` name or its directory, and an inline project without one by its
  place in the list; Jest's `displayName`; Playwright's project `name`. A Jest
  run whose projects share a test file also records that file once, rather than
  failing to write the record, and records it partial when one of those projects
  skipped every test in it.

  When you upgrade: every case of a named project changes id once, on the first
  record after upgrading, and history joined by id restarts for those cases.
  Reordering an unnamed inline Vitest project list renames its cases. A project
  without a name keeps the plain coordinate, and so does every Rstest case.
- 409d7ba: A case that evaluates a module through an inline require keeps what it entered afterwards

  Under Jest's inline requires a module evaluates inside the first case that reads
  one of its bindings. That case lost every region it entered both while the
  module evaluated and after it, such as the function a higher-order component
  returned, so a change there selected only the cases after it. The record of a
  run with inline requires is now the record of the same run without them: what
  ran while the module evaluated is flagged as loaded, and the case keeps its own
  crossings.

  A page or story case reads the same way. When a module evaluates inside the
  case's own drain, or in an earlier drain of the same case, the case keeps the
  calls it made into the module afterwards. Joining a case's drains keeps a region
  that one drain entered while the module evaluated and another entered plainly.

  A case that ran and crossed nothing is now named in the case index, with how it
  settled, instead of being left out.
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
- 85e1a40: An in-place capture retries when the subject changed during its screenshots, even if it changed back

  The two reads around an in-place capture's screenshots could agree while the
  screenshots held a state neither read saw: a text swapped and restored between
  them. The page now records each change to the subject's elements, attributes
  and text between the two reads, outside `data-variance-ignore` regions and
  shadow roots; any change counts as movement, and the refusal names what changed. A write that sets an attribute or a text to the
  value it already holds is not a change.

  This counts changes the compared reading never shows. An attribute the reading
  drops, or a node it does not keep, that a timer rewrites with a new value on
  every tick now spends a `settleAttempts` round each time, and fails the subject
  when every round sees it. Put `data-variance-ignore` on that region.
- 1eed290: A form filled in after mount is painted and compared filled in

  Text a play function or a test typed into an `<input>` or `<textarea>`, the
  option it chose in a `<select>` and the box it ticked now reach the render
  document and the snapshot. Before, the document painted the form as the server
  sent it and the snapshot did not move for typed text or a chosen option. A
  password field's value is carried as one `•` per character, and a file input's
  value is not carried. A form nobody filled in reads exactly as before.

  This is part of `RULESET_VERSION` `r2`. A subject whose form was filled in
  after the server sent it has a new render document, so after this upgrade its
  image shows the form filled in and reads `changed` against a baseline painted
  empty; `variance accept --all` adopts it. A Playwright test painted its form
  filled in before this change, so it does not move there.
- 6b1583e: A path names one file, and a path that ends like it is another file

  Four places related two names by how they end or what they spell, and each is
  now exact.

  A built module's lines are read back through its map only from the source that
  resolves to the file, as the Source Map specification resolves one: behind
  `sourceRoot`, beside the map. A source that ends like the file but resolves
  elsewhere, such as `src/a.ts` in a map beside `dist/a.js`, is another file and
  its segments are not read. A map with no source that resolves to the file used
  to have every segment read as the file's lines; the module is now recorded as
  the text that was handed over, under its own name.

  `variance ask symbol` and `ask uses` with `--package` naming one file of a
  package, such as `@acme/lib/src/internal/math`, answer from the file an import
  of that specifier resolved to. When nothing imports it, the file it names is
  not known, and the name is refused with that reason, rather than answered from
  a file whose path ends like the specifier.

  A Playwright test's name, in its recorded coordinate and in the vantage
  listing, is its `titlePath` after the file, the first entry. A describe that
  spells the file, its leaf name or the project is no longer dropped from the
  name.
- fa48984: A Vitest, Rstest, Jest or Playwright Test run removes the scratch it made and
  nothing else. It no longer prunes the rest of the cache once a day as it ends,
  so whichever run finished first no longer clears what other runs left. Run
  `variance prune` to clear it, or let `variance run` do it at its end.
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
- d1789f5: Printed messages say what was recorded

  A Playwright test's precondition line reads `ran under network=mocked` instead of
  `arranged network=mocked`, and `no preconditions recorded` instead of `nothing
  arranged`. With `varianceExecution` off it reads `so no variancePrecondition call
  was recorded`. `variance review` prints `nothing records where this change
  starts`, `variance journey` prints that the execution journal `has no entry for
  this run’s subjects`, and the Vitest selection reason reads `worker reported
  which files passed`.
- 4799688: The checkout says what the probes meant: no build writes module records

  A probe names the file it was placed on and the digest of that text,
  `path@digest`. When a run is folded, each module the journals name is cut again
  from the file in the checkout. A file whose text still matches is read on its
  own regions; a file that has moved on since the build reads as one whose reach
  is not known, which selects every test that entered it; a file that is gone
  counts the same way. Nothing is written beside the build, and nothing under the
  cache's `test-selection/<key>/<label>/` is read.

  Breaking:

  - `testSelectionProbes()` takes no `cacheRoot`. Its `label` names the journey
    head and nothing else.
  - `recordExecution()` takes no `label` and no `heads`.
  - The Jest journeys options (`withJourneyCoverage`) take no `heads`.
  - `jestStore` is removed from `@variance-authority/sense/jest`.
  - `instrumentModule(code, file)` takes no options: call it first, on the file as
    it is on disk.
  - A journal names a module by `path@digest`. A driver that writes its own
    journal builds the id with `moduleId(path, code)` from
    `@variance-authority/sense/journal`.
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

## 0.14.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

### Minor Changes

- 486caa3: Declare the test suites your repository runs, each with its kind, under `suites` in the root `variance.config.json`: `{ "suites": { "unit": { "kind": "unit" }, "stories": { "kind": "visual" } } }`. The kind is one of `unit`, `integration`, `e2e` and `visual`. Each declared suite records on its own, under `suites/<name>/` in the cache, with its case index and runs log beside it, so a run of one suite never replaces what another recorded. A worktree seeds each suite from the same suite in the primary checkout.

  Every recording integration takes a `suite` option: the Vitest, Jest and Rstest seams, `startRecording`, `recordExecution`, the Playwright reporter and `varianceExecution`, and the Storybook collector's `tests`. Once `suites` is declared, a run that names no suite, names one the file does not declare, or names both a suite and a `coverageFile` stops before it starts. A repository that declares no suites keeps its one record. `testCoverageFile` and `readableTestCoverage` take `{ suite, cacheRoot }` as their second argument, where they took a bare `cacheRoot` string, and `declaredSuites`, `parseSuites`, `recordFileFor`, `SUITE_KINDS` and `SuitesError` are exported from `@variance-authority/sense/test-selection`. The CLI refuses `suites` in a config file below the repository root.
- d68ad38: A Playwright run's recording times its spec files and test cases with `testInfo.duration`

  Each test's `testInfo.duration` — the body, its `beforeEach` hooks and the fixtures set up for it — is recorded on its case in the case index and summed onto its spec file in the coverage file, so `variance ask slowest-tests` ranks Playwright tests beside Vitest, Jest and Rstest ones. A retried test is timed as the sum of its attempts. A run whose workers stage their contributions carries the durations, and each case's retry outcome, through the fold the reporter makes.

## 0.9.0

### Patch Changes

- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

### Minor Changes

- 4250eda: Every run records which case entered each region. The `cases` option is removed
  from `withTestSelection` for Vitest, Jest and Rstest, from the Playwright
  recorder and reporter, and from the Storybook recorder: each writes
  `<coverage file>.cases.bin` beside the file-level snapshot, or `executionFile`
  when you name one. A test file that runs in a page is still recorded per file,
  and says so.

  Without `continuations: true`, a file whose cases overlap no longer fails the
  run. It is recorded as a whole, so a change it reaches runs every case in it, and
  the run names the two cases that were open at once.

### Patch Changes

- e4ee0da: The repository names its cache. Set `cacheRoot` in the `variance.config.json` at the repository root, for example `".variance/cache"`, and every command, every test runner integration and every function that takes a `cacheRoot` option uses that directory. The path resolves against the repository root. Without the key the cache is `$XDG_CACHE_HOME/variance-authority`, or `~/.cache/variance-authority`, as before, so an existing recording stays where it is. The key is read before the environment, so a sandboxed agent that sets `XDG_CACHE_HOME` to a temporary directory no longer splits the recording away from your own runs. [The cache](https://variance-authority.dev/docs/cache) page describes the location, what is in it, worktrees and CI.

  `@variance-authority/sense` exports `cacheRootFor(root)`, which returns that answer, and `CACHE_CONFIG`. `defaultCacheRoot` is removed; call `cacheRootFor(root)`. A `cacheRoot` option now names the variance-authority directory itself, and `test-selection/` is created under it. `testCoverageFile`, `seedTestCoverage`, `readableTestCoverage`, `moduleNamesFile`, `openModuleNames`, `recordStore`, `recordStores` and `repositoryLayers` take an optional `cacheRoot`. An empty or relative `XDG_CACHE_HOME` is ignored rather than resolved against the working directory. A root `variance.config.json` that is not JSON, or whose `cacheRoot` is not a non-empty string, is an error.

  `@variance-authority/cli` accepts `cacheRoot` in the config and in the schema, and refuses it in a `variance.config.json` below the repository root. `variance run`'s render cache and suite indexes are under it. `renderCacheRoot` and `suiteIndexPath` take the config.

## 0.7.0

### Minor Changes

- bc441d3: A spec is recorded whether or not it asks for `variance`

  Under `varianceExecution`, recording used to read the page only when a spec
  destructured `variance`: at each observation, and once more when that fixture
  was torn down. A spec that took only `page`, which is how most Playwright specs
  are written, was recorded as having executed nothing. The next `--since` then
  skipped it over lines it had run.

  Recording now reads the test's browser context. It reads after every `afterEach`
  and before the context closes, from every frame of every page the test opened.
  That covers a story running in Storybook's `#storybook-preview-iframe`, a second
  tab opened with `context.newPage()`, and whatever an `afterEach` clicked.

  A spec that replaced a document it ran in is recorded as incomplete: a second
  `goto`, a `reload()`, a frame the application removed, or a page that closed or
  crashed before the end. Whatever that document executed since the last read went
  with it. The spec keeps the crossings that were read, and the next selection runs
  it rather than skipping it. `pushState` and hash changes keep the same document
  and lose nothing.

### Patch Changes

- 24da1c4: The case index names the test behind a head's crossings

  With `cases` on, a run whose code executed in a declared head wrote no case
  index at all: the page had nothing to drain, and the head's accounts joined the
  spec file only. The journey a test mints now remembers the test, and the head's
  crossings join it, including what every subject depends on.
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
- 8ae7195: A relative `coverageFile` or `executionFile` is read from `root`

  The Vitest, Rstest and Jest integrations resolve these two paths from their own
  root. The Playwright reporter and the Storybook recorder resolved them from the
  root of the repository instead. In a workspace, where `root` is a package
  directory, that caused two problems:

  - The Playwright workers staged their results beside one coverage index, and the
    reporter merged them into a different one.
  - A run where the fixture merged for itself, without the reporter, wrote its
    execution index to a third place.

  Both paths are now read from `root`, as the fixture already read `coverageFile`.
  An absolute path is unchanged.

## 0.6.0

### Minor Changes

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

- 35da499: An Rstest suite can adopt this, in either of the two shapes it runs in

  [Rstest](https://rstest.rs) runs a suite in `jsdom` with no browser, and — since
  `@rstest/playwright` — hands a test body a live Playwright `Page`. Those are the
  two adoptions this project already has, under one runner, and neither of them
  worked.

  The deferred half needed nothing new: an Rstest test in `jsdom` writes a capture
  with `@variance-authority/unit-test` and a later `variance run` paints it, the
  same as any other unit runner. What was missing was the in-place half. A
  `@rstest/playwright` body has a `page` and no `TestInfo`, so the five facts an
  observation needs about its run — the subject id, the file that owns it, the
  colour scheme and scale it was painted at, and whether this run may approve
  anything — were not reachable.

  `@variance-authority/playwright-test/rstest` exports `runOf`, which reads them
  from three of the values the body destructures:

  ```js
  import { describe, test } from '@rstest/playwright';
  import { assertUnchanged, createVariance } from '@variance-authority/playwright-test';
  import { runOf } from '@variance-authority/playwright-test/rstest';

  describe('cart', () => {
    test('empty', async ({ page, task, expect, playwright }) => {
      const variance = await createVariance(page, runOf({ task, expect, playwright }), {
        materialization: { kind: 'in-place', browser: { headless: true } },
      });
      try {
        assertUnchanged(await variance.observe(page.locator('#cart')));
      } finally {
        await variance.close();
      }
    });
  });
  ```

  Three values rather than one context because Rstest refuses a test body whose
  first parameter is not an object pattern, so there is nothing whole to hand
  over. The subject id is the suite chain — `cart > empty` becomes `cart/empty` —
  and the file that owns it is the spec relative to the project root, so nothing
  in the test spells a name out.

  **Approval is `rstest run -u`, and only that.** Rstest's own default for a
  snapshot with no baseline is to write one, which is the absence Playwright
  spells `missing`; reading it as approval would promote an image out of the
  unreviewed run that produced it, so the adapter does not.

  No new package. An Rstest e2e test needs Playwright and a browser binary, which
  is what `@variance-authority/playwright-test` already asks of an adopter, and a
  second box would be a second name for one requirement.

  `cases/rstest-case` drives the real `rstest` CLI through both loops — capture,
  `variance accept`, `unchanged`; then failure, `-u`, agreement — and
  [`docs/start-rstest.md`](https://variance-authority.dev/docs/start-rstest) is
  the walkthrough.

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

### Patch Changes

- e546e21: A collector's complaints travel into the observation

  A finding produced at collection reached the CLI's record and nobody else. A
  suite driving this from its own runner asks the observation what is wrong with a
  subject, and the one diagnostic that explained the moved pixels — the host, not
  the stylesheet, chose the typeface — was produced, carried, and dropped one call
  short of the person reading the failure.

  `mergeDiagnostics` dedupes on every field, so the CLI, which now meets the same
  list twice, says a shared complaint once.
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

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Minor Changes

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
