# @variance-authority/tribunal

## 0.1.1

### Patch Changes

  - @variance-authority/history@0.1.1
  - @variance-authority/raster@0.1.1
  - @variance-authority/report@0.1.1
  - @variance-authority/server@0.1.1

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
