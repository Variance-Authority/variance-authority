# @variance-authority/store

## 0.22.0

### Minor Changes

- 659925c: An accepted baseline is kept as a lossless WebP, in about a quarter of the bytes of the PNG it was captured as. It is encoded once, on the machine that accepts, by `keepImage` in `@variance-authority/png-sharp` — sharp's libwebp at effort 2 — which decodes its output back and throws unless every pixel with any opacity matches in all four channels and every fully transparent pixel stays fully transparent. The colour under a fully transparent pixel is not kept; no comparison sees it. `@variance-authority/store/keep` exports `keptRaster`, which every accept calls before `put` and which loads sharp only then, so a run that accepts nothing never loads it, and an accept where sharp does not load fails and names why. A durable store's `put` encodes nothing: it refuses any image but a lossless WebP, naming what it was given, so a remote store receives the WebP and runs no codec. A read checks the image's header against the sidecar and refuses a `.webp` holding a PNG or a lossy WebP, or an `image` format it does not know, as damage. Captures and the render cache stay PNG; a report's before image is the baseline as it was kept, so `.before.webp` beside a WebP baseline, attached as `image/webp`. The sidecar records `"image": "webp"`; a baseline kept as a `.png` before has no such field, stays readable, and its next accept replaces it. A WebP holds at most 16,383 pixels on a side, so an accept refuses a larger image and writes nothing. A `sharp` upgrade that brings a new libwebp can write different bytes for the same pixels, so a baseline rewritten after it shows in git as a changed file whose pixels did not. `createLfsStore` tracks `*-*.webp` by default and leaves an existing `*-*.png` entry in place; a `pattern` you set yourself must end in `.webp` or `*`, or the store refuses to open. `doctor --baselines` and the carried pathspecs count both extensions. `@variance-authority/png` reads WebP without an addon through libwebp's WebAssembly decoder and adds `decodePortable`, `imageFormat`, `refuseUnkept`, `isLosslessWebp`, `refuseOversize` and `KEEP_LIMIT`; its decoders read either format by the bytes' header, `imageSize` replaces `pngSize`, `diffImage` is now async — it resolves to its PNG, since either side may be a WebP — and takes an optional decoder, `changeImages` takes decoded images rather than bytes, and `@variance-authority/png/header` reads a header without loading a codec. `@variance-authority/store` exports `KEPT`, `KeptAs` and `isKeptImage`, and a path template that ends in `.webp` is refused like one ending in `.png`. The tribunal worker labels each image by the format its bytes declare.
- 050e333: A git-LFS pointer is no longer read as the file it stands for. The text of a source file at a recorded commit, when git holds it as a pointer, is the content `git lfs smudge` gives, and the read fails with git-lfs's own words when it cannot give it. A baseline record that is a pointer is refused as one, by `find`, `describe` and `accept` alike, rather than called a truncated write or written over. `isLfsPointer` and `LFS_POINTER_HEAD_BYTES` now come from `@variance-authority/core`; `@variance-authority/store/lfs` no longer exports them.

## 0.21.0

### Minor Changes

- 0e8fa8c: An LFS checkout downloads the baselines it compares, not every baseline

  A job on the `lfs` placement had to smudge its checkout, which downloads every
  baseline in the repository on every run, although a run reads the image of a
  subject only when its document moved. Check out with `lfs: false` on
  `actions/checkout`, or `GIT_LFS_SKIP_SMUDGE=1`, and run `git lfs install --local
  --skip-smudge`: when
  `find` meets a pointer, the store runs `git lfs pull --include` for that file
  and reads it again. Pointers met while a pull runs go into the next one, so
  concurrent lanes share pulls. `describe` and the render cache never fetch.

  A pull that fails, or git-lfs missing on an unsmudged clone, is refused with
  git-lfs's own error, exit 2, never read as a missing baseline. So is a pointer the
  pull left in place, naming `git lfs install --local`, and `tracking.diagnostics`
  reports git-lfs installed but not set up, which commits whole images. `verify:
  false` still runs no git, so a pointer is refused as before. A smudged checkout never
  meets a pointer and never runs a pull.

  `createDurableStore` takes `readImage`, the reader `find` uses for the image.
  `lfsSetup(cwd, run)` names what keeps git from running git-lfs, and
  `variance doctor --baselines` refuses a pointer only where it says something:
  where git-lfs is set up in the root's work tree, the run fetches the image.

## 0.20.0

### Patch Changes

- a1dcf55: `variance doctor --baselines` refuses a checkout of git-LFS pointers, and the action asks it before every run

  On a clone that skipped the LFS fetch, a subject whose page did not move is
  settled from its sidecar without its image being read, so `variance run` passed
  until the first subject that moved met the pointer. `variance doctor` now reads
  the head of every image the `lfs` store reads — the one beside each record
  `baselines.path` places, and those in an identity directory — counts the ones that are git-LFS
  pointers, names the first under *POINTERS, NOT IMAGES*, prints
  `git lfs install && git lfs pull`, and exits 2, the code the run exits with when
  it meets one. It exits 2 for that finding under a remote renderer as well.

  `variance doctor --baselines` asks the same of the store alone: no browser is
  opened and no font measured. The composite action in `.github/actions/variance`
  runs it before every run over a store in the checkout, so a job that uses the
  action stops with exit 2 on such a clone instead of passing.

  `@variance-authority/store/lfs` exports the test both use: `isLfsPointer(head)`,
  and `LFS_POINTER_HEAD_BYTES`, how many leading bytes it needs.

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
- 238b6d9: The README's "What you get" example now names the identity directory the way
  the store writes it, `v1-<hex>`. It used to show `v1:<hex>`, the digest itself,
  which is not a portable file name and not a path the store creates.

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

