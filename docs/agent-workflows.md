# Choose an agent workflow

Three questions with three different owners: a hung test belongs to a watcher, a
screenshot that changed to what a finished run left behind, and a symbol you
cannot name to your source. Only the last can be answered without a run behind
it. Each is matched below to the reading it needs, the route that reaches it, and
the guide that sets that reading up.

A shell and MCP are the two routes, and each question says which of them reaches
it. The shipped skill guides how an agent uses them alongside its own editor,
shell, and test runner. In the [test reduction workflow](distill.md#the-agent-loop),
the agent tries one reversible substitution, reruns the exact test, and compares
what it still exercises before keeping the change.

## Pick the question you are asking

The shell route is `npx variance`, for an agent that runs commands. The MCP route
is a server your client launches, for an agent that reaches tools only through
one. A row that names one route is out of reach of the other. Once you have your
row, [install what its route needs](#install-what-your-route-needs).

### A suite that is still running: the watcher owns it

| Your question | What the agent reads | Route | Guide |
| --- | --- | --- | --- |
| My suite is running now and one test is not finishing — what is it waiting on? | A watcher process tracking what each test has opened and announced, in memory only | Shell or MCP | [Inspect a suite while it is running](agent-live-run.md) |
| What is on the page at this exact line of my test, while it is still up? | A test stopped at a call its author wrote into the spec, and what it sent from there | MCP, which alone releases the test; a shell can read the stop | [Interrogate a test where it stands](agent-interrogate.md) |

### A run that finished: what it left behind owns it

| Your question | What the agent reads | Route | Guide |
| --- | --- | --- | --- |
| What changed in my UI on a run, mine or a CI artifact, an archive or a colleague's, and what changed it? | The report `npx variance run` wrote, or one you name, plus any [execution record](execution-record.md) — the file a run writes naming which source each test covered — or archive supplied with it | Shell or MCP | [From a shell](agent-cli.md), [over MCP](agent-mcp.md) |
| Why does this test fail, or fail only on some runs, and which value separates the runs? | A story of that one test, recorded by your wrapped Vitest, Jest or Rstest run, with the lines your code printed under each step | Shell | [Read what one test ran](test-stories.md) |
| Which tests does my edit need to run, and which first? | The execution record your wrapped Vitest or Jest runs keep, read by the runner when `VARIANCE_AUTHORITY_SINCE` is set | Shell | [Run the tests an edit needs](test-an-edit.md) |
| How much of this test can I delete without losing the behavior it witnesses? | One test's authored Arrange–Act–Assert attention from [Eyes](eyes.md) and its covered source from [Sense](../packages/sense), then a rerun that checks the cut | Shell; MCP only on a connection a producer supplies, not on the `variance-authority-mcp` command | [Distil a test](distill.md) |

### Your source: the checkout owns it

| Your question | What the agent reads | Route | Guide |
| --- | --- | --- | --- |
| What do my packages publish, and where is a given symbol declared? | My manifests and current TypeScript source | Shell or MCP | [Inspect the workspace public API](agent-workspace-api.md) |
| Where in my codebase is this symbol already imported, and which story or test shows how to call it? | The imports in my current TypeScript source | Shell or MCP | [Inspect the workspace public API](agent-workspace-api.md) |

These are alternate entrances, not stages of one workflow. A live signal never
becomes a stored report, and a reading of what your workspace publishes holds
nothing about what a test executed. The whole list, in the order the shipped
skill works through it, is [everything an agent can ask](agent-questions.md).

## Install what your route needs

| Your question is about | Shell | MCP |
| --- | --- | --- |
| Your source | `@variance-authority/cli` | `@variance-authority/cli`, which builds the index, and `@variance-authority/help` |
| A run or a running suite | `@variance-authority/cli` and a `variance.config.json` | `@variance-authority/mcp` |

Reading needs no browser on either route.

For your source, [connect your agent](agent-workspace-api.md#connect-your-agent)
prints the lines for both routes. They need no run and no config.

For a run or a running suite from a shell, install the CLI:

```bash
npm install --save-dev @variance-authority/cli
npx variance ask
```

The CLI installs as a devDependency, so every invocation is `npx variance`.
`npx variance ask` with no question lists each question, the arguments it takes,
and what it answers; it reads no configuration, so it works before any run exists.
A question about a run or a running suite loads `variance.config.json`, or the
file `--config` names, and exits 2 with neither.

For the same questions over MCP, install the server alone:

```bash
npm install --save-dev @variance-authority/mcp
```

It installs a `variance-authority-mcp` binary that your client launches with the
path to a report, or with `--watch` for a suite still running. It needs no CLI
and no config. The client configuration is in
[ask an agent about a finished run over MCP](agent-mcp.md) and
[inspect a suite while it is running](agent-live-run.md).

Both routes read a run and neither makes one. `npx variance run` writes the
report, and it is the step that takes a browser, with `npx playwright install
chromium`, and a config: [your first run](start.md) sets them up.

## What these workflows will not do

The agent reads evidence or source that something else owns. None of these
paths runs your tests, renders a subject, approves a baseline, invents a reading
that is missing, or reports unavailable evidence as a measurement of zero — an
absent domain comes back named as absent. Whatever produced the run stays
canonical for what was observed; your workspace stays canonical for what it
publishes.

If your question needs an observation and none exists yet, start from the state
you already have in [choose from the state you already have](cases.md), or take
the shortest path through [your first run](start.md). A question about source
needs no rendered observation at all.
