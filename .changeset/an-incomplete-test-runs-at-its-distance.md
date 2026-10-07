---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A test recorded incomplete now runs in the leg of its distance from the change. `--at-distance` and `VARIANCE_AUTHORITY_AT_DISTANCE` used to leave such a test to the leg that reaches the end whenever the change entered none of the cases the record saw. That happens after you run part of a suite over an edit: the record is taken over the edited text, and every test carried from the earlier text is held incomplete. A `0-2` leg then skipped the test, even one that imports the changed file directly. Now `distanceFromView` places it by the shortest path it ran from a changed file, and the leg those hops fall in runs it. A test with no such path still runs in the leg that reaches the end.
