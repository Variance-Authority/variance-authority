<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/tribunal

**Requires:** a database this deployment owns, an object store beside it, a
runtime that serves `fetch`, and two bearer tokens of at least 16 characters that
are not the same value. Nothing else — no account here, no hosted anything, no
outbound call.

The venue where evidence is held and a verdict is reviewed and settled. Argos or
Chromatic, on your own premises, holding nothing more than the run put in it.

**Written against Cloudflare** — D1, R2 and a Worker — which is where the wiring
below points and the only host it has been tried on. Nothing in the package is
Cloudflare-specific: the bindings are the narrow structural subset actually used,
the router speaks Web-standard `Request` and `Response`, and every test runs the
real SQL through `node:sqlite`. The name says what it is rather than where it
runs, for the reasons in
[ADR-0023](../../docs/context/adr/0023-a-service-is-named-for-what-it-is.md).

The rest of this repository answers *what changed, why, where, and should anyone
care?* and then the process ends. This is where those answers go so that a person
can look at one and a decision about it survives — the half
[ADR-0019](../../docs/context/adr/0019-one-comment-that-leads-with-causes.md) explicitly left out of scope
("a review UI", "approval workflows beyond `accept`") because there was nowhere
for a review to live.

**Status:** built, never deployed — see [ADR-0021](../../docs/context/adr/0021-approval-promotes-an-image-that-already-exists.md).
The SQL, the routes, the promotion path and the refusals are tested against real
SQL and an in-memory bucket; the platform is not. Read
[the limits](#what-has-not-been-measured) before believing any of the rest.

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
| `@variance-authority/tribunal` | nothing | the binding types, `SCHEMA`, `applySchema` |
| `@variance-authority/tribunal/store` | D1 and R2 | `createBucketStore` — baselines |
| `@variance-authority/tribunal/history` | D1 | `createD1Backend` — the drift record |
| `@variance-authority/tribunal/review` | D1 and R2 | `createReviewStore` — builds, decisions, retention |
| `@variance-authority/tribunal/worker` | D1, R2, two tokens | `createTribunal` — one `fetch` handler |
| `@variance-authority/tribunal/worker-entry` | the bindings, as an `env` | the deployable module: `export default { fetch }`, and `wrangler.jsonc` beside it |
| `@variance-authority/tribunal/ui` | React | the review surface, its JSON client, its stylesheet |
| `@variance-authority/tribunal/next` | an App Router app | `createTribunalRoutes` — the vinext wiring |
| `@variance-authority/tribunal/testing` | Node 22 | D1 over `node:sqlite`, an in-memory bucket |

**The table is for reading, not for slimming an install.** Everywhere else in
this repository a package is cut by its requirements because a *tool* that
drags a browser or a socket in behind your back has decided something for you.
This is not a tool. It is one service, deployed once, and a service is entitled to
whatever it needs to serve — so React is an ordinary production dependency even
though only `/ui` and `/next` touch it. The rows above say which entrypoint needs
what because that is worth knowing when you read the code or split the deployment
across two Workers, not because the package is trying to keep an install small.

## Wiring it up

```ts
// worker.ts — yours, not ours
import type { D1Like, R2Like } from '@variance-authority/tribunal';
import { createTribunal } from '@variance-authority/tribunal/worker';

interface Env {
  readonly DB: D1Like;
  readonly BUCKET: R2Like;
  readonly VARIANCE_INGEST_TOKEN: string;
  readonly VARIANCE_REVIEW_TOKEN: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createTribunal({
      db: env.DB,
      bucket: env.BUCKET,
      project: 'todomvc',
      ingestToken: env.VARIANCE_INGEST_TOKEN,
      reviewToken: env.VARIANCE_REVIEW_TOKEN,
    }).fetch(request);
  },
};
```

`createTribunal` takes:

| option | default | what it decides |
|---|---|---|
| `db` | required | the D1 binding |
| `bucket` | required | the R2 binding |
| `project` | required | scopes every row and every object key, so one deployment serves several repositories without their `story:card` colliding. There is no default: an invented one puts two projects' baselines in one namespace and the first symptom is a mass `changed` |
| `ingestToken` | required | written into CI. Writes builds, baselines and history. 16 characters or more |
| `reviewToken` | required | held by people. Reads the review surface and decides. 16 characters or more, and not the same string as `ingestToken` |
| `retentionDays` | `30` | days of builds `POST /review/sweep` keeps. Applied on request rather than on a timer, because a Worker has no timer and this package will not invent a cron the operator did not ask for — wire it to a scheduled trigger, call it from a CI job, or never |
| `now` | the wall clock | injected so a test can pin every `at`. `createBucketStore` and the review surface take it for the same reason |

`env.DB` and `env.BUCKET` are Cloudflare's own `D1Database` and `R2Bucket` and
are accepted as-is: this package declares the narrow subset it uses and a wider
type is assignable to a narrower one. It does **not** depend on
`@cloudflare/workers-types`, which is why the store is testable in a plain
`vitest` process.

Apply the schema yourself, once — `applySchema(db)`, or the statements in
`SCHEMA` through whatever you use for migrations. Nothing here migrates on a
request: a handler that migrates on first use migrates concurrently under load,
and D1 has no advisory lock to serialize that with.

A database that is **already deployed** is not upgraded by that call. `SCHEMA` is
the whole shape and applying it a second time fails on the first `CREATE TABLE`,
which is the intended behaviour; what an existing database needs is the part it
is missing. That is `MIGRATIONS` — one entry per version after the shape this
package first shipped, each ending by writing the version it lands on, so a
database is never left at a version whose tables it does not have. Applying the
initial set and then every step in order arrives at exactly the same place.

### Or deploy the one that ships

The module above is the shape to copy when you want your own. If you do not,
`worker-entry` **is** that module, and `wrangler.jsonc` beside it declares the
Worker, the D1 database and the R2 bucket:

```bash
wrangler d1 create variance-tribunal
```

Put the id it prints into `wrangler.jsonc`, then:

```bash
wrangler r2 bucket create variance-tribunal
```

```bash
wrangler d1 migrations apply variance-tribunal --remote
```

```bash
wrangler secret put INGEST_TOKEN
```

```bash
wrangler secret put REVIEW_TOKEN
```

```bash
wrangler deploy
```

Every line above is read from the platform's documentation rather than reported
from a deployment, and the first person to run it should expect to correct this
section. It is checked in because the distance between this repository and a
running review surface should be a command with a known failure mode rather than
an unknown amount of work.

`worker-entry` is the only file in the package that reads an environment, and it
reads four names plus two optional ones:

| name | kind | what it decides |
|---|---|---|
| `DB` | binding | D1. The schema is in `migrations/` |
| `BUCKET` | binding | R2. Baseline and candidate bytes; never a row |
| `INGEST_TOKEN` | secret | written into CI. Writes builds, baselines and history. 16 characters or more |
| `REVIEW_TOKEN` | secret | held by people. Reads the review surface and decides. 16 characters or more |
| `PROJECT` | var, default `default` | scopes every row and object |
| `RETENTION_DAYS` | var, default `30` | days of builds `POST /review/sweep` keeps. A value that is not a positive finite number falls back rather than sweeping everything |

A bad environment answers **500 with a sentence**, not a deployment-wide platform
error: construction happens inside `fetch`, so *your token is too short* and *your
two tokens are the same* reach the operator as the response body.

`PROJECT` being a deployment setting is exactly what
[spec 0014](../../docs/specs/0014-hosted-who-the-caller-is-and-what-the-bill-counts.md)
says has to change before a second tenant exists — the credential should
establish the project and no route should accept one. Harmless while a deployment
serves one project, and the whole of the problem at two.

Two properties worth knowing before you run it. The migrations in `migrations/`
are **generated** from `SCHEMA` by `tools/tribunal-migrations.mjs` and asserted
against it by `migrations.test.ts` — editing a `.sql` by hand deploys a table no
test in this repository knows about, so change `schema.ts` and rebuild. And the
secrets are secrets: `wrangler.jsonc` carries the project name and nothing
else, because a token in a checked-in config is a token in everybody's clone.

### The review surface

```tsx
// app/variance/page.tsx
import { ReviewApp, REVIEW_STYLES, createReviewClient } from '@variance-authority/tribunal/ui';

declare function whoIsThis(): Promise<string>;

const client = createReviewClient({ endpoint: '/variance' });

export default async function VariancePage(): Promise<React.ReactElement> {
  return (
    <>
      <style>{REVIEW_STYLES}</style>
      <ReviewApp client={client} reviewer={await whoIsThis()} />
    </>
  );
}
```

```ts
// app/variance/[[...path]]/route.ts — the vinext half
import type { D1Like, R2Like } from '@variance-authority/tribunal';
import { createTribunalRoutes } from '@variance-authority/tribunal/next';
import { createTribunal } from '@variance-authority/tribunal/worker';

declare const env: {
  readonly DB: D1Like;
  readonly BUCKET: R2Like;
  readonly VARIANCE_INGEST_TOKEN: string;
  readonly VARIANCE_REVIEW_TOKEN: string;
};
declare function isSignedIn(request: Request): Promise<boolean>;

const worker = createTribunal({
  db: env.DB,
  bucket: env.BUCKET,
  project: 'todomvc',
  ingestToken: env.VARIANCE_INGEST_TOKEN,
  reviewToken: env.VARIANCE_REVIEW_TOKEN,
});

export const { GET, POST, HEAD } = createTribunalRoutes(worker, {
  basePath: '/variance',
  authorize: async (request: Request) => ((await isSignedIn(request)) ? 'review' : null),
  tokens: { ingest: env.VARIANCE_INGEST_TOKEN, review: env.VARIANCE_REVIEW_TOKEN },
});
```

`createReviewClient` takes `endpoint` — where the Worker is mounted, relative
behind this adapter because the page and the API are one deployment — and an
optional `token` for a caller holding the review token directly. Omit `token`
behind the adapter: there the server route holds it and the browser never sees
it, which is the entire reason the adapter exists. A review token shipped to a
browser is a token in everybody's devtools.

`createTribunalRoutes` takes `basePath`, `authorize` and `tokens`. `basePath` is
stripped before the request reaches the Worker, which knows only its own paths —
without it every request arrives as `/variance/review/builds` and 404s against a
route table that has never heard of the prefix. `tokens` is passed again rather
than read off the worker, because a `Tribunal` is deliberately a `fetch` handler
and nothing else: a handler that could be asked for its own secrets is a handler
that can leak them by being logged.

`authorize` has **no default**, and that is the one decision this package refuses
to make for you. The review token promotes baselines, so it stays on the server
and the route handler attaches it — which makes the handler, not the token, the
gate. Defaulting it to `'review'` would publish an approve button to the
internet; an operator who genuinely wants that writes `() => 'review'` in their
own file, where the next person reading the repository can see it.

### `GET /review/changelog`: why the baselines are what they are

A build says what changed today. This says what was *approved*, grouped by what
changed rather than by which screenshot changed — the same unit the docket uses,
because a token edit across forty stories is one decision and forty entries would
reproduce exactly the review problem clustering exists to solve.

```ts
import { createReviewStore } from '@variance-authority/tribunal/review';
import { createMemoryR2, createSqliteD1 } from '@variance-authority/tribunal/testing';

const review = createReviewStore({
  db: await createSqliteD1(),
  bucket: createMemoryR2(),
  project: 'todomvc',
});

const { changes, ungrouped } = await review.changelog({ component: 'Card', limit: 50 });

changes[0]?.subjects;  // approved subjects this shape landed in, newest first
changes[0]?.by;        // everyone who approved part of it
changes[0]?.builds;    // where the approvals came from
```

`changelog` takes `component` (substring, case-insensitive), `subject` (exact),
`since` (ISO 8601) and `limit` (default 500). The route takes the same four as
query parameters.

**One row is written per approval, and its columns are copies rather than a
join.** Everything in them is already in `builds` and `build_subjects` at the
moment of approval, and a view over those two would be shorter — and empty after
`sweep`. Builds expire; the explanation of a baseline has to last exactly as long
as the baseline, which is forever. So the regions, the commit, the intent and the
reviewer are frozen at the moment of approval, the same way
[the git-LFS half](../store) freezes them into a commit message.

Nothing is written for a **rejection**. It is a decision and it is recorded in
`decisions`, but no baseline changed, and a changelog carrying rejections would
answer *why does this baseline look like this* with entries about baselines that
are not there.

The shapes are grouped **when somebody reads**, not when a row is written.
Approval here is per subject — a reviewer clicks through a docket rather than
running one command over a report — so there is no batch at write time to
cluster, and grouping late means a shape approved across three sessions still
reads as one change. Approved subjects that no shape could group are returned as
`ungrouped` rather than dropped, so the total stays a total.

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
compares against; **decisions**, which carry a permanence trigger — a promoted
baseline whose approval was deleted is a change nobody can attribute to anyone;
and the **changelog**, for the same reason one rung further out.

It runs on request and never on a timer. A Worker has no timer, and this package
will not invent a cron the operator did not ask for; wire it to a scheduled
trigger or call it from CI.

## Testing your own wiring

```ts
import { createReviewStore } from '@variance-authority/tribunal/review';
import { createMemoryR2, createSqliteD1 } from '@variance-authority/tribunal/testing';

const review = createReviewStore({
  db: await createSqliteD1(),
  bucket: createMemoryR2(),
  project: 'todomvc',
});
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

**This has never run on Cloudflare.** Specifically unmeasured: whether
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

- [ADR-0021](../../docs/context/adr/0021-approval-promotes-an-image-that-already-exists.md) — why approving may not render
- [ADR-0022](../../docs/context/adr/0022-deciding-is-not-writing.md) — why there are two tokens
- [ADR-0023](../../docs/context/adr/0023-a-service-is-named-for-what-it-is.md) — why a service may depend on what it needs
- [ADR-0016](../../docs/context/adr/0016-where-a-baseline-is-kept-decides-nothing.md) — why a store failure is not a verdict
- [spec 0002](../../docs/specs/0002-history-store.md) — what a history row is allowed to contain
- [ADR-0011](../../docs/context/adr/0011-durable-and-ephemeral-retention.md) — why the identity partition is the primary key
