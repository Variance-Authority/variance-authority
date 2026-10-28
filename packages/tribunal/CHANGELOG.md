# @variance-authority/tribunal

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

### Patch Changes

- eac7300: A crop and the viewer say `aria-busy` while their image is still being made

  When a build keeps no difference mask, the review page makes one from the two
  captures after both have arrived, and draws it from an object URL. Nothing is
  on the wire while that runs, and no image node exists yet, so a screenshot or a
  test taken then read a crop with an empty frame. A crop now carries
  `aria-busy="true"` until it knows whether it is near the screen and, once it is, until
  its mask is made or has failed; the viewer carries it while its mask is being
  made. Wait for no `[aria-busy="true"]` on the page before you read it.
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
- 4641388: A difference mask the review page could not compute is reported as failed

  When a build keeps no difference mask, the page computes one from the two
  captures. If a capture would not load or decode, the viewer said *Working out
  the difference…* for as long as the page stayed open. It now says it could not
  compute the mask and gives the reason, such as which capture the service
  refused. That sentence, and *Working out the difference…* while the mask is
  being made, now stand above the image's frame, and the frame draws no region
  rings until there is a mask, so the rings no longer cover the words. In a
  component's strip, a render whose mask failed says so in place of the image
  instead of drawing the region's ring over an empty crop.
- d38bada: The review page no longer reports a comparison it did not make

  A render with no baseline was described as one: the viewer said *0 pixels
  differ, in regions this run did not record*, the "What moved" card blamed a
  baseline carrying no component hashes, and a build of nothing but new renders
  was headed *Nothing in this build changed* and said there was nothing to
  approve. Each now says the render has no baseline, the docket is headed *No
  change to work through*, and the rail says how many renders await review under
  Subjects. A render whose count is zero is read by the run's pixel signal: no
  pixel differs (outside the ignored regions, for an absorbed render), its pixels
  changed uncounted, or it occupies none. The viewer says so in full, and the
  rail's *No region named these* rows, reach's *Moved with nothing reaching it*
  list and the *Since the last run* rows say so in short, where each used to print
  *0 px* or *0 pixels moved*. The docket's line against the previous build counts
  a subject that build did not have as new to this run, no longer as one that
  moved for the first time.

  Smaller corrections on the same page:

  - A strip whose build kept no mask, but kept both captures, opens on the
    difference it can draw rather than on the candidate.
  - The last approved change in a component's history is dated like every other
    date on the page.
  - *3 of theses* reads *3 of these*.
  - Links that are controls (the mode pills, *The run*, each build's heading, the
    rail's rows and the change page's renders) are drawn in the page's ink, and
    every other link in its accent, never the browser's blue or visited purple.
  - The settled fold is no longer drawn in the build list's bold green.
  - A changelog whose approvals no shape grouped no longer opens on a divider
    with nothing above it.
- b1a5160: An excluded subject is reported as excluded on purpose

  The pull request comment, the MCP summary and the tribunal's coverage line
  said "excluded by configuration". A subject is also excluded by a story's tags
  or by a page's own `data-variance-exclude`, so they now say "excluded on
  purpose", and the run report keeps each exclusion's reason.
- db4f72c: The review surface ships the faces it is set in

  `REVIEW_STYLES` names Inter and JetBrains Mono first, and the package shipped
  neither, so a reviewer without them installed, and every renderer of its
  stories, read the surface in a system fallback. Both faces now ship under the
  SIL Open Font License as `@variance-authority/tribunal/fonts.css`, which a host
  imports beside `REVIEW_STYLES`. The page `tribunal serve` writes links it, and
  serves the sheet and its two files under `/ui/fonts/`.

  A host that already gates its tribunal stories sees every baseline set in text
  move once it imports `fonts.css`, because those images were of the fallback.
  Review them and accept them once.

## 0.15.0

### Minor Changes

