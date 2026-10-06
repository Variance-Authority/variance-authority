---
"@variance-authority/sense": patch
---

A column read again in the run it read last no longer moves that run to the back of its cache: it is there already. `variance select` made that move 2.3 million times a run, and 87% of them were on the run already at the back: about 120 ms of its time.
