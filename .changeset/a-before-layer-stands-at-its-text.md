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
inventing a loss.
