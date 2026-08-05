# Spec 0023 — `accept` tells a new baseline from a changed one

**Missing:** the distinction. In `--all` mode every candidate is promoted
identically, so a subject nobody has ever reviewed and a subject whose component
just changed are approved by the same keystroke.
**Built on:** [ADR-0017](../context/adr/0017-the-exit-code-is-the-interface.md)
and the refusal that already holds — acceptance promotes an image the run
produced and never renders one.

## Purpose

The exit codes exist to stop a gate becoming a recorder. `accept --all` is the
one command that walks straight through them: it is the ergonomic way to take a
first baseline, and it is indistinguishable from rubber-stamping a regression
across three hundred subjects.

The current answer is a paragraph telling operators to name subjects explicitly
and keep `--all` out of anything unattended. That is documentation carrying a
constraint the code could carry, which is the weakest place to put one — it holds
exactly until somebody is in a hurry.

## What would discharge it

**`--all` stops meaning one thing.** A run already knows which verdict each
subject reached; `new` and `changed` are different verdicts, and acceptance is
the only place that treats them as the same.

The shape, and the decision it forces:

- **Separate the two.** Accepting every `new` subject is the first-baseline
  workflow and is safe by construction — there is nothing to overwrite. Accepting
  every `changed` subject is the dangerous one, and it is the one that should
  need naming, a count, or an explicit flag that reads as what it does.
- **Refuse the mixed case by default.** A run holding both is the case where the
  operator's intent is genuinely ambiguous, and refusing with both counts is more
  useful than either guess.
- **Say what was promoted.** `accept` reporting "8 accepted" hides the
  distinction the whole spec is about. Two numbers, always.

Whether the safe half keeps the name `--all` or gains one of its own is the
decision worth arguing about, because the flag people already type is the flag
that will keep being typed.

## What it must not do

**Never re-render on acceptance.** A command that can produce an image is a
command that can record something nobody looked at, and that refusal is older and
more important than this spec.

## Leaves behind

One amendment to ADR-0017 — the exit code says whether review is needed, and
acceptance now has to distinguish what it is accepting, which is the same
distinction one rung further on.
