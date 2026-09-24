---
'@variance-authority/sense': minor
'@variance-authority/sense-darwin-arm64': minor
'@variance-authority/sense-linux-arm64-gnu': minor
'@variance-authority/sense-linux-x64-gnu': minor
'@variance-authority/sense-win32-x64-msvc': minor
---

An edit at a module's top level is now charged by what it does, not by the
lines it sits on. Before, any such edit selected every test that loaded the
module. With `sourceAt`, each changed file is read from the recorded text and
the text the diff makes of it, and gets one verdict. A comment, a type or
formatting selects nothing. A new function, or an edit inside one, selects the
tests that entered the changed regions. A changed top-level value, such as
`LIMIT = 10` becoming `20`, also selects the tests that entered a function
reading it, in the file or in a file that imports it. An edit that changes what
the module runs as it loads still selects every test that loaded it.

`narrowByExecution` returns `readings`, one per changed file: the verdict and
the names whose values moved, or why the file could not be read (`source`,
`hunk`, `parse` or `addon`). A test selected through a read carries a `reader`
reason naming the value, the file that declares it and the file that reads it.
`test:since` prints a line per reading.

A change travels by use. A new module selects nothing until something calls it,
and an import added to a file charges the functions that use its names, not
every test that loads the file. With `root`, the nearest `package.json` of a
changed file, and of every file an added or removed import loads that the file
did not already load, is asked for `sideEffects`: a declared file, or an
importer that starts or stops loading one, is read as `load`, and its reading
lists the declared files in `effects`. A test that loaded a changed module through no
importer the graph holds is listed in the reading's `unseen` and no longer
selected.
