---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`variance covering` ends every answer about a file, a line or a function with how far it holds for that file: its frame, then where and when the test files it names last ran.

```
src/pay.ts differs from the text the suite ran over; its lines are placed in the text as it is now. An edit since the recording touched `pay`: its cases ran another text of it.
The test file named here last ran at 1fa19f610e2a, a commit made 9 hours ago, over another text of src/pay.ts, which changed between that commit and 9cf65a4e2631.
```

The ran line is read per test file from the runs record beside the snapshot: a run that record holds is dated by when it landed, any other is read as having run at its commit's time, and a test file that ran over another text of the asked file is named. `--since` prints the same line under its regions, and its `Read from` line ends `; the record names no commit.` when the record names none.

The frame is printed on `--function` answers too. Under `mapped`, a `--function` answer prints whether an edit touched the function, and marks the parts no case ran that an edit touched as `edited`. Under `stale`, `--function` names the function's cases and leaves out the parts no case ran, since no recorded line is a place in the text you hold. A row the build did not instrument is framed by its digest like any other, a file held as a precondition is `recorded` or `differs` by the texts its test files ran, a file the record holds no digest of is printed as not known, and a file not on disk is answered in the record's lines.

In JSON, `at` is the record's commit on every answer whose record names one, `ran` holds the stands the ran line is read from, `frame` is on `--function` answers and can be `differs`, `moved: true` marks a `--function` answer and each `unrun` part an edit touched, and `unheld: true` a file not on disk. `@variance-authority/sense` exports `committedAt`, the committer time of a commit, `false` when the clone does not hold it, or why git could not date it.
