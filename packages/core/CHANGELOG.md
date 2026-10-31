# @variance-authority/core

## 0.22.0

### Minor Changes

- 050e333: A git-LFS pointer is no longer read as the file it stands for. The text of a source file at a recorded commit, when git holds it as a pointer, is the content `git lfs smudge` gives, and the read fails with git-lfs's own words when it cannot give it. A baseline record that is a pointer is refused as one, by `find`, `describe` and `accept` alike, rather than called a truncated write or written over. `isLfsPointer` and `LFS_POINTER_HEAD_BYTES` now come from `@variance-authority/core`; `@variance-authority/store/lfs` no longer exports them.

### Patch Changes

- d2cc975: Seven docs say what their declaration does in the words it is asked for

  `ask search` now shows these among its rows: `snapshotValue` writes a test case's value as a snapshot file, `locateSites` turns a stack frame into its source line, `BlockKind` names the construct behind each region kind, and the Playwright Locator recording in eyes is documented. The lead of `testSelectionProbes` now says it is the Vite plugin whose `transform` hook instruments each module. The tool-order doc of `@variance-authority/help` sits on the tool list rather than on the wrapper that dates each answer.
- 659925c: An accepted baseline is kept as a lossless WebP, in about a quarter of the bytes of the PNG it was captured as. It is encoded once, on the machine that accepts, by `keepImage` in `@variance-authority/png-sharp` — sharp's libwebp at effort 2 — which decodes its output back and throws unless every pixel with any opacity matches in all four channels and every fully transparent pixel stays fully transparent. The colour under a fully transparent pixel is not kept; no comparison sees it. `@variance-authority/store/keep` exports `keptRaster`, which every accept calls before `put` and which loads sharp only then, so a run that accepts nothing never loads it, and an accept where sharp does not load fails and names why. A durable store's `put` encodes nothing: it refuses any image but a lossless WebP, naming what it was given, so a remote store receives the WebP and runs no codec. A read checks the image's header against the sidecar and refuses a `.webp` holding a PNG or a lossy WebP, or an `image` format it does not know, as damage. Captures and the render cache stay PNG; a report's before image is the baseline as it was kept, so `.before.webp` beside a WebP baseline, attached as `image/webp`. The sidecar records `"image": "webp"`; a baseline kept as a `.png` before has no such field, stays readable, and its next accept replaces it. A WebP holds at most 16,383 pixels on a side, so an accept refuses a larger image and writes nothing. A `sharp` upgrade that brings a new libwebp can write different bytes for the same pixels, so a baseline rewritten after it shows in git as a changed file whose pixels did not. `createLfsStore` tracks `*-*.webp` by default and leaves an existing `*-*.png` entry in place; a `pattern` you set yourself must end in `.webp` or `*`, or the store refuses to open. `doctor --baselines` and the carried pathspecs count both extensions. `@variance-authority/png` reads WebP without an addon through libwebp's WebAssembly decoder and adds `decodePortable`, `imageFormat`, `refuseUnkept`, `isLosslessWebp`, `refuseOversize` and `KEEP_LIMIT`; its decoders read either format by the bytes' header, `imageSize` replaces `pngSize`, `diffImage` is now async — it resolves to its PNG, since either side may be a WebP — and takes an optional decoder, `changeImages` takes decoded images rather than bytes, and `@variance-authority/png/header` reads a header without loading a codec. `@variance-authority/store` exports `KEPT`, `KeptAs` and `isKeptImage`, and a path template that ends in `.webp` is refused like one ending in `.png`. The tribunal worker labels each image by the format its bytes declare.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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
- 09f60c8: A reach walks type-only imports unless you name the runtime edges

  `dependentsOf`, `dependenciesOf`, `affectedBy` and `carried` in
  `@variance-authority/core/relate` now walk every edge kind, `type` included,
  when you pass no `through`. A type-only import is still a dependency: a changed
  type can break the file that imports it, and the walk said nothing about that
  file. Test selection asks what a run loads, so every selection walk in Sense and
  the CLI passes `RUNTIME_EDGES`, and what it selects does not change.

  If you called one of these and relied on `type` edges being left out, pass
  `{ through: RUNTIME_EDGES }`.
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
- 18c70d3: A run collects in parallel by default, and the report says where each subject's time went

  Without `workers` in the config, a run collected in one browser world, so a
  route suite read its pages one after another on any machine. It now collects in
  half the machine's logical cores, at least one and never more worlds than there
  are files: two on a 4-vCPU CI runner, eight on a 16-core laptop. A `concurrency`
  you set holds it lower, since every world keeps a page and a subject in flight.
  A `workers` you set still wins over both. Set `workers: 1` for a server under
  test that cannot take concurrent pages. A collector with no `openWorker` still
  collects in one world, and the run warns about it only when you set `workers`. Verdicts and the order
  of observations do not depend on the count, and the report's new `workers` field
  records it. `variance collect` takes the same width.

  A changed subject read in a second world is now run alone like one read in the
  first. A worker opens no clean world of its own, so the run asked the worker and
  reported "not re-run alone: collector has no `collectAlone`"; it now asks the
  collector that can open one.

  The `alone.limit` budget now goes to the first subjects to change in the order
  the run takes them. It went to whichever changed subjects reached it first, so
  with more changed subjects than the limit, which ones carried `again` and
  `alone` evidence depended on the number of worlds and on timing.

  Each observation in the report also carries `steps` beside `costMs`: every
  phase the subject went through, in the order it ran, with its wall time. The
  collector's phases are named `collect.*` (`collect.navigate`,
  `collect.wait-for-fonts`, `collect.capture`), the run's own are `compose`,
  `inspect`, `settle`, `baseline`, `cache.get`, `cache.put`, `decode`, `compare`,
  `write`, `again.collect` and `alone.collect`, and a painted subject adds the
  renderer's under `render.*`. The report's `steps` sums each phase over the
  subjects that ran it and counts them. A phase a subject skipped is absent, not
  zero. Timings are part of no digest, so images, records and baselines do not
  move when only timing does.

  `settleRecipe`, `stabilizeForObservation`, `compareRasters` and the raster
  `Renderer.render` take an optional step clock and report the steps they ran on
  it. The route page agent and `readRoute` always return the steps they took.
  `stepClock`, `timeOn` and `totalsOf` are exported from
  `@variance-authority/core/format`.

  A run that is not sharded now reads the mainline's subject costs at every
  width, as a sharded run always did, and takes its slowest files first. One
  world takes its subjects in the same order as several, so the budget above
  reaches the same subjects.

  `concurrency` is split evenly across the worlds and rounded up, at least one
  per world, so by default the raster tier is as wide as the number of worlds.

  The frame above a subject carries its classes in code-unit order. Storybook
  swaps its layout class on a page it reuses, so their order said which story the
  page showed before, and a run in parallel lanes gave the same story a different
  document, and a render-cache miss, with the same pixels.
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
- 402ce9f: A story's parameters are read when the story is reached, so no story file is imported before its story comes up

  Your Storybook run used to read every story's `parameters.variance` before the
  first story, through the preview's `extract()`. That imported every story file
  up front: on a large Storybook you paid for the whole build before seeing one
  story, and each file's first story then timed its import as 0 in `collect`.

  The run now plans from `index.json` alone. When it reaches a story, it asks the
  preview for that story's merged parameters, which imports only that story's
  file, the import showing the story would have made anyway. That import is
  charged to the story's `collect`, so the first story of each file carries what
  its file costs. A story that excludes itself is still skipped and listed in the
  report with its reason, and a story whose parameters cannot be read is read at
  your run's `viewport` with a warning naming it. A preview too old to read one
  story's parameters says so once per run, not once per story.

  A story that declares `widths` is still read as `<story id>@<width>` at each
  width, with its own baseline, and all its widths are read on the same page in
  one visit: nothing is opened, booted or loaded again for a second width. A
  run that does not read such a story, because `--subjects`, `--since` or a shard
  left it out, because its visit failed, or because its parameters could not be read, still counts its width baselines as
  planned rather than naming them as baselines your plan no longer holds. A
  story that excludes itself when it is reached holds no subject of the run, so
  every baseline it left, under its own id and at each width, is named. A
  shard prices the story at the sum of the widths its last visit read.

  If you write a collector, `collect` may now return a `Visit` instead of a
  `Collected`: every subject the visit to the planned one produced, each with its own
  result, each id the planned id or the planned id at a width (`<id>@<width>`),
  and any warnings the visit raised. A visit that could not learn every subject
  it realizes, such as a story read without its parameters, says `incomplete: true`.
  A visit that produced no subject is
  reported as a failed one, and so is a visit that produced any other id. The run and `variance collect` report each subject
  at the position the plan gave the planned subject, and evidence parts record
  the planned id as `of`; a merge refuses a part whose subject is neither. A
  `--subjects` glob that names one width, such as `*@375`, now reaches the story
  it comes from, and only a width suffix extends a story id: `button--primary`
  no longer reaches `button--primary-large`.

  `@variance-authority/core/format` exports `atWidth`, which writes a subject's
  id and name at a width, and `widenedFrom`, which reads the planned id back
  from a width id, and `realizes`, which says whether a visit to one id may
  produce another.

  `readParameters(page)` is now `readParameters(page, storyId)` and returns one
  story's parameters; the up-front read of every story is gone.
