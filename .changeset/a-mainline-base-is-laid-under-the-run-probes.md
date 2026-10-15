---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A fresh CI checkout is not given a mainline record its runs cannot be laid over

`layMainline` copied the mainline's record into a fresh checkout's own layer
whenever this build could open it. A record written under other probes opens,
but no run of this build can be laid over it, so in a pull request that changes
the instrumentation, every run that landed on the copy failed with "this run
cannot be laid over the record". Now `layMainline` takes the probes of the run
that lands next and copies nothing when the record was written under other
probes. It returns that record as `passed`, and `mainlinePassedOver` prints the
record and both probes. The suite then has no base: it runs whole, and its
coverage is printed without a comparison.

`foreignProbes(record, run)` in `@variance-authority/sense/test-selection` makes
the check the lay makes first. It returns the probes a record was written under
when a run under `run` cannot be laid over it.

**Breaking:** `layMainline(root, mainline, instrumentation, options?)` takes the
run's probes as its third argument, before `options`. Pass `undefined` for a
landing that lays no coverage. It returns `{ laid }` with the path it laid,
`{ passed }` with the record it passed over, or `undefined`, where it returned
the path or `undefined`.
