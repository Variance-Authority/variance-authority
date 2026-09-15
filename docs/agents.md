# Choose an agent workflow

Start from the question your evidence can already answer. A completed run, a suite
that is still executing, and a workspace's current TypeScript source have
different owners and lifetimes, so they use different agent paths.

## Which question are you asking?

| Question | What the agent reads | Guide |
| --- | --- | --- |
| What did the last visual run observe, and what explains it? | The run report the CLI wrote, read from a shell | [Ask a run from the command line](agent-cli.md) |
| What does retained evidence say about a completed run or another recorded observation? | A supplied run report, execution index, archive, or other producer-owned evidence | [Question retained evidence over MCP](agent-mcp.md) |
| What is an executing suite doing, and where did one test stop making progress? | Process-local test lifecycle and announcement signals | [Inspect a live run](agent-live-run.md) |
| What is true at one moment inside a test, while the page is still up? | A test held at a call its author placed, and what it sent from there | [Interrogate a test where it stands](agent-interrogate.md) |
| What can one test be reduced to without losing the behavior it witnesses? | Eyes attention and/or a Sense execution index, followed by a counterfactual rerun | [Distil a test](distill.md) |
| What does this workspace publish, where is a symbol declared, and which packages import it? | Manifests and current TypeScript source | [Inspect the workspace public API](agent-workspace-api.md) |
| Where is a symbol already used here, and which story or test shows how to call it? | The imports in current TypeScript source | [Inspect the workspace public API](agent-workspace-api.md) |

These are alternate entrances, not stages of one workflow, and they ask from
one list: [everything an agent can ask](agent-questions.md) is the whole of it
in the order the shipped skill follows. A live signal does
not become retained evidence, and a public-API reading says nothing about what a
test executed.

## The shared boundary

The agent reads evidence or source supplied by another owner. These workflows
do not run tests, render subjects, approve baselines, invent a missing reading,
or treat unavailable evidence as an empty measurement. The producer remains
canonical for what was observed; the workspace remains canonical for what it
publishes.

If the question requires an observation and none exists, choose the process
that already owns the state in [choosing a composition](cases.md). A durable
rendered comparison can begin by [observing one state](start.md); a source
question needs no rendered observation.
