---
'@variance-authority/sense': minor
'@variance-authority/help': patch
---

`search`'s file set says when a suite's recorded cases could not be read. A suite whose record is there and does not read, and a root config that cannot name its suites, now put `No recorded case … was read: <why>.` in the file set's `unread`, beside any matches as well as beside none, and `intersection` carries it. A suite with no record, or a record that kept no cases, leaves the set complete, as before. The text prints that line where it did, under an answer that found nothing.

A record whose header does not read is named unread with the reader's own reason, in `search` and in `orient`'s recorded cases, where it was reported as `no run kept its cases there`, the words for a suite that never recorded. A header reads when a record reader would open it, so one that parses but lays out sections the reader refuses does not. `keepsCases` now answers `undefined` for that file, and `false` where no record is there or its header lists no case index: a caller that stored its answer as a `boolean` takes `boolean | undefined`, and a caller that only branches on it takes the branch `false` took. `keepsEyes` and `withoutCoverage` answer `false` for that file, as the reader refuses it. Such a suite is marked `unreadable: true` in `recordedCaseNames` and `recordedCases`, and in `search --format json`'s `tests.unread`.
