---
"@variance-authority/sense": patch
---

`variance index` keeps the tree `HEAD` names beside the index, by the tree id of
every package in it. A run whose `HEAD` tree is unchanged reads no tree from
git's object store. After a commit, a pull or a branch switch it compares each
changed package's old tree with its new one in the object store and reads only
the trees on the changed paths, and it reads a package whole only when git has
pruned its old tree; the working tree is compared on every run, as
before. On Kibana the tree part of an unchanged run falls from about 110 ms to
about 25 ms; the run's wall time does not move, because the tree is read while
the working tree is walked. A Watchman watch that ignores directories, such as `node_modules` or
`dist`, now vouches for the held listing too, when git ignores each of those
directories as well and tracks no file in one.
