---
"@variance-authority/cli": patch
"@variance-authority/sense": patch
---

`variance select` no longer skips a test that a partial run left out when a file it entered changed after it last ran. It reads each test from the commit `coverage.runs.json` says it last ran at, reads the files changed since then whole for that test, and prints a note for each such commit. When the runs record does not say where a test last ran, the note says which commit it was read from instead. `@variance-authority/sense/test-selection` exports this reading as `standsAt` and `readingFrom`, with `askPerStand`, `withoutFiles` and `wholeEntry`, and `yarn test:since` now uses the same code.