- 4b232c9: Reviewers can flag a render as suspicious without deciding it

  A subject page gains *Looks suspicious*, which raises a concern: a title, the
  region (with its component) or the whole render, evidence — the components, files or baseline you
  point at — a note and a hypothesis. A concern moves between open,
  investigating and resolved with a name on each step, stays on the subject with
  its trail across builds, and survives the retention sweep. Approving never resolves a concern,
  and resolving one approves nothing. The build header counts the concerns its
  subjects carry.

  The routes are `GET` and `POST /review/concerns` and `POST
  /review/concerns/<id>`, all three the review token's. `/version` reports API 4
  and schema 19; apply migration `0017_concerns.sql` before deploying.
  `createConcernStore` and the concern types are exported from
  `@variance-authority/tribunal/review`, and `Concerns`,
  `ConcernTrail`, `ConcernTallyLine` and `useConcernTally` from
  `@variance-authority/tribunal/ui`.
- 4da7b9a: An approval is taken against the baseline it read, the way a merge reads code

  Each subject on a build page now carries `baselineVersion`: the document digest
  of the baseline an approval would replace, or `null` when there is none. A
  baseline that moved after the page was read does not block by itself: when the
  approvals that moved it changed regions none of this build's regions meets, the
  approval goes through. It is refused with a 409, and nothing is recorded, only
  when they meet, when a run's `/baseline/put` wrote what stands, or when there
  was no baseline as the page was read. The answer names what you read, what is
  there now and the build whose change met yours, as a sentence, as `read` and
  `current` digests, and as a `clash` clause. The review pages send the version
  with every decision and, on a 409, say "The baseline changed while you were
  reviewing" with both digests shortened and where the two changes met, and a
  button that reloads the subject or the change. A rejection, or a decision
  without `baselineVersion`, is not checked.
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
- 67884ff: A subject page says when an earlier build kept the same image

  Each subject a reviewer decides on that kept a candidate now has `repeats` on
  its view: the earlier builds of the project, rendered by the same identity, in
  which the same subject kept the same candidate, matched on its content key, each
  with the decision it ended on. `count` is every such build, and `builds` names up
  to eight, the decided ones first. The field is absent on an `unchanged` or
  `ignored` subject and on one that kept no candidate, and `{ count: 0, builds: [] }`
  when no earlier build kept that image.

  The subject page names the earlier build in its Decision card and links to it. An
  image an earlier build rejected is drawn as a rejection. An image approved before
  this build ran, on a render that still differs from its baseline, is drawn as a
  warning that states just that.

  Approving an image whose latest earlier decision rejected it records the
  approval and opens a concern naming the build that rejected it, with that
  rejection's note. The approval is not refused: accepting a known defect is how
  the change it blocks gets merged. `decide` answers with a `Decided`, a
  `DecisionRecord` that carries the concern's id as `concern` when one was opened.

  No upload field and no migration: the candidate's key and the decisions are
  already stored, and the existing index on `after_key` answers the lookup.
- f411190: A subject page puts every move in one bar under the picture, with a key for each

  The moves on a subject used to sit at whatever height their card had in the
  right-hand column: *Approve* and *Reject* at the top, *Looks suspicious* one
  card down, and the way to the next render back in the rail. A bar under the
  picture now holds all of them. It names what is selected: the subject, the
  component the analysis named as its cause, its regions, and its place in the
  rail (*2 of 5*, or *not in the queue*).

  <kbd>J</kbd> and <kbd>K</kbd> walk the rail in the order it is drawn.
  <kbd>F</kbd> opens a concern and <kbd>I</kbd> opens one already under
  investigation, as the bar's *Investigate* does. On an open form either
  key sets its state and keeps what was typed. *Approve* and *Reject* stay buttons
  with no key. No key fires while a modifier is held, while the focus is in a text
  field or anywhere in a form, or as a held key repeats, and J and K wait while the
  concern form is open. A slider such as the wipe keeps the keys. Caps Lock
  does not change what a key does, and on a non-Latin layout the keys are the
  ones in the same place. *Keys off*, at the end of the bar, turns every
  single-letter key off and is remembered by the browser.

  Below 60rem the subject now takes the full width under the rail, rather than a
  sliver beside it.
