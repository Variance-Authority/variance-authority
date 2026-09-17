# @variance-authority/cli

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
- 0718464: Fold shard snapshots into the one a checkout reads.

  A suite split across CI jobs recorded one execution snapshot per job, and
  nothing shipped could make them one: `mergeCoverage` was reachable only through
  the Vitest seam, layers rather than folds, and no writer was public at all. The
  README said a job combines shards with it, and no job could.

  `@variance-authority/sense/test-selection` now exports `foldTestCoverage`, the
  order-independent union of shards that refuses by name when two were not one
  run, `writeTestCoverage`, the whole-or-nothing writer every seam lands through,
  and `mergeCoverage` itself. `variance journeys` takes shard snapshots as
  positionals, folds them, layers the result over what this checkout already
  holds — or writes it where `--into` says — and reads the suite it just made.
- ff718d3: Distil one test to the behavior it witnesses.

  `@variance-authority/distill` combines an Eyes attention journal and a Sense
  execution index by exact test identity. It keeps authored Arrange, Act and
  Assert attention, React update initiators, and whole-test source entry separate,
  then names entered files without addressed source attribution as opportunities
  for a counterfactual check rather than safe mocks.

  `variance distill` reads the portable files from a shell and can emit text or
  JSON. A combined MCP connection exposes the same analyzer as
  `variance_distill`; the former `variance_testing_surface` name is replaced.
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

### Patch Changes

- e546e21: A collector's complaints travel into the observation

  A finding produced at collection reached the CLI's record and nobody else. A
  suite driving this from its own runner asks the observation what is wrong with a
  subject, and the one diagnostic that explained the moved pixels — the host, not
  the stylesheet, chose the typeface — was produced, carried, and dropped one call
  short of the person reading the failure.

  `mergeDiagnostics` dedupes on every field, so the CLI, which now meets the same
  list twice, says a shared complaint once.
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
- 53e96ad: `variance push` says where it is while it is there

  A push of a real suite spends most of its wall clock before the request exists:
  every image the report named is read off disk and base64-encoded into one body,
  and a few hundred subjects of that is tens of seconds of a command that has
  printed nothing. Silence there is indistinguishable from a hang against an
  address that is not answering, and the two call for opposite responses — wait,
  or interrupt and check the endpoint.

  So the two phases report themselves, on stderr, in the shape the reader is in.
  A terminal gets one line rewritten in place, cleared before the report lands on
  stdout. A log file gets one line per phase and nothing per subject, because a
  build log is read afterwards, where every intermediate count is noise.

  `sending` carries a size and no progress, which is the truth about it: the body
  is one POST, and the number that explains the silence after it is how large that
  body turned out to be.

  `PushOptions` gained an optional `onProgress`, and nothing computes an event for
  a caller that did not ask for one.
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
- 0718464: A changed file no probe can sit in is asked of the module that imports it.

  The record decides what a change reaches. A module nobody executed — every
  test that imports it mocks it, or nothing loaded it — has no row, and the tests
  that import it never ran a line of it: it selects nobody, and so does everything
  only it imports. A stylesheet, an image, a JSON file can hold no probe, so it
  never has a row, and whether a test ran it is a question about the module that
  imported it. `narrowByExecution` and `selectTestFiles` now take `relations` and
  walk from every changed file through `asset` edges — the stylesheets that import
  the stylesheet, the modules that import those, and no further — and select the
  tests that entered each module reached; a module reached without a row is dead.
  A file whose own edges the scan could not read may reach the asset by an edge
  nobody saw, so its tests are selected as well. `knownAs` looks the changed file
  and every module reached up under every name the journal holds them by. `unread`
  names the changed paths nothing recorded holds — no row, no precondition, no
  place in the graph — as a report rather than a widening: a suite that depends on
  a file that way declares it as a precondition.

  A diff is read the way `git` writes it. A pure insertion is placed after the
  line it follows, additions past the count of lines they replace are charged to
  the gap they open after the last one, a file the diff names without a hunk — a
  binary, a rename, a mode change — is charged whole, a quoted path is decoded,
  and the narrowest region on a changed line is measured over regions that have
  source, so the `else` nobody wrote never decides a line alone. A module the
  runner evaluates again after a registry reset keeps what it counted before it,
  a module a runner shares across files without isolation is counted for every
  file that consumed it, and what a module did while evaluating is credited to
  the files that entered it rather than to every file the run ran; a file that
  only reads a module another file evaluated is reached through `relations`. A line that
  opens or closes the narrowest region — the condition of an `if`, the props
  beside a one-line handler — is the enclosing region's line too, and charges it.

  The CLI's `--since` lists files from the merge base of the ref and `HEAD` to
  the working tree, untracked files included, so a branch behind `main` is not
  charged with what others merged and a watch loop is asked about the edit that
  was just saved; the hunks the journal reads are taken from the commit the index
  was recorded at, whose coordinates are the only ones its line ranges are in;
  a module the run did not load, carried from an earlier recording, has its text
  on disk compared with what its rows were recorded over, and every test that
  entered a module that has moved is marked partial rather than left standing on
  lines that are no longer there. A rename's hunks are read under the old name.
  Paths are read unquoted and under `a/` and `b/` whatever the operator's git
  configuration says, and the index is looked for at the repository root as well
  as the run's directory.

  The Jest seam instruments every project of a `projects` configuration and
  leaves a setup entry that names a package out of the preconditions; the Vitest
  seam does the same for its setup entries.

  The runtime's counter factory is installed before the project's own setup
  files — first in Vitest's `setupFiles`, and in Jest's `setupFiles` rather than
  `setupFilesAfterEnv` — so a setup file that loads an instrumented module finds
  it. Jest projects that name `@variance-authority/sense/jest-setup` by hand keep
  working; it installs the factory itself when nothing has.

  Every selection now says why. `because` names, per selected test, the changed
  region it entered, the precondition it is governed by, or the trail of importers
  it was found through. The CLI's `--since` hands its `relations` scan to the
  journal reader when the config asks for one.

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

### Patch Changes

- 355e668: Stop labelling a changed region with the path of the node that contains it.

  A page this project did not write in React carries no component names, and both
  docket renderers fell back to the containing node's path. A pull-request comment
  led with **`0/1`** in code voice, and a failing Playwright assertion printed
  `1510px — 0` three times, the three rows separated only by their pixel counts.
  Where no component and no landmark phrase exist, both now print the region's
  geometry, which at least finds the rect in the diff image. Collateral counts only
  regions that have a component, so a page with none no longer reports "in 1
  component(s)".
- 9dfa2bd: Run when invoked through the symlink a package manager installs.

  `npm install` writes `node_modules/.bin/variance` as a link into the package, so
  `process.argv[1]` is the link while `import.meta.url` is its target. The
  main-module guard compared the two as written, which is true only when the file
  is run by its own path — inside this repository. Installed, `variance run`
  evaluated the module, dispatched nothing, and exited `0`: a gate reporting
  success without opening a browser. Both executables now resolve each side
  through `realpath` before comparing, and `tools/bin-symlink.check.ts` runs every
  declared bin twice, by path and through a link, and requires the two to agree.
