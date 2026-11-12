---
"@variance-authority/sense": patch
---

A record's readings section stores a case's newest reading as its difference from the case in the record's case index, rather than every region it crossed, and stores it again when a landing re-cuts the index. On this repository's unit suite the readings that differ from the index take 9.9 KB instead of 18.9 MB.
