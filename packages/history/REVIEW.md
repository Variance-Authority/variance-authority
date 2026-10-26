# Reviewing `@variance-authority/history`

`history` holds the row contract for visual-regression observations kept across
runs, the arithmetic that answers churn, flakiness, reach and token drift over
them, and the HTTP client for `@variance-authority/server`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/history/`.

## Contracts

- **No store is a refusal, not an empty record.** `createAbsentStore` answers
  every question `{ kept: false, because }` and is told apart from a store
  keeping an empty record. Written in
  [README](README.md#when-no-store-is-configured) and pinned by
  [absent.test.ts](src/absent.test.ts) › "is distinguishable from a store that
  is keeping an empty record".
- **A transport failure throws.** A 500, a 401, a body missing a field the
  arithmetic needs, or a hung request throws; none resolves to an empty answer.
  Written in [README](README.md#call-the-service-from-your-own-code) and pinned
  by [client.test.ts](src/client.test.ts) › "throws on a transport failure
  rather than resolving to an empty churn".
- **A capped answer says it is capped.** Whatever a `limit` excludes is counted
  on the result; a drift journey with excluded values is never `null` and marks
  its totals as lower bounds. Written in [README](README.md#the-two-thresholds)
  and pinned by [drift.test.ts](src/drift.test.ts) › "is never null when a limit
  excluded values".
- **Rates divide by what asked.** Churn counts quiet runs in its denominator and
  sums only approved changes; flakiness divides by sweeps and reports no rate,
  never zero, when nothing swept; a window with no runs is unanswerable, not
  stable. Written in [README](README.md#the-four-questions) and pinned by
  [flakiness.test.ts](src/flakiness.test.ts) › "reports no rate at all when
  nothing ever swept, rather than zero".
- **Churn counts causes, not displacement.** A component whose geometry moved
  while its structure and style held accumulates nothing. Written in
  [README](README.md#the-four-questions) and pinned by
  [drift.test.ts](src/drift.test.ts) › "accumulates nothing for a component that
  is collateral in every run".
- **Rows never carry pixels.** No pixel, coordinate, rect or count is written,
  and no geometry row exists under a tier that cannot observe layout. Written in
  [README](README.md#what-is-recorded) and pinned by
  [observation.test.ts](src/observation.test.ts) › "records no pixel,
  coordinate, rect or count on any row".
- **Rows stay in their scope.** A row for another subject, component or project
  is refused, never blended into the answer. Pinned by
  [client.test.ts](src/client.test.ts) › "refuses to write rows belonging to
  another project".

## Where to look for a counterexample

- `src/token-drift.ts` and `src/drift.ts`: a unit change, a value that came
  back, a colour, and a slice out of time order.
- `src/observation.ts`: structure compares across tiers; style stays inside one.
- `src/client.ts`: a long subject list split across requests must concatenate
  every answer, and a repeated subject is asked once.

## Not this package's

- Storage, authentication and the database: `@variance-authority/server`.
