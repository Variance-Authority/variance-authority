# @variance-authority/report

## 0.15.0

### Minor Changes

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

### Patch Changes

- 5e70b52: The adjudicate count line names each count by the verdict its claim line prints: `overreached` and `unobservable`, where it said `over-reaching` and `unchecked`.
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

- a7e7c9e: A changed subject with no difference shape is explained by what the run read, not by its retention

  A run fingerprints the regions of a changed subject whenever its collector gives a semantic snapshot, whatever its retention. When a subject has no shape, `variance_changes`, the PR comment and the review service's changelog page said the run compared without a document, in the ephemeral mode or on a raster-only path. They now say the run read no markup for that subject, or only its accessibility tree changed.
- d567e21: An unattributed change is named by what is missing, not by how it was grouped

  The `title` on the `shape only` marker in `variance report --format html` said the change was "grouped by silhouette alone", as though a change with a component were grouped by more. Every change is grouped by its fingerprint, a digest of the changed pixels that does not include the component. The marker now says that no region with that shape was attributed to a component.

  In the same way, `variance adjudicate` and the `variance_adjudicate` MCP tool named an unclaimed change with no component "(no component resolved; grouped by shape alone)". The line reads "(no component resolved)".

  The `@variance-authority/report` README said a change's fingerprint is built from the component responsible, so the same-looking change in two components stays two changes. It is built from the pixels alone: those two are one change, `accept --shape` on it promotes both, and `change.component` names the first component a region in it was attributed to. The `@variance-authority/tribunal` README's definition of a shape is corrected the same way.

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

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

### Minor Changes

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
