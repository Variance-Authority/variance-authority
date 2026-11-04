# Inspect a suite while it is running

While your suite is running there is no file to open. The only account of which
tests have started, what each has announced, and which announced work has not
ended is in the memory of a watcher process that was listening at the time — so
start one before the suite, read it from a shell or an MCP client while the run
is in flight, and expect that account to end when the watcher does.

New here? Start with [your first run](start.md).

Use this when a test hangs and the runner's timeout tells you only what the
test was waiting for. Once a run has finished, ask its output instead:
[distill a completed test](distill.md) says what one test can show, and the
[execution record](execution-record.md) — the file a run writes naming which
source each test covered — records what ran.

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

From an MCP client, install the server and add it to the client's server list,
which is `.mcp.json` at the repository root for Claude Code. [A client that
starts anywhere else](#a-client-that-starts-anywhere-else), such as Claude
Desktop, takes the entry at the end of this section.

```bash
npm install --save-dev @variance-authority/mcp
```

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

You run no command to start it: the client starts the server when it connects to
its servers, so open the client, or restart it if it was open. The watcher lasts
as long as that connection, and a restarted client is a new watcher at a new
address.

`variance watch` prints the assignment in its terminal. The MCP server's start-up
line goes to the client, which may not show it, so ask your agent to call
`variance_self`. Its answer opens with the same assignment:

```text
Nothing has reported to this vantage yet.

A run reports here when it is started with this in its environment:

  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321
```

Copy the line your listener gave you — the port differs per listener — and start
the suite with it in the environment, from any shell:

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321 npx playwright test
```

`VARIANCE_AUTHORITY_VANTAGE` is a discovery address, not a project setting.
Unset, each worker performs one environment read and sends nothing. Set, it
names the watcher that owns this run. The listener takes an ephemeral loopback
port, so concurrent suites, editor sessions and agents do not claim the same
address. An address added after worker startup belongs to the next run.

### A client that starts anywhere else

`npx` looks for the binary in the directory the client starts the server in. A
client that starts anywhere else, such as Claude Desktop, needs your repository's
path in [its own file](agent-mcp.md#a-client-that-starts-anywhere-else):

```json
{
  "mcpServers": {
    "variance-live": {
      "command": "npx",
      "args": ["--prefix", "/path/to/repo", "variance-authority-mcp", "--watch"]
    }
  }
}
```

## Ask the same questions from either entrance

Start with identity, then narrow to the test:

| Question | Shell | MCP |
| --- | --- | --- |
| Is this the watcher the suite reported to? | `npx variance ask self` | `variance_self` |
| Which tests opened, and which is still running? | `npx variance ask run-signals` | `variance_run_signals` |
| What did one test announce, in order? | `npx variance ask test-signals --test <id>` | `variance_test_signals` |
| What arrived since the previous reading? | `npx variance ask diff` | `variance_diff` |
| Which tests have stopped for me to look at them? | `npx variance ask waiting` | `variance_waiting` |
| Let a stopped test go on. | — | `variance_continue` |

The last row answers only under MCP. A shell command owns no run, so there is
nothing in it to release. The last two rows are the pair a test triggers with
`variance.snapshot()` and `await variance.observe()` — see [interrogate a test
where it stands](agent-interrogate.md).

`--at <address>` selects a watcher and defaults to
`VARIANCE_AUTHORITY_VANTAGE`. Each shell question also loads a config it never
reads, so it needs a valid `variance.config.json` in the directory or
`--config <path>`, and exits 2 with neither. `variance watch` and the MCP tools
need no config.

Ask `self` first: a suite reporting to a different address and a suite that never
started both look quiet to every other question. Once a suite has reported, `self`
opens by counting its tests:

```text
Watching 2 test(s): 2 passed.
```

An answer that still opens `Nothing has reported to this vantage yet.` while the
suite runs means the suite has another address, or none. The listing then names
each test, with how many announcements it has heard:

```text
2 test(s) at http://127.0.0.1:54321 — 2 passed.

  passed      the cart opens — tests/checkout.spec.ts — worker 0 — heard 0
  passed      the upsell stays away — tests/checkout.spec.ts — worker 0 — heard 1
```

The fixture gives every test its open and close, and no announcements. An
announcement comes from your application: a call to `vae` from
[`@variance-authority/event`](https://variance-authority.dev/reference/packages/event)
at a decision, heard by a test that takes the `events` fixture. A test missing
either half lists with `heard 0`: a measured lifecycle with no application
signal, not a reconstructed empty trace. `test-signals` names the realm of each
announcement — where the reporting code ran, whether that is the browser page,
another process, or the runner's own — and pairs work starts with ends, so an
unmatched start is the place to continue diagnosis.

## Keep the lifetime honest

The watcher's state is limited in four ways:

- **The watcher keeps a bounded number of entries.** It reports when older ones
  were dropped, so you can tell *nothing was announced* from *the beginning was
  forgotten*.
- Its state does not alter the suite's retained evidence.
- A watcher that fails does not fail the test.
- Stop the watcher and the state is gone.

When the question is about what a test queried, clicked, rendered or covered,
collect portable evidence and use [`npx variance distill`](distill.md). The full
route from a question to the evidence that answers it is in [everything an agent
can ask](agent-questions.md).

The shell contract is in the [`@variance-authority/cli`
reference](https://variance-authority.dev/reference/packages/cli), the stdio
contract in the [`@variance-authority/mcp`
reference](https://variance-authority.dev/reference/packages/mcp), and the
producing side in
[`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test).
