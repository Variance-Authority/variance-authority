<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/history

> Retain visual-regression observations across runs and answer churn, flakiness, reach and token-drift questions.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

## What this is for

A button gains 2px across eleven approved runs, and no single review sees the
22px travel. Every one of those reviews was correct: the quantity that would have
caught it is a sum, and a tool that looks at one run at a time keeps none.

This package keeps the rows a sum needs, and does the arithmetic over them. Give
it a **design token**'s recorded values across a window of runs and it tells you
whether they add up to a finding, and how thinly the change was spread.

```bash
npm install --save-dev @variance-authority/history
```

## Requirements

Node 22 or newer. The package is ESM-only (`"type": "module"`) and imports
`@variance-authority/core`, which `npm install` pulls in for you. Nothing here
opens a socket or touches a disk; the two entrypoints are:

| entrypoint | requires | holds |
|---|---|---|
| `.` | nothing | the row contract, the drift arithmetic, the wire protocol, `createAbsentStore` |
| `./client` | a reachable service | `createHttpHistoryStore` |

## Detect accumulated drift

`detectDrift` takes a **journey** — one design token's recorded values over a
window of runs, oldest first — and reduces it to a finding or to `null`. The
values are the only input it needs, so this runs with no service and no config:

```ts
import { describeDrift, detectDrift, type Journey } from '@variance-authority/history';

// Eleven approved commits, each adding 2px to the same token.
const journey: Journey = {
  token: '--va-space-3',
  window: { since: '2026-01-01T00:00:00Z' },
  values: Array.from({ length: 12 }, (_, index) => ({
    project: 'shop',
    token: '--va-space-3',
    value: `${12 + index * 2}px`,
    commit: `c${index}`,
    at: `2026-01-${String(index + 1).padStart(2, '0')}T09:00:00Z`,
  })),
  omitted: 0,
};

const found = detectDrift(journey);
if (found !== null) console.log(describeDrift(found));
```

### What you get

The sentence `describeDrift` prints:

```
`--va-space-3` drifted 12px → 34px, 22px across 11 approved commit(s)
(2026-01-01T09:00:00Z → 2026-01-12T09:00:00Z); the largest single step was 2px,
so no per-change review could have seen the total
```

And the `TokenDrift` behind it, with the eleven `steps` abridged to two:

```json
{
  "token": "--va-space-3",
  "from": "12px",
  "to": "34px",
  "steps": [
    { "from": "12px", "to": "14px", "commit": "c1", "at": "2026-01-02T09:00:00Z" },
    { "from": "32px", "to": "34px", "commit": "c11", "at": "2026-01-12T09:00:00Z" }
  ],
  "readings": 12,
  "firstAt": "2026-01-01T09:00:00Z",
  "lastAt": "2026-01-12T09:00:00Z",
  "quantity": { "unit": "px", "from": 12, "to": 34, "net": 22, "largestStep": 2, "travel": 22 },
  "ratio": 11,
  "notable": true,
  "incomplete": false,
  "omitted": 0
}
```

`steps` carries the commit behind every change, which is what turns `12px → 34px`
into an investigation somebody can finish. `quantity` and `ratio` are absent when
the values cannot be subtracted — a colour, a font stack, a shadow — and
`unquantifiable` then says why, so a colour that changed five times stays a
finding rather than becoming an empty number.

### The two thresholds

Pass them as `detectDrift(journey, { minSteps, minRatio })`. Both counts are
dimensionless: `minSteps` counts value changes, `minRatio` is a ratio of two
distances in the token's own unit.

| option | default | what it decides |
|---|---|---|
| `minSteps` | `2` | fewest value changes that can constitute a journey. Below it, this is one edit somebody made on purpose and already reviewed |
| `minRatio` | `2` | least ratio of total travel to the largest single step. The ratio *is* the finding — it says how thinly the change was spread, which is exactly how it got past eleven correct reviews. A token that moved 8px in one 8px step has a ratio of 1 and nothing to report |