- f18c00c: The differ pairs the one element its author replaced, and says what it became

  When, under one matched parent, exactly one element left and exactly one
  arrived, and the same component's `createdBy` wrote both, `matchTrees` pairs
  them. The pair is compared like any other and leads with a new `tag-changed`
  delta, in the geometry band and counted as structural, followed by whatever else
  differs: role, name, state, attributes, styles and box. Before, the same change
  was a `node-removed` and a `node-added`. Two or more replaced by one author under
  one parent stay unpaired, because either could be either, and so do two that
  each carry an alias or a role and name of their own: every `<Button>` is created
  by `Button`, and a Save button replaced by an Export link is two elements.

  `tag-changed` is reported on every pair across two tags, so a pair that a
  declared alias or a shared role and name joined — a `<button>` and a
  `<div role="button">` with one name — now says its tag changed, where before it
  reported nothing for it.

  A `style-changed` or `token-changed` delta on a pair across two tags is banded
  `geometry`, with the `tag-changed` it follows, rather than `token`: the style is
  the new element's, and the structure a `token` delta says held did not. A
  `bands: ['token']` ignore rule no longer reads it. `bandOf` owns the rule, as
  `bandOf(kind, { retagged })`, and a parting row's bands now read each delta's
  own band, so the row and the docket agree.
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
- 16e7c76: `dominatorsOf` is removed from `@variance-authority/core/relate`

  Nothing ran it once distill read its records in the sense addon, which finds
  the import every path from a test file runs through with its own dominator
  pass. A caller that needs immediate dominators of a file graph computes them
  over `Relations` directly.

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

