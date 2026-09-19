<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/server

> A self-hosted HTTP history service for Variance Authority observations and approvals.

Part of [Variance Authority](https://variance-authority.dev), which retains what
a test run knows — what it rendered, which code it entered, what the workspace
exposes — so the next question is answered from the record, not another run.

Run this package when your pipeline needs to keep what it saw. A single run
answers *did this change*. It cannot answer *how often does this component
change*, *has this page been reading differently from itself for a month*, or
*what has `--va-space-3` drifted to across eleven approved edits* — those are
questions about a record, and this is the process that holds one.

A **run** — one execution of the pipeline, recorded whether or not anything
changed — posts **observations** (one row per component whose rendered hash
moved, on a **subject**: one named UI state you asked for and can ask for
again) and **approvals** (a reviewer accepting one subject's observations for
one run). It stores both, and answers eight HTTP questions over them.

You run it: a process, a port, a database file and a token you set. No instance
is shared between operators, nothing in this package starts it for another
project, and every row in it was posted by your own code.

## Requirements

- **Node 22 or newer.** The package is ESM-only (`"type": "module"`); there is
  no CommonJS build and no `require()` entry.
- **`node:sqlite`**, for the shipped backend only. Node 22 prints
  `ExperimentalWarning: SQLite is an experimental feature` on import; Node 24
  and newer do not. No `--experimental-sqlite` flag is needed on any of them,
  and `--disable-warning=ExperimentalWarning` silences the Node 22 line.
- **A writable database path.** One SQLite file, in WAL mode, owned by one
  process.

A backend you write yourself needs neither `node:sqlite` nor a file — see
[implementing another backend](#implementing-another-backend).

## Run it

```bash
npm install @variance-authority/server
```

```bash
export VARIANCE_HISTORY_TOKEN=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")

VARIANCE_HISTORY_DB=/srv/variance/history.db \
VARIANCE_HISTORY_PORT=7788 \
npx variance-authority-server
```

It prints what it bound, what it opened, and not the token:

```text
variance-authority history service listening on http://127.0.0.1:7788
  database: /srv/variance/history.db
  storage:  node:sqlite on 26.7.0 — a built-in, nothing was compiled to install it
  auth:     bearer token from VARIANCE_HISTORY_TOKEN
```

| variable | default | |
|---|---|---|
| `VARIANCE_HISTORY_TOKEN` | none | the bearer token every request must send. At least 16 characters, or the process exits with a sentence |
| `VARIANCE_HISTORY_DB` | `variance-history.db` in the working directory | resolved to an absolute path and printed on startup |
| `VARIANCE_HISTORY_PORT` | `7788` | `0` binds an ephemeral port |
| `VARIANCE_HISTORY_HOST` | `127.0.0.1` | the interface to bind |

`SIGINT` and `SIGTERM` close the database before the process exits.

### Check that it is up

There is no health route and no unauthenticated path: every request is
authenticated before its path is looked at, so an unknown path and a wrong
token get the same `401`. Probe it with a real question instead — an empty
store answers one truthfully.

```bash
curl -sS -H "Authorization: Bearer $VARIANCE_HISTORY_TOKEN" \
  'http://127.0.0.1:7788/v1/churn?component=Button'
```

```json
{"component":"Button","window":{},"runs":0,"changedRuns":0,"bands":[],"collateralRuns":0,"rejectedRuns":0,"omittedRuns":0,"omittedObservations":0}
```

### Write a run and read it back

A run posts itself, its moved rows and the token values it resolved in one
request. `204` means the whole write landed.

```bash
curl -sS -X POST -H "Authorization: Bearer $VARIANCE_HISTORY_TOKEN" \
  -H 'content-type: application/json' \
  'http://127.0.0.1:7788/v1/observations' \
  -d '{
    "run": {"project":"shop","run":"run-2","commit":"c2","profile":"chromium","at":"2026-03-02T10:00:00.000Z","swept":true},
    "observations": [{"project":"shop","subject":"checkout","component":"Button","band":"structure","hash":"h-2","profile":"chromium","commit":"c2","run":"run-2","at":"2026-03-02T10:00:00.000Z","accepted":false,"file":"src/Button.tsx"}],
    "tokens": [{"project":"shop","token":"--va-space-3","value":"12px","commit":"c2","at":"2026-03-02T10:00:00.000Z"}]
  }'
```

```bash
curl -sS -H "Authorization: Bearer $VARIANCE_HISTORY_TOKEN" \
  'http://127.0.0.1:7788/v1/last-changed?subject=checkout&component=Button'
```

```json
{
  "observation": {
    "project": "shop", "subject": "checkout", "component": "Button",
    "band": "structure", "hash": "h-2", "profile": "chromium",
    "commit": "c2", "run": "run-2", "at": "2026-03-02T10:00:00.000Z",
    "accepted": false, "file": "src/Button.tsx"
  }
}
```

That row reads `accepted: false` after a review, and that is the record
behaving: the run wrote it before anybody looked at it, and accepting a subject
posts an approval to `/v1/approvals` rather than rewriting the row. `churn`
joins the two, which is why it can report rejected runs separately.

```bash
curl -sS -X POST -H "Authorization: Bearer $VARIANCE_HISTORY_TOKEN" \
  -H 'content-type: application/json' \
  'http://127.0.0.1:7788/v1/approvals' \
  -d '{"approvals":[{"project":"shop","subject":"checkout","run":"run-2","at":"2026-03-02T10:00:00.000Z","approver":"marina"}]}'
```

In a pipeline, `npx variance accept <subject>` posts that for you.

## The words in the answers

Four of them are this project's, and every route below uses at least one.

**Band** — which part of a component was hashed: `structure` (the rendered
tree), `style` (the resolved declarations), `geometry` (the box). A change is
assigned to whichever of the three hashes moved, so one edit can produce up to
three rows for one component. `structure` is portable and is counted across
every profile; `style` and `geometry` are only ever compared within one, so
`churn` reports them per profile and `structure` once.

**Profile** — which tier observed it, `jsdom` or `chromium`. It is on every row
and it is why `style` and `geometry` are scoped: asking about them across tiers
returns a change caused by the CI configuration rather than by an edit.

**Sweep** — a run that read *every* subject twice rather than only the ones that
changed, which `npx variance run --flakes` does. It is the only honest denominator
for flakiness: an ordinary run asks a subject whether it agrees with itself only
after calling it changed, so a green subject's silence in that run is not
evidence.

**Occurrence** — one run in which a subject read differently from itself. Runs
post these as the optional `instabilities` array; `/v1/flakiness` counts them.
An **absorbed** occurrence fell entirely in bands the subject does not assert
on — working as declared, so never a finding, counted separately so a rule that
has been absorbing something for six months can still be asked about. A
**collateral** run, on the churn side, is one in which only a component's
`geometry` moved: it was displaced by an edit somewhere else, reported and never
summed.

## HTTP API

Every request needs `Authorization: Bearer <token>`, checked before the path is
looked at: a missing or wrong token gets `401`, a `WWW-Authenticate: Bearer`
header and `{"error": "a valid bearer token is required"}`, whatever path it
named. All paths are versioned under `/v1`, and `project` is an optional query
parameter on every route, for a service shared across projects.

| method & path | request | response |
|---|---|---|
| `POST /v1/observations` | `{ run, observations, tokens, instabilities? }` | `204`, empty body |
| `POST /v1/approvals` | `{ approvals }` | `204`, empty body |
| `POST /v1/current?project=` | `{ subjects }` — up to 200 subject ids | `200 { observations, tokens }` — the latest row per subject, component, band and profile, and every token's latest value |
| `GET /v1/last-changed?project=&subject=&component=&band=` | `subject` and `component` required; `band` optional, one of `structure`\|`style`\|`geometry` | `200 { observation }` — the row, or `null` |
| `GET /v1/churn?project=&component=&since=&until=&limit=` | `component` required | `200` — runs and changed runs in the window, a `rate` per band, and separate counts of collateral and rejected runs |
| `GET /v1/flakiness?project=&subject=&since=&until=&limit=` | `subject` required | `200` — sweeps, occurrences, absorbed runs, named causes, and a `rate` that is absent rather than zero when nothing swept |
| `GET /v1/value-journey?project=&token=&since=&until=&limit=` | `token` required | `200` — the token's values across approved runs, oldest first |
| `GET /v1/reach?project=&component=&since=&until=&limit=` | `component` required | `200` — subjects the component appeared in, and which of those are newly arrived |

`since` and `until` are ISO-8601 instants and `limit` a positive integer; all
three are optional on every `GET`. They are matched against the `at` each row
carried when it was written — the posting machine's clock, not the service's —
so a CI agent with a skewed clock writes rows that land in the wrong window.

There is no cursor. `limit` caps the rows a query reads, and whatever it
excludes comes back as an `omitted` count rather than silently shrinking a
total: `omittedRuns: 37` tells you how wrong a lower bound might be. Narrow with
`since` and `until` rather than paging.

`POST /v1/current` is a read and stays a POST because its argument is a subject
list: three hundred subject ids in a query string is a `414` from a proxy nobody
configured. Nothing about it is cacheable — the answer is the store's current
state and the caller is about to append to it. Above 200 subjects it answers
`400` rather than trimming, and the client in
[`@variance-authority/history`](https://variance-authority.dev/reference/packages/history)
splits a longer list and concatenates the results.

### What you get

Three runs, one of which moved `Button`'s structure, all three approved, with
one occurrence on `checkout` and `--va-space-3` moving to `14px`.

`GET /v1/churn?component=Button`:

```json
{
  "component": "Button",
  "window": {},
  "runs": 3,
  "changedRuns": 2,
  "bands": [
    { "band": "structure", "runs": 3, "changes": 2, "rate": 0.6666666666666666 },
    { "band": "style", "profile": "chromium", "runs": 3, "changes": 0, "rate": 0 },
    { "band": "geometry", "profile": "chromium", "runs": 3, "changes": 0, "rate": 0 }
  ],
  "collateralRuns": 0,
  "rejectedRuns": 0,
  "firstAt": "2026-03-01T10:00:00.000Z",
  "lastAt": "2026-03-02T10:00:00.000Z",
  "omittedRuns": 0,
  "omittedObservations": 0
}
```

`GET /v1/flakiness?subject=checkout`:

```json
{
  "subject": "checkout",
  "window": {},
  "runs": 3,
  "sweeps": 3,
  "occurrences": 1,
  "absorbedRuns": 0,
  "rate": 0.3333333333333333,
  "sweepsSince": 0,
  "causes": [{ "component": "Clock", "band": "content", "runs": 1 }],
  "firstAt": "2026-03-03T10:00:00.000Z",
  "lastAt": "2026-03-03T10:00:00.000Z",
  "lastRun": "run-3",
  "omittedRuns": 0,
  "omittedOccurrences": 0
}
```

`sweepsSince` is the resolution signal, counted in sweeps rather than in days so
that a suite which stopped running does not look increasingly fixed. `causes`
reports a frequency band — `content` is data, `geometry` is layout, `token` is
style — which is a different axis from the `band` on an observation.

`GET /v1/value-journey?token=--va-space-3`:

```json
{
  "token": "--va-space-3",
  "window": {},
  "values": [
    { "project": "shop", "token": "--va-space-3", "value": "12px", "commit": "c1", "at": "2026-03-01T10:00:00.000Z" },
    { "project": "shop", "token": "--va-space-3", "value": "12px", "commit": "c2", "at": "2026-03-02T10:00:00.000Z" },
    { "project": "shop", "token": "--va-space-3", "value": "14px", "commit": "c3", "at": "2026-03-03T10:00:00.000Z" }
  ],
  "omitted": 0
}
```

Values from runs nobody approved are left out of this answer rather than counted
as `omitted`: they are outside the question, not missing from it.

`GET /v1/reach?component=Button`:

```json
{ "component": "Button", "window": {}, "subjects": ["checkout"], "arrived": ["checkout"], "omittedSubjects": 0 }
```

`POST /v1/current` with `{"subjects":["checkout"]}`:

```json
{
  "observations": [
    {
      "project": "shop", "subject": "checkout", "component": "Button",
      "band": "structure", "hash": "h-2", "profile": "chromium",
      "commit": "c2", "run": "run-2", "at": "2026-03-02T10:00:00.000Z",
      "accepted": false, "file": "src/Button.tsx"
    }
  ],
  "tokens": [
    { "project": "shop", "token": "--va-space-3", "value": "14px", "commit": "c3", "at": "2026-03-03T10:00:00.000Z" }
  ]
}
```

### Errors

Every error body is `{"error": "..."}` with a sentence naming what was wrong.

| status | when |
|---|---|
| `400` | a malformed body, an unparseable timestamp, an unknown band or profile, a missing required parameter, more than 200 subjects |
| `401` | no token, a wrong token, or any path at all without one |
| `404` | an authenticated request to a path this version does not serve; the body lists the routes it does |
| `405` | the wrong method, with an `Allow` header |
| `409` | a write that cannot be reconciled with what is stored |
| `413` | a body above `maxBodyBytes`, with `Connection: close` |

A run is identified by `(project, run, profile)`, and posting the same run again
is a no-op rather than a second row — a caller that approves half its components
separately legitimately writes twice, and a run counted twice halves every rate
derived from it forever. So a retry after a timeout is safe. Reusing a run id
at a *different* commit is the `409`:

```json
{"error":"run \"run-1\" of project \"shop\" under chromium is already recorded at commit c1; this write claims DIFFERENT. A run id that points at two commits makes every question asked by lineage unanswerable, so the write is refused rather than appended alongside it"}
```

Approving the same `(project, subject, run)` twice is also a no-op, so a double
click is not a failed command.

A run and its rows commit together or not at all. Rows without their run would
leave a change with no denominator; a run without its rows would leave a quiet
run that was not quiet.

## Exposing it beyond loopback

It speaks plain HTTP. There is no TLS in this process and no option to add one,
and the bearer token is sent in a header — so anything other than
`VARIANCE_HISTORY_HOST=127.0.0.1` needs TLS terminated in front of it. Put it
behind a reverse proxy and let the proxy hold the certificate.

The token is one shared static string. It carries no identity: it answers *is
this write attributable to this deployment*, not *who are you*. There is one of
them, there are no read-only tokens, and rotating it means restarting the
process with a new value — during which clients holding the old one get `401`.
The `project` query parameter scopes what a query reads; it does not scope
access, so anyone holding the token reads every project in the database.

## What it keeps

Everything, permanently. `UPDATE` and `DELETE` abort at the database level on
every table, there is no route that removes a row, and the package ships no
prune, retention, export, backup or restore command. Two branches observing
different hashes for one key are two rows, and anything allowed to overwrite one
brings back the merge problem the store exists to escape.

What that costs per run, so you can size it:

- one row per `(run, profile)`, quiet runs included — this is the denominator;
- one observation row per component and band whose hash **moved**, so a quiet
  run writes none;
- one token row per custom property the run resolved, **every run**, moved or
  not — this is the row that grows fastest;
- one instability row per occurrence, which is rare by definition;
- one approval row per subject somebody accepted.

The database is a single SQLite file at `VARIANCE_HISTORY_DB`, plus its WAL
sidecars, owned by one process.

## Upgrading

The stored shape carries a version number in `PRAGMA user_version`, exported as
`SCHEMA_VERSION` from `@variance-authority/server/sqlite`. On startup the
service compares the file against the build, and there are four outcomes:

- **same version** — opened.
- **older version, with migrations for every step between** — migrated in place,
  in one transaction with the version bump, so the file is never left at a
  version whose shape it does not have. The steps are additive by construction:
  they add columns and tables and rewrite no row, so answers the file already
  gave mean what they meant before. Your data survives the upgrade.
- **older version with a missing step** — refused, naming the version it found.
- **newer version than the build understands** — refused. Reading a newer shape
  through older assumptions answers drift questions with numbers that are wrong
  in a way nothing shows.

A refusal is a process that exits with a sentence, never a service that starts
and answers wrongly. Since a downgrade is refused and a migration is one-way,
copy the file before you upgrade the package.

An SQLite file that holds tables but no version of ours is refused too, rather
than adopted.

## Implementing another backend

`HistoryBackend` is the interface a custom store implements — Postgres, or
anything that shards by project. It appends rows and returns rows, and none of
its methods returns a number: every rule about what an answer is made of lives
in this package's shared arithmetic, so two backends cannot disagree about what
a rate means.

```bash
npm install @variance-authority/server @variance-authority/history
```

Twelve methods, all returning promises:

| method | answers |
|---|---|
| `append(run, observations, tokens, instabilities?)` | store one run and its rows, atomically. The same run twice is a no-op, not an error |
| `appendApprovals(approvals)` | store acceptances. The same one twice is a no-op |
| `currentOf({ project?, subjects })` | the latest row per `(subject, component, band, profile)` for those subjects, raw and unreduced. No window, no limit, and a backend may not add either |
| `currentTokens({ project? })` | the latest value per token, for the whole project |
| `lastObservation({ project?, subject, component, band? })` | the most recent row for an area, or `null` |
| `runsIn(window)` | `Slice<RunRecord>` — every run in the window, one entry per `(run, profile)`, quiet ones included |
| `observationsOf({ ...window, component })` | `Slice<Observation>` — every row for one component, approved or not |
| `approvalsOf(window)` | `Slice<Approval>` — acceptances in the window, scoped by window rather than by component |
| `instabilitiesOf({ ...window, subject })` | `Slice<Instability>` — every occurrence for one subject, absorbed ones included |
| `valuesOf({ ...window, token })` | `Slice<TokenValue>` — one token's values, oldest first |
| `reachOf({ ...window, component })` | `{ subjects, arrived, omittedSubjects }`, pre-reduced: `arrived` needs a lookup outside the window |
| `close()` | release the store |

A `window` is `{ project?, since?, until?, limit? }`. Two rules bind every
implementation. Compare `since` and `until` as **instants**, never as text —
ISO-8601 sorts lexically only while every timestamp shares one offset, and a
store fed by CI jobs in two regions does not. And return a `Slice`, whose
`omitted` count is what the `limit` excluded: a capped answer that does not say
it was capped reads as a complete one.

Wire yours into the service, or skip the socket entirely:

```ts
import {
  createBackedStore,
  serveHistory,
  type HistoryBackend,
} from '@variance-authority/server';
import { createSqliteBackend } from '@variance-authority/server/sqlite';

// Swap this line for your own implementation. Everything below is unchanged.
const backend: HistoryBackend = createSqliteBackend({ path: '/srv/variance/history.db' });

const service = await serveHistory({
  backend,
  token: process.env['VARIANCE_HISTORY_TOKEN'] ?? '',
  port: 7788,
});

console.log(service.url, service.port);
await service.close();

// Or hold it in process: the same backend as a `HistoryStore`, with the shared
// arithmetic already wrapped around it, and no port at all.
const store = createBackedStore(backend, 'shop');
```

`createSqliteBackend` takes one option: `path`, a file or `':memory:'` for a
store that ends with the process. `serveHistory` takes:

| option | default | |
|---|---|---|
| `backend` | required | the `HistoryBackend` that stores and returns rows |
| `token` | required | the bearer token clients must send. An empty one throws rather than binding |
| `port` | `0` here, `7788` from the executable | `0` binds an ephemeral port; the bound one comes back as `service.port` |
| `host` | `127.0.0.1` | the interface to bind |
| `maxBodyBytes` | 8 MiB | largest body accepted; a larger write gets `413` |

It resolves to `{ url, port, close() }`. `close()` shuts the socket and drops
keep-alive connections, so a finished CI job cannot hold the process open;
closing the backend is separate, and yours.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | a socket | `HistoryBackend`, the shared arithmetic, `serveHistory`, `createBackedStore` |
| `./sqlite` | `node:sqlite` | `createSqliteBackend`, `SCHEMA_VERSION` |
| `./bin` | both | `readConfig`, `start` — what the executable runs |

A backend backed by Postgres implements `HistoryBackend` from `.` and never
loads `./sqlite`.

## Who writes to it

A configured CLI, or a client you call yourself. `variance run` posts the run
and its observations when the config carries a `history` block:

```jsonc
{
  "project": "shop",
  "history": {
    "endpoint": "https://history.internal.example/v1",
    "token": "${VARIANCE_HISTORY_TOKEN}",
  },
}
```

and when **the run can name itself**, which means a run id and a commit SHA
arriving together from one source. Either you pass both —
`npx variance run --run <id> --commit <sha>` — or the run reads a pair whole
from the CI environment it is already inside:

| CI | run id | commit |
|---|---|---|
| GitHub Actions | `GITHUB_RUN_ID` + `GITHUB_RUN_ATTEMPT` | `GITHUB_SHA` |
| GitLab CI | `CI_PIPELINE_ID` | `CI_COMMIT_SHA` |
| Bitbucket Pipelines | `BITBUCKET_BUILD_NUMBER` | `BITBUCKET_COMMIT` |

Each pair is read whole: a run id from one system with a commit from another
describes a run that never existed, so it is refused rather than completed from
two sources. A run on a laptop with neither flag writes nothing and says so in
its report.

That is the usual reason a configured database is empty on day one. The other
is that nothing has posted yet.

`@variance-authority/history` holds the other half of this: the wire contract
both ends agree on, the HTTP client `variance run` uses, and the arithmetic that
folds a token's recorded values into a drift total. This package holds the
database, the socket, and the row-to-answer arithmetic every backend shares.

- **[What accumulates](https://variance-authority.dev/docs/history)** — what
  the record answers that one run cannot.
- **[Flakiness](https://variance-authority.dev/docs/flakiness)** — sweeps,
  occurrences, and reading the numbers above.

---

**[@variance-authority/server](https://variance-authority.dev/reference/packages/server)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
