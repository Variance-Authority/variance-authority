---
'@variance-authority/sense': patch
---

Record one coverage row for a subject the run read twice.

Stabilization reads a subject again whenever the first read was not trusted, so
a changed or unstable subject reaches `recordExecution` twice. It built one
`CoverageTest` per observation and keyed them by owner, and the encoder refuses
to intern two rows under one name: every second run of a moving Storybook suite
died with `duplicate test coverage observation` and wrote no journal, which is a
selection index that silently stops existing exactly when the suite starts
moving.

`recordExecution` now folds its subjects through `joinObservations` before
anything reads them — the same join `@variance-authority/playwright-test`
already applied at its call site and `@variance-authority/storybook-collector`
did not. Folding inside the recorder rather than in each collector is what makes
the one-row-per-owner invariant hold for collectors not yet written.
