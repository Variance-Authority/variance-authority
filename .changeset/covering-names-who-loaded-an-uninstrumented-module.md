---
'@variance-authority/cli': minor
---

`covering` answers a module the run loaded without instrumenting it with the test files that loaded it

Such a module, one your suite's `include` leaves out or one named in
`unprobed`, was refused as if the run never loaded it, while `variance select`
selected every test file that loaded it. `covering` now answers with those
files, in `preconditionOf`: each holds the module as a precondition, and a
change to it selects every one of them. No case and no line is named, because
nothing measured them. A file the run never loaded is still refused.
