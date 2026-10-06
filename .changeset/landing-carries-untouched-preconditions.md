---
'@variance-authority/sense': patch
---

Landing a run no longer reads the preconditions of tests that the run did not touch. Their names and digests are carried over by dictionary id, as untouched module rows already are, so a one-file run now spends about half as long layering the coverage record. The bytes it writes are unchanged.
