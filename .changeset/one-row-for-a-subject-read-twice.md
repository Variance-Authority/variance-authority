---
'@variance-authority/sense': patch
'@variance-authority/storybook-collector': patch
---

Record one coverage row for a subject the run read twice.

Stabilization reads a subject again whenever the first read was not trusted, so
a changed or unstable subject reaches `recordExecution` twice. It built one
`CoverageTest` per observation and keyed them by owner, and the encoder refuses
to intern two rows under one name: every second Storybook run of a moving suite
died with `duplicate test coverage observation` and wrote no journal.
`recordExecution` now folds its subjects through `joinObservations` — the same
join Playwright's collector already applied before calling — so the invariant
holds for collectors not yet written.

`@variance-authority/storybook-collector` also honours what its own comment
promised. A refusal to record was written to stderr and the run continued; a
throw from the same call took the run down with it, costing every subject its
baselines over a journal that is not the artefact under review.
