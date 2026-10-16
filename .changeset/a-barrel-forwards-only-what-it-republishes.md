---
'@variance-authority/core': patch
'@variance-authority/sense': patch
---

At `symbol` precision, a barrel passes on only the names it republishes

Suppose the walk reaches a file whole: it was changed and its exports could
not be read, or it imports a name that moved. A barrel that re-exports that
file used to be entered whole too, so every test importing any name from the
barrel was selected. Now the barrel carries only the names it republishes from
the file, and a test that imports the barrel's other names is no longer
selected for that change.

Anything the file does when it loads still reaches those tests. They can only
feel it by loading the file, and the record selects every test that did. That
holds only for a changed file every build the record holds instrumented, so a
change that touches a file with no row, or one a build left uninstrumented,
still enters the barrel whole.
`export *` from a file reached whole still enters the barrel whole, because
the graph does not list the names it republishes.

`affectedBy` takes `loadsRecorded` to opt in, a claim that a record holds
every file that loaded each seed. A walk that no record backs,
such as `variance reach`, leaves it off and still enters the barrel whole.