`null` means the values were recorded, they were read, and they did not add up to
a journey. One case never answers `null`: a journey whose `limit` excluded values
comes back with `incomplete: true` and a non-zero `omitted`, because a `null`
there would claim a stability the slice cannot support.

## What is recorded

Band hashes per component boundary, plus resolved design-token values. **Never
pixels, never images, never coordinates.**

- A **component boundary** is a node in the rendered tree where one component's
  output begins. A component rendered three times in a subject has three.
- A **band hash** is a digest of one part of what a boundary rendered:
  `structure`, `style`, or `geometry`. Three bands, three digests, taken from the
  semantic snapshot rather than from the image — so the hash moves when the
  component's own code moves, and it means the same thing on every machine.
- A **subject** is one named UI state you asked for and can ask for again: a
  story, a route, a fixture, a value.

A row is written only when a hash moves, and is roughly a hundred bytes: a
300-subject run in which two components changed writes two rows plus the run
itself. Quiet runs are recorded too — they are the denominator every rate divides
by.

Because the record holds resolved values rather than rasters, an answer like

```
--va-space-3: 12px → 20px across eleven approvals
```

is exact and machine-independent, and nobody has to keep a PNG to get it.

## The four questions

Every question is a method on `HistoryStore` returning `Answer<T>` — the result,
or the statement that no record is being kept. Narrow with `isKept`, then hand
the result to the matching sentence function.

| question | method | sentence | what the number is |
|---|---|---|---|
| churn | `store.churn(component, window)` | `describeChurn` | approved changes caused by this component, per run recorded in the window, and per band |
| flakiness | `store.flakiness(subject, window)` | `describeFlakiness` | occurrences per sweep — a sweep being a run that read every subject twice. Absent, never zero, when nothing swept |
| reach | `store.reach(component, window)` | `describeReach` | subjects the component appears in, and which of those saw it for the first time in this window |
| token drift | `store.valueJourney(token, window)` | `detectDrift` then `describeDrift` | the journey above |

An excerpt — `store` is a `HistoryStore`, built in the next section:

```ts
import { describeChurn, isKept } from '@variance-authority/history';

const answer = await store.churn('Button', { since: '2026-01-01T00:00:00Z' });
console.log(isKept(answer) ? describeChurn(answer) : answer.because);
```

A real churn line reads:

```
`Button` caused an approved change in 11 of 40 run(s) (28%): structure 4/40
across every tier, style 9/40 under chromium; last on 2026-08-09
```

Churn counts only components a run named as a *cause*. A component whose geometry
moved while its own structure and style held was displaced by an edit elsewhere,
and accumulating displacement reports the widest container in your application as
the thing that keeps changing, in every run, forever.

Every read takes a `Window` — `{ since?, until?, limit? }`, the instants matching
a row's `at`. Whatever a `limit` excludes is counted and reported on the result,
so a capped answer never reads as a complete one.

## Store the rows

This package holds no storage: the row contract, the arithmetic, and the wire
protocol, but no database. The database is `@variance-authority/server`, which
you run yourself — a process, a port, and a bearer token you set.

**1. Start the service.**

```bash
npm install --save-dev @variance-authority/server

VARIANCE_HISTORY_TOKEN=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))") \
VARIANCE_HISTORY_DB=/srv/variance/history.db \
VARIANCE_HISTORY_PORT=7788 \
npx variance-authority-server
```

The bearer token is the one you generate here and nothing else: the service holds
no accounts and no identity of its own. It refuses to start without one, and
refuses one shorter than 16 characters. `VARIANCE_HISTORY_PORT` defaults to
`7788` and `VARIANCE_HISTORY_HOST` to `127.0.0.1`.

**2. Point the CLI at it.** The CLI is a devDependency, which is why every
command below is `npx variance`:

```bash
npm install --save-dev @variance-authority/cli
```

