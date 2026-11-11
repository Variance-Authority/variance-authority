---
'@variance-authority/sense': patch
---

A `/// <depends path>` now selects its declarer for a change to anything the named file loads, at any depth, however the record answers that change. A test that runs a program in another process declares the program's entry, and a change inside the program selects it.
