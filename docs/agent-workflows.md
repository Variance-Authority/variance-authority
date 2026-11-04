# Choose an agent workflow

Three questions with three different owners: a hung test belongs to a watcher, a
screenshot that changed to what a finished run left behind, and a symbol you
cannot name to your source. Only the last can be answered without a run behind
it. Each is matched below to the reading it needs, the route that reaches it, and
the guide that sets that reading up.

A shell and MCP are the two routes, and each question says which of them reaches
it. The shell route is `npx variance`. The MCP route is two servers your client
launches: `variance-authority-help` answers about your source and
`variance-authority-mcp` about a run, so a client that asks about both lists
both. The shipped skill guides how an agent uses them alongside its own editor,
shell, and test runner.

## Pick the question you are asking

An agent that can run commands takes the shell, even when it also speaks MCP: the
shell reaches more rows, and MCP joins it for the one step only MCP takes,
releasing a stopped test. An agent that reaches tools only through MCP takes the
rows that name MCP. A row that names one route alone is out of reach of the
other, and a row that splits says what each route keeps. Once you have your row,
[install what its route needs](#install-what-your-route-needs).

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
| How much of this test can I delete without losing the behavior it witnesses? | What one test touches as it arranges, acts and asserts, from [Eyes](eyes.md), and the source it covered, from [Sense](../packages/sense), then a rerun that checks the cut | Shell; over MCP only from a server you host on [`@variance-authority/mcp`](../packages/mcp), since neither server above carries it | [Distil a test](distill.md) |

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

| Your question is about | What must exist first | Shell | MCP |
| --- | --- | --- | --- |
| Your source | A git repository | `@variance-authority/cli` | `@variance-authority/cli` and `@variance-authority/help` |
| A finished run | A report | `@variance-authority/cli` and a `variance.config.json` | `@variance-authority/mcp` |
| A running suite | A suite that reports to a watcher | `@variance-authority/cli` and a `variance.config.json` | `@variance-authority/mcp` |

For your source over MCP, install both packages and build the index:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/help
npx variance index
```

Your client then launches `npx variance-authority-help .`. `variance index` reads
your source into the [workspace index](agent-workspace-api.md) outside your
tracked files. The server answers about a name without it, and only the code map
waits for it. [Connect your agent](agent-workspace-api.md#connect-your-agent)
prints each route's lines and the check for them. They need no run and no config.

Both routes read a run and neither makes one. `npx variance run`, from the CLI,
writes the report, and it is the step that takes a browser, with `npx playwright
install chromium`, and a config: [your first run](start.md) sets them up. Reading
takes no browser on either route. A running suite reports only when it extends
`varianceFixtures` and starts with `VARIANCE_AUTHORITY_VANTAGE` set to the
watcher's address: [inspect a suite while it is running](agent-live-run.md) sets
up both ends.

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
path to a report, or with `--watch` to start a watcher for a suite still running.
Reading needs neither the CLI nor a config. The client configuration is in
[ask an agent about a finished run over MCP](agent-mcp.md) and
[inspect a suite while it is running](agent-live-run.md).

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
