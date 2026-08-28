---
'@variance-authority/sense': minor
---

Record what a driven page executed, so Storybook and Playwright select like Vitest.

The execution selector had one origin: a Vitest run instrumented its own modules
and wrote them down in the same process. A page cannot do that — the names and
spans that make a block ordinal mean something are produced by whichever process
ran the bundler, and for a driven run that process finished on Monday. So the
two halves are now written separately and joined by the driver.
`testSelectionProbes()` instruments product source in the adopter's own build
and persists the block inventory; the collector it hoists counts crossings in the
page; `recordExecution` merges drained journals into the same coverage
index, with the same probes and the same ordinals.

`@variance-authority/storybook-collector` records with `tests`, where a story is
its own owner because this tool shows one at a time.
`@variance-authority/playwright-test` records with the `varianceExecution`
fixture option or `tests` on `createVariance`, where every observation in one
spec file joins that file, because the file is the runner's unit of execution.
Module-kind blocks go to every subject the run drained, since a module
initializes once per page and charging it to whichever subject was first would
leave the rest unselected by an edit they all read. Workers merge under a lock on
the index. A missing inventory, a foreign probe recipe, and a page with no
collector each record nothing and say why.