- 045767a: The docket names stories of one component that render the same image

  Two stories whose candidates are byte for byte one image show nothing in a
  diff: both are `new`, or both changed the same way, and neither is red. Such a
  story is a flag value that reaches no pixel, or one state under two names. A
  build now carries `sameImage`, the groups of two or more stories of one
  component whose candidates are stored under one key, read from the keys the
  build already holds. The run uploads nothing new. A component is the part of
  the subject id before the first `--`, and no group crosses one. A story that
  settled on its baseline's digest kept no candidate and is in no group, so a
  pair is named only on a build where both are new or both changed.

  The docket counts these variations and links each group. A subject page lays its
  component's stories side by side, in the order the journeys panel draws them, and
  marks the ones that are one picture.

  The journeys panel now orders two stories with names of one length by code unit
  rather than by locale, so the panel and the docket list a group in one order.
- 29abf64: The rail opens with the work a build still asks for

  A build's header said how many renders awaited a decision and how many
  concerns stood, and neither number led anywhere. Finding the renders with an
  open concern meant reading every row of the rail. The rail now opens with four tasks:
  **Unreviewed**, **Open**, **Investigating** and **Resolved**. Each counts the
  renders it covers — *Unreviewed* what the header's *awaiting review* counts — and choosing one narrows the rail and the bar's
  <kbd>J</kbd> and <kbd>K</kbd> to them; the render on screen keeps its place
  until you move on, even once deciding it takes it out of the task. The header
  now reads `concerns: 2 open · …`, since it counts concerns and the tasks
  count renders. The bar's *Flag as investigating* is now *Investigate*, the
  word the concern's own button uses. The address keeps the task, as
  `?task=open`. A concern task also lists renders the build left unchanged,
  when an earlier build's concern still stands on them. When concerns could not
  be read, those tasks show `?` and say why, not zero.
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
- 7bc33d0: The run page draws a family that varies on exactly two axes as a grid: the axis the name format lists first down, the other across, the base in the corner, and a combination nothing in the family is at as an empty cell that names its two values. Placement reads only the records' `step`, stored in a new `build_variations.step` column (migration `0018_variation-step.sql`); a family with a link the name format did not read stays as pairs. A variation picture too large for its tile at quarter size is drawn at a quarter and cropped to its top-left corner, labelled so, rather than shrunk until the sampler chooses its rows.
- f079bcb: The run page draws each variation as its two pictures, parent first, each linked to its subject's page; a variation whose parent this run did not observe draws only its own. `Variations` takes an optional `pictures` prop with the client, build, subjects and `go`; without it the list stays names only.

### Patch Changes

- 242e449: The change page separates a reading mark from the sentence before it

  On the change page, the run's sentence about why a component moved and the mark
  saying how its render has read before printed as one line, as in
  `…to reach the first rungnobody has read this render twice yet`. A ` · ` now
  stands between them.
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

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

### Minor Changes

- c9852fa: A tribunal serves the share under `/share/`, so an `http` share whose `endpoint` is `<deployment>/share` stores its lines there. The ingest token reads and writes it. The new optional share token (`shareToken`, `SHARE_TOKEN` on Cloudflare, `VARIANCE_TRIBUNAL_SHARE_TOKEN` for the Node executable) only reads it. Every other route answers it with 403, except `GET /version`, which answers every token. The review token is refused under `/share/`. A manifest is replaced only on the version it was read at, so two writers publishing to one line keep both sets of entries. A manifest write with neither `If-Match` nor `If-None-Match` answers 428. `createTribunalRoutes` exports `PUT`, and `authorize` may return `'share'` when `tokens.share` is set. `R2Like.put` takes R2's `onlyIf` and returns the written object's `httpEtag`. The API version is 3. The note `push` prints about an older deployment names every capability it lacks, and names the share only when `PushOptions.share` is an `http` share under the deployment's endpoint, so a push to a deployment at API 2 whose share is elsewhere prints no note.

### Patch Changes

