# Inspect a live run

Use a watcher when the question exists only while a Playwright suite is
executing: which test is still running, what it has announced, and which work
began without finishing. The watcher holds process-local signals; it does not
create a run report.

## Instrument the suite before it starts

Use Node 22 or newer. The Playwright suite must extend
`varianceFixtures` from `@variance-authority/playwright-test`; those fixtures
already include the live-run reporter.

```ts
import { test as base } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

export const test = base.extend(varianceFixtures);
```

Compose this into the suite's existing shared fixture module. Do not create a
second `test` export when the suite already extends `varianceFixtures`.

## Start the watcher first

Something must be listening before the suite starts, because nothing else keeps
what the suite says. Two things can listen: the CLI, which needs a shell and no
configuration, and the MCP server, for a client that speaks it. They hold the
same state and answer with the same text; choose by what the agent has
already.

From a shell:

```bash
npx variance watch
```

It prints the listener address as a `VARIANCE_AUTHORITY_VANTAGE` assignment and
stays up until it is interrupted.

For an MCP client, install the server where the client can launch it:

```bash
npm install @variance-authority/mcp
```

Configure a separate live connection:

```json
{
  "mcpServers": {
    "variance-live": {
      "command": "npx",
      "args": ["variance-authority-mcp", "--watch"]
    }
  }
}
```

When the connection initializes, its instructions contain the same assignment.

Start the suite with that exact address already present. The port below is
illustrative; replace the complete URL with the one from the current watcher:

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321 npx playwright test
```

An address added after the suite starts belongs to the next run. With the
fixture and address connected, every test reports its open and close lifecycle,
including tests that take no screenshot and destructure no event fixture.

## Locate the stalled work

Ask `self` first. It reports where the watcher is listening and how much it
holds, which is how a suite that reported to a different address is told apart
from one that never started — a distinction every other question is blind to.

Then `run-signals`: it lists tests in opening order and marks the one still
running. Use the test id it returns with `test-signals` to read that test's
announcements in order, the realm that sent each one, and work that started
without a matching end. Ask `diff` when the useful question is what changed
since the preceding successful call.

```bash
npx variance ask self
npx variance ask run-signals
npx variance ask test-signals --test '<id>'
```

`--at <address>` names the watcher and defaults to `VARIANCE_AUTHORITY_VANTAGE`,
so a shell that exports it for the suite needs no flag. An MCP client asks the
same four as `variance_self`, `variance_run_signals`, `variance_test_signals`
and `variance_diff`.

No announcements for a listed test are a wiring or application signal, not a
fabricated empty trace. The listing itself establishes whether the suite
reached the watcher before interpreting silence inside one test.

## Preserve the lifetime boundary

The watcher is bounded and says when older entries were dropped. Its state is
not written to disk, does not alter the suite's evidence, and disappears with
the watcher process. Observer failure does not fail the test subject. When the
question must survive the process, inspect a completed artifact through the
[retained-evidence workflow](agent-mcp.md).

The shell contract lives in the [`@variance-authority/cli` watch
reference](../packages/cli/README.md#watch-ask-about-a-suite-that-has-not-finished),
the stdio one in the [`@variance-authority/mcp` watch
reference](../packages/mcp/README.md#watch-a-suite-that-has-not-finished).
The producing boundary is described by
[`@variance-authority/playwright-test`](../packages/playwright-test/README.md#watch-the-run-from-outside-it),
and the process-local store by
[`@variance-authority/vantage`](../packages/vantage/README.md#under-playwright-and-under-an-agent).
