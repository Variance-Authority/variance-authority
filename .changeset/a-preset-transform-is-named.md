---
'@variance-authority/sense': patch
---

`withTestSelection` and `withJourneyCoverage` wrap the `transform` of a Jest
preset such as `ts-jest` when the object names none. The wrap's own pattern used
to match first, so the preset's transformer never ran and the first run failed
on syntax.

A transformer now loads from the project's `rootDir`, where Jest finds it, so one
installed only under a nested package needs no `require.resolve`.
