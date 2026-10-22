---
"@variance-authority/sense": minor
---

`withTestSelection` from `@variance-authority/sense/vitest` runs under Vitest 5, and the peer range now includes `^5.0.0`. The case runner reaches Vitest 5's `TestRunner` through `vitest` itself, and asks Vitest's own manifest whether it ships `@vitest/runner` rather than taking whichever copy resolves. A module the seam probes is kept out of Vitest's file-system module cache, which Vitest 5 turns on by default and Vitest 4.1 offers as `fsModuleCache`: a cached module skipped the probe and the record refused it as a module without a source identity.
