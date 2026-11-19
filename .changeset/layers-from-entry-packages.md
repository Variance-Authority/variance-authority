---
'@variance-authority/cli': minor
---

Use `variance layers --package <name>` to list an entry package and its transitive repository dependencies. Repeat `--package` for several roots; shared dependencies appear once. The answer includes the selected roots and package and layer counts. Without roots, the command lists the whole repository as before. Root selection cannot be combined with `--against`.