- a3d7088: `createDirectoryBucket` compares every segment of a key with the name the volume stores, not only the file name. On a volume that treats two spellings as one name, such as the default APFS on macOS, a key that finds an existing file or directory only through a spelling it does not use is absent: `get` and `head` answer `null`, `delete` removes nothing, and `put` throws an error that names the segment and the stored spelling. So two share lines whose branches differ only by case, such as `branch/Feature` and `branch/feature`, are two lines on a case-sensitive volume, and on a folding volume the second one is refused instead of reading and replacing the first. A `put` checks before it makes the key's directory and again after, so of two keys that differ only by case and are written at the same moment, the one whose spelling the volume did not keep is refused, in one process or two. The worker answers a refused key with 422 and a message that names the key's own directory, never the store's path on disk. The check asks the volume about each segment of the key with two `lstat` calls, one for the segment and one for its case-inverted spelling, and adds a `realpath` only where both name one file.

## 0.9.0

### Patch Changes

- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.

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
- 53e96ad: `variance push` asks what the deployment already holds, and uploads only the rest

  Objects in a tribunal deployment are addressed by their content, which made most
  of what a push sent redundant without anything being able to notice: a run's
  `before` **is** the baseline that deployment handed it over `/baseline/find`, and
  an unchanged subject's `after` is a second copy of that same picture. Every run
  re-encoded and re-uploaded them, and the second and every later copy landed at a
  key the store already had.

  A push now opens with one `POST /review/have` naming the SHA-256 of every image
  it is holding. Images the deployment can already produce travel as a digest; the
  rest travel as bytes. A suite where nothing moved sends its report and almost no
  pixels, and `variance push` reports how many images it did not have to upload.

  The digest form is re-checked on ingest rather than trusted. A digest this
  deployment does not hold — invented, or collected by retention between the
  question and the build — refuses the build naming the subject and the remedy,
  because the run still has the image on disk and may push it again. Recording a
  subject whose picture is not there would surface as a 404 on a review page days
  later instead.

  A deployment that does not answer `/review/have` gets the push this command made
  before the route existed: larger, and correct. Upgrading the CLI ahead of the
  service is not a breaking change.
- 53e96ad: Say which halves are talking.

  A deployment answers `GET /version` with the wire contract it serves and the row
  shape it expects, and `variance push` asks before it reads a byte off disk. The
  pair is printed on the line the operator keeps, and a difference between them is
  named in a sentence rather than left to be inferred.

  It had to be inferred until now, and it was not. A CLI newer than its deployment
  asks `POST /review/have` which images are already there, is answered 404, reads
  that correctly as *nothing is*, and uploads every pixel it is holding — a push
  that is eight megabytes and thirty seconds instead of a few hundred kilobytes,
  with no error anywhere in it. The same mismatch promotes a retina baseline under
  the run's identity rather than the document's, which presents as a subject that
  stays `new` after an approval the page reported as recorded. Three symptoms, one
  cause, and nothing in the chain could state it.

  `variance --version` prints the tool on its own.
- 7b6ec3c: One object per picture, and a sweep that can tell what nothing wants

  Every key this service wrote was derived from where the bytes came from rather
  than from what they are: a baseline under the identity that painted it, a cache
  entry under its document digest, a build image under the build id. Two
  byte-identical PNGs therefore always landed at two keys, by construction. An
  unchanged suite of 300 subjects over 200 builds stored 60,300 objects holding
  300 distinct pictures, approving copied an image the bucket already had through
  this process twice, and the `before` each run uploaded was a second copy of a
  baseline this deployment had handed that run itself over `/baseline/find`.

  Images are now addressed by their own SHA-256. A baseline, the candidate it was
  promoted from, and the `before` of every run since are one object with three
  rows naming it, and a promotion writes a row and no bytes. Old keys still read:
  a key is a column, not something a lookup derives, so a deployment upgrades
  without moving an object.

  Sharing one object removes the property that made deletion simple — a build's
  `before` could not have been the baseline, because the baseline was elsewhere —
  so the sweep no longer deletes per build. A new `objects` table claims every key
  this package writes, and the sweep removes the ones no baseline, cache entry or
  build subject refers to and that nothing has stored or matched for the whole
  retention window. That ledger also closes a hole that predates content keys:
  `store.ts` said an object written before its row was "removed by the next
  sweep", and it never was, because every key the sweep knew came from a row and
  `R2Like` has no `list`. Those were unreachable forever; they are ordinary rows
  now.

  **A build nobody has finished reviewing outlives its window.** The sweep used to
  count a build's decisions and then delete its images anyway, which took the
  `after` out from under every undecided `changed` subject — `decide` afterwards
  refused with "the bucket has no such object", so the change became permanently
  unapprovable through this service, by the retention policy, silently. Such a
  build is kept, and `SweepReport` gained `held` so a review queue nobody is
  working shows up as a number rather than as missing evidence. `ephemeral` builds
  are exempt: both of their images were painted in one run and compared against
  each other, so no decision about one can reach a stored baseline.

  The nine `DELETE`s that remove a build now travel in one `batch`. Run
  separately, a failure in the middle left a build whose subjects were gone and
  whose reach rows were not — a row set no page renders and no later sweep
  revisits, since the `builds` row it selects on went last.

  `render_cache` was the one table nothing ever removed a row from. The sweep now
  drops entries older than the same window and reports them as `cached`; an entry
  is pure optimisation, so the loss of one costs a re-render of a document nothing
  has asked for in the whole retention period.
