---
'@variance-authority/cli': minor
'@variance-authority/sense': patch
---

The mainline's record fetched last stands until a nearer one can exist, not
for 10 minutes. The line keeps only its newest record, and the nearest a
checkout can use is the one at `HEAD`'s merge base with the mainline. A record
at or past that merge base is read without asking the remote, and so is one
fetched while the merge base was the one it is now. After a pull or a rebase
moves the merge base, the line is asked once. `variance select` and
`test:since` therefore stop waiting on the remote every 10 minutes in an edit
loop, and every job of a CI run reads the same record however far apart the
jobs start.

`FetchedMainline.base` keeps the merge base the line was asked at, in
`fetched.json`. `earlier.reused` on a `MainlineRecord` says why the record
stands: `'nearest'` at or past the merge base, `'asked'` when the line was
asked at this merge base. The reader's note says the same. A line's answer
that it gave no record still stands for 10 minutes.
