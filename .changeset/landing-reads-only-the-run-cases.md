---
'@variance-authority/sense': patch
---

Landing a run no longer decodes the cases and regions of the case index that the run did not touch. A carried case or region is copied by dictionary id, and each test file the index holds is checked once rather than once per case, so laying a one-file run over a 6,800-case index takes about 55 ms instead of 95 ms. The preconditions of a carried case are copied by id too, rather than parsed and spelled again, so the landing's cost no longer grows with how many distinct preconditions the index holds. A later shard of a landing reads only the modules of the landing's first index that a shard recorded, rather than every module it holds. The bytes it writes are unchanged.

The native case fold now spells a precondition's number as `JSON.stringify` does: `0.000001` rather than `1e-6`, and `123456789012345680000` rather than `1.2345678901234568e20`. Every writer of the case index now stores a case's preconditions in the same spelling.
