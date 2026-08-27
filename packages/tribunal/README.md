<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/tribunal

> A self-hosted review service for Variance Authority baselines, history and per-subject decisions.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

Use this package when you are deploying a self-hosted review service for
baselines, history, and per-subject decisions. It supplies the Worker handler,
storage adapters, review API, and optional React UI; it does not provide a hosted
endpoint or an integration that posts runs for you.

**Requires:** a database and object store owned by the deployment, a runtime that
serves `fetch`, and two different bearer tokens of at least 16 characters.

**The supplied deployment targets Cloudflare** — D1, R2, and a Worker. The
bindings are the narrow structural subset used by the package, and the router
speaks Web-standard `Request` and `Response`. Those interfaces allow an adapter
for another fetch runtime, but the package makes no portability promise; the
operator owns that deployment's platform limits. The name says what it is rather
than where it runs.

Producing runs and reports is the job of `@variance-authority/cli`. This package
stores the evidence they send and gives a reviewer a place to inspect and settle
it; it does not render subjects or decide what a run should contain.

```bash
npm install @variance-authority/tribunal
```
## The service surfaces

| surface | contract | defined by |
|---|---|---|
| baselines | `RasterStore` behind `/baseline/*` and `/cache/*` | `raster`, `remote` |
| history | `HistoryBackend` behind `/v1/*` | `history`, `server` |
| review | builds, subjects, decisions | here |

`variance run` reaches this deployment with **no change to the CLI** —
`baselines.kind: "remote"` and a URL — and a client built from
`@variance-authority/history/client` reaches it with no change to the client.

A **subject** is one rendered unit under test — a story, route, or fixture —
identified by a string id (for example `story:card`). `@variance-authority/cli`
decides each subject's verdict (`unchanged`, `changed`, `new`, among others)
upstream; this service stores the evidence and the decision made about it.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `@variance-authority/tribunal` | nothing | the binding types, `SCHEMA`, `applySchema`, `MIGRATIONS` |
| `@variance-authority/tribunal/store` | D1 and R2 | `createBucketStore` — baselines |
| `@variance-authority/tribunal/history` | D1 | `createD1Backend` — the drift record |
| `@variance-authority/tribunal/review` | D1 and R2 | `createReviewStore` — builds, decisions, retention |
| `@variance-authority/tribunal/worker` | D1, R2, two tokens | `createTribunal` — one `fetch` handler |
| `@variance-authority/tribunal/worker-entry` | the bindings, as an `env` | the deployable module: `export default { fetch }`, and `wrangler.jsonc` beside it |
| `@variance-authority/tribunal/ui` | React | the review surface, its JSON client, its stylesheet |
| `@variance-authority/tribunal/next` | an App Router app | `createTribunalRoutes` — route handlers for a Next.js App Router |
| `@variance-authority/tribunal/testing` | Node 22 | D1 over `node:sqlite`, an in-memory bucket |

**The table is for reading, not for slimming an install.** This is one service,
deployed once, so React is an ordinary production dependency even though only
`/ui` and `/next` touch it. The rows above say which entrypoint needs what,
which is worth knowing when you read the code or split the deployment
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
| `now` | the wall clock | supplies every recorded `at`; override it when the deployment has its own clock source |

`env.DB` and `env.BUCKET` are Cloudflare's own `D1Database` and `R2Bucket`,
accepted as-is via structural typing: this package declares only the subset it
uses, and does **not** depend on `@cloudflare/workers-types` — which is why the
store is testable in a plain `vitest` process.

Apply the schema yourself, once — `applySchema(db)`, or the statements in
`SCHEMA` through whatever you use for migrations. Nothing here migrates on a
request, since D1 has no advisory lock to serialize a migration running under
concurrent load.

An **already-deployed** database is not upgraded by that call: `SCHEMA` is the
whole shape, and applying it a second time fails on the first `CREATE TABLE`.
Apply `MIGRATIONS` instead — one entry per version after the package's initial
shape, each writing the version it lands on. Step `i` lands on
`INITIAL_VERSION + i + 1`, so a database reporting `schema_version` `n` needs
every step from `n - INITIAL_VERSION` on.

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

`worker-entry` is the only file in the package that reads an environment, and it
reads four names plus two optional ones:

| name | kind | what it decides |
|---|---|---|
| `DB` | binding | D1. The schema is in `migrations/`. A name that does not match what `d1_databases` declares is refused by name |
| `BUCKET` | binding | R2. Baseline and candidate bytes; never a row. Declared for production and not for a preview environment is refused by name |
| `INGEST_TOKEN` | secret | written into CI. Writes builds, baselines and history. 16 characters or more |
| `REVIEW_TOKEN` | secret | held by people. Reads the review surface and decides. 16 characters or more |
| `PROJECT` | var, default `default` | scopes every row and object |
| `RETENTION_DAYS` | var, default `30` | days of builds `POST /review/sweep` keeps. A value that is not a positive finite number falls back rather than sweeping everything |

A bad environment answers **500 with a sentence**, not a deployment-wide platform
error: construction happens inside `fetch`, so *your token is too short* and *your
two tokens are the same* reach the operator as the response body.

`PROJECT` is a deployment setting, so one deployment serves one project; a
second tenant needs a second deployment.

The migrations in `migrations/` are **generated** from `SCHEMA` by
`tools/tribunal-migrations.mjs` — change `schema.ts` and rebuild rather than
editing a generated `.sql` file. `wrangler.jsonc` carries the project name and
no credentials; keep both tokens in Wrangler secrets.

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
// app/variance/[[...path]]/route.ts
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

