# Reviewing `@variance-authority/storybook-collector`

The collector `variance run` loads for a Storybook: it serves or reaches the
preview, shows each story through `@variance-authority/storybook`, reads it
through `@variance-authority/playwright`, and, with `tests`, records what each
story executed. Its preset places the probes in the Storybook build.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/storybook-collector/`.

## Contracts

- **A width keeps its story's baseline.** Each declared width is a subject of
  its own; a story read again alone comes back at the width it declares now, and
  a width it no longer declares is refused. Written in the JSDoc of `realize` in
  [src/parameters.ts](src/parameters.ts); pinned by
  [src/parameters.test.ts](src/parameters.test.ts) › "refuses a width the story
  no longer declares, rather than reading it at a size nothing asked for".
- **Unread parameters are incomplete, not empty.** A story whose parameters
  could not be read is read at the run viewport with a warning and marked
  incomplete. Pinned by [src/parameters.test.ts](src/parameters.test.ts) › "says
  the story may be more than it read when its parameters were not read".
- **Alone reads what the shared world reads.** `collect` and `collectAlone`
  share one `Reading`, base URL included. Written in the JSDoc of
  [src/read.ts](src/read.ts).
- **No fallback capture.** A missing `ready` marker, an open Suspense boundary
  or a `loading` story that settled is refused, never captured. Written in
  [README › Readiness and loading](README.md#readiness-and-loading).
- **One row per width, timed by the page.** Each width is its own row with its
  own phases. Written in [README › Skipping stories nothing
  touched](README.md#skipping-stories-nothing-touched); pinned by
  [src/execution.test.ts](src/execution.test.ts) › "records each width a story
  is read at as its own row, with its own figures".
- **A story file is named from the checkout.** A recorded path is relative to
  the repository, not to where Storybook ran. Pinned by
  [src/execution.test.ts](src/execution.test.ts) › "names a story file from the
  checkout, not from where Storybook ran".
- **Probes once, after every loader, only where the collector drives.** The
  preset probes `--test` and dev builds, nothing published and nothing inside
  Vitest; it refuses a hand-placed probes rule and adds no second Vite plugin.
  Written in [README › Skipping stories nothing
  touched](README.md#skipping-stories-nothing-touched); pinned by
  [src/preset.test.ts](src/preset.test.ts) › "which builds the addon probes".

## Not this package's

- Index parsing, readiness and the `storyFinished` wait:
  `@variance-authority/storybook`.
- Placing probes and cutting regions: `@variance-authority/sense`.
