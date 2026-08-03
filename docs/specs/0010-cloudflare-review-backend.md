# Spec 0010 — Self-hosted review backend on Cloudflare

**Status:** `built, never run` — see [the status vocabulary](README.md#status-vocabulary)
**Depends on:** [0002](0002-history-store.md), [0003](0003-cli.md), [0004](0004-artifact-storage.md), [0005](0005-ci-integration.md)
**Package:** new — `@variance-authority/cloudflare`

## Purpose

Give a change somewhere a person can look at it, and give a decision about that
change somewhere it survives — **without a hosted control plane**.

[Spec 0005](0005-ci-integration.md) delivers a finding to a pull request comment
and stops there, listing *a review UI* and *approval workflows beyond `accept`*
as out of scope. That boundary was right while there was nowhere for a review to
live: `variance accept` promotes a candidate on the machine that ran, so the
decision exists only where the run happened, and a team gets it by committing
images to a branch.

This spec fills that hole in the one shape the project's standing constraints
allow: an operator's own Cloudflare account, holding a database, a bucket, and a
review surface, with nothing shared between operators and nothing published.

## Contract

One deployable, wired up by the operator, serving three surfaces that already
have contracts elsewhere plus one that does not:

| surface | contract | defined by |
|---|---|---|
| baselines | `RasterStore` over the `/baseline/*` and `/cache/*` routes | [`raster`](../../packages/raster), [`remote`](../../packages/remote) |
| history | `HistoryBackend` behind the `/v1/*` routes | [`history`](../../packages/history), [`server`](../../packages/server) |
| review | builds, subjects, decisions | **this spec** |
| the UI | React, mounted in the operator's own app | **this spec** |

The first two are re-implementations against Cloudflare's primitives, not new
protocols. `variance run` configured with `baselines.kind: "remote"` MUST reach
this deployment with no change to the CLI, and a client built from
`@variance-authority/history/client` MUST reach it with no change to the client.

## What is stored, and where

**D1 holds text. R2 holds bytes.** Nothing else is a store.

- **D1** — baseline sidecars (identity, document digest, dimensions, the R2 key),
  builds, per-subject verdicts and their regions and findings, decisions, and the
  history rows of [0002](0002-history-store.md).
- **R2** — baseline images, candidate images, and diff images. Addressed by
  content or by build, never by a name a caller supplies.

**The identity partition of [ADR-0011](../context/adr/0011-durable-and-ephemeral-retention.md) is the primary key, not a
convention.** A baseline row is keyed by `(project, identity digest, subject,
label)`, so a baseline written by one machine cannot be read by another as
comparable — for the same reason the directory store's layout enforces it, and
with the same absence of a check anyone could forget.

## Behaviour

**A build is a report plus the images that run kept.** The CI job posts one
`RunReport` ([`@variance-authority/report`](../../packages/report)) and the
candidate, baseline-at-the-time, and diff images for the subjects that need
review. What arrives is exactly what `variance run` already produced; there is no
second format to author.

**`notObserved` survives ingest.** A build that planned 300 subjects, failed on
50 and found 250 unchanged MUST NOT present as clean. The field the report
carries for that reason is stored and shown, and `undefined` — the writer never
said — stays distinguishable from `[]`.

**Approval promotes an image that already exists.** Deciding *approved* on a
subject makes that build's candidate the baseline under the identity the build
declared. It renders nothing, exactly as `variance accept` renders nothing: a
review surface that can produce an image is a surface that can record something
nobody looked at.

**A decision is one row per (build, subject), and the latest one wins.** Not an
edit. A reviewer who approves and then changes their mind leaves two rows, and
the record of the first decision is what makes the second reviewable.

**Only the ingest token may write a build; only the review token may decide.**
Two secrets, because the first lives in CI configuration and the second promotes
baselines. One secret doing both means anything that can read a CI log can
approve a regression.

**Authentication happens before routing**, as it does in
[`server/http.ts`](../../packages/server/src/http.ts): an unauthenticated caller
gets one sentence whatever it asked for, including for paths that do not exist.

**The Worker makes no outbound request. Ever.** Not a status check, not a PR
comment, not a webhook. The pipeline reports to the server; the server reports to
nobody. This is the project's standing no-phone-home constraint, and it is also
what keeps the deployment free of a credential for someone else's system.

**Retention is configured, applied, and reported.** Candidate and diff images
expire; the current baseline for a live identity does not. A superseded baseline
is kept for a stated window and then removed. Whatever a sweep removed is
counted, because a store that quietly discards is a store whose *"we have never
seen this"* is a lie — and `new` re-records.

**A store failure is never a verdict.** Every failure of D1 or R2 — a missing
binding, a bucket that 500s, a row whose sidecar does not parse, an object absent
where a row says one is — raises `RasterStoreError`, and none of them produces
`null`. `null` is reserved for *there is no baseline for this key*.

## Deployment shape

A library, not an application. The operator writes the Worker entry, the
`wrangler.toml`, and the bindings; this package exports the handler, the schema,
and the React surface. Nothing here creates an account, provisions a resource, or
knows a project's name until it is handed one.

The review UI is exported as ordinary React with a JSON client, and separately as
Next.js App Router handlers, so an operator running [vinext](https://vinext.io)
mounts it as one route in an app they already deploy.

## Acceptance

1. `variance run` with `baselines.kind: "remote"` pointed at the deployment
   reaches the same verdict as the directory store on the same inputs —
   `unchanged`, `changed`, `new`, `incomparable` — including the cheap `describe`
   path that decides whether an image is fetched at all. Verified by
   [`observe/parity.test.ts`](../../packages/observe/src/parity.test.ts), which
   pins each expected verdict rather than only comparing implementations.
2. A baseline written under one renderer identity is not found as comparable
   under another, and the answer names the machine that wrote it.
3. Every D1 or R2 failure surfaces as an operator error, and no code path returns
   `null` for one.
4. A build ingested from a `RunReport` reproduces that report's verdicts,
   regions, findings and `notObserved` entries, with `undefined` and `[]`
   distinguishable in what the API returns.
5. Approving a subject changes what the next run's `find` and `describe` answer,
   and writes no image that did not already exist.
6. The ingest token cannot decide, and the review token cannot ingest. An
   unauthenticated request to a route that does not exist is indistinguishable
   from one to a route that does.
7. The history routes answer `churn`, `value-journey`, `reach` and `last-changed`
   identically to the SQLite backend for the same rows.
8. A retention sweep removes candidates past their window, keeps the current
   baseline of a live identity, and reports counts for everything it removed.

## Out of scope

- Provisioning: no account creation, no `wrangler` invocation, no migrations run
  on the operator's behalf.
- Any outbound call, including posting to a pull request.
- Accounts, roles, or per-user identity. Two tokens, and neither is a person.
- Cross-browser grids, sharding, or scheduling runs. This backend stores and
  shows; it does not run anything.
- Garbage collection of superseded baselines beyond the stated window (as
  [0004](0004-artifact-storage.md) already excludes).

## Known limits

**Nothing here has run against Cloudflare.** D1 is SQLite and the tests execute
the real SQL through `node:sqlite`, and R2 is exercised through an in-memory
double — so the queries, the schema, the triggers and the routes are verified,
and the platform is not. Batch atomicity, object-size ceilings, request limits,
consistency under concurrent Workers, and every quota are unmeasured claims until
a deployment exists.

**A build's images are as large as the run kept.** This spec stores what the run
produced and does not compress, deduplicate across builds, or resize.
