---
'@variance-authority/sense': minor
---

Code your suite loads but cannot probe selects the tests that loaded it

A function handed to `page.evaluate` crosses into the browser as its text, so a
probe inside it throws there. The record held nothing for such a module, and an
edit to it selected no test, however many had loaded it. `withTestSelection`
for Vitest and Jest, the Rstest plugin and `registerRecording` now take
`unprobed`, which names the modules a probe cannot sit in and wins over
`include`; Jest takes it as globs under `root`. A module it names runs as
written, with one mark after its last line, and is recorded as loaded but not
probed. A change to it selects every test that loaded it, through the same
preconditions a module loaded before the coverage provider started already used.
A Jest transformer that places the probes itself is handed such a module
already marked, without `senseProbes`.

A module the instrumenter cannot parse now runs with the same mark instead of
unrecorded, so an edit to it selects the tests that loaded it rather than none.

Code a test reads as text and runs elsewhere, such as a bundle injected into the
page, is still not loaded through the runner and is still not selected by an
edit to it.
