# What accumulates

Every comparison this tool makes is between two things. That is what a
comparison *is*, and it is why a whole class of problem is invisible to one:

> A button gains 2px. Eleven times. Each one approved by somebody who looked at
> one diff and correctly decided it was fine. Nobody ever sees the 22px.

No threshold catches that, because the quantity that would is a **sum**, and a
tool that holds one run at a time keeps none. Neither does a sharper differ, a
better mask or a stricter reviewer — each of the eleven decisions was right.

The same shape hides three other questions. *How often does this component
actually change?* *Has this flake been happening all month, or did it start
today?* *Where has this component started appearing?* All four need a record
across runs, and a record needs somewhere to live.

## What it is, and what it is not

A **service you run**, in your own infrastructure: a process, a port, and a token
you set. Nothing here runs it for you and no instance is shared between
operators. Everything it stores was produced by your own runs.

It is **not a file in your repository**, and that is a decision rather than a
default. A committed record puts derived state under human merge resolution, and
the hashes of a merge commit are neither branch's — so a file-based record always
describes a state that no longer exists by the time it lands. A store of
observations has no merges to resolve: two branches observing different hashes
for one key are two rows, and the query selects the lineage.

It stores **no pixels**, ever. Not squeamishness about size — a measurement. The
first version of this accumulated changed-pixel counts and was killed inside an
hour by a 1px edit to a spacing token that produced 4949 changed pixels, because
the count is dominated by how much page sits below the edit. A pixel count
measures *displacement* rather than magnitude, and it is machine-bound on top of
that. A content hash has neither problem.

## Turning it on

Run the service, and point a config at it.

```bash
variance-authority-server
```

```json
{
  "history": {
    "endpoint": "http://history.internal:7788",
    "token": "the-token-you-set"
  }
}
```

A run also has to be able to **name itself**, because a row that cannot be joined
to a build is a row nothing can ask about:

```bash
variance run --run "$GITHUB_RUN_ID" --commit "$GITHUB_SHA"
```

Inside GitHub Actions, GitLab CI or Bitbucket Pipelines you can leave both off —
the pair is read from the environment those systems already export. Anywhere
else, a run with no identity records **nothing** and says so in its warnings. An
id invented on your behalf would attach every later answer to a build that never
happened, so none is invented.

## What a run writes

| | when | roughly |
|---|---|---|
| The run itself | always, including runs where nothing changed | one row |
| A component hash | when it moved | one row per `(subject, component, band)` that moved |
| A resolved token | when a token's value moved | one row per token |
| An instability | every time a subject fails to read the same way twice | one row per named cause |

**Quiet runs are recorded**, and that is the unglamorous row everything else
depends on. Churn is a fraction, and a store that only hears from runs in which
something changed has no denominator — it reports "changed in 4 of 4 runs" for a
component that changed in 4 of 40.

A row is roughly a hundred bytes. A 300-subject run in which two components
changed writes two of them, plus the run. That economy is the reason the run
reads what is already recorded before it writes: it sends only movement.

## What you get back

The run asks, and the answers travel **in the report** — so the summary, the
pull-request comment and an agent over MCP all read one artifact, hours apart,
without any of them holding a connection to your service.

### How far a token has drifted

```
DRIFT: 1 token(s) moved in this run, and the record says what they have
  drifted to across every approved change in the window. No single review saw these
  totals, because each of them approved one step:
    `--va-space-3` changed 11 time(s) over 2026-05-02 → 2026-08-10, 12px → 20px;
    net +8px, largest single step +2px, spread across 11 reviews
```

The last clause is the finding. `largest single step` is the most any one
reviewer could have seen, and the ratio between it and the total is how thinly the
change was spread — which is exactly how it got through.

### How often a component changes

Printed under the regions it qualifies, in `variance_describe`:

```
HOW OFTEN THESE COMPONENTS CHANGE:
  `Button` caused an approved change in 11 of 40 run(s) (28%): structure 4/40
  across every tier, style 9/40 under chromium; last on 2026-08-09
```

Only components a run named as a **cause**. A component whose geometry moved
while its own structure and style held was displaced by an edit somewhere else,
and accumulating displacement reports the widest container in your application as
the thing that keeps changing, in every run, forever.

### Whether a flake is new

See [`flakiness.md`](flakiness.md#has-this-happened-before). Two readings of one
subject put a floor under flakiness and can never put a ceiling on it; the record
is the other instrument, and the number that decides what anybody does is not the
rate but the sweeps since.

## Two rules worth knowing before you trust a number

**Only approved changes count.** A rejected change was caught; counting it would
describe your review process rather than your product. A run cannot know whether
anybody agreed, so it writes every row unapproved and `variance accept` records
the approval separately — one row per `(subject, run)`, which is exactly the
decision a reviewer makes. Until a subject is accepted, its change is counted as
rejected.

**An absent answer never reads as a good one.** With no store configured, every
history question answers with the sentence *nobody is keeping a record* — never
an empty result, because an agent handed an empty churn concludes the product is
stable when the truth is that the question was never asked. The same rule holds
one level in: a service that cannot be reached is a warning naming what was lost,
not a zero.

## What it costs to run

One process, one SQLite file, one port. `node:sqlite`, so there is no native
build to install and nothing to compile — a self-hosted service that needs a
toolchain is a service nobody installs.

Concurrent CI jobs serialize their writes through the one process, which is
correct and is not unbounded. The storage sits behind an interface so a different
engine can replace it without changing the client, the arithmetic, or what a row
means; a Cloudflare D1 implementation ships in [`tribunal`](../packages/tribunal).

Everything is append-only, enforced by the database rather than by the code above
it. An `UPDATE` or a `DELETE` aborts with a sentence saying why — because a
rewritten row changes a number somebody already read, and a deleted one turns a
flake that was fixed into a flake that never happened.

## What is not built

[`spec 0002`](specs/0002-history-store.md) is the live list, and two things on it
are worth knowing up front.

**`reach` is not asked by anything.** *Where has this component started
appearing* is a question about the suite rather than about a run, so it does not
fit the shape everything else here uses — the run asks, the report carries.

Half of it stopped being a vacancy on 2026-08-12: *where does this component
appear* is now answered for one commit, by the suite comparing itself against
itself rather than against a store ([`composition.md`](composition.md)). What is
still missing is the word *started* — a delta needs two of those graphs, and
nothing writes one to the record. The shape is there now, which makes this a
smaller job than it was: a component census is a list of names and subject
counts, and comparing two of them is set arithmetic.

**The eleven-step journey above has never been produced against a real
project.** Every part of it exists and each part is tested; what has not happened
is eleven runs, eleven approvals, and the sentence at the end of them.

---

**Further:** [`flakiness.md`](flakiness.md) for the flake half ·
[`flows.md`](flows.md#rung-5--history-recurrence-and-drift-across-runs) for where
this sits in the adoption ladder ·
[spec 0002](specs/0002-history-store.md) for what a row is allowed to contain and
why ·
[ADR-0031](context/adr/0031-the-run-asks-what-is-recorded-now.md) and
[ADR-0032](context/adr/0032-a-flake-rate-divides-by-the-runs-that-asked.md) for
the two decisions that made it callable.
