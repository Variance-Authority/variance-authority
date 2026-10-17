---
'@variance-authority/cli': minor
---

`share --suite` names the commit of the mainline's record

`variance share --suite <name> --format github` prints `commit=<sha>`, the
commit the mainline's record of the suite was made at, and `commit=` when the
mainline has none, for a workflow to merge a pull request with that commit
instead of the base tip. The `record of "<name>":` line goes to stderr.
