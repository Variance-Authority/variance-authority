# Inspect a suite while it is running

While your suite is running there is no file to open. The only account of which
tests have started, what each has announced, and which announced work has not
ended is in the memory of a watcher process that was listening at the time — so
start one before the suite, read it from a shell or an MCP client while the run
is in flight, and expect that account to end when the watcher does.

New here? Start with [your first run](start.md).

Use this when a test hangs and the runner's timeout tells you only what the
test *wanted*. Once a run has finished, ask its output instead:
[distill a completed test](distill.md) says what one test can show, and the
[execution record](execution-record.md) — the file a run writes naming which
source each test entered — says what ran.

## Report the run from your tests

Install the Playwright binding and extend your suite with `varianceFixtures`:

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

```ts
// tests/suite.ts
import { test } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

export const suite = test.extend(varianceFixtures);
```

Write tests with `suite` where you wrote `test`. The fixture reports test open
and close for every test it runs, including tests that take no screenshot and
destructure no fixture, so a listing has no holes.

## Start the watcher before the suite

A run in flight leaves no file behind, so something has to be listening before
the suite starts. Two entrances answer the same questions; take the one you
already have.

From a shell, with the CLI installed as a devDependency:

```bash
npm install --save-dev @variance-authority/cli
npx variance watch
```

From an MCP client, install the server and add it to the client's server list —
`claude_desktop_config.json` for Claude Desktop, or the equivalent file for any
other MCP client:

```bash
npm install --save-dev @variance-authority/mcp
```

```jsonc
// claude_desktop_config.json, or any MCP client's server list
{
  "mcpServers": {
    "variance-live": {
      "command": "variance-authority-mcp",
      "args": ["--watch"]
    }
  }
}
```

Both listeners print the same assignment:

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321
```

Copy the line the listener printed — the port differs per listener — and start
the suite with it in the environment:

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321 npx playwright test
```

`VARIANCE_AUTHORITY_VANTAGE` is a discovery address, not a project setting.
Unset, each worker performs one environment read and sends nothing. Set, it
names the watcher that owns this run. The listener takes an ephemeral loopback
port, so concurrent suites, editor sessions and agents do not claim the same
address. An address added after worker startup belongs to the next run.

## Ask the same questions from either entrance

Start with identity, then narrow to the test:

| Question | Shell | MCP |
| --- | --- | --- |
| Is this the watcher the suite reported to? | `npx variance ask self` | `variance_self` |
| Which tests opened, and which is still running? | `npx variance ask run-signals` | `variance_run_signals` |
| What did one test announce, in order? | `npx variance ask test-signals --test <id>` | `variance_test_signals` |
| What arrived since the previous reading? | `npx variance ask diff` | `variance_diff` |
| Which tests have stopped for me to look at them? | — | `variance_waiting` |
| Let a stopped test go on. | — | `variance_continue` |

`--at <address>` selects a watcher and defaults to
`VARIANCE_AUTHORITY_VANTAGE`. Ask `self` first: a suite reporting to a different
address and a suite that never started both look quiet to every other question.

The last two answer only under MCP. A shell command owns no run, so there is
nothing in it to release. They are the pair a test triggers with
`variance.snapshot()` and `await variance.observe()` — see [interrogate a test
where it stands](agent-interrogate.md).

A listed test with no announcements is a measured lifecycle with no application
signal, not a reconstructed empty trace. `test-signals` names the realm of each
announcement — where the reporting code ran, whether that is the browser page,
another process, or the runner's own — and pairs work starts with ends, so an
unmatched start is the place to continue diagnosis.

## Keep the lifetime honest

The watcher keeps a bounded number of entries and says when older ones were
dropped, so you can tell *nothing was announced* from *the beginning was
forgotten*. Its state does not alter the suite's retained evidence, and a
watcher that fails does not fail the test. Stop the watcher and the state is
gone.

When the question is about what a test queried, clicked, rendered or entered,
collect portable evidence and use [`npx variance distill`](distill.md). The full
route from a question to the evidence that answers it is in [everything an agent
can ask](agent-questions.md).

The shell contract is in the [`@variance-authority/cli`
reference](https://variance-authority.dev/reference/packages/cli), the stdio
contract in the [`@variance-authority/mcp`
reference](https://variance-authority.dev/reference/packages/mcp), and the
producing side in
[`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test).
