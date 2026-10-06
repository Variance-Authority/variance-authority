---
'@variance-authority/sense': patch
---

Landing a run no longer decodes the cases and regions of the case index that the run did not touch. A carried case or region is copied by dictionary id, and each test file the index holds is checked once rather than once per case, so laying a one-file run over a 6,800-case index takes about 55 ms instead of 95 ms. The bytes it writes are unchanged.
