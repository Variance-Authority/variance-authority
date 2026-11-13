---
"@variance-authority/sense": patch
---

A record keeps its cases' earlier readings as bytes rather than JSON: each module, name and path is written once per case, and every number as a varint, so the readings section no longer grows the record by the text of every reading.
