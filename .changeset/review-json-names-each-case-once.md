---
'@variance-authority/cli': minor
---

`review.json` names each case once

A change that moves most of a suite enters most changed regions with most of its cases, and `review.json` wrote every case in full under every region it entered: 541 MB for a thousand commits of this repository, past what `--from-run` could read back. `review.json`, and `variance review --format json`, now carry `version: 2` and a `cases` list holding each case once, ordered by test file, title and id; a region's `called` lists the places in `cases` of the cases that entered it, and its `tests` are left out, being the test files of those cases. The same review is 56 MB. Places hold within one file: match cases on `id` to compare two reviews.

`--from-run` reads `review.json` a member at a time, so it reads a file larger than a single string holds, in this shape or in the one before, which has no `version`.

A reader written for the shape before — an older `variance review --from-run`, or a script reading `files[].regions[].called[].name` or `tests` — misreads this one: upgrade the CLI, and read a region's cases as `cases[called[i]]`.
