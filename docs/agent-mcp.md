# Question retained evidence over MCP

Connect an MCP client after the evidence exists. The server turns a supplied
run report or evidence held by its producing integration into answers; it does
not collect the evidence, rerender a subject, or approve a result.

## Start from the evidence owner

A run report has a standalone server. Other retained domains, including source
execution indexes, test-attention archives, presentation reports, and scenario
archives, remain with the integration that produced them. That integration can
serve one domain or combine independently supplied domains through the MCP
package's observability surface.

The standalone `variance-authority-mcp` executable does not discover those
other artifacts beside a report file. Use it for a run report; use the
producer's MCP connection for evidence the producer holds.

The report tools are also questions on the command line, where they need no
client and no server: [ask a run from the command line](agent-cli.md). Connect a
client when the evidence is held by a producer, or when the agent in the loop
speaks MCP already.

## Serve a completed run report

Use Node 22 or newer. From the directory in which the MCP client will launch the
server, install the package and make the report path available:

```bash
npm install @variance-authority/mcp
```

For the default CLI report location, configure the client with:

```json
{
  "mcpServers": {
    "variance": {
      "command": "npx",
      "args": ["variance-authority-mcp", ".variance/report.json"]
    }
  }
}
```

The relative report path is resolved from the server process's working
directory. Use the actual report path, or an absolute path, when the client
starts elsewhere. The server validates the report at startup and re-reads it
before each request, so a completed rerun is visible without reconnecting.

## Ask from the run outward

Begin a report-file session with `variance_summary`. It accounts for planned
subjects that were not observed as well as the observations that produced a
verdict, so silence cannot be mistaken for a clean run.

If the summary names changes, ask `variance_changes` before opening an
individual subject. It groups shared causes across subjects. Narrow to a
subject, component, finding, composition, or verdict explanation only when the
question requires that detail. After replacing the report with a completed
rerun, `variance_diff` compares the current supplied report with the subject
held from the preceding successful tool call.

On a connection that serves several observability domains, begin instead with
`variance_observability`. Its inventory distinguishes an unavailable domain
from one that was supplied and measured zero members. Then ask the native tool
for the domain that can answer the question; cross-domain answers join only on
exact identities emitted by both producers.

## Keep approval outside MCP

Some answers include an exact CLI command that could settle a reviewed visual
change. The MCP server returns that command as evidence and never executes it.
Baseline promotion remains an explicit action by the owner of the review loop,
and evidence the connection was not supplied remains absent.

The complete server and tool contracts live in the
[`@variance-authority/mcp` package reference](../packages/mcp/README.md).
Continue from a report finding with [pixel-to-source
attribution](attribution.md), [suite composition](composition.md), or the
producer's deeper [presentation](presentation.md) and [scenario](scenarios.md)
evidence models.
