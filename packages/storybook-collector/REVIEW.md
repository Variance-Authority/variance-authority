# Reviewing `@variance-authority/storybook-collector`

## Contracts

- **A width keeps its story's baseline.** Written in
  [src/parameters.ts](src/parameters.ts); pinned by
  [src/parameters.test.ts](src/parameters.test.ts).
- **Unread parameters are incomplete, not empty.** Pinned by
  [src/parameters.test.ts](src/parameters.test.ts).
- **Alone reads what the shared world reads.** Written in
  [src/read.ts](src/read.ts).
- **No fallback capture.** Written in [README › Readiness and
  loading](README.md#readiness-and-loading).
- **One row per width, timed by the page.** Written in [README › Skipping
  stories nothing touched](README.md#skipping-stories-nothing-touched); pinned
  by [src/execution.test.ts](src/execution.test.ts).
- **A story file is named from the checkout.** Pinned by
  [src/execution.test.ts](src/execution.test.ts).
- **Probes once, after every loader, only where the collector drives.** Written
  in [README › Skipping stories nothing
  touched](README.md#skipping-stories-nothing-touched); pinned by
  [src/preset.test.ts](src/preset.test.ts).
