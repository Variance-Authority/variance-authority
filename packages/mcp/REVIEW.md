# Reviewing `@variance-authority/mcp`

## Contracts

- **It never runs tests, re-renders anything or changes a baseline.** Written in
  [README](README.md).
- **A run with unobserved subjects never reads as clean.** Written in
  [README](README.md#coverage-boundary); pinned by
  [`src/scenario.test.ts`](src/scenario.test.ts).
- **An answer comes from the subject as it is now.** Written in
  [README](README.md#serve-a-custom-subject); pinned by
  [`src/mcp.test.ts`](src/mcp.test.ts).
- **`again` re-asks only a well-formed call.** Written in
  [README](README.md#serve-a-custom-subject); pinned by
  [`src/server-subject.test.ts`](src/server-subject.test.ts).
- **A start point without `root` is refused.** Written in
  [README](README.md#answer-from-the-source-tree); pinned by
  [`src/report-server-tree.test.ts`](src/report-server-tree.test.ts).
- **A missing domain is named with its producer, never manufactured empty.**
  Written in [README](README.md#when-a-domain-is-unavailable); pinned by
  [`src/tools/observability.test.ts`](src/tools/observability.test.ts).
- **Nothing is recorded silently under a moved identity.** Pinned by
  [`src/tools/changelog.test.ts`](src/tools/changelog.test.ts).
- **`./tools` and `./protocol` are pure, and `.` loads no server until one
  starts.** Written in [README](README.md#entrypoints); pinned by
  [`src/root-entry.test.ts`](src/root-entry.test.ts).
