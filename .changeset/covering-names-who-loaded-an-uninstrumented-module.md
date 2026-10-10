---
'@variance-authority/cli': minor
---

`covering` answers a module the run loaded without instrumenting it with the test files that loaded it

A module the run loaded without instrumenting it, such as one named in
`unprobed` or one whose text the run could not parse, was refused as if the run
never loaded it, while `variance select` selected every test file that loaded
it. `covering` now answers with those
files, in `preconditionOf`: each holds the module as a precondition, and a
change to it selects every one of them. No case and no line is named, because
nothing measured them. Under `--cases` or `--where`, only the test files of
the cases asked about are named. A file no test file loaded and no suite declares is
still refused, and a record whose coverage cannot be read is refused as unable
to say, not as never having loaded it.
