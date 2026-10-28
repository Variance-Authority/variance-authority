---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

`variance coverage --fan-in` counts how many test files called into each region: the test files an edit to it would run, leaving out those that only loaded it. Per suite kind, it prints how many regions only one test file ran and the median, 90th percentile and maximum test files per region. Three lists of ten files follow: the most regions only one test file ran, the most test files called into the file (as a share of the suites' test files and of their time), and the files selected whole for the most test files beyond what their median region needs. `--format json` lists every file under `fanIn`, and `--format markdown` prints the same for a job summary. `coverageFanIn` in `@variance-authority/sense/test-selection` makes the count.
