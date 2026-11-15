---
'@variance-authority/sense': patch
---

The listing of every tracked path compares the working tree in-process instead of asking `git status`. It reads HEAD's tree from the object store and compares the index with HEAD and with the disk, then walks the untracked files on four threads under the repository's ignore rules. On Kibana (about 135,000 paths) the listing takes about 0.6 s where it took about 1.05 s. The answer is the one `status` gave. A repository that uses `core.fsmonitor` or a sparse index, holds a submodule under the root, or is not SHA-1 is still asked through `git status`, and so is an index holding git's untracked cache, which `status` reads faster than a fresh walk; `feature.manyFiles` turns that cache on, so most large repositories that set it keep `git status`.
