---
'@variance-authority/cli': minor
---

Add `variance coverage --format html`: the coverage answer as one
self-contained page to open in a browser. It shows each suite's regions run,
run only at load and loaded, with what changed them since the base. It shows
what each kind of test runs alone and what several share, every package with
its files and the test files that enter each, and every directory no suite
loads. It counts `--packages` and `--fan-in` without being asked; with
`--from` it counts that one directory. The review action's new
`coverage-page: 'true'` input uploads the page unzipped and links it from the
comment and the step summary.
