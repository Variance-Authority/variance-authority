# Which input changed, not just which pixels

A diff says a `<div>` rendered a `<p>` on one side and a `<span>` on the other.
That is a symptom, and acting on it means opening the component, guessing which
branch ran, and guessing why. `partingOf` takes those two readings and names
the input that sent them apart — a prop, a context value, an external store, or
a hook cell — along with the component that changed it. Read on when you have a
difference in hand and want its cause rather than its coordinates.

It returns a **parting** — the account of where the two readings diverged and
which input sent them there:

```text
variation — an input changed and the page followed
Cart chose differently — useState #0 changed
  manifests as Summary was handed a different `expanded`
    1 delta here (content)
```

The same evidence connects the output to its inputs. The first line classifies
the difference. The second names the changed input at its origin; the remaining
lines show its effects.

## Run it

`partingOf` ships in `@variance-authority/core`. Reading a React component's
inputs needs `@variance-authority/react`, and this example mounts the component
in jsdom with `@variance-authority/unit-test`:

```bash
npm install --save-dev @variance-authority/core @variance-authority/react \
  @variance-authority/unit-test jsdom
```

```tsx
// parting.test.tsx — Vitest, jsdom environment
import { explainParting, partingOf } from '@variance-authority/core/compare';
import { holdingOf, provenanceOf, wiringOf } from '@variance-authority/react';
import { capture } from '@variance-authority/unit-test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const viewport = { width: 320, height: 200, deviceScaleFactor: 1, colorScheme: 'light' } as const;

function Summary({ total, expanded }: { total: number; expanded: boolean }) {
  return expanded ? <p>{total} items in your cart</p> : <span>{total}</span>;
}

test('which input changed', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const read = async () => {
    const artifact = await capture(container.firstElementChild!, {
      subject: 'cart/empty',
      viewport,
      provenanceOf,
      wiringOf,
      holdingOf,
    });
    return artifact.snapshot;
  };

  await act(async () => {
    root.render(<Summary total={2} expanded={false} />);
  });
  const before = await read();

  await act(async () => {
    root.render(<Summary total={2} expanded />);
  });
  const after = await read();

  const parting = partingOf(before, after);
  expect(parting.deltas.length).toBeGreaterThan(0);
  console.log(explainParting(parting).join('\n'));
});
```

`partingOf` takes the two readings and returns the structured result;
`explainParting` turns that result into the lines printed above.

The two readings need not be two revisions. Two variants of an experiment, two
breakpoints, or the same **subject** read twice — one named UI state you asked
for and can ask for again, identified by a stable id like
`story:checkout--empty` — are all pairs. The last of those is the case
[flakiness](flakiness.md) covers: a flake is where every input agreed and the
output changed anyway, the same question asked of one page instead of two.

---

## What kind of difference this is

Before *which input changed* comes *whether anybody should look*. Every parting
opens with a **slice** — the one word that classifies the whole difference.
There are eight, decided from three facts — did the component tree hold, did any
input change, did the output change — and a fourth that splits one of them:

| slice | reading |
|---|---|
| `settled` | nothing changed: not the tree, not an input, not the output |
| `variation` | an input changed and the output followed — **the only one where the attribution categories below are worth reading** |
| `flake` | every input agreed, the component tree held, and the output changed anyway |
| `placed` | the same, between two readings taken in different places |
| `reshaped` | the component tree is a different tree, no input changed, and the output followed |
| `refactor` | the component tree changed and the output did not |
| `absorbed` | an input changed and the output did not — a variant was assigned differently and rendered the same |
| `unread` | the output changed and what would explain it was not read |

`refactor` is the slice a pixel diff cannot reach at all, because there is
nothing to diff: component identity enters neither the render hash nor any
**band** — the category a visual difference is sorted into, one of `a11y`,
`geometry`, `token`, `content` and `texture` — so wrapping a subtree in a new
`Panel` produces zero deltas. The tree
signature — owner chains and wiring, read directly rather than through a hash —
is what notices.

`reshaped` and `refactor` are the same reading of the component tree with the
output landing on opposite sides. A tree that is a different tree and an output
that followed is a component that chose a different shape — a branch taken
differently between two variants, or a rewrite between two revisions — and in
neither case has a changed input for attribution to name.

`placed` is the fourth fact: *were the two readings taken at one address*. A
subject read twice — across two revisions, or across two moments of one scenario
— is `same`, and an output that moved with every input holding is the accusation.
Two instances lifted out of two subjects at one commit are `elsewhere`, and there
the same evidence means something else. Where a component sits is decided by the
boxes around it, and no component receives its own position as a prop: two
instances that agreed on every input and landed at different coordinates have
contradicted nothing, so they are never reported as a flake.

`unread` is what makes `flake` safe to say. **Unread** means the evidence was
never collected: a run that read no component boundaries has not found the
inputs agreeing, it has not asked them. Because that is a slice of its own,
silence is never reported to you as agreement.

---

## Attribution categories and their evidence

A **boundary** is one component instance in the rendered tree, together with
what it received and what it retained. At every boundary, one rule applies: *a
component whose inputs agreed and whose output changed decided differently.*
Walking up to the shallowest boundary where that holds is what turns a page of
deltas into one sentence.

