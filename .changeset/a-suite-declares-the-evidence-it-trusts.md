---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A suite declares the evidence selection trusts

A suite in `variance.config.json` takes `evidence`, one of `file`, `symbol`,
`file-use`, `function-use` and `region-use`, coarsest first. At `file` a test
runs when it imports a changed file through the graph; at `symbol`, when it
imports an export the change moved; at `file-use`, when it loaded a changed
file; at `function-use`, when it entered the function a changed line is in.
`file` and `symbol` also run every test `file-use` runs, so each step runs
every test a finer one does. The
default, `region-use`, is the region reading every suite already had. Recording
is the same at every step, so a team that starts coarse moves finer by editing
one key.

`file` and `symbol` read the import graph, so a suite declaring
`"relations": false` cannot declare them and the config is refused, as is any
other value. `narrowByExecution` takes the step as `evidence`,
`EVIDENCE_STEPS` lists them, and `byRelations` says whether one reads the graph.
