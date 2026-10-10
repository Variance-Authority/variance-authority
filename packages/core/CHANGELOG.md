# @variance-authority/core

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
- 8187fb1: `didYouMean` and `nearest` are exported from `@variance-authority/core` and no
  longer from `@variance-authority/mcp/tools`. Import them from
  `@variance-authority/core`. A mistyped command or flag is refused, with the
  nearest right one, without loading the MCP server's tools.

### Patch Changes

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