## 0.15.0

### Minor Changes

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
- b065364: `::before` and `::after` are read as children of the element they hang from

  Restyling or rewording a `::before` or `::after` box used to repaint the page
  and move no hash: the rules written for it were matched against the element,
  failed, and were dropped from both the snapshot and the render document. A
  generated box now enters the capture as a child node tagged `::before` (first)
  or `::after` (last), carrying the rules written for it. In a browser it carries
  its computed style, projected onto the allowlist, and the text its `content`
  says as a `#text` child; a box whose `content` is `none` or `normal`, or whose
  `display` is `none`, is not in the tree. Strings are joined and `attr()` reads
  the element's attribute; a part such as `counter()` or `open-quote` is carried
  as written.

  Under JSDOM, which computes no generated content, the declared rules answer,
  picked by the same cascade order normalization uses: a box is in the tree when
  the winning `content` gives it one and the winning `display` is not `none`, with the rules that style it and no computed style.
  When that `content` is strings and `attr()`, the box says its words as a
  `#text` child, as in a browser, so rewording it moves the snapshot. When it
  holds a `counter()`, a quote, a `var()` or a `url()`, the box has no text and
  carries `unread` on `RawNode` and `SemanticNode`, naming the parts it could not
  resolve; `unread` is outside every hash. JSDOM's own parser drops a `content`
  that is a single `attr()` or `counter()` and nothing else, so no box is read
  for one.

  This is part of `RULESET_VERSION` `r2`, the same `r2` that keeps the served
  port out of a render. A subject with a `::before` or `::after` box has a new
  render document, so after this upgrade its image shows the box and reads
  `changed`; `variance accept --all` and Playwright's
  `--update-snapshots=changed` adopt it.
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
- a4f55c1: One walk carries a change to every file that loads it

  `@variance-authority/core/relate` exports `carried`, the walk against the
  arrows that `dependentsOf`, its narrowed form and test selection's two importer
  walks now all run. You pass seeds, each with what its change carries — the
  whole file, or the names that moved — and a step that says what one importer
  does with what reached it. The walk owns the worklist, enters each file once
  per name, ends on any cycle, and treats a step with no answer as the whole
  file. A walk you write over the graph gets the same answers on cycles,
  self-imports and re-exports as the ones the selector runs, with no loop of your
  own.
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
- 754d04c: The port a build is served on is no part of a render

  The route and Storybook collectors serve a build on a free port, and that port
  reached three identities. An asset the page loaded was keyed by its absolute
  URL, a `url()` in a computed style was the absolute URL the engine resolved,
  and the document digest read both. One build served twice therefore read as two
  environment keys and two documents: each run missed the render cache, painted
  again, and read its document as changed against its own baseline.

  An asset the page's own origin serves is keyed by its path, and the page's
  origin is dropped from a `url()` before it is hashed. An asset another origin
  serves keeps its absolute URL. A capture carries the page's `baseUrl` so core
  knows which origin is the page's, and the renderer resolves a path-keyed asset
  against the document's `baseUrl`. `documentDigest` reads the page's own base
  and resources as paths, so one build served on two ports addresses one render
  and the render cache hits; the document keeps them absolute for the renderer,
  and a resource another origin serves stays absolute in the digest too.

  A `@variance-authority/unit-test` capture keys its assets the same way, so a
  `@variance-authority/vitest-browser` observation, which captures through it on
  the port the runner had free, keeps the port out of its environment key.
  `readCapture` reads back a capture whose asset is keyed by path, resolving the
  key against the document's `baseUrl` as the renderer does; `assetUrl` in
  `@variance-authority/core/format` is that one resolution.

  **The document of every page served over `http` moves once after this
  upgrade.** `documentDigest` now reads a document's base and resources without
  the page's origin, so the digest of every document served over `http` or
  `https` changes: every route, every story, every Vitest browser page, and every
  Playwright page opened by URL. A moved document misses the render cache once,
  and its image is still compared with the baseline: a page whose pixels did not
  move reads `unchanged`, and one whose pixels did reads `changed`, which
  `variance accept --all` and Playwright's `--update-snapshots=changed` adopt.
  `RULESET_VERSION` moves from `r1` to `r2`. The ruleset is part of a snapshot's
  environment key, not of the render recipe, so no image names it as a moved
  identity; a snapshot diffed against one recorded under `r1` names the ruleset as its
  environment root.
