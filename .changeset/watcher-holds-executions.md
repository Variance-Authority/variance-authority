---
'@variance-authority/wire': minor
'@variance-authority/sense': minor
'@variance-authority/vantage': minor
'@variance-authority/mcp': minor
'@variance-authority/cli': minor
---

`variance ask ran --at <address>` and the MCP tool `variance_ran` list what an application used by hand ran: one execution per request no test drove, each with the regions it ran as `file:line name`.

An application reports when its build places the probes, its request handler runs inside `collectJourneys().enter`, and it is started with the watcher's address in `VARIANCE_AUTHORITY_VANTAGE`. That address alone now turns the head on. `--name`, `--file` and `--limit` narrow the listing, and `variance ask self` counts the executions a watcher holds.
