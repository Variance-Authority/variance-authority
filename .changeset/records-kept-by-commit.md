---
'@variance-authority/core': minor
'@variance-authority/store': minor
'@variance-authority/cli': minor
---

A checkout behind the mainline's tip is measured against the record at its merge base

A share in git now keeps each mainline publish at the commit it ran at, under `refs/variance/at/<commit>/mainline/<name>`, beside the latest. Each publish says what it kept: `kept the record at <commit> beside the latest.` When the latest is not at `HEAD`'s merge base with the mainline, every reader asks for the record kept there first: `share`, `select`, `review`, `ask` and `serve`. Then it reads the nearest record kept behind the merge base, and the latest only when none is kept at or behind it. Nothing removes a kept record until you ask: `variance share --purge-older-than <days>` deletes those older, and the latest stays. A release branch, or a pull request cut days ago, is no longer charged with every commit the mainline gained since. A directory or an HTTP share keeps the latest only, as before.