- e963cba: A directory line's lock stays its writer's for as long as the writer works

  A publish to a directory line keeps its lock fresh while it writes, so a write
  that runs past a minute is no longer taken for a dead writer's and written over.
  A writer that has gone 45 s without freshening its lock gives it up before
  another writer could take it for dead: it writes no manifest and answers that the line moved,
  so the publish reads the line again. It asks once the manifest is staged, so
  nothing but the rename that commits it follows the answer. The same holds for a writer whose lock is
  gone, or whose freshening landed too late to count. When two writers find one dead
  writer's lock, one removes it and the other waits for the lock that writer
  makes.

  A dead writer's lock, or a dead writer's claim on one, that the file system will
  not let a writer claim or remove, and a lock whose age it will not tell, now
  answer as `refused` (or `unreachable`) at once, with what the file system said,
  instead of retrying without a pause or waiting the lock out as if it were held.
  A writer that gives its lock up because the file system refused to freshen it
  answers the same way, instead of reporting that the line moved, and leaves no
  staged manifest behind.
- 1707076: A publish to a git share whose line moved while the push was in flight reads
  the line again and decides again, as it already did when the line had moved
  before the push started. A hosted remote refuses that push at its own ref
  update, `[remote rejected]`, and the publish used to report that refusal as
  `nothing published … failed to push some refs`. A refused push is now a lost
  race when the remote holds the line at a commit other than the one the publish
  started from. The publish reports any other refusal as before.
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
- 12dc597: A push the share remote refuses now says why: the reason git reports for the refused ref and every `remote:` line the remote's hooks printed, in place of git's "failed to push some refs".
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

### Patch Changes

- 7dda58a: A `git` share line does not send `http.extraheader` twice when the environment already hands the same header over as `GIT_CONFIG_*` variables, as a CI step does after checking out with `persist-credentials: false`.

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

- ee3f00f: `createDirectoryLineCell` compares each segment of a line's name with the name the volume stores. On a volume that treats two spellings as one name, such as the default volume on macOS or Windows, branches `Feature` and `feature` are two lines and one directory. A line that finds its directory only through another spelling is absent: `load` answers `{ kind: 'absent' }`, and so does `blob` for an entry path, so `readLine` answers `absent` too. `store` refuses the line with a detail that names it, the segment as the line spells it, and the spelling the volume stores, so `publishLine` answers `refused` instead of replacing the other line's entries. `store` checks after it makes the directory, so when two writers publish both spellings at once, in one process or in two, one is written and the other is refused. On a case-sensitive volume the two branches are still two lines. An image path is read under any spelling, because every line shares the images. The check costs one `readdir` for each segment of the name, on each read that finds a manifest or an entry and on each write.
- 6b3642c: `share.token` is read from its environment variable when a share command reads it, not when the config loads. A job without that variable still loads the config and runs, and `variance share`, `variance ask` and `variance serve` report the share as unconfigured, naming the field and the variable. When no mainline is known and a run's branch was written to its own line for that reason, `variance share --publish` says so and names the answers that were missing; a pull request's line is its head branch either way, and it says nothing of the mainline. When it writes the report, it also says how many images the report names that this machine could not read, and names the first. `createDirectoryLineCell` answers an entry or image path that resolves outside its root as `refused`, from `store` and from `blob`, and the detail names the path.

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

### Patch Changes

- e546e21: `baselines.records` puts the sidecars where git is not looking

  A baseline is an image and a record of how it was painted. The image moves when a
  pixel moves; the record moves whenever the *document* does — a class name, a
  build id, a font that resolved somewhere else — so a record committed beside its
  image puts a tracked diff on every edit that moved nothing. At a few hundred
  subjects the baseline directory is the noisiest path in the repository, and a
  directory nobody reads is a directory that catches nothing.

  `"records": ".variance/records"` on a `directory` or `lfs` baselines section sets
  the store's `recordRoot`, and the rule it buys is worth stating plainly: if a
  change did not update an image, it updates no file under version control.

  Unlike `cacheRoot` beside it, this is not inferred. A lost cache entry costs a
  render; a lost record costs the run its `missingFonts` and its `findingMarks`,
  which are evidence a verdict is allowed to turn on — so where they go is your
  decision and the config is where you make it.

  It moves the record's directory and nothing else. Both halves are still written
  and both are still read, so half a pair still stops the run and still names the
  file it looked for, in whichever root it looked in. A repository that leaves
  `baselines.records` unset keeps `*.json merge=binary` as the stopgap it was.
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

### Patch Changes

- 5c3299b: Ask `git log` about the baseline root the caller named. A relative `root` was
  passed to git as a pathspec and read back against the directory git ran in —
  which defaults to that same root — so `readChangelog({ root: '.variance/baselines' })`
  filtered on `.variance/baselines/.variance/baselines` and returned no commits.
  An empty list is this reader's word for *no baseline has ever been explained*.
