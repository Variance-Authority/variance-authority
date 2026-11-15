---
'@variance-authority/sense': patch
---

A recorded test file starts faster. An instrumented module no longer carries
its own copy of the probe: the header asks the recording for the probes of its
row on the first call, so a fresh realm compiles and warms one probe for all of
its modules, and each module's header shrinks from 618 bytes to 278.
