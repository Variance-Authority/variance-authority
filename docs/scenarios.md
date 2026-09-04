# Runtime scenarios

A runtime scenario makes AAA visible as a state machine. Arrange is a named,
observed precondition; Act is an authored transition label; Assert is the
variance assessment across that edge. One execution is a witnessed path, and
several executions fold into a partial graph.

This answers a question a list of clicks cannot: whether two runs already differ
at Arrange, whether one Act has the same effect under both preconditions, and
which Act first changes that effect.

## Named worlds are Arrange states

`page`, `page-loading`, `page-error`, `page-one-article`, and
`page-two-articles` remain distinct subjects. The collector, fixture, route,
story, server, or test host produces each world. The scenario records which one
was arranged and what it rendered; it does not inspect mocks or invent another
precondition vocabulary.

Their links come from the same planned-subject resolver described in
[`variations.md`](variations.md). A `variance-parent:` tag wins, a configured
name grammar reads declared axes, and the unconfigured great-green-dragon rule
uses the longest subject prefix at a separator. The resolved link and its
evidence travel with the execution. Changing the grammar changes the reading,
not subject identity or snapshot hashes.

## The third A owns three distinct comparisons

The assessment keeps three pairs separate:

| Reading | Pair | Question |
| --- | --- | --- |
| Arrange variation | initial state against initial state | Did the executions begin differently? |
| Transition effect | state before an Act against its outcome | What moved across this edge? |
| Execution divergence | one transition effect against the corresponding effect | At which Act did behaviour stop agreeing? |

The transition-effect digest is derived from semantic deltas. It remains stable
when an unrelated edit moves both sides of an edge together, and changes when the
Act produces a different delta. It is inquiry evidence, not a regression verdict:
scenario assessment writes no baseline, approval, history row, changelog, or
exit code.

## What the edge was, not only that there was one

The first two readings carry a **parting**. A digest says the Act had an effect;
the parting says which input made it, and its slice is the triage.
[`parting.md`](parting.md) defines the seven slices. Three of them read
differently when the two readings are separated by a moment rather than by a
page:

| slice | the edge was |
| --- | --- |
| `variation` | the Act moved state and the page followed. It did what it meant to |
| `absorbed` | an input moved and the page did not. The Act landed on nothing |
| `reshaped` | a different component tree from the same inputs — a boundary resolved |

*Snapshot, click, snapshot* and *snapshot, wait for a boundary, snapshot* are not
two features. They are one comparison, and the slice is the only place they part:
a click that worked is `variation` with a hook cell named under it, an arrival is
`reshaped`, and neither is reported as the accusation `flake` — which stays
reserved for the edge where every input a run actually read agreed.

An Act is identified by an authored key and its occurrence. DOM event bubbling,
selectors, accessible names, and targets are not identity. Alignment stops at
the first inserted, missing, or repeated Act and reports the unmatched values;
it never shifts later ordinals to manufacture agreement.

## The graph contains only witnessed edges

Frames with the same render hash are one machine state. A shared destination is
convergence. One state and Act with several observed destinations is branching
and remains several edges, never a last-write-wins record.

An initial capture or Act outcome can be explicitly unobserved. That terminates
the reachable prefix, preserves its diagnostics, and leaves the transition
unknown. No empty snapshot, empty variance, later frame, or impossible edge is
synthesized from missing evidence.

Profiles remain part of the comparison basis. When a jsdom path is assessed
beside a Chromium path, geometry names jsdom as the blind side; it does not read
as unchanged because one side had no boxes to compare.

## Retention is separate from recording

Scenario values are ephemeral by default. Holding a run in a session retains its
semantic snapshots; dropping the value retains nothing.

The optional scenario archive stores a small versioned manifest and canonical
semantic snapshots by content digest. Its address covers project, run, scenario,
execution, precondition, profile, and attempt. Equal snapshots share one object.
Expiry, missing objects, and refused admission are explicit unobserved outcomes.

The archive is text-only and independent of baseline storage and history. It
stores no raster or resource-closed document, and its write has no promotion or
verdict semantics. Because semantic snapshots contain readable page and source
evidence, archival requires declared retention, access, deletion, and admission
policy; values the policy cannot retain are refused before anything is written.

Use [`@variance-authority/scenario`](../packages/scenario) for the runtime API.