- 8187fb1: `didYouMean` and `nearest` are exported from `@variance-authority/core` and no
  longer from `@variance-authority/mcp/tools`. Import them from
  `@variance-authority/core`. A mistyped command or flag is refused, with the
  nearest right one, without loading the MCP server's tools.
- ca7813e: `intersectionArea` is exported from `@variance-authority/core/format`

  The area two `Rect`s share, zero when they only touch or do not meet. It sits
  beside `Rect`, where the attribution already used it, so the review service can
  ask whether two builds changed the same place.

### Patch Changes

- 85e1a40: `wait-for-fonts` gives up after 15 seconds and names the font

  A web font whose request never answered kept `document.fonts.ready` pending, and
  the capture waited forever. `wait-for-fonts` now waits at most 15 seconds, the
  same bound as `wait-for-images`, then fails naming every font still loading:
  its family, and the `src` that requested it when the stylesheet declaring it is
  same-origin. A face declared in a cross-origin stylesheet is named by family
  alone, because the page cannot read that sheet's rules.
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

### Minor Changes

- c743d3a: A share holds lines only. `SharedCache`, `SharedHit`, `neverFails`, `shareKey`, `firstShared`, `memoryShare`, `httpShare` and `HttpShareOptions` are removed from `@variance-authority/core/share`, and `createDirectoryShare` from `@variance-authority/store/share`. Use `httpLineCell`, `memoryLineCell`, `createDirectoryLineCell` or `createGitLineCell` with `publishLine` and `readLine`: a line keeps the latest entries a mainline or a branch published, and a miss says why. `neverFails` in `@variance-authority/raster` is unchanged.
- 6e5d53a: A file-backed baseline store files each baseline under a directory named for the renderer identity that painted it: a digest of the renderer, engine, platform, scale and fonts. That directory is now named `v1-<hex>`. It was named with the digest as written, `v1:<hex>`. NTFS refuses a colon in a file name, so a baseline root that still holds a `v1:` directory cannot be checked out on Windows, and `actions/upload-artifact` refuses to upload it. The render cache, which is in your cache directory unless `cacheRoot` says otherwise, now uses `v1-` for its identity directories and for each entry's file name.

  A store treats `v1:<hex>` and `v1-<hex>` as the same identity and reads both. When `v1-<hex>` has no baseline for a subject, the store looks in `v1:<hex>`. A baseline under another machine's identity, in either spelling, still makes the subject `incomparable`.

  `variance accept` writes each subject it accepts under `v1-<hex>` and deletes that subject's copy under `v1:<hex>`. It does not touch a subject whose pixels did not change, so a baseline that never changes stays under the old name, and the root stays unreadable on Windows until you move it. For each `v1:` directory, `variance doctor` prints how many baselines it holds and the `v1-` directory to move them into. Move the files with `git mv`. Render-cache entries under the old names are never read again, and the sweep every run applies to the cache deletes them.

  `@variance-authority/core/format` exports `digestFileName`, which spells a digest as a path segment, and `digestOfFileName`, which reads a digest back from either spelling.

