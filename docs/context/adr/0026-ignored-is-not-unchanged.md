# ADR-0026 — `ignored` is not `unchanged`

**Status:** accepted
**Date:** 2026-08-05
**Extends:** ADR-0002 (observation profiles), ADR-0008 (per-profile expectations)
**Discharges:** spec 0024 (an ignore is a declaration, not a blind spot)

## Context

ADR-0002 established a rule that has held everywhere since: **an unobservable
difference is never reported as no difference.** A band a profile cannot see
reports `unobserved`; a baseline from another machine reports `incomparable`.
Neither is allowed to be spelled `unchanged`, because a green subject that is
indistinguishable from a genuinely clean one destroys the only question worth
asking of a suite — *how much of this did you actually check*.

[ADR-0025](0025-an-ignore-names-a-place-or-a-shape.md) introduced a second reason
not to have looked, and this one is chosen rather than imposed: the operator
declared that a subtree or a difference shape is not the subject. The obvious
implementation reports such a subject `unchanged` and moves on. Every product in
this category does exactly that, and it is why a masked suite rots — a mask that
outlived its flake is a permanent hole nobody can see, because nothing
distinguishes the subjects it covers from the ones that are genuinely fine.

## Decision

**A subject whose every difference was absorbed reports `ignored`.**

It is green and it exits `0`: the operator said this is not the subject, and
nothing needs review. It is a different word from `unchanged` so that the two can
be counted separately, forever, by anyone reading the report — including an agent,
since the verdict is on `RunReport` where the MCP tools can see it.

**Absorption is accounted for at three levels**, and each answers a question the
other two cannot:

- **Per comparison.** `Observation.ignored` carries the pixels absorbed, the
  number of excluded boxes, how many of those covered nothing, and a per-rule
  breakdown. It is present whenever the subject had an exclusion at all, including
  when it absorbed nothing — a field that vanishes at zero cannot report the state
  that matters.
- **Per subject.** `changedPixels` is net of exclusions and `ignored.pixels` is
  what they took, so the two can never be added by accident and a subject with a
  mask over half of it does not read as one that barely moved.
- **Per run.** `variance run` prints a ledger: what each rule absorbed, in how many
  subjects, and — named as `[dead]` — every rule that absorbed nothing. Two dead
  states are distinguished, because they need opposite actions: a rule that found
  its element and saw no difference is probably a fixed flake, and a rule that
  resolved nowhere at all is a selector that has rotted while the operator
  believes something is silenced.

**Expiry is declared rather than inferred.** A rule may carry `until`, after which
it stops absorbing and starts being reported, and the differences it was hiding
come back with no further action. The filtering happens in the CLI rather than in
a collector, because a collector runs in a browser and a browser is the wrong
place to hold a clock; `core` takes the date as an argument for the same reason —
a package that reads a clock cannot be tested for what it does on the one day the
field matters.

**An `ignored` subject gets a count, not a line.** `variance_summary` lists every
subject whose verdict is not `unchanged`, which would put a shared header carrying
a clock in front of the reader three hundred times. Three hundred lines saying
"you already decided not to look at this" is the output nobody reads — which is
how the *other* lines get missed. The header count keeps it visible and the ledger
explains it.

## Consequences

**`exitFor` reads a list of green verdicts rather than comparing to one word.**
Written as `!== 'unchanged'` the distinction would have disappeared from the exit
code the day it was added; the list makes adding a third green state a decision
somebody has to make.

**Every verdict map has to grow.** `tribunal`'s build summary counts by verdict
and now counts `ignored` too, including as an explicit zero — a map missing the
key reports `undefined` where a build genuinely had none, and a review surface
that cannot tell "no ignored subjects" from "this build predates ignores" is one
an operator goes to the database to check.

**It is honest about a run that is entirely ignored.** A suite where every subject
went green because of one over-broad rule reports every subject `ignored`, one
ledger line, and exit `0`. That is a correct answer and an alarming-looking one,
which is the intended reading: nothing about it resembles a clean run.

**What it does not do.** It does not refuse the exit code. An operator who
excludes their entire application gets `0`, because the alternative is a tool that
argues with a decision it was told to respect. What it does instead is make the
decision impossible to lose track of.
