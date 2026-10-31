---
'@variance-authority/cli': patch
---

A manifest or lockfile read at a commit fails with git's reason when git cannot read it, rather than reading as absent at that commit and being compared as an install added since.
