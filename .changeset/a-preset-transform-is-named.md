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

A preset only `import` can read, such as one with top-level await, is refused at
config load, by name, because the wrap is synchronous.
