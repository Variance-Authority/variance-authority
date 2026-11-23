---
'@variance-authority/cli': minor
---

Add `variance coverage --format html`: the coverage answer as one
self-contained page to open in a browser. It shows each suite's regions run,
run only at load and loaded, with what changed them since the base. It shows
what each kind of test runs alone and what several share, and every directory
no suite loads; with `--packages` every package with its files, and with
`--fan-in` the test files that cover each. The review action's new
`coverage-page: 'true'` input uploads the page unzipped and links it from the
comment and the step summary.
