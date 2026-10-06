---
"@variance-authority/sense": patch
---

A column read again in the run it read last no longer moves that run to the back of its cache: it is there already. `variance select` made that move 1.35 million times a run, about 120 ms of its time.
