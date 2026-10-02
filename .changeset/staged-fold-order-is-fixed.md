---
"@variance-authority/sense": patch
---

A run whose workers finish in a different order now folds the same way. The test-file journals Jest and Vitest workers write, the trees a Vitest case runner writes, and the contributions staged Playwright and Jest workers leave were read in whatever order the file system listed them, and the fold sums durations, joins what each case said it arranged and keeps one fixture digest per name in the order it reads. The same run could record a different duration, precondition or head order each time it ran. Each is now read in an order decided by what it holds, which no worker's finishing time changes.
