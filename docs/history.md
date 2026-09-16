# What accumulates

[Variance Authority](README.md) is visual and execution regression tooling: a run renders a
set of subjects — a story, a route, a fixture, or a value — and compares each
one against its own baseline. Every comparison it makes is between two things.
That is what a comparison *is*, and it is why a whole class of problem is
invisible to one:

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

It stores **no pixels**, ever. Not squeamishness about size — a measurement. A
1px edit to a spacing token produces 4949 changed pixels, because the count is
dominated by how much page sits below the edit. A pixel count measures
*displacement* rather than magnitude, and it is machine-bound on top of that. A
content hash has neither problem, which is why accumulating one is worth doing
and accumulating the other is not.

## Turning it on

Run the service, and point a config at it.

```bash
VARIANCE_HISTORY_TOKEN=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))") variance-authority-server
```

It refuses to start without that token, and refuses one shorter than 16
characters: an unauthenticated history listens, accepts writes it cannot
attribute to any run, and answers every question asked of it — silently and
successfully.

```json
{
  "history": {
    "endpoint": "http://history.internal:7788",
    "token": { "env": "VARIANCE_HISTORY_TOKEN" }
  }
}
```

The token is the one setting that does not belong in this file. The config is in
your repository, so a literal here is a credential shared with everyone who can
read it; `{ "env": "NAME" }` names the variable that holds it instead. The config
still says exactly where the value comes from — nothing is read from the
environment that the file did not name — and a variable that is unset is refused
by *its* name, so an operator whose config is right and whose CI secret is
missing is sent to the secret. A literal string is still accepted, for a token
that is not a secret.

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
| A component hash | when it changes | one row per `(subject, component, band, profile)` that moved — a **band** is the kind of difference (`geometry`, `token`, `content`, `texture`), a **profile** is the named browser/engine setup the run captured it under |
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

The run asks, and the answers travel **in the report** — the file a run writes
when it finishes, at the address your config names — so the summary, the
pull-request comment and an agent over MCP all read that one artifact, hours
apart, without any of them holding a connection to your service.

### How far a token has drifted

Printed in the run summary, and **above the docket** — the causes a run leaves
for you to decide — in the pull-request comment: ahead of those causes, because
it is the one finding on that page a reviewer could not have reached by looking
at the diff in front of them, and they are the person about to approve the next
step:

```
DRIFT: 1 token(s) moved in this run, and the record says what they have
  drifted to across every approved change in the window. No single review saw these
  totals, because each of them approved one step:
    `--va-space-3` drifted 12px → 20px, 8px across 11 approved commit(s)
    (2026-05-02 → 2026-08-10); the largest single step was 2px, so no per-change
    review could have seen the total
```

The last clause is the finding. `largest single step` is the most any one
reviewer could have seen, and the ratio between it and the total is how thinly the
change was spread — which is exactly how it got through.

### How often a component changes

Printed under the regions it qualifies — the changed areas within a subject —
in `variance_describe`, the MCP tool that reports what changed inside one
subject:

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
an empty result, because an agent handed an empty churn figure concludes the
product is stable when the truth is that the question was never asked. The same rule holds
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

---

**Further:** [`flakiness.md`](flakiness.md) for the flake half ·
[`changelog.md`](changelog.md) for the other half of the same complaint — why one
baseline is what it is, from evidence kept beside it ·
[`flows.md`](flows.md#level-5--history-recurrence-and-drift-across-runs) for where
this sits in the adoption ladder.
