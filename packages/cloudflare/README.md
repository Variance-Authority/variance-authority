# @variance-authority/cloudflare

**Requires:** a Cloudflare account you control, with a D1 database and an R2
bucket bound to a Worker you deploy. Two bearer tokens of at least 16 characters
each, and they may not be the same value. Nothing else — no account here, no
hosted anything, no outbound call.

Argos or Chromatic, with the backend on your own premises, holding nothing more
than the run put in it.

The rest of this repository answers *what changed, why, where, and should anyone
care?* and then the process ends. This is where those answers go so that a person
can look at one and a decision about it survives — the half
[spec 0005](../../docs/specs/0005-ci-integration.md) explicitly put out of scope
("a review UI", "approval workflows beyond `accept`") because there was nowhere
for a review to live.

**Status:** `built, never run` — see [spec 0010](../../docs/specs/0010-cloudflare-review-backend.md).
93 tests pass against the real SQL and an in-memory bucket. **Nothing here has
ever run on Cloudflare.** Read [the limits](#what-has-not-been-measured) before
believing any of the rest.

## Two of the three surfaces are protocols that already existed

| surface | contract | defined by |
|---|---|---|
| baselines | `RasterStore` behind `/baseline/*` and `/cache/*` | [`raster`](../raster), [`remote`](../remote) |
| history | `HistoryBackend` behind `/v1/*` | [`history`](../history), [`server`](../server) |
| review | builds, subjects, decisions | here |

So `variance run` reaches this deployment with **no change to the CLI** —
`baselines.kind: "remote"` and a URL — and a client built from
`@variance-authority/history/client` reaches it with no change to the client.
What is new is only the third row.

That the first row means the same thing here as on a disk is tested rather than
claimed: this store is one of the four implementations in
[`observe/parity.test.ts`](../observe/src/parity.test.ts), which runs the same
scenarios through every backend and **pins each expected verdict**, because four
stores agreeing on a wrong answer is not a pass.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `@variance-authority/cloudflare` | nothing | the binding types, `SCHEMA`, `applySchema` |
| `@variance-authority/cloudflare/store` | D1 and R2 | `createCloudflareStore` — baselines |
| `@variance-authority/cloudflare/history` | D1 | `createD1Backend` — the drift record |
| `@variance-authority/cloudflare/review` | D1 and R2 | `createReviewStore` — builds, decisions, retention |
| `@variance-authority/cloudflare/worker` | D1, R2, two tokens | `createVarianceWorker` — one `fetch` handler |
| `@variance-authority/cloudflare/ui` | React | the review surface, its JSON client, its stylesheet |
| `@variance-authority/cloudflare/next` | an App Router app | `createVarianceRoutes` — the vinext wiring |
| `@variance-authority/cloudflare/testing` | Node 22 | D1 over `node:sqlite`, an in-memory bucket |

**The table is for reading, not for slimming an install.** Everywhere else in
this repository a package is named for its requirements because a *tool* that
drags a browser or a socket in behind your back has decided something for you.
This is not a tool. It is one service, deployed once, and a service is entitled to
whatever it needs to serve — so React is an ordinary production dependency even
though only `/ui` and `/next` touch it. The rows above say which entrypoint needs
what because that is worth knowing when you read the code or split the deployment
across two Workers, not because the package is trying to keep an install small.

## Wiring it up

```ts
// worker.ts — yours, not ours
import { createVarianceWorker } from '@variance-authority/cloudflare/worker';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createVarianceWorker({
      db: env.DB,
      bucket: env.BUCKET,
      project: 'todomvc',
      ingestToken: env.VARIANCE_INGEST_TOKEN,
      reviewToken: env.VARIANCE_REVIEW_TOKEN,
    }).fetch(request);
  },
};
```

`env.DB` and `env.BUCKET` are Cloudflare's own `D1Database` and `R2Bucket` and
are accepted as-is: this package declares the narrow subset it uses and a wider
type is assignable to a narrower one. It does **not** depend on
`@cloudflare/workers-types`, which is why the store is testable in a plain
`vitest` process.

Apply the schema yourself, once — `applySchema(db)`, or the statements in
`SCHEMA` through whatever you use for migrations. Nothing here migrates on a
request: a handler that migrates on first use migrates concurrently under load,
and D1 has no advisory lock to serialize that with.

### The review surface

```tsx
// app/variance/page.tsx
import { ReviewApp, REVIEW_STYLES, createReviewClient } from '@variance-authority/cloudflare/ui';

const client = createReviewClient({ endpoint: '/variance' });
export default () => (
  <>
    <style>{REVIEW_STYLES}</style>
    <ReviewApp client={client} reviewer={await whoIsThis()} />
  </>
);
```

```ts
// app/variance/[[...path]]/route.ts — the vinext half
export const { GET, POST, HEAD } = createVarianceRoutes(worker, {
  basePath: '/variance',
  authorize: async (request) => ((await isSignedIn(request)) ? 'review' : null),
  tokens: { ingest: env.VARIANCE_INGEST_TOKEN, review: env.VARIANCE_REVIEW_TOKEN },
});
```

`authorize` has **no default**, and that is the one decision this package refuses
to make for you. The review token promotes baselines, so it stays on the server
and the route handler attaches it — which makes the handler, not the token, the
gate. Defaulting it to `'review'` would publish an approve button to the
internet; an operator who genuinely wants that writes `() => 'review'` in their
own file, where the next person reading the repository can see it.

## What the review surface leads with, and why it is not two screenshots

Everyone in this category shows a before and an after and asks you to spot the
difference. That is the review blindness this project exists to refuse: the
hundredth screenshot gets the same glance as the first.

So the order is inverted.

1. **The docket.** Components the semantic tier named as *causes*, largest first,
   with the file each is declared in. Collateral is one number for the build.
2. **The regions, drawn on the render**, cause and collateral styled apart, each
   labelled with the component that owns it.
3. **The comparison** — swipe, onion, side-by-side, difference mask — last, and
   only the modes this build actually kept images for.

Ranked by area that report is *backwards*: a container that was never edited and
only reflowed outranks the edit, measured at 6× on one change. The ordering comes
from the tier that has provenance, which is why `cause` is a field on a region
and not a guess made in a component.

## What it refuses

**Approval promotes an image; it never records one.** Deciding *approved* makes
that build's uploaded candidate the baseline, through the same `RasterStore` the
next run reads. A subject whose candidate was never uploaded **cannot be
approved** — the alternative is a review surface that renders in order to say
yes, and a surface that can render can record something nobody looked at. This is
`variance accept`'s rule, and it is why a build stores the candidate's document
digest and dimensions rather than only its pixels.

**A store failure is never a verdict.** Every D1 and R2 failure raises
`RasterStoreError`. `null` is reserved for *the store looked and there is no
baseline*, because `null` becomes `new`, `new` records whatever this build
painted, and the image it overwrites was the only evidence of what the subject
looked like before.

**A row without its object is damage, not absence.** The sidecar lives in D1 and
the image in R2, which is the directory store's `.json`/`.png` pair with the
halves in the services that suit them — and it inherits the pair's failure mode
exactly. `describe` spends an R2 `head` for this reason: answering from the row
alone would let the cheap lookup and the full one disagree about whether a
baseline exists, and a verdict that depends on which question you asked is not a
verdict.

**A coverage list that was never stated is not an empty one.** `undefined` and
`[]` are stored as different values, returned as different values, and drawn as
different sentences. A run that planned 300 subjects, failed on 50 and found 250
unchanged produces a report in which every observation is clean; the only thing
that can refuse "nothing to review" is that list, and a UI printing `0 failed`
for a silent writer would undo it at the last possible moment. The same
distinction holds for findings: `[]` is *inspected and clean*, absent is *nothing
looked*.

**Two tokens, and they may not be equal.** The ingest token lives in CI
configuration and writes builds, baselines and history. The review token belongs
to people and decides. Construction refuses a short token and refuses two
identical ones — a deployment with one secret would satisfy every check in the
router while anything that can read a build log could approve a regression.

**Authentication happens before routing.** A caller holding neither token gets
one sentence, identical for a wrong token, a missing token, and a path that does
not exist. The capability check happens after routing, and only reveals to
someone already holding a valid token which of the two a route wants.

**The Worker makes no outbound request.** Not a status check, not a PR comment,
not a webhook, not telemetry. The pipeline reports to the server; the server
reports to nobody. It also means there is no credential here for anybody else's
system.

**The record is append-only, and the database says so rather than this code.**
Runs, observations, token values and decisions all carry `UPDATE` and `DELETE`
triggers with the message attached — so a person at a `wrangler d1 execute`
prompt hits them too.

## Retention

`POST /review/sweep?days=N` removes builds older than `N` days: their subject
rows, their coverage rows, and every image they kept. It **reports counts** for
everything it removed, because a store that discards quietly is a store whose
"we have never seen this" is a lie.

What it does not remove: **promoted baselines**, which are what the next run
compares against, and **decisions**, which carry a permanence trigger — a
promoted baseline whose approval was deleted is a change nobody can attribute to
anyone.

It runs on request and never on a timer. A Worker has no timer, and this package
will not invent a cron the operator did not ask for; wire it to a scheduled
trigger or call it from CI.

## Testing your own wiring

```ts
import { createSqliteD1, createMemoryR2 } from '@variance-authority/cloudflare/testing';
```

D1 *is* SQLite, so the double runs the real statements through `node:sqlite`: the
schema, the indexes, the triggers, the `ON CONFLICT` clause and every `ORDER BY`
are executed rather than paraphrased. `createMemoryR2().fail(…)` makes the bucket
throw, which is how "a store failure is never a verdict" is a test rather than a
comment.

That is also what an operator wants: their routes, their ingest, their retention
settings, in a plain `vitest` process, with no `wrangler`, no container and no
account.

## What has not been measured

**This has never run on Cloudflare.** The SQL, the routes, the promotion path and
the refusals are verified; the platform is not. Specifically unmeasured: whether
D1's `batch` is transactional in the way the history backend's atomicity rests
on, object-size ceilings, request and subrequest limits, every quota, consistency
between two Workers writing at once, and whether `STRICT` tables and
`INTEGER PRIMARY KEY AUTOINCREMENT` behave in D1 as they do in SQLite.

**Concurrency around run lineage is weaker than the SQLite backend's.** That one
takes a write lock before checking whether a run id is registered; two Workers
cannot. The `WHERE NOT EXISTS` guard and the unique index still refuse a run id
pointing at two commits — the pre-read only exists to make the message name both
commits instead of an index.

**A build's images are as large as the run kept.** Nothing here compresses,
resizes, or deduplicates across builds.

**A build cannot distinguish two images of one subject.** `ObservationRecord`
carries a subject and no label, so labelled baselines are writable through the
store and not reachable through the review path.

## Reading

- [spec 0010](../../docs/specs/0010-cloudflare-review-backend.md) — the contract and the acceptance criteria
- [spec 0004](../../docs/specs/0004-artifact-storage.md) — why a store failure is not a verdict
- [spec 0002](../../docs/specs/0002-history-store.md) — what a history row is allowed to contain
- [ADR-0011](../../docs/context/adr/0011-durable-and-ephemeral-retention.md) — why the identity partition is the primary key
