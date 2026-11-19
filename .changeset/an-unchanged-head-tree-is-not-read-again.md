---
"@variance-authority/sense": patch
---

`variance index` keeps the tree `HEAD` names beside the index, by the tree id of
every package in it. A run whose `HEAD` tree is unchanged reads no tree from
git's object store. After a commit, a pull or a branch switch it compares each
changed package's old tree with its new one in the object store and reads only
the trees on the changed paths, and it reads a package whole only when git has
pruned its old tree; the working tree is compared on every run, as
before. The tree part of an unchanged run falls from about 80 ms to about 20 ms
on Kibana, and from about 1.1 s to about 50 ms on Firefox; the run's wall time
does not move on either, because the tree is read while the working tree is
walked. A Watchman watch that ignores directories, such as `node_modules` or
`dist`, now vouches for the held listing too, since what it ignores is out of
the source:
on Firefox, whose own watch ignores its build directories, an unchanged run
falls from about 6.2 s to about 1.2 s.
Under a watch, a branch switch, a reset or a commit compares only the files
Watchman reports moved, and the kept listing answers for the rest: a switch one
commit away and back takes the listing from about 0.66 s to about 0.23 s on
Kibana, and from about 2.2 s to about 0.67 s on Firefox, where the run falls
from about 5.9 s to about 4.4 s.
