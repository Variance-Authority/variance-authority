# @variance-authority/tribunal

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

### Patch Changes

- Updated dependencies
  - @variance-authority/core@0.5.4

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
