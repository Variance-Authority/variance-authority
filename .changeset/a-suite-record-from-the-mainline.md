---
"@variance-authority/cli": minor
---

Every base is main's record: `variance select`, `yarn test:since` and a runner of your own measure a change from the record your mainline's CI published, and the primary checkout's record is only the offline fallback.

`variance share --suite <name>` reads one suite's execution record from its mainline, or with `--publish` publishes it to the line the run belongs to, taking the suite and the share from the root `variance.config.json`, so a repository with no visual project and no run report can share its unit suite's record. A `suite-v1/<suite>` entry carries the runs record beside the execution record.

A mainline takes the entry only when the whole suite ran at the commit it names. `--collected <file>` names the test files your runner collects, one per line, repository-relative or absolute, as `vitest list --filesOnly` or `jest --listTests` prints them; without it the files git holds at that commit are counted, listed once from the top of the tree. A test standing on an entry at the publish commit counts as run there, and a commit git does not hold is named. A mainline publish that writes nothing exits 2; a branch line, or a run with no line, still exits 0.

`suiteBase` answers which record a checkout measures from: its own, else the mainline's, else, where no mainline record was ever fetched on this machine, the primary checkout's, with `missed` saying why the mainline's was not read. `variance select` asks it, so a worktree that has run nothing selects from main's record and says `record of "<suite>": read from mainline <name>, published at <commit>`. A fetch is reused for ten minutes and a remote that did not answer is not asked again for ten minutes; past the window, an unanswered remote leaves the record fetched earlier as the base, and the reader names when it was fetched. `variance share --suite <name>` always asks. Each fetch runs the daily cache prune, which keeps the record the last fetch named. `layMainline` copies the mainline's record, its per-case index and its runs record into a fresh CI checkout's own layer; `mainlineRead`, `mainlineMissed` and `primaryRead` are exported beside them.
