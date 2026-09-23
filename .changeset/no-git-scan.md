---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`--no-git` reads source from disk, and a scan no longer makes Git fetch in a partial clone

`variance select` and `variance reach` take `--no-git`: source is read from the
disk rather than from Git's object store, and Git still supplies the diff. The
scan walks directories instead of Git's list of tracked files, and cached parse
results, which are keyed by Git object names, are not reused.

Without the flag, a file whose object is missing from the local Git store is
read from the disk. Before, in a partial clone, reading it made Git fetch the
object from the remote.
