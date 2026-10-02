---
'@variance-authority/cli': minor
'@variance-authority/distill': minor
'@variance-authority/eyes': minor
'@variance-authority/mcp': minor
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
---

Eyes journals travel in the record

A run that opts into Eyes writes each case's journal into `coverage.bin`, in an
`eyes` section keyed by the case's id and its attempt, so a journal joins its
case exactly and a retried case keeps every attempt. The attempt counts from 1
(Playwright's `retry + 1`) and is a column of its own, never part of the id. A
run that did not opt in writes no section. Source paths in a journal are
relative to the repository root, as the case index's are.

The Playwright fixture and `watchTest` hand their journal to the case the
recording runs, never to `testInfo.testId`. The RTL `watchTest`, given no id,
returns the journal and hands it to the running case where the recording seam's
case scope takes one. The Vitest and Jest seams hold each attempt's case from
before its `beforeEach` until after its `afterEach`, so a journal closed in
teardown lands under that case and attempt; the Rstest seam takes none. A run that opts in lists every case it watched in
the section, so a watched case that handed no journal reads apart from a case
whose run did not opt in. Two different journals for one case and attempt keep
the one whose JSON sorts first, and the run still records.

A journal stays on the machine that ran it. It leaves with the record, through
`variance share` or an `actions-cache` carry, and each says so: a share names
every suite entry whose record carried journals, and a carry save notes each
suite whose record goes into the cache with them. `sharedRecord` keeps the
section, and drops one that is unreadable or of a newer version at the
crossing, keeping the rest of the record. A repin keeps the journals of every
case its index keeps.

`variance distill` reads the checkout's own record, or the one `--execution`
names, and prints every attempt of the case. It refuses an id the record does
not hold and shows the ids it does. `--eyes` is removed, and so are the
`@variance-authority/eyes/collect` and `@variance-authority/eyes/reporter`
entries (`writeEyesArchive`, `gatherEyesArchive`, `recordEyesTest`,
`resetEyesJournals`, `EYES_JOURNAL_SUFFIX`, the Eyes reporter and
`EyesReporterOptions`). `eyesJournal` and `EyesJournal` give a test's journal,
and `parseEyesJournal` reads one back. In `@variance-authority/distill`,
`DistillInput` takes `execution` always and `eyes` as `EyesAttempt` rows, and
`Distillation` reports `attempts` as `AttemptAttention` in place of
`attention`, `joined` and `available`; `watched` names the cases a run that
opted in watched, and distill says which of them kept no journal. The sense
test-selection entry adds `keepsEyes`, `recordedEyesAt`, `RecordedEyes`,
`ObservedEyes`, `EyesSection` and `encodeAsSetExecutionIndex`. In
`@variance-authority/mcp`, `serveEyesRecord` replaces `serveEyesArchive` and
serves the journals a record keeps, read by `readEyesRecord`; the MCP `distill`
tool needs the runtime journey and reads a case by its exact id.
