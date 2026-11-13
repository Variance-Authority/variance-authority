---
"@variance-authority/sense": patch
---

A record keeps its cases' earlier readings as bytes rather than JSON: each module, name and path is written once per case, every number as a varint, each case id and test file path as what it shares with the one before it, and each inputs digest as its bytes. A record an earlier build wrote reads as holding no earlier readings, and the next run writes them again.
