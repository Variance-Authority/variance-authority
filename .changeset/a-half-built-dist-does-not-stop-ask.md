---
'@variance-authority/cli': patch
---

`variance ask` answers when a package it does not call is half-built

`ask uses` and `ask symbol` read the source index, yet loading `ask` pulled in
the whole `run` command, and through it `@variance-authority/observe`,
`@variance-authority/png`, the raster store and the Storybook collector. A build
interrupted part way through any of those stopped every question with a stack
trace. `ask` now loads none of them. When a package the program itself runs on
is missing one of its built files, the program names the package and the file
and asks you to rebuild that package. It no longer reports a defect in the tool.
