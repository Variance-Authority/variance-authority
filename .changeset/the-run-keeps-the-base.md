---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

Runs at one commit add to `cases.before.bin` instead of replacing it, so a suite split over several invocations keeps the replaced cases of every file it ran. `cases.last.json` names the commit those cases were recorded at under `before`, and drops it once a run at the same commit runs a file again, because that file's replaced cases are then the commit's own. Its `files` lists every test file the runs at the commit announced.

`variance review` compares with those cases and leaves out, and names, what the base's branch changed after their commit. `--against` is no longer needed in a pipeline, and no copy of the case index is either. `variance covering --cases last` names that commit too.
