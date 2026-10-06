---
'@variance-authority/cli': patch
---

`variance select --format vitest` now narrows a vitest 2 run. It wrote every
exclusion as an absolute path, which vitest 2 matches against nothing, so the
substituted run was the whole suite. The exclusions now take the form the
installed vitest matches: relative to the repository on vitest 2, absolute from
vitest 3 on.

Each exclusion also escapes the glob characters in its path, so it excludes the
one file it names: `test/cart[1].test.ts` no longer also excludes
`test/cart1.test.ts`, and on vitest 2 `app/(shop)/page.test.ts`, or a name with a
backslash outside Windows, is excluded at
all.
