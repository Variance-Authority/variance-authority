---
'@variance-authority/sense': patch
---

Layering a recording onto a snapshot costs the change, not the snapshot

Publishing decoded every module the snapshot held. A path string and an array
per row, a map from path to rows, and one object a module — so a run that
re-recorded ten modules of two hundred thousand still built two hundred
thousand of each, and the heap a publish needed grew with the file it was
layering onto rather than with the run it was layering.

The rows are in code-unit order and so is the dictionary above them, so a
path's place among the strings decides its place among the rows. Both searches
are now binary and integer, the modules nobody touched are never decoded or
compared, and the output's order is one `Int32Array` — four bytes a carried
module — in place of the objects. Heap is flat in snapshot size at 6.6 to 7.7
MB, where it was 9.4 MB at ten thousand modules and 18.6 MB at eighty
thousand. What still scales is the columns themselves: total live memory falls
from 1.07 to 0.89 MB per thousand modules.

The bytes are the bytes. This is an optimization of a function that already
existed, and the gate test still asserts the output is identical to the merge
and encode it replaces.
