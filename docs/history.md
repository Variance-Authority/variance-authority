# Keep a history of what a run changed

Every run writes a report and then forgets the one before it. A history service
keeps them, so drift that no single comparison was wrong about can still be asked
about as a sum.

This page is for the operator who wants those reports to accumulate: how to run
the history service, what each run writes to it, and which answers come back in
the report. New here? Start with [your first run](start.md).

One run compares a **subject** — one named UI state you asked for and can ask
for again, identified by a stable id like `story:checkout--empty` — against its
own baseline. A comparison between two things cannot see a quantity that only a
sum holds:

> A button gains 2px. Eleven times. Each one approved by somebody who looked at
> one diff and correctly decided it was fine. Nobody ever sees the 22px.

No threshold catches that, because a tool that holds one run at a time keeps no
sum. Neither does a sharper differ, a better mask or a stricter reviewer — each
of the eleven decisions was right.

A record across runs answers three more questions of the same shape: how often a
component actually changes, whether a flake started today or has been happening
all month, and where a component has started appearing. That record needs
somewhere to live.

## What it is, and what it is not

The record lives in **a service you run**, in your own infrastructure: a
process, a port, a database file and a token you set. No instance is shared
between operators, and everything it stores was produced by your own runs.

It is **not a file in your repository**. A committed record is derived state
under human merge resolution, and the hashes of a merge commit are neither
branch's, so it describes a state that no longer exists by the time it lands. In
the store there is nothing to merge: two branches observing different hashes for
one key are two rows, and the query selects the lineage.

It stores **no pixels**, ever. A 1px edit to a spacing token produces 4949
changed pixels, because the count is dominated by how much page sits below the
edit — a pixel count measures *displacement* rather than magnitude, and it is
machine-bound as well. A content hash has neither problem.

## Start the service and point your config at it

The service is `@variance-authority/server`. Install it on the host that will
hold the record, and start it with a token:

```bash
npm install @variance-authority/server
```

```bash
VARIANCE_HISTORY_TOKEN=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))") \
  npx variance-authority-server
```

