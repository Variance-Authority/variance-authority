<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/server

The history service. The half of [spec 0002](../../docs/specs/0002-history-store.md)
that has state: a socket that accepts observations and answers drift questions
about them, backed by a store you choose.

**Requires:** a port and a bearer token of at least 16 characters — it refuses to
start without the token. The shipped backend adds a Node with `node:sqlite` (22+,
where it is still experimental and warns on import) and a writable database path;
a backend you write yourself requires neither, and the entrypoint table below says
which is which.

## First-party and self-hosted, and both words are load-bearing

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

## Writes are one transaction

A run and its rows travel together and commit or fail together. Recording rows
whose run never landed leaves a change with no denominator; recording the run
without its rows leaves a quiet run that was not quiet.

## Who writes to it

**Only a client you call yourself.** The service stores what is posted to it and
nothing else: `variance run` records no observations, and `variance doctor`
reports only whether a history endpoint is configured. An empty database under a
configured endpoint is therefore the designed state, not a misconfiguration —
until something in your own pipeline posts a row, there is nothing to read back.
