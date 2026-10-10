---
'@variance-authority/sense': minor
---

Code your suite loads but cannot probe selects the tests that loaded it

A function handed to `page.evaluate` crosses into the browser as its text, so a
probe inside it throws there. The record held nothing for such a module, and an
edit to it selected no test, however many had loaded it. `withTestSelection`
for Vitest and Jest, the Rstest plugin and `registerRecording` now take
`unprobed`, which names the modules a probe cannot sit in and wins over
`include`; Jest takes it as globs under `rootDir`, or under the `root` option
when you set one, where a glob that opens with `!` keeps a module probed, as in
`testMatch`. A module it names runs
unchanged, followed by one line that records it was loaded, and the record lists
it as not instrumented. A module recorded as not instrumented is a precondition
of every test that loaded it, so a change to it selects all of them.
A Jest transformer that places the probes itself is handed such a module
already marked, without `senseProbes`, and a module it hands back with no probe
placed, as it does a text it cannot parse, is marked after it as not probed.

A module the instrumenter cannot parse now runs with the same line instead of
unrecorded, through the page plugin and `instrumentModule` as well, so an edit
to it selects the tests that loaded it rather than none.

Code a test reads as text and runs elsewhere, such as a bundle injected into the
page, is not loaded through the runner, so no test records it. Declare the
bundle's entry in the `before` of the suite that injects it: an edit to anything
the bundle is built from then runs that whole suite.
