# @variance-authority/server

**Requires: a database and a socket.** `server/sqlite` requires `node:sqlite`
specifically.

The history service. The half of [spec 0002](../../docs/specs/0002-history-store.md)
that has state.

## First-party and self-hosted, and both words are load-bearing

**You run it.** A process, a port, and a token you set. Nothing in this
repository runs it for anyone, no instance is shared between operators, and
everything it stores was produced by your own runs. It neither reaches out nor
accepts a write it cannot attribute to its configured token.

`@variance-authority/history` holds the contract and the drift arithmetic and no
storage at all; this package holds a database and a socket and no arithmetic at
all. The line between them is what makes the record a **service**: two branches
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
npx variance-authority-server
```

`readConfig` refuses to start without a token, and refuses a short one. A history
service holds every observation every run has ever made about a codebase, and a
default-open port with a placeholder token is not a configuration mistake anybody
notices until it matters.

## Implementing another backend

```ts
import { serveHistory, createBackedStore, type HistoryBackend } from '@variance-authority/server';

const backend: HistoryBackend = { /* rows in, rows out — no arithmetic */ };
const service = await serveHistory({ backend, token, port: 7788 });
```

A backend answers with **rows**. Turning rows into churn, journeys and reach is
`churnFrom`/`journeyFrom`/`reachFrom`, shared by every backend, so two backends
cannot disagree about what a number means.

## Writes are one transaction

A run and its rows travel together and commit or fail together. Recording rows
whose run never landed leaves a change with no denominator; recording the run
without its rows leaves a quiet run that was not quiet.

## Status

Built and tested — the schema, the queries, the auth, the round trip through the
real client. **Nothing in the pipeline writes to it yet**: `variance run` does
not record observations, and `variance doctor` only reports whether a history
endpoint is configured.
