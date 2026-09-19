# Runtime scenarios

A snapshot test tells you that one UI state looks the way it did. It cannot tell
you that clicking Delete does the same thing on a page with one article as on a
page with two. A **runtime scenario** records that: a named starting state, a
fixed sequence of authored steps, and what the UI looked like after each one.
Read this page when you want to compare two such recordings.

New here? Start with [your first run](start.md).

Arrange is a named, observed precondition. Act is a label you author for a
transition your own harness performs. Assert is the variance assessment across
that edge. One **execution** — one recorded path through those states — is what
you compare; several executions fold into a partial graph.

This answers a question a list of clicks cannot: whether two executions already
differ at Arrange, whether one Act has the same effect under both
preconditions, and which Act first changes that effect.

Two terms are used throughout below. A **subject** is one named UI state you
asked for and can ask for again, identified by a stable id such as
`page-one-article`; here a subject is the precondition a recording starts from,
and arranging it is your harness's job. An **observation profile** is what the
capture surface was able to see at all, independent of what it found: `jsdom`
resolves roles, accessible names and author-declared style but has no layout
engine, while `chromium` adds the resolved cascade, real geometry and pixels.

## Run it

```bash
npm install --save-dev @variance-authority/scenario @variance-authority/core
```

The package records and compares. It drives nothing: it opens no browser, fires
no click and renders nothing. Your harness performs the Acts and hands the
package the observations.

The [`@variance-authority/scenario`
reference](https://variance-authority.dev/reference/packages/scenario) shows a
complete `scenario-demo.ts` — two recordings of one Act under two preconditions,
the printed assessment, and the fold into a state machine — that you can save and
run as it stands.

## Each precondition is a named subject

`page`, `page-loading`, `page-error`, `page-one-article`, and
`page-two-articles` remain distinct subjects. The collector that produced the
observation — a fixture, a route, a story, a server, or your test host — decides
which world exists. The scenario records which one was arranged and what it
rendered.

A precondition can be recorded with a link to the subject it varies:
`page-error` derives from `page`. The package does not compute that link. Your
harness resolves it and passes it through, and the recording notes both the
parent and how it was resolved, whether declared on the subject or read from its
name. [Variations](variations.md) describes that resolution: a
`variance-parent:` tag wins; otherwise a configured name grammar reads the axes
you declared, and with no configuration the parent is the longest other subject
id this one extends at a separator, so `checkout-dark-narrow` varies
`checkout-dark`. Changing the grammar changes the reading, not subject identity
or snapshot hashes.

## The third A owns three distinct comparisons

The assessment keeps three pairs separate:

| Reading | Pair | Question |
| --- | --- | --- |
| Arrange variation | initial state against initial state | Did the executions begin differently? |
| Transition effect | state before an Act against its outcome | What changed across this edge? |
| Execution divergence | one transition effect against the corresponding effect | At which Act did behaviour stop agreeing? |

The transition-effect digest is derived from semantic deltas. It remains stable
when an unrelated edit shifts both sides of an edge together, and changes when the
Act produces a different delta. It is inquiry evidence, not a regression verdict:
scenario assessment writes no baseline, approval, history row, changelog, or
exit code.

## What the edge was, not only that there was one

The first two readings give you a **parting** — the account of where two readings
diverged and which input sent them there. A digest says the Act had an effect;
the parting says which input made it, and its one-word **slice** is the triage.
[Parting](parting.md) defines the full set of slices. Three of them read
differently when the two readings are separated by a moment rather than by a
page:

| slice | the edge was |
| --- | --- |
| `variation` | the Act changed state and the page followed. It did what it meant to |
| `absorbed` | an input changed and the page did not. The Act landed on nothing |
| `reshaped` | a different component tree from the same inputs — a boundary resolved |

*Snapshot, click, snapshot* and *snapshot, wait for a boundary, snapshot*
produce the same comparison, and the slice is the only place they part: a click
that worked is `variation`, with the hook cell that changed named under it; an
arrival is `reshaped`. Neither is reported as `flake`, which stays reserved for
the edge where every input the run actually read agreed.

An Act is identified by an authored key and its occurrence. DOM event bubbling,
selectors, accessible names, and targets are not identity. Alignment stops at
the first inserted, missing, or repeated Act and reports the unmatched values;
it never shifts later ordinals to manufacture agreement.

## The graph contains only witnessed edges

Frames with the same render hash — the content digest of what rendered — are one
machine state. Two paths that reach one hash converge on one node. One state and
Act with several observed destinations is branching: every edge survives, so you
see the branch rather than whichever run wrote last.

An initial capture or an Act outcome can be recorded as explicitly unobserved.
That ends the reachable path, keeps its diagnostics, and leaves the transition
unknown rather than filling it with an empty snapshot or a later frame.

Profiles remain part of the comparison basis. When a jsdom path is assessed
beside a Chromium path, geometry names jsdom as the blind side; it does not read
as unchanged because one side had no boxes to compare.

## Retention is separate from recording

**Retention** here is whether recorded evidence survives the process. By default
it does not: the recording is a value in memory, so a reference to it keeps its
semantic snapshots alive and dropping that reference keeps nothing.

When the evidence has to outlive the process, `createScenarioArchive` from
`@variance-authority/scenario/archive` stores a small versioned manifest and
canonical semantic snapshots by content digest. Its address covers project, run,
scenario, execution, precondition, profile, and attempt. Equal snapshots share
one object. Expiry, missing objects, and refused admission all read back as
explicitly unobserved rather than as absent.

The archive is text-only and independent of baseline storage and history. It
stores no raster or resource-closed document, and its write has no promotion or
verdict semantics. Because semantic snapshots contain readable page and source
evidence, archival requires declared retention, access, deletion, and admission
policy; values the policy cannot retain are refused before anything is written.

The runtime API is [`@variance-authority/scenario`](https://variance-authority.dev/reference/packages/scenario).
