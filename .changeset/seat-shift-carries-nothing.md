---
'@variance-authority/sense': patch
---

A function written in front of an anonymous one no longer takes its tests

An anonymous function is addressed by its place among its siblings. When you
write a new one in front of a recorded one and run only the new test, the run
used to carry the older tests' crossings by address onto the new function, and
the function they ran read as entered by nobody. A run landed over such a shift
now carries nothing across it, in the record and in the case index alike, and
the tests that were on the module are run again, as a merged record already
did.
