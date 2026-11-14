---
'@variance-authority/sense': minor
'@variance-authority/vantage': minor
'@variance-authority/mcp': minor
'@variance-authority/cli': minor
---

`variance ask ran --story` shows what each function of a live execution was handed

A server head started with `VARIANCE_AUTHORITY_STORY=1`, beside `VARIANCE_AUTHORITY_JOURNEYS` and a watcher, now tapes each execution it reports to the watcher and sends its story with the account: the functions entered in order, their branches, and `» handed name=value` for the arguments each was handed, spelled as a test story spells them. It shows arguments only, never a local or module variable. Two requests that run at once are taped apart, and a request whose promises run on after it settled is told again with only what it ran since. Without the variable nothing is taped and nothing changes.

`variance ask ran --story` (`variance_ran` with `story: true`) prints those stories in place of each execution's regions, a step drawn as `variance story` draws it, with what the tape lost said above it. Asked of heads that told none, it says no head was started with `VARIANCE_AUTHORITY_STORY=1` and lists the regions as before. A page that calls `reportPage` tells no story yet.

`variance ask` takes a true-or-false tool argument as a bare flag. The watcher keeps the first 8 stories a head sent of an execution, up to 1 MiB, as `stories` on that head, and counts the rest as `untold`. `@variance-authority/sense/story` exports the reading `variance story` draws a route by, so both draw a step the same way.
