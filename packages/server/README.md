<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/server

> A self-hosted HTTP history service for Variance Authority observations and approvals.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

Run this package when a pipeline needs a self-hosted HTTP history service. It
accepts observations and approvals, stores them in a backend, and answers the
history queries defined by `@variance-authority/history`.

**Requires:** a port and a bearer token of at least 16 characters — it refuses to
start without the token. The shipped backend adds a Node with `node:sqlite` (22+,
where it is still experimental and warns on import) and a writable database path;
a backend you write yourself requires neither, and the entrypoint table below says
which is which.

This is an operator-run service, not a hosted endpoint. Nothing in this package
starts it for another project or provisions a database.

## Deployment model

**You run it.** A process, a port, and a token you set. Nothing in this
repository runs it for anyone, no instance is shared between operators, and every
row in it was posted by your own code — see [who writes to it](#who-writes-to-it),
because that is not `variance run`. It neither reaches out nor accepts a write it
cannot attribute to its configured token.

`@variance-authority/history` holds the client-side contract and drift arithmetic
and no storage at all; this package holds a database and a socket, and the
row→answer arithmetic that every backend shares. **A backend itself does no
arithmetic** — it appends and returns rows, and `churnFrom`/`journeyFrom`/
`reachFrom` turn those into numbers here, so two backends cannot disagree about
what a number means. The line between the packages is what makes the record a
**service**: two branches
observing different hashes for one key are two rows, and nothing here has to
resolve a merge, because nothing here is a file anybody reviews.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | a socket | `HistoryBackend`, the row→answer arithmetic, `serveHistory` |
| `./sqlite` | `node:sqlite` | `createSqliteBackend`, `SCHEMA_VERSION` |
| `./bin` | both | `readConfig`, `start` — what the executable runs |

The split is the point of the package layout applied to itself: an operator
backing this with Postgres implements `HistoryBackend` and should **never load
`node:sqlite`**.

## Running it

```bash
VARIANCE_HISTORY_TOKEN=<at least 16 characters> \
VARIANCE_HISTORY_DB=/srv/variance/history.db \
VARIANCE_HISTORY_PORT=7788 \
npx variance-authority-server
```

`VARIANCE_HISTORY_PORT` defaults to `7788` and `VARIANCE_HISTORY_HOST` to
`127.0.0.1`; the token has no default, which is the point.

`readConfig` refuses to start without a token, and refuses a short one. A history
service holds every observation every run has ever made about a codebase, and a
default-open port with a placeholder token is not a configuration mistake anybody
notices until it matters.

## Implementing another backend

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

A backend answers with **rows**. Turning rows into churn, journeys and reach is
`churnFrom`/`journeyFrom`/`reachFrom`, shared by every backend, so two backends
cannot disagree about what a number means.

`serveHistory` takes:

| option | default | what it decides |
|---|---|---|
| `backend` | required | rows in, rows out. The one thing the socket does not implement |
| `token` | required | the bearer the operator set. There is exactly one, it is shared, and it carries no identity: the service holds no accounts and everything in it was produced by the operator's own runs. Not *who are you* — *is this write attributable to this deployment at all* |
| `port` | `7788` from the executable, `0` here | `0` binds an ephemeral port and returns its selected address |
| `host` | `127.0.0.1` | a history service that binds every interface the moment it starts is one misconfigured firewall away from being a public record of an unreleased product's internals. Making the operator ask for it is one line of configuration against a failure with no symptom |
| `maxBodyBytes` | 8 MiB | a ceiling on memory held for one socket, not a limit anyone should reach — 300 subjects write a handful of hundred-byte rows. Exceeding it is a 413 that says so, never a truncated body parsed as far as it went |

`createSqliteBackend` takes one: `path`, a file or `':memory:'` for a store that
ends with the process.

## Atomic writes

A run and its rows travel together and commit or fail together. Recording rows
whose run never landed leaves a change with no denominator; recording the run
without its rows leaves a quiet run that was not quiet.

## Who writes to it

**A configured CLI, or a client you call yourself.** The service stores what is
posted to it and nothing else. `variance run` posts the run and its observations
when a `history` config block is present and the run can name itself — a run with
no identity writes nothing and says so — and `variance accept` posts approvals.
An empty database under a configured endpoint therefore means either that no run
could name itself, or that nothing in your pipeline has posted yet.
