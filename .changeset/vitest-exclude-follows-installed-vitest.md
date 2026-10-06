---
'@variance-authority/cli': patch
---

`variance select --format vitest` now narrows a vitest 2 run. It wrote every
exclusion as an absolute path, which vitest 2 matches against nothing, so the
substituted run was the whole suite. The exclusions now take the form the
installed vitest matches: relative to the repository on vitest 2, absolute from
vitest 3 on.
