# Where two readings parted

A diff says a `<div>` rendered a `<p>` on one side and a `<span>` on the other.
That is a symptom. Acting on it means opening the component, guessing which
branch ran, and guessing why.

`partingOf` takes the same two snapshots and says something else:

```text
variation — an input moved and the page followed
Cart chose differently — useState #0 moved
  manifests as Summary was handed a different `expanded`
    1 delta here (content)
```

Same evidence, three rungs up. The first line is triage — whether this is worth
opening at all. The second names a cause. The rest is what fell out of it.

The two readings need not be two revisions. Two variants of an experiment, two
breakpoints, or **the same subject read twice** are all pairs, and the last one
connects directly to [`flakiness.md`](flakiness.md): a flake is the case where
every input agreed and the output moved anyway, the same question asked of one
page instead of two.

---

## The slice: what kind of parting this is

Before *which input moved* comes *whether anybody should look*. Seven answers,
decided from three facts — did the component tree hold, did any input move, did
the output move:

| slice | reading |
|---|---|
| `settled` | nothing moved: not the tree, not an input, not the output |
| `variation` | an input moved and the output followed — **the only one where the rungs below are worth reading** |
| `flake` | every input agreed, the component tree held, and the output moved anyway |
| `reshaped` | the component tree is a different tree, no input moved, and the output followed |
| `refactor` | the component tree moved and the output did not |
| `absorbed` | an input moved and the output did not — a variant was assigned differently and rendered the same |
| `unread` | the output moved and what would explain it was not read |

`refactor` is the slice a pixel diff cannot reach at all, because there is
nothing to diff: component identity is outside `renderHash` and outside every
band, so wrapping a subtree in a new `Panel` produces zero deltas. The tree
signature — owner chains and wiring, read directly rather than through a hash —
is what notices.

`reshaped` and `refactor` are the same reading of the component tree with the
output landing on opposite sides. A tree that is a different tree and an output
that followed is a component that chose a different shape — a branch taken
differently between two variants, or a rewrite between two revisions — and in
neither case is there a moved input for the rungs below to name.

`unread` is why `flake` is safe to say. Nondeterminism is an accusation, and a
run that read no boundaries has not found the inputs agreeing — it has not asked
them ([ADR-0002](context/adr/0002-observation-profiles.md)). The two are separate
slices so silence can never be reported as agreement.

---

## The rungs: how far up it traced

At every component boundary, one rule: *a component whose inputs agreed and
whose output moved decided differently.* Walking up to the shallowest boundary
where that holds is what turns a page of deltas into one sentence.

| rung | what it means | where to look |
|---|---|---|
| `handed` | a named prop differs | the parent decided this — up |
| `provided` | a context value differs | a provider above decided this — up |
| `inherited` | a style value differs that this boundary declares none of | an ancestor's cascade — up |
| `external` | a `useSyncExternalStore` snapshot differs | the store moved, outside React |
| `stateful` | an own hook cell differs | **here. This is the cause** |
| `unread` | the output moved and something this boundary depends on could not be read | nowhere yet |
| `undetermined` | every input was read, every input agreed, and the output moved | the component itself |
| `unpaired` | the boundary exists on one side only | — |

Anything arriving from outside settles the question, so `handed` and `provided`
outrank the state rungs however much state the boundary is also holding. The
boundaries whose output moved with no incoming input to explain it are the
**origins**, and they are what the report leads with.

`inherited` is the input nobody passes. `styleProvenance` records where every
winning declaration came from, so a property a node ended up with and no
declaration set *there* arrived from above — `color` from a card, a token from
`:root`. It needs no framework adapter: the boundary is found from the owner
chain and the cascade is read from the snapshot, which is why it is the rung a
browser run reaches first.

`external` is one row and covers the ecosystem. Redux, Zustand, Jotai, valtio
and a URL all reach React through `useSyncExternalStore`, so a store that moved
between two readings is named as a store rather than blamed on the component
that happened to subscribe.

---

## The last joint

The chain runs state → prop → attribute → pixel, and a boundary reporting a
count and a band has stopped one link short of the thing a reader is chasing.
`PartedBoundary.moved` closes it:

```text
Inbox chose differently — useState #0 moved
  manifests as Badge was handed a different `tone`
    7 deltas here (a11y, token) — color, padding-bottom, padding-left, padding-right and 1 more
```

`class` is not an admitted attribute and neither is `data-*`, so the class-name
churn a component library emits is not what lands here. The resolved style is —
which is the half a picture would have shown, now with the hook cell at the top
of it.

Four properties, then a count. `padding` expands to four longhands and a reader
who has seen the first learns nothing from the rest; what was dropped is counted
rather than elided, because a list that quietly ends reads as the whole list.

---

## One fork, not its fallout

A state cell at the top of a grid reaches every cell in it. Enumerating the
result is a page of lines that all say the same thing, so above a small fan-out
the fork is reported and the spread is counted:

```text
variation — an input moved and the page followed
Grid chose differently — useState #0 moved
  manifests across 9 boundaries below it, 12 deltas in all
```

The boundaries are still on `Parting.boundaries`, in document order, for a
caller that wants them. What collapses is the sentence, not the evidence.

---

## What it reads

```ts
capture(root, { …, provenanceOf, wiringOf, holdingOf })
```

`holdingOf` attaches, to each component's root host node, what that component
was handed and what it retained: props one digest per key, context values by
display name, and hook cells in authored call order.

**Digests, never values.** A prop can be a customer record and a `useState` cell
can hold the same record with a session token beside it, so what travels is a
digest — enough for an equality comparison, and not reversible into what a user
was looking at. The cost is the one `propsDigest` already accepts: shape rather
than identity, so a re-created inline closure does not register as moved. That
is tolerable here for the same reason it is tolerable there: this decides *who is
responsible* for a difference the semantic diff already found, never *whether*
there is one.

**Nothing here reaches a hash.** A hook's value is precisely the thing that
legitimately differs between two readings of an unchanged page, so a band
carrying it would be a flake generator wearing a band's name. The holding rides
beside the snapshot exactly as `styleProvenance` does, and this reader is what
it was kept for.

The cell list is sparse and says so. A hook that retains nothing a later reading
could disagree about contributes no cell, and each cell carries the position a
person arrives at by counting hook calls down the component — not an index into
React's cell chain, where `useContext` builds none and `useTransition` builds
two. Meeting a hook name it has no arity for, the reader stops and records where
([`holding.ts`](../packages/core/src/format/holding.ts)), because a full list
silently mislabelled from the fourth entry on is the failure this project exists
to refuse.

---

## What this does not do

- **It does not locate the hook in your source.** `useState #0` is a call
  position, not a `file:line`. Naming the fork is the job. A tool that then reads
  the component to work out which state that is has been told where to start.
- **It gives no verdict.** `compare` says what moved and `judge` says whether
  anyone should mind; a parting is an explanation and joins neither. It takes
  two snapshots without refusing a subject mismatch, because two variants of an
  experiment are two subjects on purpose.
- **Its reach is what was read.** Boundaries come back absent — never `[]` —
  when no node on either side started a component, which puts the parting in the
  `unread` slice rather than in `settled` or `flake`. Boundaries present and
  every one of them at rung `unread` is the next reading up: the components were
  found and their props and hook cells were not, which is every run without a
  framework adapter attached.
- **It is React.** `holdingOf` is a callback, exactly as `provenanceOf` is, so
  another framework supplies its own; no other implementation exists.
