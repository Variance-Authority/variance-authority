---
"@variance-authority/cli": patch
---

A shallow clone no longer prints a distance its history cannot count

In a shallow clone, `git rev-list --count` stops at the commits the clone was cut at and exits 0 with a smaller number. The distance a mainline lookup prints (`N commit(s) behind the merge base with this checkout`), the `record of "<suite>":` line's `N commit(s) before HEAD`, the merge base a reader uses to pick between mainlines, and how far HEAD is past a branch record all used that number. Each now prints `at a distance this clone cannot count` when the walk between the two commits reaches the cut, and the same number as before in a clone that holds the whole history between them.
