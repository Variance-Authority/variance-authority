# Reviewing `@variance-authority/server`

## Contracts

- **No rule about an answer lives in SQL.** Written in
  [`src/answers.ts`](src/answers.ts).
- **Authentication comes before the path, and a secret before listening.**
  Pinned by [`src/http.test.ts`](src/http.test.ts) and
  [`src/bin.test.ts`](src/bin.test.ts).
- **A capped answer says so; `current` is never capped.** Written in
  [README](README.md#http-api) and
  [ADR-0031](../../docs/context/adr/0031-the-run-asks-what-is-recorded-now.md);
  pinned by [`src/backend-sqlite.test.ts`](src/backend-sqlite.test.ts).
- **Quiet runs are the denominator.** Pinned by
  [`src/backend-sqlite.test.ts`](src/backend-sqlite.test.ts).
- **Append-only, at the database.** Written in
  [README](README.md#what-it-keeps); pinned by
  [`src/backend-sqlite.test.ts`](src/backend-sqlite.test.ts).
- **A window compares instants, never text.** Pinned by
  [`src/backend-sqlite.test.ts`](src/backend-sqlite.test.ts).
- **Only approved runs ship a token value.** Pinned by
  [`src/backend-journey.test.ts`](src/backend-journey.test.ts).
- **An unknown schema is refused, never adopted.** Written in
  [README](README.md#upgrading).
- **A malformed write stores nothing.** Pinned by
  [`src/http-refusals.test.ts`](src/http-refusals.test.ts).
