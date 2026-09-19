<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/tribunal

> A self-hosted review service for Variance Authority baselines, history and per-subject decisions.

Part of [Variance Authority](https://variance-authority.dev).

Install this package when you want a place — yours, on your infrastructure — where
a finished run lands, a person looks at what changed, and approves or rejects it
per **subject**: one named UI state you asked for and can ask for again, such as
`cart/empty`, identified here by a string id like `story:card`.

It gives you a service you run: a database of builds, decisions and history, an
object store of images, an HTTP API, and a React review page. It is not a hosted
endpoint, and it does not render anything or decide anything — producing runs and
verdicts is [`@variance-authority/cli`](https://variance-authority.dev/reference/packages/cli)'s job.

Two deployments ship. The first needs no account.

## Run it on your own machine

```bash
npm install @variance-authority/tribunal
```

```bash
VARIANCE_TRIBUNAL_PROJECT=todomvc \
VARIANCE_TRIBUNAL_INGEST_TOKEN=ingest-token-0123456789 \
VARIANCE_TRIBUNAL_REVIEW_TOKEN=review-token-0123456789 \
npx variance-authority-tribunal
```

```
variance-authority tribunal listening on http://127.0.0.1:7789
  project:  todomvc
  database: /home/you/variance-tribunal.db (schema version 18)
  objects:  /home/you/variance-tribunal-objects
  review:   served at http://127.0.0.1:7789 — this bind is reachable only from this machine
  auth:     bearer tokens from VARIANCE_TRIBUNAL_INGEST_TOKEN and VARIANCE_TRIBUNAL_REVIEW_TOKEN
```

Open `http://127.0.0.1:7789` and you are on the review page. The SQLite file and
the image directory are created and migrated on start; the two tokens are
invented above and both are long enough — the service refuses a token under 16
characters and refuses two identical ones.

Then point a suite at it. In your `variance.config.json`, `review.endpoint` is
where `variance push` sends a finished run, and the token it presents is the
**ingest** token, never the review one:

```jsonc
// variance.config.json — `review` is the part this page is about; the rest is
// your suite's, and is what it already was.
{
  "project": "snkr-shop",
  "profile": "chromium",
  "retention": "durable",
  "viewport": { "width": 1280, "height": 800 },
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": "baselines" },
  "report": "out/report.json",
  "review": {
    "endpoint": "http://127.0.0.1:7789",
    "token": { "env": "VARIANCE_INGEST_TOKEN" }
  }
}
```

```bash
variance run
variance push --branch "$(git branch --show-current)"
```

Reload the page and the build is there.

To keep approved images in this service too — so approval stops being a commit —
add `baselines` beside it:

```jsonc
// variance.config.json — `retention` and `baselines` are what changed; the
// `review` section above stays as it is.
{
  "project": "snkr-shop",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "report": "out/report.json",
  "retention": "durable",
  "baselines": {
    "kind": "remote",
    "endpoint": "http://127.0.0.1:7789",
    "token": { "env": "VARIANCE_INGEST_TOKEN" }
  },
  "review": {
    "endpoint": "http://127.0.0.1:7789",
    "token": { "env": "VARIANCE_INGEST_TOKEN" }
  }
}
```

### What the environment sets

`variance-authority-tribunal` takes no flags and reads no arguments; passing
`--port` is refused by name rather than ignored; `--help` names every variable.

| variable | default | what it decides |
|---|---|---|
| `VARIANCE_TRIBUNAL_PROJECT` | required | scopes every row and every object key, so one deployment serves several repositories without their `story:card` colliding. There is no default: an invented one puts two projects' baselines in one namespace and the first symptom is a mass `changed` |
| `VARIANCE_TRIBUNAL_INGEST_TOKEN` | required | written into CI. Writes builds, baselines and history. 16 characters or more |
| `VARIANCE_TRIBUNAL_REVIEW_TOKEN` | required | held by people. Reads the review surface and decides. 16 characters or more, and not the ingest token |
| `VARIANCE_TRIBUNAL_PORT` | `7789` | a whole number from 0 to 65535, or the process refuses to start |
| `VARIANCE_TRIBUNAL_HOST` | `127.0.0.1` | the bind address. Any address other machines can connect to also needs `VARIANCE_TRIBUNAL_TRUST_NETWORK` |
| `VARIANCE_TRIBUNAL_DB` | `variance-tribunal.db` | the SQLite file. Created and migrated on start; the startup line prints its absolute path and its schema version |
| `VARIANCE_TRIBUNAL_STORAGE` | `variance-tribunal-objects` | the directory holding baseline and candidate bytes |
| `VARIANCE_TRIBUNAL_RETENTION_DAYS` | `30` | days of builds `POST /review/sweep` keeps |
| `VARIANCE_TRIBUNAL_REVIEWER` | the OS user | the name written on decisions made through the served page |
| `VARIANCE_TRIBUNAL_TRUST_NETWORK` | unset | confirms a non-loopback bind; what that costs is below |

**On loopback, a browser is a reviewer.** The bare URL serves the review page,
and a caller with no token is treated as holding the review token: anything that
can open `127.0.0.1:7789` is already running as the person who started it.

**On a network bind the review page is not served at all**, and no call is
authorized without a token — there is no TLS here, no accounts and no rate limit,
so there would be nothing between an approve button and the internet. For a
reviewer who is not at the machine, mount the Next.js adapter behind your own
sign-in, or leave the process on loopback behind a proxy that authenticates.

The tokens are never printed and never rendered. The startup line names the
variables, not their values, and the served page carries the endpoint and the
reviewer name and nothing else — the browser calls the service, which holds the
token.

## Words this page uses

| word | what it means here |
|---|---|
| subject | one named UI state you asked for and can ask for again — a story, a route, a fixture — identified by a string id such as `story:card` |
| verdict | the per-subject outcome a run decided: `unchanged`, `changed`, `new`, `incomparable` or `ignored`. Decided by the CLI, stored here |
| shape | the digest of one distinct difference, computed from the kind of element that changed, the deltas inside it, and the component responsible. Two subjects that changed the same way carry the same shape, so one token edit across forty stories is one shape; the same-looking change in `Avatar` and in `Badge` are two |
| cause | a flag on a changed region: the analysis attributed that region to a component's own edit rather than to something upstream of it |
| collateral | pixels that moved because something else did — every changed region not flagged a cause. Counted once for the build, never split between causes |
| the record | the history rows every run appends: which component hashes changed for which subject, and the token values resolved at the time. `POST /v1/observations` writes it; the `/v1` reads derive from it |
| docket | the reviewer's list of causes for one build, one entry per component, largest first |

## Deploy it on Cloudflare

The database is D1, the object store is R2, the runtime is a Worker. Everything
above the bindings takes a `D1Like` and an `R2Like` and names no runtime, so the
routes, the refusals and the status codes are one module serving both
deployments. What differs is underneath them — see
[Operational boundaries](#operational-boundaries).

The package ships the deployable Worker module. **The two files you edit are
yours and live in your repository, not in `node_modules`** — a project of your
own, with the package installed into it.

```bash
npm install @variance-authority/tribunal wrangler
```

```ts
// worker.ts — yours, in your git
export { default } from '@variance-authority/tribunal/worker-entry';
```

```jsonc
// wrangler.jsonc — yours, in your git
{
  "$schema": "https://developers.cloudflare.com/schemas/wrangler.json",
  "name": "variance-tribunal",
  "main": "worker.ts",
  "compatibility_date": "2026-08-05",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "variance-tribunal",
      "database_id": "PLACEHOLDER — replace with the id `wrangler d1 create` prints",
      // The package's generated migrations, read where they are installed. Never
      // copied: a database migrated by a copy that drifted is a second schema
      // history wearing the same name.
      "migrations_dir": "node_modules/@variance-authority/tribunal/migrations"
    }
  ],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "variance-tribunal" }],
  "vars": { "PROJECT": "todomvc" }
}
```

```bash
wrangler d1 create variance-tribunal        # put the printed id in your wrangler.jsonc
wrangler r2 bucket create variance-tribunal
wrangler d1 migrations apply variance-tribunal --remote
wrangler secret put INGEST_TOKEN            # 16 characters or more
wrangler secret put REVIEW_TOKEN            # 16 characters or more, and not the other one
wrangler deploy
```

`wrangler d1 migrations apply` is what puts the schema into your database, and
Wrangler records which steps it has applied — so run that same command again
after you upgrade the package. A release that adds a step applies that step
alone; one that adds none applies nothing. `GET /version` reports the schema
version the deployed build expects.

The two tokens are secrets rather than `vars`: they are the deployment's
capabilities, and `wrangler.jsonc` is in your repository.

`worker-entry` is the only file in the package that reads an environment, and it
reads four names plus two optional ones:

| name | kind | what it decides |
|---|---|---|
| `DB` | binding | D1. Rows: builds, verdicts, decisions, baseline metadata, history observations |
| `BUCKET` | binding | R2. Baseline and candidate bytes; never a row |
| `INGEST_TOKEN` | secret | written into CI. Writes builds, baselines and history. 16 characters or more |
| `REVIEW_TOKEN` | secret | held by people. Reads the review surface and decides. 16 characters or more |
| `PROJECT` | var, default `default` | scopes every row and object |
| `RETENTION_DAYS` | var, default `30` | days of builds `POST /review/sweep` keeps. A value that is not a positive finite number falls back instead of sweeping everything |

A bad environment answers **500 with a sentence**, not a deployment-wide platform
error: construction happens inside `fetch`, so *your token is too short* and *your
two tokens are the same* come back to you as the response body.

`PROJECT` is a deployment setting, so one deployment serves one project; a second
tenant needs a second deployment.

There is no review page on this deployment unless you serve one. `worker-entry`
answers the API; the React surface is mounted by a host — the Next.js adapter
below, behind your own sign-in.

## The HTTP API

Authentication happens before routing. A caller holding neither token gets the
same response for a wrong token, a missing token, and a path that does not exist.
Every path takes `Authorization: Bearer <token>`; none may be asked anonymously.

| method and path | token | what it does |
|---|---|---|
| `GET /version` | either | `{"service":"variance-authority-tribunal","api":2,"schema":18}` |
| `POST /baseline/find` | ingest | the approved image for a key, bytes and all |
| `POST /baseline/describe` | ingest | the same lookup without moving the image |
| `POST /baseline/put` | ingest | store an approved image |
| `POST /cache/find`, `POST /cache/put` | ingest | the render cache the same store backs |
| `POST /v1/observations` | ingest | append a run: its observations, its resolved token values, its instability reports. 204 |
| `POST /v1/approvals` | ingest | append which subjects were signed off in which run. 204 |
| `POST /v1/current` | ingest | a run asking what is currently recorded for a list of subject ids. A POST because three hundred ids in a query string is a 414 from a proxy nobody configured |
| `GET /v1/last-changed?subject&component[&band]` | either | the last observation in which that component's hash changed for that subject |
| `GET /v1/churn?component` | either | how often that component's own hashes changed, as a rate |
| `GET /v1/flakiness?subject` | either | how often that subject read differently from itself |
| `GET /v1/reach?component` | either | which subjects that component appears in now that it did not before |
| `GET /v1/value-journey?token` | either | how one design token's resolved values drifted across approved runs |
| `POST /review/builds` | ingest | file a finished run as a build. What `variance push` calls |
| `POST /review/have` | ingest | given image digests, which of them this deployment already holds, so a push uploads only the rest |
| `GET /review/builds[?limit]` | review | recent builds |
| `GET /review/builds/{id}` | review | one build: its subjects, their verdicts, their regions, the docket |
| `POST /review/builds/{id}/subjects/{subject}/decision` | review | `{"decision":"approved"\|"rejected","by":"…","note":"…"}` |
| `GET /review/builds/{id}/subjects/{subject}/{before\|after\|diff}.png` | review | one image, immutable and cacheable |
| `GET /review/changelog[?component&subject&since&limit]` | review | every approval, grouped by shape |
| `POST /review/sweep[?days=N]` | review | retention, below |

The four `/v1` reads take `since`, `until` and `limit` to bound the window, and
`project` where one deployment is queried for another's rows.

**The review token reads the record and never writes it.** The five reads answer
either capability because they derive from rows already recorded, and the browser
drawing a review page holds the review token. `/v1/observations` and
`/v1/approvals` are the ingest token's because they write; `/v1/current` is the
ingest token's because its caller is a run deciding what to write.

`api` is the wire contract, not the package version — it changes when what a
client may send or expect changes. `variance push` asks before it uploads and
says so when the two disagree, because a CLI newer than its deployment is not an
error: it works, sends more than it needs to, and until something prints both
numbers it looks like a slow network.

## What a reviewer sees

When `ReviewApp` is open on a build, in this order:

1. **The docket** — one entry per component the analysis named as a cause,
   largest first, with the file each is declared in. Ranked by cause pixels, not
   by total area, so a large container that only reflowed does not outrank the
   smaller edit that pushed it. Collateral is one number for the build.
2. **The regions, drawn on the render** — cause and collateral styled apart, each
   labelled with the component that owns it.
3. **The comparison** — swipe, onion, side-by-side, difference mask — last, and
   only the modes this build actually kept images for.
4. **The record, on request per subject**: how often this subject has failed to
   read the same way twice, how often its cause has caused an approved change,
   and how many subjects that component reaches. Fetched when a reviewer clicks
   *Has this changed before?* rather than with the build — a build with three
   hundred changed subjects would otherwise make nine hundred history requests to
   draw a page on which only one of them is read.

Step 4 is the question a before-and-after cannot answer. The same 2px shift is a
bug in a component nobody has touched since March and a Tuesday in one that
drifts in nineteen runs out of twenty. Two numbers are drawn as missing rather
than as zero: a flake rate is **absent** until a run has read every subject
twice, and a coverage that was never stated is unknown rather than clean.

The run page — *what this run read*, one link from the docket — carries **where
the subjects parted**, when the build was instrumented with probes and so carries
a [journey](https://variance-authority.dev/docs/journeys) for each subject. The
record `variance journeys` prints per module is turned round to face the subject:
the stretches of source (a function body, a branch, a `case`) this subject
entered that another subject of the same module did not, and the ones it missed
that another entered, with the file and the lines. The count of subjects the
journal holds is drawn even when nothing parted: no partings among five subjects
is agreement, and among one it is nothing at all. A build with no journal draws
no panel.

The `Changelog` tab is the same evidence at project scale.

## The changelog

A build says what changed today; `GET /review/changelog` says what was
*approved*, grouped by shape rather than by which screenshot changed — so a token
edit across forty stories is one entry, not forty.

```ts
// runnable as written: `testing` supplies an in-memory database and bucket
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

**One row is written per approval, and its columns are copies, not a join.** The
regions, the commit, the intent and the reviewer are frozen at the moment of
approval rather than read live from `builds` and `build_subjects`, because a
sweep removes builds and a baseline's explanation has to outlive them.

**Nothing is written for a rejection.** It is recorded in `decisions`, but no
baseline changed.

**Shapes are grouped when somebody reads**, not when a row is written — approval
here is per subject, so there is no batch at write time to cluster, and a shape
approved across several sessions still reads as one change. Approved subjects
that no shape could group are returned as `ungrouped`, not dropped.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `@variance-authority/tribunal` | nothing | the binding types, `SCHEMA`, `applySchema`, `MIGRATIONS` |
| `@variance-authority/tribunal/store` | D1 and R2 | `createBucketStore` — baselines |
| `@variance-authority/tribunal/history` | D1 | `createD1Backend` — the record |
| `@variance-authority/tribunal/review` | D1 and R2 | `createReviewStore` — builds, decisions, retention |
| `@variance-authority/tribunal/worker` | D1, R2, two tokens | `createTribunal` — one `fetch` handler |
| `@variance-authority/tribunal/worker-entry` | the bindings, as an `env` | the deployable module: `export default { fetch }` |
| `@variance-authority/tribunal/node` | Node 22, a writable file and directory | `openDatabase`, `createDirectoryBucket`, `serveTribunal`, and the `variance-authority-tribunal` executable |
| `@variance-authority/tribunal/ui` | React 19 | the review surface, its JSON client, its stylesheet |
| `@variance-authority/tribunal/next` | an App Router app | `createTribunalRoutes` |
| `@variance-authority/tribunal/testing` | Node 22 | D1 over `node:sqlite`, an in-memory bucket |

This is one service, deployed once, so React is an ordinary production dependency
even though only `/ui` and `/next` touch it. The rows say which entrypoint needs
what, which is what you want when you read the code or split the deployment
across two Workers.

## Wiring a Worker of your own

Copy this when you want your own module rather than the one that ships.

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

| option | default | what it decides |
|---|---|---|
| `db` | required | the D1 binding |
| `bucket` | required | the R2 binding |
| `project` | required | scopes every row and every object key. There is no default, for the reason given above |
| `ingestToken` | required | written into CI. Writes builds, baselines and history. 16 characters or more |
| `reviewToken` | required | held by people. Reads the review surface and decides. 16 characters or more, and not the same string as `ingestToken` |
| `retentionDays` | `30` | days of builds `POST /review/sweep` keeps. Applied on request, not on a timer — a Worker has no timer, and this package will not invent a cron you did not ask for. Wire it to a scheduled trigger, call it from a CI job, or never |
| `now` | the wall clock | supplies every recorded `at`; override it when the deployment has its own clock source |

`env.DB` and `env.BUCKET` are Cloudflare's own `D1Database` and `R2Bucket`,
accepted as-is via structural typing: this package declares only the subset it
uses and does **not** depend on `@cloudflare/workers-types`, which is why the
store is testable in a plain `vitest` process.

If you apply the schema yourself rather than through `wrangler d1 migrations
apply`, call `applySchema(db)` once, or run the statements in `SCHEMA` through
whatever you use for migrations. Nothing here migrates on a request, since D1 has
no advisory lock to serialize a migration running under concurrent load.

An **already-deployed** database is not upgraded by that call: `SCHEMA` is the
whole schema, and applying it a second time fails on the first `CREATE TABLE`.
Apply `MIGRATIONS` instead — one entry per version after the package's initial
schema, each writing the version it lands on. Step `i` lands on
`INITIAL_VERSION + i + 1`, so a database reporting `schema_version` `n` needs
every step from `n - INITIAL_VERSION` on.

## Composing the Node service yourself

The same three pieces without the executable, for a process that is also serving
something else:

```ts
import { createDirectoryBucket, openDatabase, serveTribunal } from '@variance-authority/tribunal/node';
import { createTribunal } from '@variance-authority/tribunal/worker';

const ingest = process.env.INGEST_TOKEN ?? '';
const review = process.env.REVIEW_TOKEN ?? '';

const service = await serveTribunal({
  tribunal: createTribunal({
    db: await openDatabase('variance-tribunal.db'),
    bucket: createDirectoryBucket('variance-tribunal-objects'),
    project: 'todomvc',
    ingestToken: ingest,
    reviewToken: review,
  }),
  host: '127.0.0.1',
  port: 7789,
  authorize: (request) =>
    request.headers.get('authorization') === `Bearer ${ingest}` ? 'ingest' : 'review',
  tokens: { ingest, review },
  ui: true,
  reviewer: 'marina',
});

service.url;  // http://127.0.0.1:7789
await service.close();
```

`serveTribunal` takes the `tribunal` to serve, an `authorize` and `tokens` that
mean exactly what they mean for `createTribunalRoutes` — it is the same function
underneath — plus `host`, `port`, and two that only a served page needs: `ui`,
which decides whether the review surface and its bundle are served at all, and
`reviewer`, the name written on decisions made through it. `openDatabase` opens,
creates or migrates the file and reports the `version` it settled on;
`createDirectoryBucket` writes each object through a staging file and renames it,
so a reader never sees half of one.

The `authorize` above grants review to any caller. That is right for a loopback
bind and wrong for anything else — the executable's own rule is the one to copy:
a bearer gets what its token is for, and a caller with no bearer reviews only
when the bind is loopback.

## Mounting the review surface in Next.js

```tsx
// app/variance/page.tsx — excerpt: `whoIsThis` is your session lookup
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
// app/variance/[[...path]]/route.ts — excerpt: `env` is your platform's bindings,
// `isSignedIn` your session check
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
behind the adapter above: the server route holds it and the browser never sees
it.

`createTribunalRoutes` takes `basePath`, `authorize` and `tokens`. `basePath` is
stripped before the request reaches the Worker. `tokens` is passed explicitly
because the `Tribunal` object exposes only `fetch`, not the tokens it was created
with.

`authorize` has **no default**. It returns `'ingest'`, `'review'`, or `null`; a
refused caller gets a 401 before the Worker sees the request, and a caller
returned `'review'` has the review token attached on their behalf. A default that
returned `'review'` would be a published approve button.

## Review invariants

**Approval promotes an image; it never records one.** Deciding *approved* makes
that build's uploaded candidate the baseline, through the same `RasterStore` the
next run reads. A subject whose candidate was never uploaded **cannot be
approved**.

**A store failure is never a verdict.** Every D1 and R2 failure raises
`RasterStoreError` instead of returning a value; `null` is reserved for *the
store looked and there is no baseline*.

**A row without its object is damage, not absence.** The metadata sidecar lives
in D1 and the image in R2. `describe` spends an R2 `head` call to confirm the
object still exists rather than answering from the D1 row alone.

**A coverage list that was never stated is not an empty one.** `undefined` and
`[]` are stored, returned, and drawn as different values: absent means nothing
looked, `[]` means inspected and clean. The same distinction holds for findings.

**Two tokens, and they may not be equal.** The ingest token lives in CI
configuration and writes builds, baselines and history; the review token belongs
to people and decides. Construction refuses a token under 16 characters and
refuses two identical tokens.

**Which token a route requires is only revealed to a caller who already holds
one.** Authentication happens before routing.

**The service makes no outbound request.** Not a status check, not a PR comment,
not a webhook, not telemetry — the pipeline reports to the service, and the
service reports to nobody.

**The record is append-only, and the database enforces it.** Runs, observations,
token values and decisions all carry `UPDATE` and `DELETE` triggers, so a direct
`wrangler d1 execute` against the database is refused too.

## Retention

`POST /review/sweep?days=N` removes builds older than `N` days: their subject
rows, their coverage rows, and every image they kept. It **reports counts** for
everything it removed — `builds`, `subjects`, `objects`.

What it does not remove: **promoted baselines** (what the next run compares
against), **decisions**, and the **changelog**. The fourth count,
`decisionsKept`, is how many approvals outlived the builds this call removed, not
a fourth removal.

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

D1 is built on SQLite, so this adapter runs the package's own schema, indexes,
triggers, `ON CONFLICT` clauses and ordering through `node:sqlite` — your routes,
your ingest, your retention settings, in a plain `vitest` process, with no
`wrangler`, no container and no account. What it does not reproduce is
Cloudflare; see below. `createMemoryR2().fail(…)` makes the bucket throw, so you
can exercise your store-failure path.

## Operational boundaries

The Worker relies on the platform's D1 transaction and `batch` semantics, request
and subrequest limits, object-size ceilings, quotas, and the behavior of
concurrent writes. Those are deployment conditions, not behavior this package can
configure or infer, and none of them are reproduced by the SQLite adapter above.

**Concurrency around run lineage is weaker on Cloudflare than on the Node
deployment.** The router is one module and answers identically; what differs is
underneath it. A SQLite file has a single writer and a lock, so the Node backend
takes that lock before checking whether a run id is registered. Two Workers
cannot. A unique index still refuses a run id pointing at two commits either way.

**A build's images are as large as the run kept.** Nothing here compresses,
resizes, or deduplicates across builds.

**A build cannot distinguish two images of one subject.** The per-subject outcome
a run reports carries a subject and no label, so labelled baselines are writable
through the store and the review path can never address them.

**Anything that satisfies `D1Like` and `R2Like` is an adapter away**, and the
package makes no portability promise beyond the two deployments it ships. Your
deployment's platform limits are yours.

---

**[@variance-authority/tribunal](https://variance-authority.dev/reference/packages/tribunal)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
