---
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

A workspace whose members sit outside its directory is read from an index of what it lists

Some workspaces list members outside their own directory, such as a product in
a monorepo that lists packages from the repository's other top-level
directories. The questions `variance ask` answers about such a workspace
covered every top-level directory that held a member. In one product that came
to 316,034 files, read again on every `variance index` because nothing kept
them. The reading now covers what the `workspaces` list names: the workspace's
own directory and each listed member directory. A file elsewhere in the
repository that imports one of its packages is no longer counted as a use.
`variance index` keeps a source index over that scope next to the workspace's
own, updates it as it updates the workspace's, and answers the questions from
it. In that product, `variance index` after an edit went from 59–62 s to 15 s.

`updateSourceIndex` takes `dirs`, the directories the index covers, and
`primary`, the generation a missing index starts from.
