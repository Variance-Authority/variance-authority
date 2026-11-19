---
"@variance-authority/sense": patch
---

`variance index` keeps the tree `HEAD` names beside the index, by the id of
every directory in it. A run whose `HEAD` tree is unchanged reads no tree from
git's object store, and one after a commit, a pull or a branch switch reads only
the directories whose ids changed; the working tree is compared on every run, as
before. On Kibana the tree part of an unchanged run falls from about 110 ms to
about 25 ms; the run's wall time does not move, because the tree is read while
the working tree is walked. A Watchman watch that ignores directories, such as `node_modules` or
`dist`, now vouches for the held listing too, unless a tracked file lies in one.
