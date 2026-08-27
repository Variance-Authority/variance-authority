<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/history

> Retain visual-regression observations across runs and answer churn, flakiness, reach and token-drift questions.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

Use this package when a visual-regression pipeline needs to retain observations
across runs and turn them into churn, flakiness, reach, or token-drift answers.
The root entrypoint is pure contract and arithmetic; `history/client` is the
optional HTTP client for a service you run.

**Requires:** nothing for the root entrypoint. `history/client` requires a
running service endpoint and its bearer token.

A single run cannot describe accumulation: a button can gain 2px across eleven
approved runs without any one review seeing the 22px travel. History keeps the
rows and the arithmetic that makes that sum observable.

```bash
npm install --save-dev @variance-authority/history
```
## Contract and storage boundary

This package holds **no storage**. That is a boundary, not an omission — storage
is `@variance-authority/server`, run by the operator in their own
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
--va-space-3: 12px → 20px across eleven approvals
```

is exact and machine-independent, and nobody has to keep a PNG in their history
to get it.

## Detect accumulated drift

`detectDrift(journey, options)` is the arithmetic the 22px story needs, and it
returns `null` when the token's travel is not worth anybody's attention. Two
thresholds decide that, and both exist to stop the report crying wolf about an
ordinary edit:

| option | default | what it decides |
|---|---|---|
| `minSteps` | `2` | fewest value changes that can constitute a journey. Below it, this is one edit somebody made on purpose and already reviewed |
| `minRatio` | `2` | least ratio of total travel to the largest single step. The ratio *is* the finding — it says how thinly the change was spread, which is exactly how it got past eleven correct reviews. A token that moved 8px in one 8px step has a ratio of 1 and nothing to report |

A `null` is an observation rather than an absence: the values were recorded, they
were read, and they did not add up to a journey. The one case where nothing is
not an answer is a journey whose limit excluded steps — an incomplete journey is
always returned and always says so, because a `null` there would claim a
stability the slice cannot support.

## Why history is external

A committed lock file puts derived state under human merge resolution, and the
hashes of a merge commit are neither branch's. A database has no merge conflicts
because it stores **observations**, not state — two branches observing different
hashes for one key are two rows.

## Represent missing history

```ts
import { createAbsentStore } from '@variance-authority/history';

const store = createAbsentStore();
await store.churn('Button', {});   // Unkept — "no record is kept", not an empty result
```

An unreachable service returning an empty churn produces the sentence "nothing
has drifted", which is a confident answer to a question nobody asked. The HTTP
client throws on every transport failure for the same reason, and
`createAbsentStore` says *no record is kept* rather than answering.

## Writers and client options

**A configured `variance run` does, and so does `variance accept`.** The CLI
parses a `history` config block; `variance run` records the run and its
observations when that block is present *and* the run can name itself, and
`variance accept` records approvals. A run with a store but no identity writes
nothing and says so, because a history that quietly stops growing the day
somebody changes CI provider answers every later drift query over a window
missing the runs nobody noticed were absent.

`createHttpHistoryStore` takes:

| option | default | what it decides |
|---|---|---|
| `endpoint` | required | base URL of the service you run, e.g. `http://history.internal:7788` |
| `token` | required | the bearer the service was started with. The service holds no accounts and no identity of its own; everything it stores was produced by runs you own, and the token is how it refuses a write it cannot attribute to one |
| `project` | none | scopes every query and is checked against every row written. Optional because a single-project deployment does not need it, and dangerous to omit on a shared one: unscoped queries blend two projects' `Button` into one rate and nothing in the answer would show it. Set, a write carrying another project's rows throws rather than landing in the wrong history |
| `timeoutMs` | `10000` | a history query that hangs must fail, not stall the run |
| `fetch` | `globalThis.fetch` | for a caller with its own agent or proxy |

A store you reach directly through `createHttpHistoryStore`, outside the CLI,
holds exactly what your own code posted to it — and with no writer at all, every
drift query answers from an empty store, which `createAbsentStore` and the
`unkept` sentence above give you a truthful way to report.
