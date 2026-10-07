---
"@variance-authority/sense": patch
---

A recorded Vitest 4.1 run no longer prints `Importing from "vitest/runners" is
deprecated since Vitest 4.1` once for each test file. The case runner extends
the `TestRunner` that Vitest 4.1 exports from `vitest`, and imports
`vitest/runners` only on Vitest 2, 3 and 4.0, whose root does not export it.
