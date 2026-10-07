---
'@variance-authority/sense': patch
---

A selection reads the recorded texts of the files it checks, and not the rest of the diff

`narrowByExecution` checks each changed module that has a recorded row against
the text at the record's commit. Before, the reader from `textAtRecording`
fetched texts over the whole diff. It read files that no test ran and that
nothing would ask about, so it started more `git cat-file` processes than the
check needed. Now the selection passes `sourceAt` a third argument, `asking`.
It holds every changed path the selection reads a text under, and it is
complete before the first ask. The reader fetches those paths together and
nothing else. On a diff where most changed files have no row, `variance select`
starts fewer `git` processes, and its answer is the same. A `sourceAt` you
write yourself can ignore `asking`.