It refuses to start without that token, and refuses one shorter than 16
characters: an unauthenticated history accepts writes it cannot attribute to any
run, and answers every question asked of it. `VARIANCE_HISTORY_DB` chooses the
database file — `variance-history.db` in the working directory by default —
`VARIANCE_HISTORY_PORT` the port (`7788`), and `VARIANCE_HISTORY_HOST` the
interface it binds (`127.0.0.1`). The
[`@variance-authority/server` reference](https://variance-authority.dev/reference/packages/server)
has the HTTP surface and the backend interface.

Then give `variance.config.json` — the file
[`npx variance run`](start-cli.md) reads — a `history` key naming that endpoint:

```json
{
  "project": "shop",
  "history": {
    "endpoint": "http://history.internal:7788",
    "token": { "env": "VARIANCE_HISTORY_TOKEN" }
  }
}
```

Those two keys go alongside the `subjects` and `baselines` keys your run
already has; [run visual review from the command line](start-cli.md) is where
the rest of the file is set up. `project` is the name your rows are filed
under, and is required whether or not you configure `history`. The token is the one setting that does not belong in
this file: the config is in your repository, so a literal here is a credential
shared with everyone who can read it, and `{ "env": "NAME" }` names the variable
that holds it instead. Nothing is read from the environment that the file did
not name, and a variable that is unset is refused by *its* name, so an operator
whose config is right and whose CI secret is missing is sent to the secret. A
literal string is still accepted, for a token that is not a secret.

A run also has to be able to **name itself**, because a row that cannot be
joined to a build is a row nothing can ask about:

```bash
npx variance run --config variance.config.json --run "$GITHUB_RUN_ID" --commit "$GITHUB_SHA"
```

Inside GitHub Actions, GitLab CI or Bitbucket Pipelines you can leave both off:
the pair is read whole from `GITHUB_RUN_ID` and `GITHUB_SHA`, `CI_PIPELINE_ID`
and `CI_COMMIT_SHA`, or `BITBUCKET_BUILD_NUMBER` and `BITBUCKET_COMMIT`. A run
id and a commit are never taken from two different sources. Anywhere else, a run
with no identity records **nothing** and says so in its warnings — an id
invented on your behalf would attach every later answer to a build that never
happened.

## What a run writes

| | when | roughly |
|---|---|---|
| The run itself | always, including runs where nothing changed | one row |
| A component hash | when it changes | one row per `(subject, component, band, profile)` that changed — a **band** is the kind of difference (`a11y`, `geometry`, `token`, `content`, `texture`), a **profile** is the named browser and engine setup the run captured it under |
| A resolved token | when a token's value changed | one row per token |
| An instability | every time a subject fails to read the same way twice | one row per named cause |

**Quiet runs are recorded.** Churn is a fraction, and a store that only hears
from runs in which something changed has no denominator — it would report
"changed in 4 of 4 runs" for a component that changed in 4 of 40.

A row is roughly a hundred bytes. A 300-subject run in which two components
changed writes two of them, plus the run: each run reads what is already
recorded before it writes, and sends only what changed.

## What you get back

The run asks the questions, and the answers travel **in the report** — the file
a run writes when it finishes, at the path the `report` key in
`variance.config.json` names. The summary, the pull-request comment and an agent
over MCP all read that one file, hours apart, none of them holding a connection
to your service.

### How far a token has drifted

Printed in the run summary, and in the pull-request comment above the **docket**
— the causes a run leaves for you to decide. It sits above them because a
reviewer cannot reach it from the diff in front of them:

```
DRIFT: 1 token(s) moved in this run, and the record says what they have
  drifted to across every approved change in the window. No single review saw these
  totals, because each of them approved one step:
    `--va-space-3` drifted 12px → 20px, 8px across 11 approved commit(s)
    (2026-05-02 → 2026-08-10); the largest single step was 2px, so no per-change
    review could have seen the total
```

The last clause is the finding: `largest single step` is the most any one
reviewer could have seen, and the ratio between it and the total is how thinly
the change was spread.

### How often a component changes

Printed under the regions it qualifies — the changed areas within a subject —
in `variance_describe`, [the MCP tool](locate.md) that reports what changed
inside one subject:

```
HOW OFTEN THESE COMPONENTS CHANGE:
  `Button` caused an approved change in 11 of 40 run(s) (28%): structure 4/40
  across every tier, style 9/40 under chromium; last on 2026-08-09
```

`across every tier` is the counting rule, not decoration: a structural change
reads the same under every capture setup a run used, so its rate counts all of
them, while `style` and `geometry` rates name one profile, because one value
observed under two engines is two different observations rather than two
sightings of one edit.

Only components a run named as a **cause** are counted: a component whose geometry
moved while its own structure and style held was displaced by an edit somewhere
else, and counting displacement would report the widest container in your
application as the thing that changes in every run.

### Whether a flake is new

Reading one subject twice puts a floor under its flakiness and can never put a
ceiling on it. The record supplies the rest: how long the subject has been
reading differently from itself, and how many runs have happened since the
last time it did. [Has this happened
before](flakiness.md#has-this-happened-before) covers the questions and the
answers.

## Two rules worth knowing before you trust a number

**Only approved changes count.** A rejected change was caught; counting it would
describe your review process rather than your product. A run cannot know whether
anybody agreed, so it writes every row unapproved and `npx variance accept` records
the approval separately — one row per `(subject, run)`, which is exactly the
decision a reviewer makes. Until a subject is accepted, its change is counted as
rejected.

**An absent answer never reads as a good one.** With no store configured, every
history question answers with the sentence *nobody is keeping a record* — never
an empty result, because an agent that is handed an empty churn figure
concludes the product is stable when the truth is that the question was never
asked. The same rule holds one level in: a service that cannot be reached is a
warning naming what was lost, not a zero.

## What it costs to run

It costs one process, one SQLite file, one port, on Node 22 or newer. The
shipped backend is `node:sqlite`, so there is no native build to install and
nothing to compile.

Concurrent CI jobs serialize their writes through that one process. Storage sits
behind an interface, so another engine can replace it without changing the
client, the arithmetic, or what a row means; a Cloudflare D1 implementation
ships in
[`@variance-authority/tribunal`](https://variance-authority.dev/reference/packages/tribunal).

Everything is append-only, enforced by the database rather than by the code
above it. An `UPDATE` or a `DELETE` aborts with a sentence saying why: a
rewritten row changes a number somebody already read, and a deleted one turns a
flake that was fixed into a flake that never happened.

---

**Further:** [Tell a flake from a change](flakiness.md) for what the record adds
to an unstable subject · [Why a baseline is what it is](changelog.md) for the
evidence kept beside one · [Run it in CI](flows.md#level-5--history-recurrence-and-drift-across-runs)
for where the history service sits among the other things you can stand up.
