---
'@variance-authority/cli': minor
---

`variance select --format json` says why each test file runs

`ground` names the reading the answer came from: `read`, or the reason none was
made (`no-journal`, `no-coverage`, `no-diff`, `no-install`), or `before` with
the changed files that moved what the suite rests on under `rests`. When the
record narrowed, `selected` lists each test file the change reached with the
positions of its reasons in `reasons`, which names each changed region,
precondition, reader or importer trail once, however many test files it
selected. `incomplete` lists the recorded test files not observed whole, which
run whatever changed.
