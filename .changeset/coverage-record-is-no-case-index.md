---
'@variance-authority/sense': patch
---

`decodeExecutionIndex` says when it is handed a coverage record that kept no case index

Handed the bytes of a coverage record with no case index in it, `decodeExecutionIndex` from `@variance-authority/sense/test-selection` threw `unsupported execution index version: 12`, which reads as a case index from a newer or older build. 12 is the coverage record's format, not an index version. It now throws `these bytes are a coverage record (format 12) that kept no case index, not a case index`. A record that carries a case index is still read as that index, and an index of a version this build does not know is still refused as `unsupported execution index version`.
