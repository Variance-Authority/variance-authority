# ADR-0032 — a flake rate divides by the runs that asked

**Status:** accepted
**Date:** 2026-08-10
**Extends:** ADR-0030 (two second passes, one variable each)
**Relates to:** [spec 0002](../../specs/0002-history-store.md),
[ADR-0031](0031-the-run-asks-what-is-recorded-now.md)

## Context

ADR-0030 shipped the detector: a changed subject is read twice in the same world,
and a subject that disagrees with itself is `unstable`, named with a component and
a band. It is a **lower bound by construction** — a subject that flakes one time
in fifty passes it forty-nine runs out of fifty — and
[`flakiness.md`](../../flakiness.md) said so while shipping nothing that could put
a number on it.

The missing number is not decoration. *Unstable in 6 of 20* and *6 times, none in
the last 9 sweeps* are opposite instructions: the first says the fixture is bad,
the second says a fix already landed and rewriting it is a day spent re-solving a
solved problem. An agent handed only "this subject read differently" cannot tell
those apart, and neither can a person.

## Decision

**An occurrence is an event, recorded every time it fires, and the rate that
counts them divides by the runs that could have seen one.**

Three parts, each of which is a defect if it goes the other way.

**Every firing is written.** Observations follow a write-only-on-movement rule,
because a hash that did not move is a fact already recorded. An instability has no
such prior: it is an event, it is rare, and a subject that fired eleven times is a
different object from one that fired once in March. Rows are flat —
`(subject, component, band, run, absorbed_by)` — so *which component keeps
flaking* is a query rather than a parse.

**The denominator is sweeps.** An ordinary run reads a subject twice only after
the comparison already called it `changed`, so a subject that was green in
eighteen runs was never asked whether it agrees with itself. Dividing occurrences
by *runs* would report a flake that fires whenever anybody looks as firing one
time in ten. `variance run --flakes` reads every subject twice, the run record
carries whether it swept, and only those runs are the denominator.

**A window with no sweep in it has no rate.** Absent, never zero. A rate of zero
printed beside a subject a run has just called unstable is the sentence "this has
never happened before", which is a confident answer to a question nobody asked —
the failure `createAbsentStore` exists to prevent, arriving through arithmetic
instead of through a missing service.

Recency is counted the same way. `sweepsSince` is examinations, not days: a suite
that stopped running would otherwise look increasingly healthy the longer nobody
looked at it.

## Consequences

**`RunRecord` gains an optional `swept`, and the null is load-bearing.** A run
recorded before the field existed never said what it examined, and reading that as
"did not sweep" would make an old history look like a suite nobody ever swept —
which is a claim, and a wrong one. Absent, false and true are three states all the
way down: through the wire, the parser, the column and the row reader.

**The sweep is now the mode that pays for the numbers.** `--flakes` was already
the shape that finds a flake one run before it costs a red build; it is now also
the only run whose *silence* about a subject is evidence. A project that never
sweeps still gets occurrence counts and `sweepsSince`, and gets no rate — which is
the honest output for a suite nobody asked the question of.

**An absorbed occurrence is recorded and counted separately.** A route that
declared it asserts on layout is not lying when its clock ticks: it never gates
and is never a finding. It is still written, because a rule that has absorbed
something in every run for six months is worth being able to ask about — the same
argument that makes `ignored` a word of its own rather than a synonym for
`unchanged` (ADR-0026).

**The answer travels in the run report.** The summary, the pull-request comment
and an MCP client all read one artifact rather than each opening a connection to
the operator's service. Two of those surfaces are read hours apart from the same
file, and a tool that queried on demand would answer differently depending on when
somebody looked.

## Alternatives

**Auto-ignore a difference whose shape has recurred often enough.** The shipped
answer elsewhere, and it works at a scale nothing here has run at. Declined for
the reason [`flakiness.md`](../../flakiness.md) gives: suppression by diff shape
silences the symptom without naming the writer, and the same rule that hides a
flake hides the regression that later lands in the same region. We count the
recurrence and report it; the decision to stop looking stays a declaration
somebody writes down.

**Divide by runs and explain the caveat in prose.** Rejected because the number is
what gets read. A rate whose denominator is wrong by a factor of ten is
believable, actionable and silently false, and the sentence explaining it is three
lines further down.

**Record which subjects a sweep examined, so the denominator is per subject.**
Correct, and it costs one row per subject per run — three hundred rows a night for
a suite whose entire design is that a quiet run writes two. The run-level flag
answers the same question for every subject in the run at the cost of one column,
and the case it gets wrong (a subject added mid-window) is visible as a run count
larger than the sweeps that could have seen it.

**A window measured in days.** Rejected in favour of sweeps for `sweepsSince`, and
kept for the window bound itself, where a calendar is what an operator means by
"lately". The two are different questions and the answer says which unit it used.
