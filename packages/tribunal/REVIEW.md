# Reviewing `@variance-authority/tribunal`

The self-hosted review service: a D1 or SQLite record of builds, decisions,
history and concerns, an R2 or directory store of images, an HTTP API and a
React review page, on a Worker or Node. `variance push` and an `http` share
call it; it implements `raster`'s `RasterStore` and reads `history`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/tribunal/`.

## Contracts

- **Approval promotes an uploaded image, never records one.** No candidate,
  or bytes that are gone, refuses the approval. Written in the
  [README](README.md#review-invariants) and pinned by
  [`src/review.approve.test.ts`](src/review.approve.test.ts) › "refuses to
  approve a subject the run kept no candidate for" and "refuses to approve
  when the candidate bytes are gone".
- **A moved baseline refuses where the changes meet, and records nothing.**
  A run's put, a cut-short region list or a deleted baseline cannot be told
  apart, so it refuses. Written in the [README](README.md#review-invariants)
  and pinned by [`src/review.moved.test.ts`](src/review.moved.test.ts) › "is
  refused where the two changes overlap, naming the build that moved it",
  "is refused when the change that moved it kept fewer regions than it found"
  and "records nothing when it is refused".
- **A store failure is never a verdict, and a row without its object is
  damage.** Pinned by [`src/store.test.ts`](src/store.test.ts) › "raises an
  operator error when the bucket cannot be read" and "refuses to describe a
  baseline whose image is gone".
- **Absent is stored apart from empty.** Pinned by
  [`src/review.test.ts`](src/review.test.ts) › "round-trips every state,
  keeping unmeasured apart from unchanged" and
  [`src/concerns.test.ts`](src/concerns.test.ts) › "keeps no region and no
  evidence as absent, not as empty".
- **No token reveals a route.** A wrong token, none, and an invented path
  answer alike; two equal tokens or one under 16 characters refuse to start.
  Pinned by [`src/worker.test.ts`](src/worker.test.ts) › "answers a real path
  and an invented one identically without a token" and "refuses to start
  when both tokens are one secret".
- **Each token holds only its role.** The review token never writes what runs
  recorded, the ingest token never reads reviews, the share token never
  decides. Written in the [README](README.md#the-http-api).
- **The service makes no outbound request.** No status, comment, webhook or
  telemetry. Written in the [README](README.md#review-invariants).
- **The record is append-only in the database.** Pinned by
  [`src/changelog.test.ts`](src/changelog.test.ts) › "refuses to rewrite or
  delete an entry, in the database rather than in code".
- **A sweep keeps what a later run or reader needs.** Pinned by
  [`src/objects.test.ts`](src/objects.test.ts) › "keeps the object a promoted
  baseline shares with the build that proposed it".
