---
'@variance-authority/sense': patch
---

`withTestSelection` and `withJourneyCoverage` wrap the `transform` of a Jest
preset such as `ts-jest`. The wrap's own pattern used to match first, so the
preset's transformer never ran and the first run failed on syntax. A `transform`
in the object merges with the preset's as in Jest, and a preset that says
`transform: {}` runs plain JavaScript. A preset whose patterns take no scripts
keeps its probes: scripts are instrumented directly after its patterns.

A transformer now loads from the project's `rootDir`, with `<rootDir>` in its name
replaced, as Jest does it, so one installed only under a nested package needs no
`require.resolve`. A preset with top-level await no longer fails the run: stderr
names it and says to spell out `transform`. A run no longer fails on the
`require.cache` entry a JSON file leaves when it is reached through `import`.
