# Inspect a suite while it is running

A live run answers a narrow question: which tests have opened, what each test
has announced, and which announced work has not ended. The evidence lives in a
watcher process and disappears with it. It is useful before a completed report,
[Eyes](eyes.md) archive or [execution index](execution-record.md) exists.

This is distinct from [distilling a completed test](distill.md). Live signals
locate a stall; retained attention and execution evidence explain the test's
authored AAA surface and reduction opportunities.

## Connect the producer

Extend the suite's Playwright test with `varianceFixtures`. The fixture reports
test open and close lifecycle for every test, including tests that take no
screenshot and destructure no event fixture.

Start the watcher before the suite. Choose the entrance the agent already has:

```bash
# Shell entrance
variance watch
```

```json
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

Start the suite with the complete assignment in its environment. An address
added after worker startup belongs to the next run.

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321 npx playwright test
```

`VARIANCE_AUTHORITY_VANTAGE` is an opt-in capability and a discovery address,
not a project setting. Unset, each worker performs one environment read and
sends nothing. Set, it names the watcher that owns this run. The listener uses
an ephemeral loopback port so concurrent suites, editor sessions and agents do
not claim the same address. A constant port is technically possible, but it
would trade the copied assignment for collision handling and would still need
an opt-in signal to preserve observer-free runs.

## Ask the same questions from either entrance

Start with identity, then narrow to the test:

| Question | Shell | MCP |
| --- | --- | --- |
| Is this the watcher the suite reached? | `variance ask self` | `variance_self` |
| Which tests opened, and which is still running? | `variance ask run-signals` | `variance_run_signals` |
| What did one test announce, in order? | `variance ask test-signals --test <id>` | `variance_test_signals` |
| What arrived since the previous reading? | `variance ask diff` | `variance_diff` |
| Which tests have stopped for me to look at them? | — | `variance_waiting` |
| Let a stopped test go on. | — | `variance_continue` |

`--at <address>` selects a watcher and defaults to
`VARIANCE_AUTHORITY_VANTAGE`. Ask `self` first: a suite reporting to a different
address and a suite that never started both look quiet to every other question.

The last two answer only under MCP. A CLI process holds no run, so there is
nothing in it to release, and they are the pair a spec reaches with
`variance.snapshot()` and `await variance.observe()` — see [interrogate a test
where it stands](agent-interrogate.md).

A listed test with no announcements is a measured lifecycle with no application
signal. It is not a reconstructed empty trace. `test-signals` preserves the
realm of each announcement and pairs work starts with ends, so the unmatched
start is the place to continue diagnosis.

## Keep the lifetime honest

The watcher is bounded and reports when older entries were dropped. Its state
does not alter the suite's retained evidence, and observer failure does not fail
the test subject. Stop the watcher and the state is gone.

When the question is about what a test queried, clicked, rendered or entered,
collect portable evidence and use [`variance distill`](distill.md). The full
question routing across report, live, attention and execution evidence is in
[everything an agent can ask](agent-questions.md).

The shell contract lives in the [`@variance-authority/cli` watch
reference](../packages/cli/README.md#watch-ask-about-a-suite-that-has-not-finished),
the stdio contract in the [`@variance-authority/mcp` watch
reference](../packages/mcp/README.md#watch-a-suite-that-has-not-finished), and
the producing boundary in
[`@variance-authority/playwright-test`](../packages/playwright-test/README.md#watch-the-run-from-outside-it).
