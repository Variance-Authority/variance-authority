---
"@variance-authority/sense": patch
"@variance-authority/playwright-test": patch
---

A Vitest, Rstest, Jest or Playwright Test run removes the scratch it made and
nothing else. It no longer prunes the rest of the cache once a day as it ends,
so whichever run finished first no longer clears what other runs left. Run
`variance prune` to clear it, or let `variance run` do it at its end.
