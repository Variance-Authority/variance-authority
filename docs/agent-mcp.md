# Ask an agent about a finished run over MCP

A finished run leaves `.variance/report.json`, and an agent handed that file by
copy and paste only ever sees the part you pasted. Connected over MCP it reads
the whole report itself — what changed, and what changed it. The server answers
only from the report it is given: it never runs a test, re-renders a state, or
promotes a baseline.

New here? Start with [your first run](start.md). To give an agent your code with
no run and no config, [connect it to the source](agent-workspace-api.md#connect-your-agent).

## Produce a report first

Every tool on this page answers from one file, `.variance/report.json` by
default, and nothing in the MCP package writes it. The CLI does:

```bash
npm install --save-dev @variance-authority/cli
npx playwright install chromium
npx variance run --config variance.config.json
```

`variance run` writes the report at the path your config's `report` key names,
`.variance/report.json` unless you change it. Writing that config, and the
collector that mounts each UI state, is
[run visual review from the command line](start-cli.md).

The report contains one record per **subject** — one named UI state you asked for
and can ask for again, identified by a stable id such as `checkout/empty` or
`story:checkout--empty`.

## Serve the report to a client

Use Node 22.15 or newer. In the repository that holds the report, install the
package:

```bash
npm install --save-dev @variance-authority/mcp
```

A client launches `command` from its own `PATH`, where a local install puts
nothing, so both entries below go through `npx`. Which one you write depends on
the directory your client starts the server in, because `npx` looks for the
binary there and a relative report path is read from there.

### A client that starts in the repository

Claude Code starts a server in the repository it was opened in, and keeps its
list in `.mcp.json` at the repository root:

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

### A client that starts anywhere else

Claude Desktop may start a server in any directory, `/` among them. It keeps its
list in `~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Give that
entry your repository's absolute path twice, once for `npx` and once in the
report's path. It works from every directory, so write this one when your
client's documentation does not say where it starts:

```json
{
  "mcpServers": {
    "variance": {
      "command": "npx",
      "args": [
        "--prefix",
        "/path/to/repo",
        "variance-authority-mcp",
        "/path/to/repo/.variance/report.json"
      ]
    }
  }
}
```

### Check the connection

Check the entry before you open the client. The check launches it from the file
you wrote and asks for the tools, and it starts the server in the directory you
run it from, so run it where your client starts. In the repository, an entry that
works nowhere else passes. For a client that starts in the repository, run this
at the repository root:

```bash
npx @modelcontextprotocol/inspector --cli --config .mcp.json --server variance --method tools/list
```

For a client that starts anywhere else, run it from outside the repository and
name that client's file. For Claude Desktop on macOS:

```bash
cd / && npx @modelcontextprotocol/inspector --cli --config "$HOME/Library/Application Support/Claude/claude_desktop_config.json" --server variance --method tools/list
```

The answer lists these twelve:

```text
variance_summary variance_diff variance_changes variance_adjudicate
variance_composition variance_locate variance_variations variance_changelog
variance_describe variance_findings variance_trace_component
variance_explain_verdict
```

The server validates the report at startup and re-reads it before each request,
so a completed rerun is answered from the new report without reconnecting.

The same questions are available on the command line, where they need no client
and no server: [ask a run from the command line](agent-cli.md).

## Ask from the run outward

Ask in this order:

- **Begin a report-file session with `variance_summary`.** It accounts for
  planned subjects that were not observed as well as for the observations that
  produced a **verdict** — the one word reported per subject: `unchanged`,
  `changed`, `new` or `ignored` — so silence cannot be mistaken
  for a clean run.
- **If the summary names changes, ask `variance_changes` before opening an
  individual subject.** It groups shared causes across subjects.
- Narrow to a subject, component, finding, [composition](composition.md), or
  verdict explanation only when the question requires that detail.
- **After replacing the report with a completed rerun, ask `variance_diff`.** It
  compares the current supplied state with the one kept from the preceding
  successful tool call.

A question that names a thing rather than a subject id goes to
[`variance_locate`](locate.md). It finds subjects from a description over every
name the run wrote down — component, role, accessible name, visible text, file,
region, token — and each hit prints the field it matched on, so the order is
checkable and a wrong first hit costs one more call. `variance_composition`
with a `subject` then prints what that subject is made of. When the run recorded
no composition, both print that rather than matching nothing.

## Evidence other integrations supply

The standalone `variance-authority-mcp` executable reads the report file it is
given and nothing else; it does not look for other artifacts beside it.
Evidence another integration produced — a [source execution
index](source-index.md), a [presentation report](presentation.md), a [scenario
archive](scenarios.md) — is served by the connection that integration sets up,
and one connection can serve several kinds supplied independently.

On such a connection, begin instead with `variance_observability`. Its inventory
distinguishes evidence that was never supplied from evidence that was supplied
and measured zero members. Then ask the tool belonging to the evidence that can
answer the question; an answer that crosses two kinds joins only on exact
identities both producers emitted.

## Keep approval outside MCP

Some answers include an exact CLI command that could settle a reviewed visual
change. The MCP server returns that command as evidence and never executes it.
Baseline promotion remains an explicit action by the owner of the review loop,
and evidence the connection was never supplied with stays absent.

The complete server and tool contracts live in the
[`@variance-authority/mcp` package
reference](https://variance-authority.dev/reference/packages/mcp).
Continue from a report finding with [pixel-to-source
attribution](attribution.md), [suite composition](composition.md), or the
deeper [presentation](presentation.md) and [scenario](scenarios.md) evidence.
