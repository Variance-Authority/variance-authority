---
'@variance-authority/sense': minor
---

Code your suite loads but cannot probe selects the tests that loaded it

A function handed to `page.evaluate` crosses into the browser as its text, so a
probe inside it throws there, and you keep such a module out of `include`. The
record then held nothing for it, and an edit to it selected no test, however
many had loaded it. `withTestSelection` now takes `unprobed`, asked of each
module `include` refuses. A module it names runs as written, with one mark after
its last line, and is recorded as loaded but not probed. A change to it selects
every test that loaded it, through the same preconditions a module loaded before
the coverage provider started already used. Code a test reads as text and runs
elsewhere, such as a bundle injected into the page, is still not loaded through
the runner and is still not selected by an edit to it.
