# @variance-authority/observe

**Requires:** a `Renderer` and a `RasterStore`, both passed in — so it needs
neither a browser nor a directory of its own, and swapping either is a wiring
decision it does not notice.

One composition, shipped as an example.

## Why this package exists at all

[`docs/architecture.md`](../../docs/architecture.md) opens with *"there is no
pipeline — there are tools, and a pipeline is something a user assembles from
them."* This package is where that claim is kept honest.

It is the **only** place in the repository where an order is hard-wired, it is
named for being one, and it is assembled from the same public tools anybody else
would use. Nothing below it imports it.

It also demonstrates the rule about compositions: a composition inherits the
requirements of everything it composes, so it cannot hide. Anything else in this
repository claiming to be a tool while depending on four requirements is a
composition that has not admitted it.

## Two modes, one function each

```ts
import { observePair, observeAgainstBaseline } from '@variance-authority/observe';

// Ephemeral: both images produced now, by one renderer, and thrown away.
// The machine cancels out by construction — there is no second machine.
const observation = await observePair(before, after, { renderer, store, snapshot, sourceIndex });

// Durable: render this side, compare against a stored baseline.
const observation = await observeAgainstBaseline(document, { subject: 'story:card' }, {
  renderer, store, snapshot, sourceIndex,
});
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

[`parity.test.ts`](src/parity.test.ts) runs four scenarios — `unchanged`,
`changed`, `new`, `incomparable` — through the durable store, the git-LFS store
and a store across a real socket, and **pins the expected answer** as well as
comparing the three. Three stores agreeing on a wrong answer is not a pass, and a
test that only checked agreement could not tell the difference.

If moving the store changed a verdict, the verdict was never about the subject
and every argument this project makes about attributing a change to a component
would be describing the deployment instead.
