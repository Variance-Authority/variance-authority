---
'@variance-authority/sense': patch
---

An update where nothing moved took about 2.8 s and 1.19 GB on 288,197 paths. It now takes about 1.5 s and 0.95 GB. Three things caused the extra cost. `updateSourceIndex` decoded the published chain twice, and now opens it once. At the top of a checkout the tree snapshot asked `git status --untracked-files=all -- .`, which git's untracked cache cannot answer. It now asks `--untracked-files=normal` with no pathspec, and lists each directory that `status` collapses with `git ls-files --others --exclude-standard`. With `core.fsmonitor` and `core.untrackedCache` set, that call costs 17 ms on a 41,171-path clone, down from 55 ms. The native snapshot no longer sorts a listing that git has already printed in order.

This also fixes a defect in the native snapshot. A new directory in the working tree made `git hash-object` fail, and every path in the same batch was dropped, so files that existed were missing from the index. The directory is now expanded into its files before hashing.