- 7b6ec3c: One round trip per question, because a binding call is a subrequest

  A Worker may make 50 subrequests per request on the free plan and 10,000 on a
  paid one, and D1 and R2 binding calls both count. This service was spending them
  one row at a time.

  **`/review/have`** asked the ledger and then asked the bucket, per digest,
  serially: a suite naming 600 images cost 1,200 subrequests — twenty-four times
  what a free Worker may spend, on the one route whose whole purpose is to save
  work. It now asks the ledger in groups of 99, which is what D1's 100-parameter
  limit permits, and does not ask the bucket at all. The `head` was checking
  whether a row had outlived its object, which is a window that opens only when a
  process dies between two adjacent writes; the places that actually need the
  bytes — serving an image, promoting a baseline — still check, because they are
  about to read them. Six queries for those 600 digests.

  **Ingesting a build** stored images one subject at a time and made two round
  trips per image: about 2,100 for a 300-subject run. It is now three phases for
  the whole build — one chunked query for which keys are already here, a `put` for
  each one that is not, and a single `batch` claiming every key the build named.
  A green suite, where every image is a baseline this deployment handed the run
  itself, reaches the bucket zero times and ingests in eight round trips.

  **The build listing** ran the four summary queries per build after the listing
  query — 201 statements for a page of fifty, issued one after another, which is
  where the three seconds went. The summaries are now four `GROUP BY build`
  aggregates over the same window of builds, and the page is one `batch`. So is a
  build page: `build()` issued thirteen serial statements, read the decisions and
  the not-observed rows twice each, and is now one batch of fifteen.

  **The crossing fetched the whole build listing** — a page of summaries, four
  queries each — to learn the id of the run before this one. `BuildDetail` carries
  `previous`, chosen in SQL by the same rule the page always used: by position in
  the listing rather than by clock, because two runs pushed from one machine can
  share a timestamp to the millisecond.

  Two correctness repairs came out of the same reading. The latest-decision join
  selected its outer rows on a globally unique sequence number without also
  filtering them by project and build, which was right only for as long as that
  column stays `AUTOINCREMENT`; it is filtered now, and the index covers it. And
  `discard` handed R2 every key it was given in one call while `unreferenced`
  defaulted to exactly R2's 1,000-key limit — correct today, and a platform error
  for whoever raised that default for any reason. It is chunked.
- faec91c: The difference mask is computed on the review page, not uploaded

  A mask is new bytes by definition whenever anything moved, so it is the one image
  content addressing can never deduplicate: `before` is always a hit and an
  unchanged `after` is a second copy of a baseline, but a mask matches nothing and
  never will. `variance push` now leaves it at home. The review surface holds both
  captures and makes its own when a reviewer opens the difference — through the
  same function, at the same policy, so the two cannot disagree about a threshold,
  an anti-aliasing rule, or what a grown capture does to the union box. Builds
  pushed by earlier versions kept a mask and are still served it.

  Runs are unchanged: the report still writes a diff PNG, because that is the
  picture a developer opens without a deployment, and a deployment is optional.

  `@variance-authority/png` gains a `./mask` subpath — the padding rule and the
  difference, over pixels somebody else decoded — so a caller holding RGBA reaches
  the arithmetic without a codec, and a bundler following it finds no `pngjs`.

