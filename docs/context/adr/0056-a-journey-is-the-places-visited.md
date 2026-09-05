# ADR-0056 — A journey is the places visited, and the committed tree decides

**Status:** accepted
**Date:** 2026-09-06
**Extends:** ADR-0002 (absent is not empty), ADR-0009 (sessions detect instead
of rinse), ADR-0030 (`again` and `alone`, one variable each), ADR-0055 (update
initiators are structural attention)
**Relates to:** [spec 0028](../../specs/0028-the-instrument.md) (the instrument),
[spec 0035](../../specs/0035-a-flake-is-what-the-run-did-not-execute.md) (the
rung that reads the record), [spec 0036](../../specs/0036-a-journey-crosses-processes.md)
(the record across a process), [spec 0038](../../specs/0038-a-journey-is-read-against-the-committed-tree.md)
(the readers this decision makes possible and does not build),
[journal 0040](../journal/0040-photos-not-steps.md) (how this was reached)

## Context

A journey is what the instrument records for one subject: the regions of
instrumented source the execution entered while the subject was painted, one
presence bit per region. The specs it was written under promised more — a
maintained stack so each crossing records how it was reached, a trie of routes,
counts per block, a call-stack depth per crossing. Three clean-room rounds on
what a journey says beside a subject's Fiber and DOM tree — the same output with
different journeys, the same journey with different output, memoization as a
side effect the journey sees, concurrent React moving the set with every input
held — kept arriving at the same wall.

The wall is `async`. A function is entered once and resumed once per `await`,
and between the two the same page runs other executions: another subject's
effect, a service response, React's own scheduler. A bracket that opens at entry
and closes at exit closes around somebody else's work. A current-block global is
wrong after the first `await`. The browser has no async context to hang either
on. So order, counts, spans, depth, and the route by which a block was reached
are not facts the page can write down. What it can write down is that a place
was visited, and the `resume` region already makes each continuation a place of
its own.

Two readings were overturned on the way. *Journey moved with output held* is not
benign: a pure function is stable in what it returns *and* in where it went, and
a function whose places move with its inputs fixed is an impurity that has not
yet found its trigger. And *modern React yields stable journeys, so an unstable
one is state outside React* is false as a printed sentence: React moves the set
itself — a render restarted after an interleaved update, a discarded attempt,
StrictMode running effects twice, a cold Suspense cache, sibling prewarming, an
eager-state bailout, hydration for whichever subject was first. Only
`useSyncExternalStore` is honestly outside React.

## Decision

**A journey is the set of regions an execution entered. Everything else is read
from that record at report time, and nothing is added at runtime.**

The premise under every reader is that the record is a map and not the
territory. It answers *has this execution been here* and, at a fork, *which way
did it go* — and both arms of one fork can have been walked, by a component
that rendered twice with different state or a loop that went both ways. Two
executions with one record are one record, however differently they walked it.
A reader that draws a journey as a route through the file, one arm per fork,
has mistaken the map for the trip.

1. **Record places.** One presence bit per region and subject. No occurrence, no
   span, no stack, no count, no order, no depth.

2. **A block's name is lexical.** A region is named from the inventory, by the
   declaration path under its owner and by its kind: `CartCard` for the
   component's own entry, `CartCard/onClick` for a handler declared under it,
   `CartCard/useEffect.arg0` for the callback handed to an effect, and the
   handler's own declaration for code that is not React. Its identity is the
   ordinal and the digest of its own source, because the name is not unique —
   two effects in one component share one today. The name already separates a
   render body from an effect from a handler; no phase is tagged when the
   probe fires.

3. **The drain is per subject.** Each collector drains the page once its
   observation is complete and before another subject runs on it, so what a
   subject holds is what ran on the page between the previous drain and its
   own. Selection reads the union of those sets against the innermost region of
   each changed line. A subject the diff does not reach is *not run*, never
   *unaffected* and never *covered*.

4. **Anything more is a reader.** Joining the record to the component tree
   React committed, keying a journey by the conditions it was read under,
   naming a place that moved with its inputs fixed, and quarantining or pruning
   one are readers over this record. They are contracted in
   [spec 0038](../../specs/0038-a-journey-is-read-against-the-committed-tree.md)
   and none of them adds a field to what the page writes.

## What it forecloses

- **Occurrence and span records, a maintained stack, a route trie, per-block
  counts, a recorded depth.** Spec 0027's *historical execution stack* and
  route lines, spec 0028's *maintained stack so each crossing records how it
  was reached*, spec 0029's droppable trie nodes, spec 0030's kept trie
  prefixes and spec 0036's per-crossing call-stack depth are withdrawn; the
  specs are amended to presence. The reverse index still accepts a depth from
  a foreign execution index and prints it as supplied; this project's own
  record writes none.
- **Phase tags recorded at runtime for selection.** The drain per subject
  already filters by time, and the lexical name already says which phase.
- **A depth limit on comparison.** Depth is not a fact the record holds.
- **Any proposal that needs order, counts, spans or a runtime stack.** It is out
  under this decision, not deferred by it.

## Consequences

The join gives a module's root region to every subject the run drained. Every
other region entered during module evaluation — a helper the root calls, a
module-scope branch or loop — is charged to whichever subject's window the
module first evaluated in. A later subject whose only crossing of a changed
region was at module initialization is therefore not selected by a change to
it. That is the unsafe direction; the
site in [`journal.ts`](../../../packages/sense/src/test-selection/journal.ts)
carries the marker.

Region names come from source and component names from the function, so any
reader that joins the two needs an instrumented build that does not minify
component names. That is a cost of the join, carried by spec 0038, and not a
constraint on the record.

A cross-process reading — the page's journey unchanged, a service's journey
changed, pixels identical — is a backend regression that passed in silence, and
it is reportable exactly where a head, a second instrumented process reporting
under the same execution id, reported ([spec 0036](../../specs/0036-a-journey-crosses-processes.md)).
