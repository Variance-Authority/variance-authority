---
"@variance-authority/sense": patch
---

`variance index` keeps the tree `HEAD` names beside the index, by the id of
every directory in it. A run whose `HEAD` tree is unchanged reads no tree from
git's object store, and one after a commit, a pull or a branch switch reads only
the directories whose ids changed; the working tree is compared on every run, as
before. A Watchman watch that ignores directories, such as `node_modules` or
`dist`, now vouches for the held listing too, unless a tracked file lies in one.