### Patch Changes

- 789405d: An `ignored` subject now ships the pair that makes it reviewable.

  `ignored` means pixels differed and every one of them fell inside a mask
  somebody wrote, which makes it the one verdict where the question is about the
  mask rather than about the render. The run shipped only the candidate for it —
  the single image that cannot answer *has this rule grown over a regression*,
  because inside a mask the candidate looks exactly as intended. A `before` and
  the difference mask are written and uploaded for it now, on the same terms as a
  changed subject, and the settled panel links each absorbed row to the page that
  shows all three.

  The browser accessibility snapshot a candidate sidecar could carry is stated as
  the missing acquisition it is, at the site that would have to close it: the CLI
  builds the sidecar from the render cache, which holds the renderer's output, and
  the collector contract has no field for one. The column, the transport and the
  promotion all carry it already.
- c8f0824: An approved candidate becomes a baseline a later run can find

  Every baseline lookup keys on the identity of the document that was painted —
  `identityAtScale`, which folds in the viewport's `deviceScaleFactor`. A build
  row carries the identity of the machine instead, whose own source says nothing
  may key a store on it: a run painting 1x and 2x viewports reports the scale
  there as 1. Promotion used that one. On any suite above 1x the approval was
  recorded, the page said so, and the next run looked under a digest nothing had
  ever been filed under — so the subject came back `new`, forever, and no amount
  of approving it helped.

  So `push` now sends the candidate's own sidecar identity, the service keeps it,
  and a promotion files under it. A push that predates the field still promotes
  under the build identity, which is what this did for every build and is correct
  at 1x.

  `components` and `findingMarks` travelled the same way and did not survive: the
  sidecar carries them, the request dropped them, and a baseline promoted through
  review came back without. Both describe the document that painted the image, so
  nothing downstream can recover them from the bytes — without the hashes a later
  run ranks causes by area, and without the marks it reports every standing defect
  as one the change under review introduced. Absent and `[]` stay apart end to
  end, because nobody having looked is not the same fact as having looked and
  found nothing.

  For the same reason `push` no longer defaults a missing `missingFonts` to `[]`.
  A sidecar that never said which fonts were missing now withholds the candidate
  with a sentence naming the file, rather than promoting a baseline that claims a
  font check it never ran.
- 7014719: A page that has nothing yet says what it is missing, and wears its chrome while it waits

  Two states on the review surface threw away what the page already knew.

  A deployment nobody has pushed to said `No builds have been posted yet` and
  stopped. Every other absence here is a fact about the project, and a sentence is
  the whole right response to those — but this one is a fact about a setup
  somebody is still finishing. It now prints the `review` block with the endpoint
  this page is reachable at already filled in, the `variance push` line under it,
  and which of the two tokens that is: the ingest one, not the review token, which
  is what a person decides a subject with. A failed build list still never reaches
  this screen, because instructions over a service that answered 503 send a reader
  off to check a config that is not the problem.

  A build that was still loading, or one that failed to load, rendered an empty
  ground with a single grey line on it — no brand, no crumb, nothing to click.
  Both now wear the topbar the loaded page wears, with the crumb back to the build
  list, which was knowable before the build was; the body is drawn as bars the
  height of what is landing, so nothing jumps when it does. `Waiting`, `Skeleton`
  and `Stalled` are exported for hosts that render the pages themselves.

  `ReviewClient` gained an optional `endpoint` — the base it was built with — so
  the one screen that has to name an address rather than use it can.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Minor Changes

