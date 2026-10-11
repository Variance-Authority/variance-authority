---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

The case index stands at the lines a landing moves a module's rows to

When a landing moves a module's rows to another text, it re-cuts them by
address. A module edited on disk is moved this way by a local run that did not
record it, and by a repin onto a newer milestone this checkout did not record it
in. A shard that recorded the module but kept no case of it moves it in
`variance land`. In all three landings the case index kept that module at the lines
it was recorded at. Every reader asks the index by line: selection, `variance
covering`, coverage, the MCP changed-tests tool and `variance review`. After
two lines were written above a function, they all named the cases of the
function that used to stand there. A change to the function's own body selected
none of its cases.

After each landing, the held cases of every module whose rows moved are now
laid onto the rows' new cut. This is the rule a run's own recording of the
module already followed: each region by address and kind, and a region new to
the text takes the cases of the region around it. When no region's cases land,
the module leaves the index, as a module no run kept cases of is absent from it,
rather than standing at lines no text holds. An index that went stale this way before this
release is repaired the next time a landing moves the module.

`followRows`, exported from `@variance-authority/sense/test-selection`, lays a
landing's case index onto the rows it landed; `variance land` calls it.