`createReviewClient` takes `endpoint` — where the Worker is mounted — and an
optional `token` for a caller holding the review token directly. Omit `token`
behind the Next.js adapter above: the server route holds it and the browser
never sees it.

`createTribunalRoutes` takes `basePath`, `authorize` and `tokens`. `basePath` is
stripped before the request reaches the Worker. `tokens` is passed explicitly
because the `Tribunal` object only exposes `fetch`, not the tokens it was
created with.

`authorize` has **no default**. It returns `'ingest'`, `'review'`, or `null`; a
refused caller gets a 401 before the Worker sees the request, and a caller
returned `'review'` has the review token attached on their behalf.

### `GET /review/changelog`

A build says what changed today; this endpoint says what was *approved*,
grouped by shape rather than by which screenshot changed — the same grouping
the docket (the reviewer's ranked list of causes, described below) uses, so a
token edit across forty stories is one entry, not forty.

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
join.** The regions, the commit, the intent and the reviewer are frozen at the
moment of approval rather than read live from `builds` and `build_subjects`,
because a `sweep` (see Retention below) removes builds, and a baseline's
explanation has to outlive them.

**Nothing is written for a rejection.** It is recorded in `decisions`, but no
baseline changed.

**Shapes are grouped when somebody reads**, not when a row is written — approval
here is per subject, so there is no batch at write time to cluster, and a shape
approved across several sessions still reads as one change. Approved subjects
that no shape could group are returned as `ungrouped` rather than dropped.

## Review surface

When `ReviewApp` (`@variance-authority/tribunal/ui`) is open on a build, a
reviewer sees, in this order:

1. **The docket** — one entry per component the semantic tier (the analysis step
   that attributes a changed region to a component, rather than just measuring
   pixels) named as a *cause*, largest first, with the file each is declared in.
   Collateral is one number for the build rather than a per-region list.
2. **The regions, drawn on the render**, cause and collateral styled apart, each
   labelled with the component that owns it.
3. **The comparison** — swipe, onion, side-by-side, difference mask — last, and
   only the modes this build actually kept images for.

The docket ranks by cause pixels rather than total area, so a large container
that only reflowed does not outrank the smaller edit that caused it; `cause` is
a field on a region rather than something inferred from a component's size.

## Review invariants

**Approval promotes an image; it never records one.** Deciding *approved* makes
that build's uploaded candidate the baseline, through the same `RasterStore` the
next run reads. A subject whose candidate was never uploaded **cannot be
approved**.

**A store failure is never a verdict.** Every D1 and R2 failure raises
`RasterStoreError` rather than returning a value; `null` is reserved for *the
store looked and there is no baseline*.

**A row without its object is damage, not absence.** The sidecar (metadata)
lives in D1 and the image in R2. `describe` spends an R2 `head` call to confirm
the object still exists rather than answering from the D1 row alone.

**A coverage list that was never stated is not an empty one.** `undefined` and
`[]` are stored, returned, and drawn as different values: absent means nothing
looked, `[]` means inspected and clean. The same distinction holds for findings.

**Two tokens, and they may not be equal.** The ingest token lives in CI
configuration and writes builds, baselines and history; the review token
belongs to people and decides. Construction refuses a token under 16 characters
and refuses two identical tokens.

**Authentication happens before routing.** A caller holding neither token gets
one identical response for a wrong token, a missing token, and a path that does
not exist; which of the two tokens a route wants is only revealed to a caller
who already holds a valid one.

**The Worker makes no outbound request.** Not a status check, not a PR comment,
not a webhook, not telemetry — the pipeline reports to the server, and the
server reports to nobody.

**The record is append-only, and the database enforces it.** Runs,
observations, token values and decisions all carry `UPDATE` and `DELETE`
triggers, so a direct `wrangler d1 execute` against the database is refused
too.

## Retention

`POST /review/sweep?days=N` removes builds older than `N` days: their subject
rows, their coverage rows, and every image they kept. It **reports counts** for
everything it removed — `builds`, `subjects`, `objects`.

What it does not remove: **promoted baselines** (what the next run compares
against), **decisions**, and the **changelog**. The fourth count,
`decisionsKept`, is how many approvals outlived the builds this call removed,
not a fourth removal.

It runs on request only, never on a timer — wire it to a scheduled trigger or
call it from CI.

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

D1 *is* SQLite, so this adapter runs the package's schema, indexes, triggers,
`ON CONFLICT` clauses and ordering through `node:sqlite`.
`createMemoryR2().fail(…)` makes the bucket throw, allowing a host to exercise
its store-failure path.

That is also what an operator wants: their routes, their ingest, their retention
settings, in a plain `vitest` process, with no `wrangler`, no container and no
account.

## Operational boundaries

The Worker relies on the platform's D1 transaction and `batch` semantics,
request and subrequest limits, object-size ceilings, quotas, and the behavior of
concurrent writes. Those are deployment conditions, not behavior this package
can configure or infer.

**Concurrency around run lineage is weaker than the SQLite backend's.** The
SQLite backend takes a write lock before checking whether a run id is
registered; two Workers cannot. A unique index still refuses a run id pointing
at two commits either way.

**A build's images are as large as the run kept.** Nothing here compresses,
resizes, or deduplicates across builds.

**A build cannot distinguish two images of one subject.** `ObservationRecord`
(the per-subject outcome a run reports — subject id, verdict, regions) carries
a subject and no label, so labelled baselines are writable through the store
and not reachable through the review path.

