# Choose an agent workflow

**[Variance Authority](README.md)** is a visual regression system you run yourself: it
renders a UI state, compares it against the baseline you approved, and reports
what changed in the vocabulary of your source — the component that drew the
pixels and the `file:line` it was written at.

This page is the entrance to the agent side of it. Pick the question you want
answered and it sends you to the guide that answers it. What an agent gets here
that a pixel diff does not give it: a run report it can query by name rather
than look at, and two live entrances no report file has — a suite that is still
executing, and a test held at one line with its page still up.

Every answer below is keyed by a **subject** — one named UI state you asked for
and can ask for again, identified by a stable id such as `checkout/empty` or
`story:checkout--empty`.

## Get a shell entrance in three commands

```bash
npm install --save-dev @variance-authority/cli
npx playwright install chromium
npx variance ask
```

The CLI installs as a devDependency, so every invocation is `npx variance`.
`npx variance ask` with no question lists each question a finished run can be
asked, the arguments it takes, and what it answers; it reads no configuration,
so it works before any run exists. Producing the run those questions read is
[your first run](start.md).

For an agent that speaks MCP rather than a shell, the server is a second
package:

```bash
npm install --save-dev @variance-authority/mcp
```

It installs a `variance-authority-mcp` binary that your client launches with the
path to a report. The client configuration is in
[ask an agent about a finished run over MCP](agent-mcp.md).

## Pick the question you are asking

A finished run, a suite that is still executing, and your current TypeScript
source have different owners and different lifetimes, so each is read by a
different path.

| Your question | What the agent reads | Guide |
| --- | --- | --- |
| What changed in my UI on the last run, and what changed it? | The report `npx variance run` wrote, read from a shell | [Ask a run from the command line](agent-cli.md) |
| What does a report I did not produce say — a CI artifact, an archive, a colleague's run? | A report handed to the server, plus any [execution record](execution-record.md) — the file a run writes naming which source each test entered — or archive supplied with it | [Ask about a finished run over MCP](agent-mcp.md) |
| My suite is running now and one test is not finishing — what is it waiting on? | A watcher process holding what each test has opened and announced, in memory only | [Inspect a suite while it is running](agent-live-run.md) |
| What is on the page at this exact line of my test, while it is still up? | A test stopped at a call its author wrote into the spec, and what it sent from there | [Interrogate a test where it stands](agent-interrogate.md) |
| How much of this test can I delete without losing the behavior it witnesses? | One test's authored Arrange–Act–Assert attention from [Eyes](eyes.md) and its entered source from [Sense](../packages/sense), then a rerun that checks the cut | [Distil a test](distill.md) |
| What do my packages publish, and where is a given symbol declared? | My manifests and current TypeScript source | [Inspect the workspace public API](agent-workspace-api.md) |
| Where in my codebase is this symbol already imported, and which story or test shows how to call it? | The imports in my current TypeScript source | [Inspect the workspace public API](agent-workspace-api.md) |

These are alternate entrances, not stages of one workflow. A live signal never
becomes a stored report, and a reading of what your workspace publishes says
nothing about what a test executed. The whole list, in the order the shipped
skill works through it, is [everything an agent can ask](agent-questions.md).

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
