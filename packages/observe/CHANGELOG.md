# @variance-authority/observe

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
- 4c2e4a7: A colour change of more than 1% is a change

  The default policy counted a pixel only when its colour changed by more than 10%
  of the largest difference `pixelmatch`'s YIQ metric measures, which is
  `pixelmatch`'s own default. At 10%,
  a border colour changed from `#2f3437` to `#3a4043`, or an accent from `#ff4a19`
  to `#ff6a19`, reported `unchanged` on every story it painted. `DEFAULT_POLICY` now
  uses `threshold: 0.01` and still forgives antialiasing. A subject whose colour
  changed by between 1% and 10% since its baseline reports `changed` on its next
  run. Stored baselines are not re-keyed.

  The reason for a green verdict now gives the pixels the default policy forgave,
  when the strict policy counted any: *no pixels differ beyond the tolerance of the
  default policy, which forgave 37 pixels as antialiasing or as a colour change of
  at most 1%*. The same clause follows the reason for every `ignored` verdict. It
  replaces `; 37 pixels differ with antialiasing counted`, which named
  antialiasing for pixels that the colour threshold had forgiven.
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

### Patch Changes

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

### Patch Changes

- 10c401e: A subject that paints nothing is no longer `changed` by a random class name or id

  When neither side of a subject occupies pixels, its verdict rests on whether its
  document moved, and that was read from the digest of the raw markup. A harness
  that puts a random `className`, `data-testid` or `Math.random` id on each mount
  changes that digest on every run. Material UI's conformance tests do all three,
  and two runs of one commit reported 209 of its 1,235 unpainted subjects
  `changed`, each naming no component that moved. For such a subject, a moved
  digest is now read through the component hashes when the baseline and the run
  both carry them: the document moved only if some component, including the nodes
  outside every component, moved a band or rendered on one side only. A painted
  subject still reports the raw answer.
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

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

### Patch Changes

- 6b4a6b8: A pull-request comment now groups subjects that have no baseline under one reason instead of listing each subject as its own cause. The reason for `new` and `incomparable` no longer repeats the subject id, which every line already shows: `no baseline under this renderer; nothing to compare against`.

  `variance report --format html --embed-images` writes the report as one file with its images inside it, so it opens anywhere, including on a phone. On GitHub Actions, upload it with `actions/upload-artifact@v7` and `archive: false`, and the artifact link opens the page instead of downloading a zip.

  `variance comment --to-accept <text>` tells the reviewer how to accept in your repository. When `--run-url` is given, the comment links the report and no longer prints the `variance report --subject <id>` command, which needs the report on disk. The GitHub action takes `to-accept` and `report-page` inputs. `report-page` writes, uploads and links that page.

  The comment now fits a phone's first screen: the count, the leading cause and its file, the report link and how to accept, then any font warning as an alert. The causes, the collateral count, what was skipped and what painted the images sit under one `<details>` fold.

  In the HTML report, each subject's commands (`accept`, `again`, `alone`, `report --subject`) sit folded under **Commands for a checkout**, each with a line saying what it does. The mark on a subject whose inspection found nothing reads `no defects found`. On a narrow screen the header scrolls away instead of staying pinned.

  On a phone, the HTML report shows each subject with its reason and images, and nothing else. The grouped changes, region tables, commands, composition, history, settled subjects, what was not observed and coverage stay on wider screens. A line at the top names the ones this report holds, so you know there is more.

  `variance comment --image-root <url>` shows the leading cause's before and after on the comment's first screen, and each further cause's pair in the fold. The address is where you published the report's directory. The GitHub action takes an `image-ref` input that pushes those images to a ref outside `refs/heads/`, as one commit, and links them by that commit.

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

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

First release.
