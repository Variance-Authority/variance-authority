---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A region written between two siblings no longer costs its neighbours their
cases. When a base names the commit it was recorded at, `variance coverage`,
`variance covering` and `variance review` pair each base region with the region
its lines moved to through the diff from that commit, rather than by its place
among regions of the same name. Three `.filter` callbacks where there were two
used to report the last one as having lost every case and a new one as having
gained them; it now reports the inserted callback as written and nothing lost.

`caseMotion` and `coverageChange` take the diff as `diff`, read by
`hunksByFile` from `@variance-authority/sense/test-selection`. Without it,
regions are paired by address as before.

A diff read from a directory reached through a symbolic link, as every
temporary directory on macOS is, now names its files from that directory rather
than climbing out of the link and back in, which matched nothing.
