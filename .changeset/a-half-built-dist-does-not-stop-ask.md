---
'@variance-authority/cli': patch
---

`variance ask` answers when a package it does not call is half-built

`ask uses` and `ask symbol` read the source index, yet loading `ask` pulled in
the whole `run` command, and through it `@variance-authority/observe`,
`@variance-authority/png`, the raster store and the Storybook collector. A build
interrupted part way through any of those stopped every question with a stack
trace. `ask` now loads none of them. When a module the program loads for a
command was never written, the program names the package and the missing file
and asks you to rebuild that package, or to reinstall it when it is installed
under `node_modules`, instead of reporting a defect in the tool. An output left
empty or cut short still reports a defect.
