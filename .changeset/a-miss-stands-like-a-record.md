---
'@variance-authority/cli': minor
---

A mainline that gave no record is not asked again for 10 minutes, the same
window a fetched record is reused for. The window used to hold only for a
remote that did not answer. It now also holds when the line has no record for
the suite, or has one this version cannot keep. Within the window, every reader
gets the same answer as the first. A record published in the meantime is read
after the window closes, not halfway through a sitting or a CI run.
`MainlineMissed.asked` and `earlier.asked` on a `MainlineRecord` give the time
the line answered, and the reader's note includes it. An unreachable miss no
longer appends that time to its `detail`.

`readMissedMainline` and `writeMissedMainline` read and write that answer under
a suite's read root. A job that is handed another job's read root can then
stamp the answer as given now. `MissedMainline` is its type.
