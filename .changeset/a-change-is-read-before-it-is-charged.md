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