### Patch Changes

- 11c1619: `httpLineCell` reads a 4xx answer as `refused`, not only 401 and 403, because every 4xx is the store saying no: a key it will not hold, a path it does not route, a token it does not take. The detail carries the store's own reason when the body gives one, as the `error` of a JSON body or as plain text, on one line and at most 1000 characters: `<url>: HTTP 422: the object key … names "feature" …`. A 404 is still `absent`. 408, 429 and every 5xx are `unreachable`, because they say the store could not take the request now, and they carry the reason the same way.

## 0.9.0

### Minor Changes

- 2958674: `variance reach` and `variance run --since` walk from the exports a JavaScript or TypeScript edit changed, not from the whole file. A file that imports only exports the edit left as they were is not reached, and a barrel passes each changed export on under the name it republishes it as. Stderr names the changed exports of each file, and `variance reach --format json` lists them under `exports`. A namespace import, a `require`, a dynamic `import()` and an import that binds nothing are still walked whole. `affectedBy` in `@variance-authority/core/relate` takes `moved`, the exports each seed changed, and `relationsOfFiles` takes `uses`, the names each import binds; `readPublishedSources` in `@variance-authority/sense` returns that lookup, read from the parses the index already stores.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

### Minor Changes

- 97e1ce6: A module can name a file it reads without importing it:
  `/// <depends path="./schema.graphql" />`, anywhere in the file. The scan draws
  a `depends` edge to that file, so a change to it reaches the tests that load
  the module. TypeScript and every runtime read the line as a comment. A directive
  that names no `path` is reported in the file's `unknown`. The source index
  format moves to version 11, so an existing index is read again once.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

### Minor Changes

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

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

### Minor Changes

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

## 0.2.0

### Minor Changes

- e546e21: A collector's complaints travel into the observation

  A finding produced at collection reached the CLI's record and nobody else. A
  suite driving this from its own runner asks the observation what is wrong with a
  subject, and the one diagnostic that explained the moved pixels — the host, not
  the stylesheet, chose the typeface — was produced, carried, and dropped one call
  short of the person reading the failure.

  `mergeDiagnostics` dedupes on every field, so the CLI, which now meets the same
  list twice, says a shared complaint once.
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
- e546e21: A subject is allowed to reference something that is not there

  A fixture that points an `<img>` at a path nobody serves is testing the fallback,
  and the broken state is the subject. Capture had no way to say so: the resolver
  returned bytes or the capture was refused, so Material UI's CardMedia,
  ImageListItem and Avatar suites — which all reference a deliberately absent
  `/fake.png` — could not be captured at all.

  `resolveResource` may answer `{ absent: true }`. The resource is recorded with
  its status, and the renderer answers that status instead of counting the request
  as one the document failed to carry.
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
- e546e21: Two readings of two places are not a flake

  `flake` is an accusation — *this reading is not repeatable* — and it was being
  made about a comparison that never claimed repeatability. Lifting two instances
  out of two subjects at one commit and parting them produces a case where every
  input agrees, the tree holds, and the output moved; the old table had exactly one
  row for that.

  Where a component sits is decided by the boxes around it, and no component
  receives its own position as a prop. Two instances that agreed on everything they
  were handed and landed at different coordinates have contradicted nothing.

  `partingOf` takes a `PartingPlace`: `same` for one subject read twice, across
  revisions or across two moments of one scenario, and `elsewhere` for two
  instances at one commit. It decides only between `flake` and the new `placed`
  rung and slice, and it defaults to `same`, which is what every comparison across
  revisions is. `divergencesOf` is the one caller that says `elsewhere`. The
  sentence points outwards, at what put the component there, rather than at the
  component.

