<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/history

**Requires:** nothing. `history/client` requires a service already running at an
endpoint you control, and the bearer token it was started with.

The question a single run cannot answer: a button gains 2px, eleven times, each
approved correctly, and nobody ever sees the 22px change. No threshold catches
it, because the quantity that would is a **sum**, and a one-run-at-a-time tool
keeps none.

## What it holds, and what it deliberately does not

This package holds **no storage**. That is a boundary, not an omission — storage
is [`@variance-authority/server`](../server), run by the operator in their own
infrastructure.

What is left is everything that can be argued about without a database: what a
row is allowed to contain, what the numbers mean, and what to say when there is
no store at all.

| entrypoint | requires | holds |
|---|---|---|
| `.` | nothing | the row contract, the drift arithmetic, the wire protocol, the absent store |
| `./client` | a network | `createHttpHistoryStore` |

## What is recorded

Semantic band hashes per component boundary, plus resolved token values. **Never
pixels, never images, never coordinates.** So a question like

```
--va-space-3: 12px → 20px across eight approvals
```

is exact and machine-independent, and nobody has to keep a PNG in their history
to get it.

## Why it cannot be a file in the repository

A committed lock file puts derived state under human merge resolution, and the
hashes of a merge commit are neither branch's. A database has no merge conflicts
because it stores **observations**, not state — two branches observing different
hashes for one key are two rows.

See [spec 0002](../../docs/specs/0002-history-store.md) and
[`epitaphs.md`](../../docs/context/epitaphs.md), which records the local-file
design that was built and killed by this argument.

## Absence is said out loud

```ts
import { createAbsentStore } from '@variance-authority/history';

const store = createAbsentStore();
await store.churn('Button', {});   // Unkept — "no record is kept", not an empty result
```

An unreachable service returning an empty churn produces the sentence "nothing
has drifted", which is a confident answer to a question nobody asked. The HTTP
client throws on every transport failure for the same reason, and
`createAbsentStore` says *no record is kept* rather than answering.

## Who writes a row

**A configured `variance run` does, and so does `variance accept`.** The CLI
parses a `history` config block; `variance run` records the run and its
observations when that block is present *and* the run can name itself, and
`variance accept` records approvals. A run with a store but no identity writes
nothing and says so, because a history that quietly stops growing the day
somebody changes CI provider answers every later drift query over a window
missing the runs nobody noticed were absent.

A store you reach directly through `createHttpHistoryStore`, outside the CLI,
holds exactly what your own code posted to it — and with no writer at all, every
drift query answers from an empty store, which `createAbsentStore` and the
`unkept` sentence above give you a truthful way to report.