- c54a8d1: Serve every history path, and let a reviewer ask what the record already knows.

  Three of the eight protocol paths were unserved and two fields were dropped on
  the way in, and none of it presented as an error. Without `/v1/current` a run
  compares against nothing, so every component reads as new and drift is never
  detected. Without `/v1/approvals` every observation stays unapproved, so churn
  answers *this component has never changed* about a component that changed forty
  times. Without `instabilities` and `run.swept` a flake has no denominator. All
  three failures sound like a stable suite.

  The derived reads — churn, reach, flakiness, the value journey, the last change —
  now answer the review capability as well as the ingest one. They write nothing,
  and the browser drawing a review page holds the review token; refusing them there
  meant a surface that can approve a change it cannot put in context. The writes
  and `/v1/current` stay the ingest token's.

  On the page: a **Changelog** tab grouping every approval by the shape that was
  approved, counting the approvals nothing could attribute rather than dropping
  them, and a per-subject **record** panel — how often this subject read
  differently, whether it has since, how often its cause caused an approved change,
  and how far that component reaches. Fetched when the reviewer asks, because a
  build with three hundred changed subjects would otherwise make nine hundred
  requests to draw a page on which one is read. A flake rate stays absent until
  something swept: `0%` is the confident answer to a question nobody asked.
- 89bd179: Export `MIGRATIONS` and `INITIAL_VERSION` from the package entrypoint.

  The README sends an operator whose database is already deployed to `MIGRATIONS`
  — "what an existing database needs is the part it is missing" — and the constant
  lived in a private module. The entrypoint offered `SCHEMA`, which fails on the
  first `CREATE TABLE` against that database by design, and nothing else. There
  was no way to reach the steps from outside the package.

  `INITIAL_VERSION` goes with it, because `MIGRATIONS` is indexed against it: step
  `i` lands on `INITIAL_VERSION + i + 1`, so a database reporting `schema_version`
  `n` needs every step from `n - INITIAL_VERSION` on.
- f2564ed: Name the sweep count for what happened to it

  `SweepReport.decisions` became `decisionsKept`. Every other number in that
  report is a removal, and the README sentence beside it says the store "reports
  counts for everything it removed" — so an operator reading `decisions: 4`
  concludes four approvals were deleted, which is the one thing the `decisions`
  table's permanence trigger exists to make impossible. The number was always the
  opposite: approvals that outlived the builds this call removed.
- 896d64a: Run the review service on a machine you own — a SQLite file, a directory, a port.

  The package shipped one deployment and named none: every module above the
  bindings takes a `D1Like` and an `R2Like`, so what stood between it and a laptop
  was two adapters and a shell. `@variance-authority/tribunal/node` supplies them.
  `openDatabase` opens, creates and migrates a SQLite file through `node:sqlite`
  and reports the version it settled on; `createDirectoryBucket` puts objects in a
  directory through `node:fs`, each written to a staging file and renamed so a
  reader never sees half of one, and refusing a key a case-folding volume would
  land on another key's file. `serveTribunal` binds a `node:http` server over the
  same `createTribunalRoutes` the Next.js adapter uses, so the token-attaching rule
  has one implementation rather than two.

  `variance-authority-tribunal` is that service as an executable, configured by the
  environment. It refuses an unnamed project, refuses a non-loopback bind unless
  `VARIANCE_TRIBUNAL_TRUST_NETWORK` says so, and on a network bind serves no review
  surface at all — there would be nothing between an approve button and the
  internet. On loopback it serves the surface and treats an untokened caller as the
  reviewer, because anything that can open the port is already the person who
  started the process. No token is written into the page or into the startup line.

  The SQLite adapter `testing.ts` had privately is now that shipped adapter, so
  what the suite exercises is what an operator runs.

### Patch Changes

- 44a174f: Name the binding that never arrived

  `createBucketStore` and `createD1Backend` now refuse a `db` or `bucket` that is
  not the binding it claims to be. A `wrangler.jsonc` declaring the database as
  `D1` while the entry reads `env.DB` used to reach the first statement that
  touched a row and surface as `Cannot read properties of undefined (reading
  'prepare')` — a platform-shaped error for a configuration line — and a bucket
  declared for production and not for a preview environment would have written
  sidecar rows without the images they describe.
- 08ab85c: Refuse a deployment that never said which project it is.

  `project` is required, scopes every row and every object key, and had no runtime
  check. `undefined` reached D1 as a bind parameter and came back as *the baseline
  store could not reach its database or its bucket* — the platform blamed for a
  line in a wrangler file — and a blank string quietly became a namespace nobody
  named. `createBucketStore` now refuses both with a sentence, which `createTribunal`
  and `createReviewStore` inherit, the way the two token rules already answer.
