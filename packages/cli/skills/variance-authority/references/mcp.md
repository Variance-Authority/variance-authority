# Over an MCP connection

The questions in this skill also arrive as MCP tools: the run questions as
`variance_*`, the live ones from a watcher, and the workspace questions as
`docs_*`. The routing in `SKILL.md` is unchanged; read the row for the question
itself. Each tool returns the same text as the command, from the same function.

## The servers

All of them speak MCP over stdio.

```bash
variance serve [--config <path>] [--just-answer]    # @variance-authority/cli: the run's variance_* tools and the six docs_* tools
variance-authority-mcp <run-report.json>            # @variance-authority/mcp: the report is the argument
variance-authority-mcp --watch                      # the live run; prints its address to stderr
variance-authority-help [root] [--just-answer]      # @variance-authority/help: the six docs_* tools only
```

`variance serve` reads the report the config names. `--just-answer` applies to
the `docs_*` tools, as it does on the command line
([workspace API](workspace-api.md)).

`variance-authority-mcp` is the `bin` of `@variance-authority/mcp`, a transitive
dependency of the CLI, so its binary is on the package runner's path only when
that package is a direct devDependency. Where it is not, `variance serve` is the
same server over the same functions and needs nothing more installed.

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

`command` is found on `PATH`. `args` is a bare root and no verb, which is the
form that starts a stdio server. `.` is the directory the client starts the
process in, so use an absolute path if that is not the workspace. The server
reuses a generation for up to an hour, as the command does; add `--just-answer`
to `args` when the producer owns freshness and every call must only read the
published generation. Each tool response prints the generation time.

## Tool names and arguments

The six workspace tools are `docs_packages`, `docs_entrypoint`, `docs_symbol`,
`docs_uses`, `docs_search` and `docs_gaps`. They take their arguments under
their schema names (`package`, `subpath`, `name`, `query`, `from`, `to`), not as
positionals. Drop the `docs_` prefix and you have the verb.

A connection also serves questions the CLI does not ask:

- **Test distillation:** `variance_distill`, then `variance_test_attention` for
  the chronology or `variance_source_tests` for an exact source point. Read React
  update initiators before execution-only opportunities. See
  [distill](distill.md).
- **Changed tests:** `variance_changed_tests` is `variance covering --since`,
  taking the unified diff as an argument. See [covering](covering.md).
- **Observability:** ask `variance_observability` first when several domains are
  connected at once, to see which are present.
