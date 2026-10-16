---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A record cut under other probes answers, and names what it leaves open

`variance covering`, `review`, `select`, `journeys` and a `run --since` read a
record cut under probes this build does not place, such as
`sense:instrument/presence-v5` under a build that places `presence-v6`, as if
it described the code as this build cuts it. Each still answers from it, and now
says beside the answer which probes cut the record, which this build places,
and that whether a region this build cuts and those probes did not ran is not
answered. `covering --file` compares that file's regions in the record with the
ones this build cuts in the text the record was made over, and says when they
are the same or names the ones that differ. When the mainline's record cut under
this build's probes is on the machine beneath the one read, the note names its
path, which `--execution` reads.

A suite with nothing recorded is refused as before, now without naming a
recorder to run; a suite the share carries names `variance share --suite` to
fetch the mainline's record.

`covering` on a file the suite declares a precondition of its test files, such
as a Rust source under a Node suite, now says that the file is not instrumented
and that the suite declares it, rather than listing every test file as having
met it. A file the run loaded without instrumenting keeps the old wording.

`covering` on a whole module many test files import names the cases that ran a
range and counts, per range, the ones that ran it only while their file
imported the module, instead of listing all of them.
