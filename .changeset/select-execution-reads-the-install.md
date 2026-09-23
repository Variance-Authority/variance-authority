---
"@variance-authority/cli": minor
"@variance-authority/sense": minor
---

`variance select --execution` traces a changed lockfile to the tests it reaches, and refuses a list of paths.

A lockfile in the patch is compared as an install: the patch's `index` line names both blobs, git produces them, and every package that resolved differently is walked back through the packages resting on it to the files that import them. Those files' test files run, and so does every case the journey saw enter one of them. A lockfile the patch changes without naming its blobs keeps every test. `narrowByJourneys` and `selectJourneyFile` take the moved names as `packages`.

A journey file selects by changed lines, so `git diff --name-only` handed to `--execution` is refused with a pointer to `variance reach`, which answers a list of paths from the import graph.
