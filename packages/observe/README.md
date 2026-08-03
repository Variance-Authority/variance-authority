# @variance-authority/observe

**Requires:** a `Renderer` and a `RasterStore`, both passed in — so it needs
neither a browser nor a directory of its own, and swapping either is a wiring
decision it does not notice. Pass a `snapshot` and a `source` index too, unless a
pixel count with coordinates is all you want back.

Two images and a verdict — `unchanged`, `changed`, `new` or `incomparable` —
attributed to a component and a file rather than to the machine that painted the
pixels. Either both images are produced now and discarded, or one is compared
against a baseline you stored earlier. The two are one function each, and picking
between them is the only decision this package leaves open — everything else
about the order is fixed, which the next section is about.

## Whether to import it or copy it

**Import it if the order it hard-wires is the order you want; copy it if not.**
It is the only place in the repository where a phase order is fixed, and it is
assembled from the same public tools you would use yourself — nothing below it
imports it, so replacing it costs you nothing that is not in this file.
[`docs/architecture.md`](../../docs/architecture.md) is the argument for why the
order lives here rather than in every package.

A composition inherits the requirements of everything it composes, which is why
the `Renderer` and `RasterStore` above are parameters rather than dependencies:
they are how this package avoids acquiring a browser and a directory of its own.

## Two modes, one function each

```ts
import { observePair, observeAgainstBaseline } from '@variance-authority/observe';

// `renderer` and `store` are required. `snapshot` is the normalized semantic
// snapshot of the same render and `source` the component→file index: both are
// optional, and both are the whole reason to bother — without them an
// observation is a pixel count with coordinates, which is unassignable.
const wiring = { renderer, store, snapshot, source };

// Ephemeral: both images produced now, by one renderer, and thrown away.
// The machine cancels out by construction — there is no second machine.
const ephemeral = await observePair(before, after, wiring);

// Durable: render this side, compare against a stored baseline.
const durable = await observeAgainstBaseline(document, { subject: 'story:card' }, wiring);
```

Both return the same `Observation`, so a pipeline is written once and run either
way. What differs is where the other image came from and whether anyone is
allowed to trust it later.

## What it adds beyond wiring

The part that is genuinely about composition: **which verdicts exist, and which
of them are allowed to be `unchanged`.**

| verdict | meaning |
|---|---|
| `unchanged` | one machine painted both, and no pixel differs |
| `changed` | with regions, components and files attached |
| `new` | no baseline. Not a pass, and not a failure |
| `incomparable` | a baseline exists, produced by a different machine |

`incomparable` is the verdict that keeps the durable mode honest. Comparing
across identities yields a large, confident diff caused by a font stack or a
driver, which the report would then attribute to whichever component happens to
sit under the pixels. So the comparison is refused instead — and **`unchanged` is
never available on that path**, because an unobservable difference must never be
reported as no difference.

The refusal names both machines:

```
incomparable — the baseline was painted by playwright-chromium (chromium@131.0.0,
linux/x64, 1x) and this run is darwin/arm64, 2x
```

## Where a baseline lives decides nothing about what it means

**The store is not part of the verdict.** All four outcomes — `unchanged`,
`changed`, `new`, `incomparable` — come out the same through the durable store,
the git-LFS store and a store across a real socket, and each expected answer is
pinned rather than merely compared across the three
([`parity.test.ts`](src/parity.test.ts)). So you may choose a backend on
operational grounds alone.

If moving the store changed a verdict, the verdict was never about the subject
and every argument this project makes about attributing a change to a component
would be describing the deployment instead.