| category | evidence | where to look |
|---|---|---|
| `handed` | a named prop differs | the parent decided this — up |
| `provided` | a context value differs | a provider above decided this — up |
| `inherited` | a style value differs that this boundary declares none of | an ancestor's cascade — up |
| `external` | a `useSyncExternalStore` snapshot differs | the store changed, outside React |
| `stateful` | an own hook cell differs | **here. This is the cause** |
| `unread` | the output changed and something this boundary depends on could not be read | nowhere yet |
| `undetermined` | every input was read, every input agreed, and the output changed | the component itself |
| `unpaired` | the boundary exists on one side only | — |

A changed prop or context value takes precedence over local state, so `handed`
and `provided` identify incoming changes even when hook cells also differ. The
boundaries whose output changed with no incoming input to explain it are the
**origins**, and they are what the report leads with.

`inherited` is the input nobody passes. `styleProvenance` records where every
winning declaration came from, so a property a node ended up with and no
declaration set *there* arrived from above — `color` from a card, a token from
`:root`. It needs no framework adapter: the boundary is found from the owner
chain and the cascade is read from the snapshot, which is why it is the category a
browser run reaches first.

`external` is one row and covers the ecosystem. Redux, Zustand, Jotai, valtio
and a URL all reach React through `useSyncExternalStore`, so a store that changed
between two readings is named as a store rather than blamed on the component
that happened to subscribe.

---

## The last joint

The chain runs state → prop → attribute → pixel, and a boundary reporting a
count and a band has stopped one link short of the thing a reader is chasing.
`PartedBoundary.moved` closes it:

```text
Inbox chose differently — useState #0 changed
  manifests as Badge was handed a different `tone`
    7 deltas here (a11y, token) — color, padding-bottom, padding-left, padding-right and 1 more
```

`class` is not an admitted attribute and neither is `data-*`, so the class-name
churn a component library emits is not what lands here. The resolved style is —
which is the half a picture would have shown, now with the hook cell at the top
of it.

Four properties, then a count. `padding` expands to four longhands, so the list
is cut at four and the remainder is counted — the line always tells you how many
properties it did not name.

---

## One fork, not its fallout

A state cell at the top of a grid reaches every cell in it. Enumerating the
result is a page of lines that all say the same thing, so above a small fan-out
the fork is reported and the spread is counted:

```text
variation — an input changed and the page followed
Grid chose differently — useState #0 changed
  manifests across 9 boundaries below it, 12 deltas in all
```

The boundaries are still on `Parting.boundaries`, in document order, for a
caller that wants them. What collapses is the sentence, not the evidence.

---

## What it reads

`partingOf` reads **holdings** — the record, made at capture time, of what each
component was handed and what it retained. A holding is attached to each
component's root host node by `holdingOf`: props as one digest per key, context
values by display name, and hook cells in authored call order.

Holdings exist only if the capture asked for them. That is the
`provenanceOf`, `wiringOf` and `holdingOf` triple in the
[Run it](#run-it) example — an excerpt of that call:

```ts
// excerpt — `root`, `subject` and `viewport` come from the full example above
capture(root, { subject, viewport, provenanceOf, wiringOf, holdingOf });
```

**Digests, never values.** A prop can be a customer record and a `useState` cell
can hold the same record with a session token beside it, so what travels is a
digest: enough to compare two readings for equality, and not reversible into
what a user was looking at. The comparison is therefore by shape rather than by
identity — a re-created inline closure is not reported as changed.

**A holding never decides a pass or a fail.** It enters no hash and no band, so
it can never turn a run red on its own. It rides beside the snapshot and is read
only to explain a difference the comparison already found.

The cell list is sparse and says so. A hook that retains nothing a later reading
could disagree about contributes no cell, and each cell carries the position a
person arrives at by counting hook calls down the component — not an index into
React's cell chain, where `useContext` builds none and `useTransition` builds
two. Converting between those two numberings needs the cell count of every hook
by name. Meeting a hook name it has no count for — a hook a later React release
adds, for instance — the reader stops there and records the name that stopped
it, so the cells you get are a prefix that says where it ends rather than a full
list mislabelled from that point on. `holdingOf`, which carries that table, is
documented in the
[`@variance-authority/react` reference](https://variance-authority.dev/reference/packages/react).

---

## What this does not do

- **It does not locate the hook in your source.** `useState #0` is a call
  position, not a `file:line`. Naming the fork is the job. A tool that then reads
  the component to work out which state that is has been told where to start.
- **It gives no verdict.** A **verdict** is the pass-or-fail a run reports:
  `compare` says what changed and `judge` decides whether anyone should mind. A
  parting is an explanation and joins neither. It also accepts two readings of
  two different subjects, because two variants of an experiment are two subjects
  on purpose — tell it so by passing `'elsewhere'` as its third argument, and it
  will not call the difference a flake.
- **Its reach is what was read.** Boundaries come back absent — never `[]` —
  when no node on either side started a component, which puts the parting in the
  `unread` slice rather than in `settled` or `flake`. Boundaries present and
  every one of them in category `unread` means the components were found but
  their props and hook cells were not read, as in a run without a
  framework adapter attached.
- **It is React.** `holdingOf` is a callback, exactly as `provenanceOf` is, so
  another framework supplies its own; no other implementation exists.
