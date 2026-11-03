---
'@variance-authority/core': minor
'@variance-authority/store': minor
'@variance-authority/cli': minor
---

A checkout behind the mainline's tip is measured against the record at its merge base

A share in git now keeps each mainline publish at the commit it ran at, under `refs/variance/at/<commit>/mainline/<name>`, beside the latest. Each publish deletes the ones older than 14 days or beyond the newest 200 commits, and says what it kept: `kept the record at <commit> beside the latest, for 14 days or 200 commits.` When the latest is not at `HEAD`'s merge base with the mainline, every reader asks for the record kept there first: `share`, `select`, `review`, `ask` and `serve`, and a worktree's first record. It reads the latest only when none is kept there. A release branch, or a pull request cut days ago, is no longer charged with every commit the mainline gained since. A directory or an HTTP share keeps the latest only, as before.