### Patch Changes

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

- 5c34e6d: Say which input moved, not just which tag did

  `partingOf(baseline, candidate)` climbs from a set of deltas to the component
  boundary that owns them and names the input that carried the decision:
  `Cart chose differently — useState #0 moved`, with `Summary` reported as having
  been handed a different `expanded` and hanging under that line as a
  manifestation rather than as a second finding. `explainParting` renders that
  as lines. Two runs of one page that differ in a `<p>` where the other has a
  `<span>` previously produced a structural delta and nothing to say about it;
  the tag is now the symptom and the hook cell is the report.

  `holdingOf` from `@variance-authority/react` supplies the evidence — props,
  context values and hook cells as digests, per boundary, including
  `useSyncExternalStore` snapshots so a store that moved outside React is
  distinguished from a component that decided differently on its own. Values are
  never carried, only digests, and a holding reaches no hash: `renderHash`,
  `structureHash`, `styleHash`, band-exact component digests and
  `componentInstances` are all unmoved by it, the same bargain `styleProvenance`
  makes. `collect` in `@variance-authority/dom` takes `holdingOf` as a
  caller-supplied reader, opt in separately from `wiringOf`, and `capture` in
  `@variance-authority/unit-test` now accepts `provenanceOf`, `wiringOf` and
  `holdingOf` so a unit test can read one.

  A boundary whose own input could not be read is reported as `unread` and never
  as nondeterminism: `undetermined` is reserved for a component whose every input
  was read and agreed. A wrapper that roots a component boundary no longer
  collapses, because collapsing it discarded the holding — the cost is that a run
  reading holdings keeps wrappers a run without them removes, which is why both
  sides of a comparison must be read the same way.

  A component that ran no hooks is read as having run none, rather than as
  unreadable. React writes `_debugHookTypes = null` on every fiber and fills it on
  the first hook call, so the property's absence is the only silence — and
  collapsing the two reported the one shape most worth calling nondeterministic, a
  component with no props and no hooks that renders differently twice, as
  something nothing could be said about.

  `PartedBoundary.moved` names the properties the owned deltas named — `color`,
  `padding-top`, `width` — and `explainParting` spends them on the delta line.
  That is the last joint of the chain the rungs climb: a hook cell moved, a prop
  carried it down, and this is what the prop turned into on the page. A count and
  a band stop one link short of what somebody chasing a visual regression is
  trying to name.

  `Parting.slice` answers the question asked before which input moved: is this
  worth opening. Three facts are read independently — did the component tree
  move, did any input move, did the output move — and the combinations collapse
  to six sentences. `refactor` is the one that pays for the rest: a component
  tree that moved while the page did not is the receipt a refactor never gets,
  since a pixel differ can say the screenshots match and nothing about what was
  rewritten underneath. `flake` is `settled`'s opposite number and is refused on
  silence — a run that read no boundary reports `unread`, never `flake`.

  `explainParting` leads with that line, and stops enumerating manifestations
  past three: one input at a fork can put a boundary on every component beneath
  it, and nine lines carrying one decision bury the one line worth reading.

  The whole layer is documented in `docs/parting.md`: the six slices, the seven
  rungs, what a holding carries and what it deliberately does not.

### Patch Changes

- e8fee66: Refuse a value whose state is not in its own enumerable keys.

  `shapeValue` documented a `Date` as refused and encoded it instead. `typeof`
  answers `object`, `Object.entries` answers empty, and the canonical text came
  out `{}` — so a snapshot holding a timestamp addressed to the digest of an empty
  object, and a later run comparing a different timestamp reported unchanged. The
  same hole swallowed `Map`, `Set`, `URL`, and `RegExp`.

  An object with no own enumerable keys and a prototype other than `Object`'s is
  now refused by name at its pointer. A genuinely empty object is still a value,
  and an instance carrying its own fields still serializes them.
