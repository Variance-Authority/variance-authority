---
'@variance-authority/cli': patch
---

`run --since` observes a subject the recording saw enter the change

A subject could be skipped by what its baseline names and the imports the file
graph could read, even when the execution record showed that it entered the
changed lines. That happened in two cases: the chain to the change ran through
an import the scan could not read, or the baseline did not record the component,
which is always true of a server component. The recording was consulted only
about the subjects that survived the first check, so it could not keep this one.

A subject that the recording saw enter the changed lines is now observed,
whatever its baseline names, and the run names every subject it kept this way.
The recording still rules out only subjects that passed the first check.
