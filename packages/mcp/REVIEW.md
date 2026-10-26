# Reviewing `@variance-authority/mcp`

An MCP server over stdio that answers an agent's questions from evidence
something else produced: a run report, an execution index, a live suite, an Eyes
record. `variance-authority-mcp` and hosts that call `serve` start it; it reads
through `report`, `help`, `sense` and `vantage`, and owns none of their
contracts.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under `packages/mcp/`.

## Contracts

- **It never runs, renders or writes a baseline;** `variance_diff` keeps one
  value in the process. Pinned by
  [`src/server-diff.test.ts`](src/server-diff.test.ts) › "diffs against exactly
  the previous successful invocation".
- **A run with unobserved subjects never reads as clean.** An absent coverage
  list stays absent; an entry that is neither kind is refused, not defaulted.
  Written in the [README](README.md#coverage-boundary) and pinned by
  [`src/scenario.test.ts`](src/scenario.test.ts) › "never says \"nothing to
  review\" over a 50-subject hole" and "preserves an absent coverage list as
  absent, never as empty".
- **An answer comes from the subject as it is now.** `subject` is a function
  awaited per request. Written in the [README](README.md#serve-a-custom-subject)
  and pinned by [`src/mcp.test.ts`](src/mcp.test.ts) › "answers from the report
  as it is now, not as it was at boot".
- **`again` re-asks only a well-formed call.** An unknown tool or a missing
  argument is not asked again; what a tool threw is read from the call. Written
  in the [README](README.md#serve-a-custom-subject) and pinned by
  [`src/server-subject.test.ts`](src/server-subject.test.ts) › "is not asked
  again for a tool the server does not have, or a call missing an argument".
- **A start point without `root` is refused.** Written in the
  [README](README.md#answer-from-the-source-tree) and pinned by
  [`src/report-server-tree.test.ts`](src/report-server-tree.test.ts) › "refuses
  the question and tells the operator on stderr where the tree could not be
  read".
- **A missing domain is named with its producer, never manufactured empty.**
  Written in the [README](README.md#when-a-domain-is-unavailable) and pinned by
  [`src/tools/observability.test.ts`](src/tools/observability.test.ts) › "lifts
  native tools and refuses to manufacture an empty missing subject".
- **Nothing is recorded silently under a moved identity.** Pinned by
  [`src/tools/changelog.test.ts`](src/tools/changelog.test.ts) › "records
  nothing for a subject re-stamped under a moved identity, and says so".
- **`./tools` and `./protocol` are pure, and `.` loads no server until one
  starts.** Written in the [README](README.md#entrypoints) and pinned by
  [`src/root-entry.test.ts`](src/root-entry.test.ts) › "evaluates nothing a
  server reads until a server is started".

## Not this package's

- What a verdict or an adjudication means: `report` and `core`. Tool names and
  wording carry no compatibility promise, by the README's "Stability".
