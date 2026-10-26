# Reviewing `@variance-authority/server`

The self-hosted history service: it stores the runs, observations, token values,
instabilities and approvals a pipeline posts and answers HTTP questions over
them. `variance run` and `variance accept` post through the client in
`@variance-authority/history`; this package owns the database, the socket and
the row-to-answer rules every `HistoryBackend` shares.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/server/`.

## Contracts

- **No rule about an answer lives in SQL.** A backend appends and returns rows;
  what counts is decided once, in `src/answers.ts`. Written in the JSDoc of
  [`src/answers.ts`](src/answers.ts).
- **Authentication comes before the path, and a secret before listening.**
  Pinned by [`src/http.test.ts`](src/http.test.ts) › "answers an unknown path
  to an unauthenticated caller exactly as it answers a real one" and
  [`src/bin.test.ts`](src/bin.test.ts) › "refuses a port that is not a port
  instead of falling back to a default".
- **A capped answer says so; `current` is never capped.** `limit` moves rows
  into `omitted`; `current` above 200 subjects is `400`, not trimmed. Written
  in the [README](README.md#http-api) and
  [ADR-0031](../../docs/context/adr/0031-the-run-asks-what-is-recorded-now.md);
  pinned by [`src/backend-sqlite.test.ts`](src/backend-sqlite.test.ts) ›
  "counts a row whose run a limit cut away rather than crediting it to a
  missing denominator".
- **Quiet runs are the denominator.** Every `(run, profile)` has a row. Pinned
  by [`src/backend-sqlite.test.ts`](src/backend-sqlite.test.ts) › "counts quiet
  runs in the churn denominator and the same history without them does not".
- **Append-only, at the database.** `UPDATE` and `DELETE` abort; the same run
  twice is one; a run id at a second commit is `409`. Written in the
  [README](README.md#what-it-keeps) and pinned by
  [`src/backend-sqlite.test.ts`](src/backend-sqlite.test.ts) › "refuses a
  second write that claims a different commit for one run id".
- **A window compares instants, never text.** Pinned by
  [`src/backend-sqlite.test.ts`](src/backend-sqlite.test.ts) › "compares a
  window as instants, so a row from another offset is not dropped".
- **Only approved runs ship a token value.** Pinned by
  [`src/backend-journey.test.ts`](src/backend-journey.test.ts) › "excludes a
  token value from a run nobody approved".
- **An unknown schema is refused, never adopted.** Written in the
  [README](README.md#upgrading).
- **A malformed write stores nothing.** Pinned by
  [`src/http-refusals.test.ts`](src/http-refusals.test.ts) › "refuses a row
  with an unknown band and stores nothing from that write".

## Where to look for a counterexample

- `src/sqlite-queries.ts`: a `WHERE` that decides what counts, a `limit`
  applied before a join so `omitted` undercounts, a bound compared as a string.
- `src/sqlite-schema.ts`: a migration that rewrites a row, or bumps the version
  outside its transaction.

## Not this package's

- The wire types, the client, splitting a long subject list, churn and drift
  arithmetic: `@variance-authority/history`.
