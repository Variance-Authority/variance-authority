---
'@variance-authority/sense': patch
'@variance-authority/help': patch
---

`search`'s file set says when a suite's recorded cases could not be read. A suite whose record is there and does not read, and a root config that cannot name its suites, now put `No recorded case … was read: <why>.` in the file set's `unread`, beside any matches as well as beside none, and `intersection` carries it. A suite with no record, or a record that kept no cases, leaves the set complete, as before. The text prints that line where it did, under an answer that found nothing.

A record whose header does not read is named unread with the reader's own reason, where it was reported as `no run kept its cases there`, the words for a suite that never recorded. `keepsCases` now answers `undefined` for that file, `false` only where no record is there, and the `--format json` answer marks such a suite's `tests.unread` entry `unreadable: true`.
