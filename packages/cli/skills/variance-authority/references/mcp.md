# Over an MCP connection

The questions in this skill also arrive as MCP tools: the run questions as
`variance_*`, the live ones from a watcher, and the workspace questions as
`docs_*`. The routing in `SKILL.md` is unchanged; read the row for the question
itself. Each tool returns the same text as the command, from the same function.

## The servers

All of them speak MCP over stdio.

```bash
variance serve [--config <path>] [--just-answer]    # @variance-authority/cli: the run's variance_* tools, variance_costs, variance_decisions, variance_concerns and the docs_* tools
variance-authority-mcp <run-report.json>            # @variance-authority/mcp: the report is the argument
variance-authority-mcp --watch                      # the live run; prints its address to stderr
variance-authority-help [root] [--just-answer]      # @variance-authority/help: the docs_* tools only
```

`variance serve` reads the report the config names. Its `--just-answer`
affects only the `docs_*` tools ([workspace API](workspace-api.md)).

`variance-authority-mcp` and `variance-authority-help` are the `bin`s of
`@variance-authority/mcp` and `@variance-authority/help`. Both are dependencies
of the CLI, so their binaries are on the package runner's path only when the
package is also a direct devDependency. Where it is not, `variance serve` is the
same server over the same functions; it needs `variance.config.json`, as every
`variance` command that reads a run does.

## Writing the client config

In an MCP client's `command` field, write the installed binary, its resolved
path or a package script. A package runner there costs a registry check on
every client start.

```json
{
  "mcpServers": {
    "workspace-api": {
      "command": "variance-authority-help",
      "args": ["."]
    }
  }
}
```

`command` must resolve the installed binary. `args` is a bare root and no verb,
which is the form that starts a stdio server. `.` is the directory the client
starts the process in, so pass the workspace's absolute path if that is not the
workspace. The server key, `workspace-api` here, is yours to name.

## Tool names and arguments

| Name | What it is | Where it appears |
| --- | --- | --- |
| `@variance-authority/help` | the npm package | a manifest, a package runner |
| `variance-authority-help` | the binary that package installs | a shell, an MCP `command` |
| `docs_packages`, `docs_search`, … | the MCP tool names | an MCP client's tool list |

Drop the `docs_` prefix and turn `_` into `-`, and you have the `variance ask`
verb: `docs_slowest_tests` is `slowest-tests`, `docs_journey_map` is
`journey-map`. A tool takes its arguments under their schema names — `package`,
`subpath`, `name`, `query`, `from`, `to`, `limit`, `offset`, `files`, `area`,
`file` — not as positionals. `files` is an array.

## Tools no binary serves

`variance_distill`, `variance_test_attention`, `variance_source_tests`,
`variance_changed_tests` and `variance_observability` belong to the
`OBSERVABILITY` tool set that `@variance-authority/mcp/protocol` exports. None
of the servers above serves them. A host serves them by passing that set to
`serve` from `@variance-authority/mcp` with its own `ObservabilitySubject`, as
the package README shows. On such a connection, ask `variance_observability`
first to see which domains are present; [distill](distill.md) and
[covering](covering.md) own the questions behind the others.
