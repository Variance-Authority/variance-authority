---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Code that runs when a module loads no longer counts as covered by every test in the file

A module's top level runs once per test file, while whichever test is running
at the time. Before, every test in the file was recorded as covering it, so
each line at module scope looked as covered as the function bodies in that
module. The record now marks such a region as loaded and lists no test as
covering it. `variance covering` works out, from the import graph, which tests
loaded it, and leaves out test files that mock the module. When no import graph
names a recorded test, for example a module that runs in the page and that a
browser spec never imports, `variance covering` prints no tests for it rather
than an empty list.

Recordings written by an earlier version still read. Their module-scope regions
are marked as loaded when the recording already said so, and are unmarked
otherwise.
