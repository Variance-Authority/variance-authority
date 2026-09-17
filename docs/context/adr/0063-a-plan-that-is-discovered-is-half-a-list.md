# ADR-0063 — a plan that is discovered is half a list

**Status:** accepted
**Date:** 2026-09-17
**Relates to:** [journal 0058](../journal/0058-the-sitemap-and-the-component-were-never-connected.md), [ADR-0011](./0011-durable-and-ephemeral-retention.md), [ADR-0016](./0016-where-a-baseline-is-kept-decides-nothing.md), [ADR-0062](./0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md)

## Context

A subject list can be declared or discovered. `subjects.kind: "list"` is a
config file: adding and removing a subject are both diffs, both reviewed, both
attributable. `subjects.kind: "collector"` takes the list from a sitemap, a
story index or a directory of built HTML, and that is the form people actually
adopt — it is the one that does not ask them to maintain the inventory twice.

Discovery is asymmetric, and only one half of the asymmetry was ever handled.

**An addition is loud.** A page that appears in the sitemap is planned, has no
baseline, is reported `new`, and exits `1`. Nobody can add a watched surface by
accident; the run insists somebody approve it.

**A removal is silent in both directions.** The subject is not planned, so it is
not collected; not collected, so not compared; not compared, so no verdict
mentions it. Meanwhile its approved image is still in the baseline root, where
it is indistinguishable from a baseline somebody is relying on. The suite gets
smaller and greener in the same run, and the report that says
`coverage: every planned subject was observed` is telling the literal truth.

This is [ADR-0062](./0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md)'s
failure family in a different tier: the output is not a crash, it is a smaller
number, and the smaller number reads as success. The documented response was to
sell it as a trade — *name the routes explicitly when that silence is
unacceptable* — which makes the safe configuration the one nobody chooses.

It is also computable and was not being computed. The run holds the ids it
planned. The store holds the baselines it was given. The difference between
those two sets is exactly the list of subjects that left the plan without
leaving the store.

## Decision

**A run reports the approved subjects its plan did not contain, and that report
changes no verdict.**

Four constraints make it safe to state.

**The question is asked of the whole plan, never of what ran.** `--since`, a
`--subjects` glob and a selection index all narrow *downstream* of the plan:
they fill `skipped`, they do not shorten `plan.subjects`. Asked against the
observed set instead, a correctly narrowed run would report its entire saving as
a suite of abandoned baselines — the fix would manufacture, on every selective
run, a louder version of the defect it was written for.

**The store answers, because only the store knows where it put things.** Where a
baseline is kept decides nothing about a verdict (ADR-0016), and the corollary is
that nobody outside the store can enumerate what it holds. `RasterStore.unplanned`
takes the planned keys and an identity and answers for that identity's partition
alone: a baseline another machine approved is not this run's to call abandoned.

**It answers with names, not keys.** A file-backed store recovers a name from a
path and a path is lossy — a long id is truncated and digested to fit a filename,
and a `beside` layout spends the id's own slashes on directories. Answering with
a `BaselineKey` would mean inventing the id that produced the file. A name an
operator can find on disk is both honest and the thing they act on.

**It is optional, and its absence means unknown.** A backend behind an API with
no list call omits the method. A caller that read a missing method, or a failed
listing, as an empty answer would report every store that cannot enumerate as a
store holding nothing — which is the reading this whole family of defects is
made of.

## Consequences

A dropped route, a deleted story and a removed HTML file are named in the report
the run after they go. The exit code does not move: nothing was observed, so
nothing was compared, so there is no verdict to change, and a run that failed on
this would fail every intentional deletion between the delete and the cleanup.

One baseline root serving two suites reports each suite's subjects to the other.
That is not a false answer — from inside one run the other's images are exactly
held-and-not-planned — but it is not actionable either, so the sentence names
both readings and recommends nothing.

The `flat` and `beside` layouts are now walked by something other than a lookup,
which makes `placement.ts` load-bearing in a second direction: a future layout
must be enumerable, not merely addressable.

`docs/cases.md` and `docs/start-routes.md` described the silence as the price of
discovery. It is no longer the price, and they say what is actually lost now: the
config diff, not the notice.

What this decision does *not* settle is what an operator does with the names.
There is no verb that retires a baseline, a record does not say which suite
approved it, and the remote store cannot answer the question at all — carried as
[spec 0050](../../specs/0050-reconciling-a-discovered-plan-with-the-store.md).
