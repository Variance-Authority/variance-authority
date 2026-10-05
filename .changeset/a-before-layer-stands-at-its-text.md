---
'@variance-authority/sense': patch
---

A region an edit above it moved is no longer reported as lost

The case index keeps each module at the lines it was recorded at. The snapshot
moves a module it carries to the text on disk. When a module went unrecorded
across an edit above one of its regions, the before layer stood at the old
lines but named the new text. `variance review` then paired a row with the
region now on its old line. A case that still called its callback read as
`Lost every case` on one line and gained on the next. Now, when a run records
the module from the text the before layer names, the before layer is cut at
the lines the run recorded. When the two texts number their regions
differently, the module is named under no text. A review then lists it as not
compared, with the cases before recorded over another text, instead of
inventing a loss. A landing of several shards keeps the lines an earlier shard
recorded when a later shard, which did not record the module, retires cases of
it. Cases of a test file the run did not run land on the module's new regions
only where the two texts number them alike.

A callback no longer passes its cases to a sibling of the same name when one
recording holds a region the other lacks. Callbacks of one name and path are
told apart only by their order, so a cut missing the first `map` callback of a
function numbered the second one first, and its cases landed on the first.
`variance review` then reported the region lost, in a file nobody changed. Now,
where two recordings hold such a name a different number of times, a callback's
cases land only on the one at its own lines. When a held callback finds none
there, the module is listed as not compared.
