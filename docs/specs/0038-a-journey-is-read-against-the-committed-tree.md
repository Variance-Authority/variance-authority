# Spec 0038 — a journey is read against the committed tree

**Missing:** every reader. The record holds one presence bit per region and
subject and the run reports where two subjects parted; nothing joins a subject's
journey to the component tree React committed for it, nothing keys a journey by
the conditions it was read under, and nothing names a place that moved while
its inputs held still. A handler written inline as a JSX attribute is
`anon#n`, and no join can find it.
**Built on:** [ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md)
(the record is places, and everything else is a reader),
[ADR-0055](../context/adr/0055-update-initiators-are-structural-attention.md)
(the structural component path — name, key, props digest, innermost first — as
the portable form of a Fiber, and its rule that a name alone is not a join),
[ADR-0030](../context/adr/0030-two-second-passes-one-variable-each.md) (`again`
and `alone`, which this keys by rather than replaces),
[0028](0028-the-instrument.md) (the names this joins on), [0035](0035-a-flake-is-what-the-run-did-not-execute.md)
(the rung this sharpens).

## Purpose

Two subjects with one journey ran the same code, and the run says so. What it
cannot say is what the places a subject entered *belonged to*. React renders
more than it commits: an attempt restarted after an interleaved update, a
sibling prewarmed under Suspense, an effect run twice under StrictMode, a
hidden `Activity` subtree — each enters regions of the source, and the record
holds them beside the regions of the render that won. Read alone, the journey
of a subject rendered under concurrent React is the union of every attempt, and
the parting it reports against a sibling may be a parting between two
schedulers rather than two stories.

The committed Fiber is React's own record of which attempt won, and it is
deterministic given the inputs. It is the arbiter, and the join is made when the
record is read, never when the probe fires.

## What would discharge it

**1. The join.** A subject's journey read beside the component tree React
committed for it, retained in the portable form ADR-0055 gives an update
initiator: a structural path of name, key and props digest. Nothing retains the
committed tree that way today; ADR-0055 retains the initiators only. A region
entered under a component absent from the committed tree was speculated,
prewarmed, hidden or discarded, and is reported as that rather than as the
subject's path. Both outcomes of one decision entered by one subject means the
component rendered more than once with different state, and is reported as
that. The join is the structural path on the Fiber side against the owner
chain on the region side, and a name alone is not a join; the name is still the
one token both sides share, so an instrumented build must not minify component
names, and a build that did is reported as one the join cannot read.

**2. The key.** Two journeys compare only under one key: build mode and
StrictMode, first read of a page against a repeat, hydration against a client
render, engine, and cache warmth. `again` and `alone` are keys, not noise, and a
parting across two keys is not a parting.

**3. A place that moved with its inputs fixed.** Under one key, with the props
digest equal and the environment clamped, a region one reading entered and the
next did not is reported by name, with the causes the run cannot rule out — the
application's own state outside its inputs, cache warmth, the scheduler — and
never as a diagnosis of a global nobody observed. It is reported whether or not
the output moved, because a function stable in its output and unstable in its
places is an impurity that has not yet found its trigger.

**4. Quarantine derived, prune last.** Comparison is block-granular. A place
that flips under one key and equal inputs is quarantined by the run: excluded
from journey comparison, named in the report, never excluded from selection, and
released when it holds still. A user's prune is accepted only for a place the
run has already reported unstable, is suspended for any run whose diff touches
it, and prints as *matched outside N excluded regions* with the names.

**5. The names the join needs.** A handler written inline as a JSX attribute is
named `anon#n` today, because nothing names a function by the attribute it is
assigned to; a callback handed to an effect is named for the call and its
argument, not for which effect of the component it is. The join reads
`CartCard/onClick` and `CartCard/useEffect.arg0` as places a person can find,
and `CartCard/anon#3` is not one.

## What it forecloses

**A depth limit on comparison.** Depth is not a fact the record holds, and a
limit would be a number nobody can derive.

**A prune that reaches selection.** A pruned place is excluded from the
comparison of two journeys and from nothing else; a change to it still selects
every subject that entered it.

**Merging the baselines of two subjects whose journeys differ and whose output
agrees.** Different journey, same output is a divergence with no observable
consequence yet, and a `catch` in the delta with identical output is a defect,
not a redundancy.

**A field on the record.** Nothing here adds order, counts, spans, phase or
depth to what the page writes. Every item above is a reader.
