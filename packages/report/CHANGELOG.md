# @variance-authority/report

## 0.22.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

### Minor Changes

- 0fd6a4b: `unstableOf` lists the subjects whose two readings disagreed outside what they assert on, with what moved and the history record for each, and `isUnstable` asks it of one observation. `NO_RECORD` is the sentence a surface prints when no history store answered. The pull-request comment, the report page and the MCP summary read the same list.

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
- 009b089: A presentation signal with one side missing is `changed`, not `incomparable`.

  A side with no presentation reading, or a reading with no layout findings, now
  gives `verdict: 'changed'` with a `because` that names that side and no effects.
  This is the rule ADR-0090 already applies to one-sided accessibility evidence.
  The signal still changes no subject's verdict.

  `presentationSignal` returns `undefined` when neither side was measured, with
  no reading or no layout findings on both sides, so the member stays absent
  rather than holding a signal about nothing.
  `PresentationSignalRecord` no longer has an `incomparable` variant: tell a
  one-sided record from a compared one by `'because' in signal`. A run-report
  file whose presentation signal says `incomparable` is refused when read.
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
- 4aa7b16: The pull-request comment shows each change at full size

  The comment showed a changed subject as its whole before and after images side
  by side at half the comment's width, so on a long page the change was a few
  pixels tall. `changeImages` in `@variance-authority/png` cuts a window around
  each changed region and each removed span, with 32 rows and 48 columns of
  context and at least 320 pixels wide, and lays the three heaviest windows out as
  before, after and the difference, one window under the next. The before panel is
  read through the row alignment, so it shows what the after rows replaced,
  removed rows included.

  `variance run` writes it beside the before, after and diff images as
  `<subject>.change.png` and names it in the report as `images.change`. The comment
  embeds that one picture at its own size when the report names it, and the whole
  before and after pair otherwise; the image refs carry the same picture, and the
  comment's text does not grow.

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
- 27ab269: The change image shows before beside after, labelled, the change marked on both

  The change image stacked before, after and a red pixel difference one under
  the next, so a reviewer had to find a reflowed paragraph by comparing panels a
  screen apart, and the red covered every line the paragraph pushed down.
  `changeImages` now lays each window out as its before beside its after, row for
  row through the alignment, with striped filler opposite rows only one side has.

  The sheet reads as one picture. Every window is cut as wide as the widest,
  framed, on a neutral canvas with a margin around and between the windows. A
  window's top and bottom move out of any line of text they would cut. Each column
  is labelled `Before` or `After`, beside a red or a green dot, and a new optional `labels`
  argument sets the subject over both and where each side came from beside its
  label; the CLI passes the subject's id, `baseline` and `this run`. The text is
  Inter, drawn from glyphs the package ships, under the SIL Open Font License 1.1
  in `glyphs/inter-LICENSE.txt`.

  What changed is washed in red on the before and green on the after, with an
  edge of the same colour just outside it, widened to the space either side of
  the words it starts and ends in, so it covers no neighbouring letter. Rows that
  only moved are not marked on the panels: a blue arrow in the gutter runs beside
  them, its head the way they went. A run of identical rows — a blank gap, or the plain inside
  of a box — that grew or shrank by more than a row gets a window while the changes leave one free, and a blue line across the
  gutter instead of a mark; one that changed by a single row is rounding and is
  left out.

  `AlignedRows`, exported from `@variance-authority/png/mask`, carries two more
  required spans for this: `grown`, the inserted rows that only repeat a run of
  identical rows that got taller, and `shrunk`, the removed rows such a run lost.
  Code that builds an `AlignedRows` itself has to supply both.

## 0.15.0

### Minor Changes

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
- 9bea264: A variation record carries `step` — the `axis`, its `position` among the format's axes, and the parent's and the subject's values on it, as `from` and `to` — when the configured name format read the pair. A pair linked any other way has none. `VariationStep` is exported beside `VariationRecord`.

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
