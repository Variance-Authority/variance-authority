<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/server

> A self-hosted HTTP history service for Variance Authority observations and approvals.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

Run this package when a pipeline needs a self-hosted HTTP history service. A
**run** — one execution of the pipeline, recorded whether or not anything
changed — posts **observations** (one row per component whose rendered hash
moved, on a **subject**: the page or story under test) and **approvals** (a
reviewer accepting one subject's observations for one run). The service stores
both in a backend and answers the history queries defined by
`@variance-authority/history`.

**Requires:** a port and a bearer token of at least 16 characters — it refuses to
start without the token. The shipped backend adds a Node with `node:sqlite` (22+,
where it is still experimental and warns on import) and a writable database path;
a backend you write yourself requires neither, and the entrypoint table below says
which is which.

This is an operator-run service, not a hosted endpoint. Nothing in this package
starts it for another project or provisions a database.

## Deployment model

**You run it.** A process, a port, and a token you set. No instance is shared
between operators, and every row in it was posted by your own code — see
[who writes to it](#who-writes-to-it). It neither reaches out nor accepts a
write it cannot attribute to its configured token.

`@variance-authority/history` holds the client-side contract and the drift
arithmetic and no storage; this package holds a database and a socket, plus the
row-to-answer arithmetic every backend shares. A backend itself does no
arithmetic — it only appends and returns rows. Three functions turn those rows
into the numbers a client reads: **churn** (how often one component's own code
changed, as a rate), **journey** (a design token's recorded values over time),
and **reach** (the subjects a component appears in, and which of those are newly
arrived). Every backend shares this arithmetic, so two backends cannot disagree
about what a number means.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | a socket | `HistoryBackend`, the row→answer arithmetic, `serveHistory` |
| `./sqlite` | `node:sqlite` | `createSqliteBackend`, `SCHEMA_VERSION` |
| `./bin` | both | `readConfig`, `start` — what the executable runs |

An operator backing this with Postgres implements `HistoryBackend` and should
**never load `node:sqlite`**.

## Running it

```bash
VARIANCE_HISTORY_TOKEN=<at least 16 characters> \
VARIANCE_HISTORY_DB=/srv/variance/history.db \
VARIANCE_HISTORY_PORT=7788 \
npx variance-authority-server
```

`VARIANCE_HISTORY_PORT` defaults to `7788` and `VARIANCE_HISTORY_HOST` to
`127.0.0.1`; the token has no default, which is the point.

`readConfig` refuses to start without a token, and refuses one shorter than 16
characters.

## HTTP API

Every request needs `Authorization: Bearer <token>`, checked before the path is
even looked at: a missing or wrong token gets `401`, with a `WWW-Authenticate:
Bearer` header and body `{"error": "a valid bearer token is required"}`,
whatever path it named. All paths are versioned under `/v1`, and `project` is an
optional query parameter on every route below, for a service shared across
projects.

| method & path | request | response |
|---|---|---|
| `POST /v1/observations` | `{ run, observations, tokens, instabilities? }` — the run record, the observation rows that moved, the token values resolved, and optionally which subjects read differently from themselves this run | `204`, empty body |
| `POST /v1/approvals` | `{ approvals }` | `204`, empty body |
| `POST /v1/current?project=` | `{ subjects }` — up to 200 subject ids | `200 { observations, tokens }` — the latest recorded row per subject/component/band/profile, and every token's latest value |
| `GET /v1/last-changed?project=&subject=&component=&band=` | `subject` and `component` required; `band` optional, one of `structure`\|`style`\|`geometry` | `200 { observation }` — the observation, or `null` |
| `GET /v1/churn?project=&component=&since=&until=&limit=` | `component` required | `200` — runs and changed-runs in the window, a `rate` per comparable band, and separate counts of collateral and rejected runs |
| `GET /v1/flakiness?project=&subject=&since=&until=&limit=` | `subject` required | `200` — sweeps, occurrences, absorbed runs, and a `rate` that is absent (not zero) when nothing swept |
| `GET /v1/value-journey?project=&token=&since=&until=&limit=` | `token` required | `200` — the token's recorded values, oldest first |
| `GET /v1/reach?project=&component=&since=&until=&limit=` | `component` required | `200` — subjects the component appeared in, and which of those are newly arrived |

`since`/`until` are ISO-8601 instants and `limit` a positive integer; all three
are optional on every `GET` route above. Whatever a `limit` excludes comes back
as an `omitted` count rather than silently shrinking a total.

Errors are `{"error": "..."}`: `400` for a malformed request, `404` for an
unknown path, `405` for the wrong method (with an `Allow` header), `409` when a
write conflicts with what is already stored, and `413` when a write exceeds
`maxBodyBytes`.

## Implementing another backend

`HistoryBackend` is the interface a custom store implements: append rows,
return rows, no arithmetic. Wire it straight into the HTTP service below, or
skip the socket and wrap it as a `HistoryStore` — the same interface
`@variance-authority/history`'s client and CLI call to read and write history,
whether it is backed by this socket or an in-process backend.

```ts
import { serveHistory, createBackedStore, type HistoryBackend } from '@variance-authority/server';

// Yours: rows in, rows out, no arithmetic. `HistoryBackend` names every method
// it has to answer, and none of them returns a number.
declare const backend: HistoryBackend;

const service = await serveHistory({ backend, token, port: 7788 });

// Or skip the socket: the same backend as a local `HistoryStore`, with the
// shared arithmetic already wrapped around it.
const store = createBackedStore(backend, 'my-project');
```

`serveHistory` takes:

| option | default | what it does |
|---|---|---|
| `backend` | required | the `HistoryBackend` that stores and returns rows |
| `token` | required | the bearer token clients must send; checked on every request |
| `port` | `7788` from the executable, `0` here | `0` binds an ephemeral port; the bound address is returned |
| `host` | `127.0.0.1` | the interface to bind; set it explicitly to listen beyond loopback |
| `maxBodyBytes` | 8 MiB | largest request body accepted; a larger write gets a `413` |

`createSqliteBackend` takes one: `path`, a file or `':memory:'` for a store that
ends with the process.

## Atomic writes

A run and its rows commit together or not at all: `POST /v1/observations`
either stores the whole write or none of it. Rows without their run would leave
a change with no denominator; a run without its rows would leave a quiet run
that was not quiet.

## Who writes to it

**A configured CLI, or a client you call yourself.** The service stores what is
posted to it and nothing else. `variance run` posts the run and its observations
when a `history` config block is present and the run can name itself — a run with
no identity writes nothing and says so — and `variance accept` posts approvals.
An empty database under a configured endpoint therefore means either that no run
could name itself, or that nothing in your pipeline has posted yet.
