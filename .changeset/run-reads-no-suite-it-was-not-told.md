---
"@variance-authority/cli": patch
---

`variance run` no longer refuses to start in a repository that declares more than one suite. Without `--suite`, it does not read where its subjects parted in the source, and its report has no section for that. `--suite <name>` reads that suite's record, as before.
