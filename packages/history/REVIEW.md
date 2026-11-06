# Reviewing `@variance-authority/history`

## Contracts

- **No store is a refusal, not an empty record.** Written in
  [README](README.md#when-no-store-is-configured); pinned by
  [absent.test.ts](src/absent.test.ts).
- **A transport failure throws.** Written in
  [README](README.md#call-the-service-from-your-own-code); pinned by
  [client.test.ts](src/client.test.ts).
- **A capped answer says it is capped.** Written in
  [README](README.md#the-two-thresholds); pinned by
  [drift.test.ts](src/drift.test.ts).
- **Rates divide by what asked.** Written in
  [README](README.md#the-four-questions); pinned by
  [flakiness.test.ts](src/flakiness.test.ts).
- **Churn counts causes, not displacement.** Written in
  [README](README.md#the-four-questions); pinned by
  [drift.test.ts](src/drift.test.ts).
- **Rows never carry pixels.** Written in [README](README.md#what-is-recorded);
  pinned by [observation.test.ts](src/observation.test.ts).
- **Rows stay in their scope.** Pinned by [client.test.ts](src/client.test.ts).
