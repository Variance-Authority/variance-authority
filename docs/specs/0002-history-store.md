# Spec 0002 — History service and drift queries

**Missing:** a caller.
**Built on:** per-component band hashing
([ADR-0018](../context/adr/0018-a-component-hash-covers-its-own-nodes.md)) and
the bulk read of the present
([ADR-0031](../context/adr/0031-the-run-asks-what-is-recorded-now.md)), which was
the blocker and is decided.
**Packages:** `@variance-authority/history` (interface, drift math, client),
`@variance-authority/server` (the service). Both ship; nothing imports either.

## Purpose

Answer the questions a single run cannot: when an area last changed, how often it
churns, what a token's value has drifted to across approvals, and where a
component now appears that it did not before.

A button gains 2px, eleven times, each approved correctly, and nobody ever sees
the 22px change. No threshold catches it, because the quantity that would is a
sum and a one-run-at-a-time tool keeps none.

## What is recorded

One row per `(subject, component, band)` whose hash moved, plus the resolved
token values for the run.

```ts
export interface Observation {
  readonly project: string;
  readonly subject: string;
  readonly component: string;
  readonly band: 'structure' | 'style' | 'geometry';
  readonly hash: Digest;
  /**
   * Which tier observed it. Required on `style` and `geometry`, which are not
   * portable across profiles; `structure` is, and is compared without it.
   */
  readonly profile: ProfileId;
  readonly commit: string;
  readonly run: string;
  readonly at: string;
  readonly accepted: boolean;
  readonly file?: string;
}

export interface TokenValue {
  readonly project: string;
  readonly token: string;
  readonly value: string;
  readonly commit: string;
  readonly at: string;
}
```

**Never** pixels, images, coordinates, rects, or pixel counts. A pixel count is
machine-bound and measures displacement rather than magnitude: a 1px change to a
spacing token produces thousands of differing pixels because the count is
dominated by how much page sits below the edit.

A row is roughly 100 bytes and is written only when a hash moves. A 300-subject
run in which two components changed writes two rows.

## Where it lives

**A service, part of this project, run by the operator in their own
infrastructure. Never a file in the repository.**

A committed record puts derived state under human merge resolution, and the
hashes of a merge commit are neither branch's — so a file-based record always
describes a state that no longer exists by the time it lands. An append-only file
adds interleaved writes from concurrent jobs.

A store of observations has no merges to resolve. Two branches observing
different hashes for one key are two rows; the query selects the lineage. This is
content-addressing (spec §4, Principle 4) applied to time.

The objection above is about a file **in a repository**, not about storage in
general. A database file owned by a service is never hand-merged and never
reviewed as a diff, so it does not inherit the problem.

### Deployment shape

- The service is a package in this repository. The operator runs it; nothing here
  runs it for them, and no instance is shared between operators.
- `@variance-authority/history` holds the `HistoryStore` interface, the drift
  arithmetic as pure functions, and an HTTP client. It contains no storage.
- `@variance-authority/server` holds the HTTP surface and the storage, behind a
  `HistoryBackend` interface so the engine is replaceable.
- The first backend is SQLite via `node:sqlite`. A self-hosted service that
  requires a native build to install is a service nobody installs; a single file
  and a port is the whole operational burden.
- Authentication is a bearer token the operator sets. The service holds no user
  accounts and no identity of its own.
- Everything the service stores was produced by the operator's own runs. It
  neither reaches out nor accepts writes it cannot attribute to a configured
  token.

## Contract

```ts
export interface HistoryStore {
  record(
    run: RunRecord,
    observations: readonly Observation[],
    tokens: readonly TokenValue[],
  ): Promise<void>;

  current(subjects: readonly string[]): Promise<Answer<readonly Observation[]>>;

  lastChanged(subject: string, component: string, band?: Band): Promise<Answer<Observation | null>>;
  churn(component: string, window: Window): Promise<Answer<Churn>>;
  valueJourney(token: string, window: Window): Promise<Answer<Journey>>;
  reach(component: string, window: Window): Promise<Answer<Reach>>;
}
```

Every operation returns a small slice. Nothing loads a whole history.

### The read a run needs, which this contract now has

`current` is the one read about the **present**, and it is what made a caller
possible: `observationsFrom(hashes, run, previous)` needs the rows currently
recorded for the subject it is about to write, and the other four reads are all
questions about the past. It never truncates, the request is capped instead, and
the reasoning is
[ADR-0031](../context/adr/0031-the-run-asks-what-is-recorded-now.md) — including
why the alternative, deduplicating on the server, was refused.

For a cycle this contract specified a write rule and gave nobody the means to
implement it, which is why there was code on both sides of a wire with nothing
crossing it. That is fixed; what is still missing is the caller itself.

**Two deviations from the first draft of this contract, both deliberate, both
argued in `packages/history/src/store.ts` rather than here.** `record` takes the
run as a required argument instead of inferring it from the rows, because a run in
which nothing changed *has* no rows and is exactly the run that must not be lost —
the draft's `record(observations, tokens)` cannot express a quiet run at all. And
every answer is wrapped in `Answer<T>`, which is `T | Unkept`, because the
alternative to saying *no record is being kept* is returning an empty result, and
an agent handed an empty churn concludes the product is stable. That is the
Behaviour section's first rule, expressed in the type rather than in a promise.

This contract was corrected on 2026-08-03 after it was found to describe neither
the draft's intent nor the shipped interface; the code had been right since it was
written.

## Behaviour

**The store is optional and its absence is reported.** With no store configured,
every single-run answer still works and every history answer states that no
record is being kept. It MUST NOT return an empty result — an agent told "no
drift" concludes the product is stable, when the truth is that the question was
never asked.

**Drift sums only accepted changes.** A rejected change was caught; counting it
would describe the review process rather than the product.

**Collateral never accumulates.** Only a component named as a *cause* contributes
to its own totals. Accumulating displacement reports the widest container in the
application as the thing that keeps changing, in every run, forever.

**Quiet runs are recorded.** A run in which nothing changed still records that it
happened, or every rate computed later is inflated — "changed in 4 of 4 runs" for
a component that changed in 4 of 40.

**Bands are compared only where they are comparable.** `structure` is portable
across profiles and is compared without regard to which tier produced it.
`style` and `geometry` are not, and a query that crossed profiles on either would
report a change caused by the tier that ran rather than by an edit (measured:
style agrees across profiles on 0 of 107 component boundaries).

## Acceptance

1. A series of small approved changes to one token produces an exact journey
   (`12px → 20px`) with a commit per step.
2. A component that is collateral in every run of a series accumulates nothing.
3. Churn over a window with quiet runs recorded reports the true rate; the same
   history with quiet runs omitted reports a higher one, and the test asserts
   both to keep the reason visible.
4. With no store configured, a drift query returns the sentence that nobody is
   keeping a record, and every non-history query is unaffected.
5. Two branches recording different hashes for one key both persist, and neither
   query nor write requires a merge.

## Known limits

- One service process owns one SQLite file. Concurrent CI jobs serialize their
  writes through it, which is correct and is not unbounded. The `HistoryBackend`
  interface exists so a different engine can replace it without the client, the
  drift arithmetic, or the recorded shape changing.
- `node:sqlite` is marked experimental on Node 22. It is reached through exactly
  one adapter for that reason.

## Out of scope

- Operating the service for anyone. It ships as something to run, not as
  something running.
- Approvals as a workflow. This records whether a change was accepted; deciding
  that belongs to the pull-request surface
  ([ADR-0019](../context/adr/0019-one-comment-that-leads-with-causes.md)).
