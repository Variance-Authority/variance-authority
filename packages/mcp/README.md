# @variance-authority/mcp

**Requires:** a run report that already exists, and a client that speaks MCP over
stdio. It never runs anything itself.

The chain the rest of this repository builds ends at a sentence: a cause, a
place, and a file. This package puts that sentence somewhere an agent can reach
it **after the fact** — from a different process, without access to whatever was
in scope when the change was sensed.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | stdio | everything, plus `serve` and `serveReportFile` |
| `./tools` | nothing | the answers, as pure functions from a report to text |
| `./protocol` | nothing | MCP framing, as a pure function from a request to a response |

Two of the three halves are pure, and that is deliberate. The question that
matters — *does this actually help an agent fix it?* — has to stay cheap to ask,
and it stops being asked the moment answering it requires speaking a protocol
over a pipe.

What a run *wrote* is not here either. The report format is
[`@variance-authority/report`](../report), because it has several readers and a
format owned by one of them bends towards that one.

## Running it

```bash
npx variance serve            # via the CLI, reading .variance/run.json
npx variance-authority-mcp .variance/run.json    # directly
```

```jsonc
// claude_desktop_config.json, or any MCP client
{
  "mcpServers": {
    "variance": { "command": "npx", "args": ["variance-authority-mcp", ".variance/run.json"] }
  }
}
```

## What an agent can ask

Four tools, all answering from the artifact and **never re-running anything**.
The run may have happened on a pinned machine in CI an hour ago; the questions
are asked wherever the agent is.

```ts
import { toolByName } from '@variance-authority/mcp/tools';

toolByName('variance_summary')?.run(report, {});
toolByName('variance_describe')?.run(report, { subject: 'story:card--populated' });
toolByName('variance_trace_component')?.run(report, { component: 'Button' });
toolByName('variance_explain_verdict')?.run(report, { subject: 'story:card--populated' });
```

## The failure it is built to refuse

An agent told **"no changes"** concludes the product is fine. If what actually
happened is that eleven subjects failed to render, that sentence is a lie the
agent will act on — and unlike a human reading a dashboard, it has nothing else
to check against.

So the summary accounts for every subject including the ones nobody observed, and
a run with unobserved subjects never reads as clean. `notObserved` distinguishes
`excluded` from `failed`, and a malformed entry is refused rather than defaulted:
guessing `excluded` turns a coverage hole into a decision somebody made, and
guessing `failed` turns every deliberate exclusion into a permanently red build.

## Honest limit

**This layer has never served a real agent.** Four tools shaped by argument about
what an agent needs, tested against text rather than against an agent that used
them and either fixed the thing or did not.
