---
'@variance-authority/distill': patch
---

A JSON execution index keeps what its cases arranged

`parseExecutionIndex` dropped every case's `preconditions`, so
`variance covering --execution index.json --where <name>` refused a JSON index
as unmeasured even when its rows said what they arranged; the recorded
`coverage.bin` spelling kept them. A JSON row's `preconditions` is now read and
validated entry by entry — `name` and `site` non-empty strings, `value` a
string, number or boolean, `level` a non-negative integer. An empty list stays
a case heard to say nothing, and a row without the field stays unheard.
