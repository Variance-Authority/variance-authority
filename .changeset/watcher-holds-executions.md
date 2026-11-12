---
'@variance-authority/wire': minor
'@variance-authority/sense': minor
'@variance-authority/vantage': minor
'@variance-authority/mcp': minor
'@variance-authority/cli': minor
---

`variance ask ran --at <address>` and the MCP tool `variance_ran` list what an application used by hand ran: one execution per request no test drove, each with the regions it ran as `file:line name`.

An application reports when its build places the probes, its request handler runs inside `collectJourneys().enter`, and it is started with `VARIANCE_AUTHORITY_JOURNEYS=1` and the watcher's address in `VARIANCE_AUTHORITY_VANTAGE`. A head given an address it cannot report to refuses to start. `--name`, `--file` and `--limit` narrow the listing, and `variance ask self` counts the executions a watcher holds.

A question only a watcher answers (`self`, `run-signals`, `test-signals`, `waiting`, `ran`) no longer reads `variance.config.json`, so it can be asked where no visual suite was configured.
