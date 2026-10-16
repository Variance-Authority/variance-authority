---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A record cut under retired probes is refused, not read as current

`variance covering` and `variance review` read a record cut under probes this
build no longer places, such as `sense:instrument/presence-v5` under a build that
places `presence-v6`, as if it described the code as it is. Its regions are
numbered by the old probes, so the answer named the wrong cases and missed the
marks the new probes leave, including which cases only loaded a module. Both
now refuse such a record by name, saying which probes cut it, which this build
places, and that `variance share --suite <suite>` fetches the mainline's. A
handover leaves that suite out with the same reason. `retiredProbes` in
`@variance-authority/sense/instrument` says what a build places in place of a
retired identity.

`covering` on a file the suite declares a precondition of its test files, such
as a Rust source under a Node suite, now says that the file is not instrumented
and that the suite declares it, rather than listing every test file as having
met it. A file the run loaded without instrumenting keeps the old wording.

`covering` on a whole module many test files import names the cases that ran a
range and counts, per range, the ones that ran it only while their file
imported the module, instead of listing all of them.
