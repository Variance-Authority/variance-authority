---
'@variance-authority/cli': patch
---

Past the reuse window, `variance select` answers from the mainline record it fetched last

After the 10 minutes a fetched mainline record is reused, `variance select`
waited for the share to answer before it printed anything: about 2.5 s for a
`git` share over SSH, on every command in an edit loop that outlasted the
window. Outside CI it now answers from the record fetched last, and starts
`variance share --suite <name>` as a process of its own to fetch the mainline's
record again. The note prints that process's id and the file its output goes
to, and the command run after it ends reads the record it fetched. A lock in
the suite's read root keeps a second command from starting a second process
while one runs; a lock whose process is gone is taken over.

The first fetch, with nothing fetched earlier, is made before the answer. In
CI, and for every caller of the library, every fetch is made before the answer,
so each job handed the read root reads the same record.
