---
'@variance-authority/sense': patch
---

The working-tree check uses git's untracked cache when the repository keeps one

Git answers `status` from its untracked cache only when the call uses the mode
set in `status.showUntrackedFiles` and passes no pathspec. Before every update
of the source index, Sense asked for `--untracked-files=normal`, or `-- .` in a
directory below the top of the checkout. Both shapes made git walk every
directory again. Where `core.untrackedCache` or `feature.manyFiles` is on,
Sense now asks the whole checkout in the mode the repository sets, and drops
every path outside the directory it is indexing. Where neither is on, nothing
changes. On a checkout of 812,428 paths set to `all`, the check went from
12.7–16.9 s to 1.05 s at the top, and from 4.2–5.2 s to 1.2–2.0 s in a
product directory.
