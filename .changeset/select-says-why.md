---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance select --format json` says why each test file runs

`ground` names the reading the answer came from: `read`, or the reason none was
made (`no-journal`, `no-coverage`, `no-diff`, `no-install`), or `before` with
the changed files that moved what the suite rests on under `rests`. When the
record narrowed, `selected` lists each test file the change reached with the
positions of its reasons in `reasons`, which names each changed region,
precondition, reader or importer trail once, however many test files it
selected; a journey file's reading names no reasons and carries neither list.
`incomplete`, when the record keeps one, lists the recorded test files not
observed whole, which run whatever changed. `install.files` names each file a
bump or a moved manifest changed whole, with `through`, the chain from the
bumped package, so a region reason on a file the diff never touched joins to
the bump that reached it.

`ExecutionNarrowing.because` is absent from a journey file's reading, which
names the tests it reached and not why, where it was an empty list.
