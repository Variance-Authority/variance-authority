---
'@variance-authority/sense': patch
---

`withTestSelection` and `withJourneyCoverage` wrap the `transform` of a Jest
preset such as `ts-jest`, merged with the object's as Jest merges them. The
wrap's own pattern used to match first, so the preset's transformer never ran and
the first run failed on syntax, and a preset's other patterns beside an object's
`transform` ran without probes.

A transformer now loads from the project's `rootDir`, where Jest finds it, so one
installed only under a nested package needs no `require.resolve`, and `<rootDir>`
in its name is replaced as Jest replaces it.

A preset Jest awaits, such as one with top-level await or one that exports a
promise, is refused at config load, by name, because the wrap is synchronous.
Under a relative `rootDir`, a preset spelled as a path, starting with `.` or
`<rootDir>`, is refused the same way whether or not it is found, and so is a bare
name that is not found. The refusal says to write an absolute `rootDir`: Jest
reads a relative one from the config file, whose directory the wrap is never
told, so a file found from elsewhere may not be the one Jest runs. Any `preset`,
with or without a `transform`, is refused too when `jest-resolve` is not reachable
from that directory.

`transform: undefined` or `transform: null` beside a preset wraps Jest's default,
because Jest reads either as shadowing the preset's `transform`.
