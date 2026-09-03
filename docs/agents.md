# Choose an agent workflow

Start from the question whose evidence already exists. A completed run, a suite
that is still executing, and a workspace's current TypeScript source have
different owners and lifetimes, so they use different agent paths.

## Which question are you asking?

| Question | What the agent reads | Guide |
| --- | --- | --- |
| What does retained evidence say about a completed run or another recorded observation? | A supplied run report, execution index, archive, or other producer-owned evidence | [Question retained evidence over MCP](agent-mcp.md) |
| What is an executing suite doing, and where did one test stop making progress? | Process-local test lifecycle and announcement signals | [Inspect a live run](agent-live-run.md) |
| What does this workspace publish, where is a symbol declared, and which packages import it? | Manifests and current TypeScript source | [Inspect the workspace public API](agent-workspace-api.md) |

These are alternate entrances, not stages of one workflow. A live signal does
not become retained evidence, and a public-API reading says nothing about what a
test executed.

## The shared boundary

The agent reads evidence or source supplied by another owner. These workflows
do not run tests, render subjects, approve baselines, invent a missing reading,
or treat unavailable evidence as an empty measurement. The producer remains
canonical for what was observed; the workspace remains canonical for what it
publishes.

If there is no observation to inspect yet, first [put one state through a
complete review loop](start.md). Once evidence exists, return here and choose
the question its lifetime can answer.
