# Why a baseline is what it is

Baselines are updated in a run of their own — a separate job, usually a separate
pull request, so that the promotion of new images is reviewable as its own act.
What that run produces is a set of PNGs, and a PNG says what the new baseline
**is**. It says nothing about what the change **was**.

That gap has a half-life. On the day it lands, the report is one click away and
the reviewer is still in the tab. A month later the CI job has expired, the
report with it, and the only surviving evidence is a commit called
`chore(variance): regenerate baselines` touching four hundred files.

> Why does this card have 20px of padding? Because someone approved it. Why did
> they approve it? Nobody can say, and the eleventh 2px approval is being
> reviewed right now.

So the explanation is written into the thing that outlives the run, next to the
baseline it explains, and it can be read back.

## Two homes, because there are two kinds of baseline

Where the explanation goes is decided by where the baselines went, and neither
choice is configurable separately — a record kept somewhere other than beside its
baseline is a record that survives the baseline being replaced.

| Baselines live in | The explanation lives in | Read back with |
|---|---|---|
| the repository, plain or git-LFS | the commit message that carried them | `variance changelog` |
| the [review service](../packages/tribunal) | its own append-only table | `GET /review/changelog` |

Under `ephemeral` retention there are no baselines, so there is nothing to
explain, and both surfaces say so in a sentence rather than answering with an
empty list.

## In a repository: the commit message

`accept` writes the message; the workflow commits it. The split is deliberate —
`accept` promotes images and owns no branch policy, and a command that decided
who commits, as whom and onto what, would be making a decision the workflow has
already made.

```bash
variance accept --all --message-file .variance/commit-message.txt
git add -- .variance/baselines
git commit -F .variance/commit-message.txt
```

The file has two audiences and satisfies them separately. The prose is for
whoever scrolls `git log`. Below it, one trailer per change carries a versioned,
base64url-encoded record for a parser — the run, the commit it compared, the
intent, and one entry per **cluster**, which is the same unit the docket reviews
in: a token edit that reached forty stories is one change with forty subjects,
not forty changes.

```
chore(variance): regenerate baselines

tighten the card

v1:2c4f9a1e0b7d3856a91c4e2f8b06d735 Card src/Card.tsx 11/14
drift --va-space-3 12px -> 20px over 11 approvals

run 4242 @ 9f8e7d6c5b4a --shape

Variance-Run: v1 eyJjaGFuZ2Vsb2dWZXJzaW9uIjoxLCJydW4iOiI0MjQyIiw…
Variance-Change: v1 eyJmaW5nZXJwcmludCI6InYxOjJjNGY5YTFlMGI3ZDM4…
```

This is what every baseline update will look like forever, so it is priced as a
block rather than a sentence: an operator's line if they wrote one, one line per
change, one line per drift, and one line for the run.

**A change line leads with the fingerprint** because that string is the argument
`accept --shape` takes. The line is something to copy, not something to read and
then translate. After it comes where the change was — the component, and the file
if the run could attribute one — and then `11/14`: promoted in eleven of the
fourteen subjects the shape reached. A bare `11` means it reached exactly those.
An entry the run could not attribute to an edit is marked ` collateral`, and the
prose names the first twenty changes; past that it says how many more are in the
trailers, which carry all of them.

**The run line is last and always present.** `--shape`, `--subject` and `--all`
are different amounts of review, and a regeneration must not read like one. That
distinction is what an auditor is looking for, so it is a column rather than a
sentence — and it is the same four facts the reader below prints, in the same
order.

```bash
variance changelog --component Card --limit 50
```

```
a1b2c3d4e5f6  2026-08-21T10:14:02+10:00  run 4242 @ 9f8e7d6c5b4a --shape
  tighten the card
  v1:2c4f9a1e0b7d3856a91c4e2f8b06d735 Card src/Card.tsx 11/14
    (11 of 14 subject(s) this shape reached were promoted here)
  drift: --va-space-3 12px -> 20px across 11 approved change(s); no single review saw the total
```

The reading is over the whole message rather than a trailer block at the end, so
a squash merge that folds three commits into one still yields three records
instead of none.

The two extra lines here are the same facts spelled out. A terminal has room for
a sentence that a commit written on every update does not, and both are rendered
from the record rather than stored in it — which is the rule that makes them
rewritable in a later release without going back to rewrite history.

**A partial promotion is the finding.** A shape that reached fourteen subjects
and was promoted in eleven means three were left changed — either the promotion
was partial or the shape is not what somebody thought it was. Both are worth
knowing long after the run that produced them.

## What a record carries, and what it deliberately does not

A record is written once and read for as long as the baseline exists, so what it
refuses to carry matters as much as what it holds. Three things are kept out.

**No measurement bound to the machine that took it.** A changed-pixel count is a
number two readers will compare, and one of them will be wrong: it measures
displacement rather than magnitude, and it varies with the renderer, the device
scale factor and the crop. What is kept instead is the region — where the change
was, which is stable and answers the question the number was standing in for.

**No rendered prose.** Drift is stored as a token and two values, not as the
sentence a report wrote about it. A sentence frozen into a commit message is a
sentence that can never be reworded, and every release afterwards inherits the
phrasing of the one that shipped first.

**Nothing derivable.** There is no accepted-subject total, because the entries
and the unshaped count already carry it. Two numbers that can disagree leave a
reader deciding which one is the record.

The version prefix is `v1`, and it goes up only if an existing field changes
meaning. Adding a field does not need it: a reader keeps keys it does not
recognise and writes them back, so a repository shared by two versions of this
tool does not lose whichever half the older one did not understand.

## In the review service: a row per approval

Approval there is per subject: a reviewer clicks through a docket rather than
running one command over a report. So a row is written the moment a subject is
approved, and shapes are grouped **when somebody reads** — which means a change
approved across three sessions still reads as one change.

The columns are copies, not a join. Everything in them also sits in the build the
approval came from, and a view over that would be shorter — and empty as soon as
retention swept the build away. Builds expire; the explanation of a baseline has
to last exactly as long as the baseline, which is forever. The changelog is
excluded from sweeps for that reason, and the database refuses `UPDATE` and
`DELETE` on it.

Nothing is written for a **rejection**. It is a decision, and it is recorded as
one, but no baseline changed — and a changelog carrying rejections answers *why
does this baseline look like this* with entries about baselines that are not
there.

## Two rules worth knowing before you trust an answer

**An absent answer never reads as a good one.** git missing, a directory that is
not a repository, a revision that does not resolve: each of those produces no
commits, and none of them means *no baseline has ever been explained*. Every one
is a refusal with a sentence naming what could not be asked. Confusing the two
sends an operator hunting a bug in the writer.

**A bounded reading says what bounded it.** CI checks out at depth 1, so a
reading there can see one commit and no further; `--limit` stops at a count that
is not the end of the history. Both come back as a `note:` alongside the results,
because a window presented as a total is the more expensive error.

## What this is not

It is not the [record across runs](history.md). That answers *how often*, *has
this happened before* and *how far has this drifted* by accumulating rows from
every run, and it needs a service. This answers *why is this baseline what it is*
from evidence stored beside the baseline itself, and in a repository it needs
nothing but `git`.

They meet at the same rule — only approved changes count — and they are the two
halves of the same complaint: no single review ever sees the total.

---

**Further:** [`packages/cli`](../packages/cli) for the command and its refusals ·
[`packages/tribunal`](../packages/tribunal) for the route and the table ·
[`history.md`](history.md) for what accumulates across runs ·
[`flows.md`](flows.md) for where baseline updates sit in the adoption ladder.