In `variance.config.json`:

```json
{
  "history": {
    "endpoint": "http://history.internal:7788",
    "token": { "env": "VARIANCE_HISTORY_TOKEN" },
    "project": "shop"
  }
}
```

`{ "env": "NAME" }` names the variable holding the bearer token, so the secret
stays out of the file you commit. `project` is optional and defaults to the
config's own `project`.

**3. Give the run an identity.** A row that cannot be joined to a build is a row
nothing can ask about, so `variance run` writes nothing until it can name itself:

```bash
npx variance run --run "$GITHUB_RUN_ID" --commit "$GITHUB_SHA"
```

Inside GitHub Actions, GitLab CI or Bitbucket Pipelines you can leave both flags
off — the id and commit are read from the variables those systems already export,
as a pair or not at all. Anywhere else, supply them. A run with a store and no
identity records nothing and says so in its warnings; no id is invented for you.

With that in place, `npx variance run` records the run, its observations and its
resolved token values, and `npx variance accept <subject>` records the approval —
which is what makes the change countable, since drift sums approved changes only.

## Reach the service from your own code

```ts
import { detectDrift, describeDrift, isKept } from '@variance-authority/history';
import { createHttpHistoryStore } from '@variance-authority/history/client';

const store = createHttpHistoryStore({
  endpoint: 'http://history.internal:7788',
  token: process.env['VARIANCE_HISTORY_TOKEN']!,
  project: 'shop',
});

const answer = await store.valueJourney('--va-space-3', { since: '2026-01-01T00:00:00Z' });
if (!isKept(answer)) {
  console.log(answer.because);
} else {
  const found = detectDrift(answer);
  console.log(found === null ? 'no journey in this window' : describeDrift(found));
}
```

| option | default | what it decides |
|---|---|---|
| `endpoint` | required | base URL of the service you started above, e.g. `http://history.internal:7788` |
| `token` | required | the bearer token the service was started with. It is how the service refuses a write it cannot attribute to a run you own |
| `project` | none | scopes every query and is checked against every row written. Optional because a single-project deployment does not need it, and dangerous to omit on a shared one: unscoped queries blend two projects' `Button` into one rate and nothing in the answer would show it. Once set, a write carrying another project's rows throws rather than landing in the wrong history |
| `timeoutMs` | `10000` | a history query that hangs fails rather than stalling the run |
| `fetch` | `globalThis.fetch` | for a caller with its own agent or proxy |

Every transport failure throws — a 500, a 401, a body that parses but is not the
shape asked for. None of them resolves to an empty result.

A store you reach this way holds exactly what your own code posted to it. With no
writer, every query answers from an empty store.

## When no store is configured

`createAbsentStore` returns a `HistoryStore` that keeps nothing and says so, so a
pipeline holds one type either way and the difference surfaces once, in the
answer:

```ts
import { createAbsentStore, isKept } from '@variance-authority/history';

const store = createAbsentStore();
const answer = await store.churn('Button', {});
console.log(isKept(answer) ? 'a record exists' : answer.because);
```

```
no history store is configured, so nothing is being recorded: how often `Button`
changes cannot be answered. This is not a finding that nothing has drifted — it is
the absence of anyone asking.
```

That refusal is a value, not a thrown error. `Answer<T>` is
`T | Unkept`, and `Unkept` is `{ kept: false, because: string }` — a separate
type in the union rather than a flag on the result, so TypeScript makes you
narrow before you can render anything. A `kept: false` field on a `Churn` full of
zeroes can be ignored by accident, and "0 changes in 0 runs" reads as stability.

## When not to use this

Skip it if all you need is one run's pass/fail comparison against a baseline — no
churn, flakiness, reach, or drift questions across runs.
`@variance-authority/cli` runs that comparison on its own, and a run with no
`history` config block writes nothing here.

---

**[@variance-authority/history](https://variance-authority.dev/reference/packages/history)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
