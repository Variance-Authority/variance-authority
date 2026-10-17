---
'@variance-authority/mcp': patch
---

Importing a pure function from `@variance-authority/mcp` no longer loads the servers beside it

The root entry exports `locateSubjects` and `readEyesRecord` beside `serve` and
the `serve*` functions, and Node evaluates every static import of an entry. So
`import { locateSubjects } from '@variance-authority/mcp'` used to evaluate
every served tool set, the run report reader, Eyes, the execution-index reader
and the live-run listener: about 400 modules, where `locateSubjects` needs 11.
Each of those is now imported by the function that reads it, when it is called:
`serveReportFile`, `serveEyesRecord`, `serveVantage` and `readEyesRecord`. The
root entry evaluates 15 modules, and `@variance-authority/help`, which serves
through `serve`, evaluates about 65 fewer.

Nothing you call changes: every name is where it was, and each `serve*`
function was already async. `serve` still starts synchronously; it reads only
the framing, which `@variance-authority/mcp/protocol` exports as before.
