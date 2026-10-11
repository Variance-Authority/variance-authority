---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A region the case index lays by name no longer takes the cases of its namesake

Regions that share a name, such as two `useEffect(() => …)` callbacks, were
paired by name and order when a landing laid the held case index onto a new
recording. Delete the first effect and write a new one behind the second, and
the old second body's cases landed on the wrong region. A later edit to the
surviving body then selected the removed effect's test and skipped the test that
ran it. Now the landing reads the `git diff -U0` hunks between the held text and
the recorded one. A region the hunks leave alone keeps its cases at the lines
they place it. A region they touch carries none, so its tests count as changed
and selection runs them. When either text cannot be found, the whole file counts
as changed.
