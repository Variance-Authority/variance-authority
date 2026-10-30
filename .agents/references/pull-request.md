# Open the pull request

Phase 5 of [`AGENTS.md`](../../AGENTS.md). `main` changes only through a pull
request. `check.yml` on the PR is where the change is tested: it runs the tests
the change reached and reports how coverage moved against the mainline's record.

## Look around

**What landed since you branched?** `git fetch`, then rebase onto
`origin/main`. CI compares the PR against `main`'s record, so a fix that landed
after your branch point changes what CI will say about yours. A PR opened on a
stale base gets comments describing code that no longer exists. If the rebase
brought anything in, [pre-verify](pre-verify.md) again: the green you had was on
the old base.

**Who else is in these files?** `gh pr list --json number,title,files` lists
each open PR with the files it changes. Two PRs
editing the same lines are a conflict one of you resolves now, or a reviewer
resolves later without the context.

**Is the diff only the task, and all of it?** `git diff origin/main --stat`. A
file you did not mean to change, or a finding the task neither needs nor wrote,
comes out and goes to its own branch cut from `origin/main`. What the task needs
stays, and so does a defect in its own diff, as [change](change.md) says. None
of it is left to a later PR: that PR is reviewed and merged against a `main`
that holds half a change, and the first PR's review approved something that was
not finished.

**What kind is it, and is it whole?** The title's prefix names the PR's kind,
in the form its commits already use: `fix(store): …`. The kind is the task's,
and its row below says what the PR carries to be complete. Everything the task
needs rides in its PR, whatever kind that part would be alone: the tests for the
code it wrote, the writing that names it, a refactor it stands on in whatever
code.

| Kind | The body shows | Complete when it carries | Never contains |
|---|---|---|---|
| `feat` | A capability that does not exist, or behaviour that works as built and is wanted different, and who asked for it | Tests that fail on the base, with those that pinned the old behaviour amended; the page, README or help text that names it, rewritten where it described the old; a changeset, saying what an upgrader does when behaviour changed | A test still asserting the old behaviour |
| `fix` | Behaviour that departs from what a doc, spec, test or issue states, quoted | A test that fails on the base; every place the same defect lives, each a block row; a changeset when a package ships | Behaviour nobody stated |
| `perf` | A cost, measured | The same measurement before and after (CI's `measure` job on the base and on the PR, or a named benchmark), its command and machine quoted in the body | A changed assertion |
| `refactor` | A shape that makes a named next change hard | Every existing test unchanged and green on both sides | A changed assertion |
| `test` | Behaviour on the base that no test pins | Tests that pass on the base | A test for code an open PR adds: it goes in that PR |
| `docs` | A sentence that is wrong, missing or unclear, quoted | The writing, with its structure held to [content flow](content-flow.md) and its sentences to [`docs/AGENTS.md`](../../docs/AGENTS.md) when it is published | Product code |
| `ci`, `chore` | A workflow, tool or dependency that fails or costs | The run on the PR that exercises the changed workflow or tool, checked in the [outer loop](outer-loop.md) | Product code |
| `revert` | The merged PR it undoes, and what that PR broke | The revert of that PR's merge commit | Any change beyond the revert and its changeset |

Every kind that changes a published package carries a changeset, or `yarn
changeset --empty`, as [change](change.md) says; a row names one only where it
says something particular. A test that fails on the base in a `test` PR is
wrong or has found a defect; when it has found one, the PR is a `fix`. A
`refactor` or `perf` that has to change an assertion changes behaviour, and is
a `feat` or a `fix`. A `docs`, `ci` or `chore` task that needs product code
takes the kind of that code's change. A pin written green first for behaviour
nothing covered, as [change](change.md) asks, passes on the base in any kind.
The release PR that changesets opens is not written by hand and has no kind.

**Does it carry its changeset?** `yarn changeset status --since=origin/main`
fails the same way CI does when a published package changed and no changeset
came with it. See [change](change.md).

## Reviewing it before it is pushed

The body follows
[`.github/pull_request_template.md`](../../.github/pull_request_template.md):
the problem, the solution in the project's concepts, and one row per block the
change touches. It is not a report of the work. The tests, the diff and the
checks carry the evidence; a row points at the one that pins its block, it does
not restate it. A test that does not assert the stated symptom does not pin it,
and what a commit message says about itself is a claim, not evidence.
`gh pr create --body-file` skips the template, so apply it yourself.

The body ends with the coverage handover, for CodeRabbit, which reviews the
body before CI has run anything:

```bash
yarn variance review --since origin/main --format handover
```

Paste its output under the template, unedited. It names each changed function
no case reached, the change wrote, or a case reached only from far, from a
distance not measured or only while its module loaded, with the test file to
open, and counts the rest. After a rebase, run it again and paste the new
block over the one between its markers.

Before anything is pushed, four subagents review the change, and a fifth when
the change writes a top-layer page. Each starts with
no other context, and each gets only what its question needs, read from your
worktree and `origin/main`, never from local `main`.

1. **Description** — the body alone. Does it say what the problem was and
   how it was solved, in a few lines a stranger can follow, and does each block
   row say what changes there? Anything else in it is noise, and blocking.
2. **Occam** — the `occam` agent, given the task sentence, the worktree and
   the path of the body file. Should this change happen at all, or this much
   of it? The other reviewers look for a way to make the change better; Occam
   looks for the reason not to make it, never suggests an addition, and reads
   the body last. Its answers, and what clears one, are in its instructions.
3. **Fidelity** — the task sentence, the body, the diff and `origin/main`.
   Does the diff deliver everything the task sentence asks? A part of the task
   no hunk delivers is a finding, even when the body leaves it out too. Is
   every block row true of the diff, and does every hunk fall in a block a row
   names? A hunk no row covers is a finding. Does the diff keep every
   contract in the root [`REVIEW.md`](../../REVIEW.md), the `REVIEW.md` of
   each package it touches, and [`site/REVIEW.md`](../../site/REVIEW.md),
   read from `origin/main`? Does each row's *pinned by* test or command observe the change,
   and fail on `origin/main` when the row changes behaviour? In a `test` or
   `refactor` PR it passes on both sides instead. For a top-layer page, does each fact the brief puts off the
   spine sit in the file it names, and does that file say it? Does each fact
   marked *nowhere* carry the reason it was left out?
4. **Alignment** — the `alignment` agent, given the task sentence, the worktree
   and the path of the body file. It designs the change from the task and the
   compass before it reads the diff, then reports each gap against the code
   rules: a second implementation, a wait or a reload, a neighbour's question,
   a runner favoured, complexity in the wrong role. It reads the body last,
   and a reason clears a finding only with evidence. Occam asks whether the
   change should happen; Alignment asks whether its shape is ours.

When the change writes or rewrites a top-layer page, a fifth runs first:

5. **Flow** — the `content-flow` agent, given each changed page alone with the
   brief's reader and question, never its expected readback. It reports what it
   understood, and you compare that with the brief, as
   [content flow](content-flow.md) says. A verdict of *no spine*, a *stalls at*
   that is not a named and linked prerequisite, or a readback that differs from
   the brief, is blocking, and the other four
   wait until it passes: a review of facts on a page whose structure will change
   is spent twice.

Each answers its own question; one reviewer finding nothing does not clear the
others. Each marks a finding blocking or not. Fix the blocking ones, in the code
or the body, and run them all again, Flow included, until none of them reports
a blocking finding. A finding still marked blocking after the second round is yours to
decide: fix it, or set it aside. Every finding not fixed is named in the body
with the reason it was set aside.

A diff-mode rejection that the idea review could have seen is an escape: it
goes into [`escapes`](escapes.md), whatever becomes of the change.

Pushing is gated: `tools/gate.mjs`, which `yarn install` registers as a
configured `pre-push` hook beside Git LFS's, refuses an agent's push of a
branch whose tip's tree `yarn verify:near` and `yarn verify:rules` have not
recorded green in that worktree; a commit before the tip is never merged alone.
`yarn install` fails for an agent whose git does not run configured hooks. A pull request only names a branch a push put there,
so the push is the one gate. CI's `idea` job reads the body's first line and
fails a pull request whose issue does not carry `idea: build`, or was edited
after the label went on; it runs again in the merge queue for every pull
request the group merges, so an edit made after the last run still stops the
merge. Both guard the workflow; they are
records, not proof that a review or a wave ran.

## Opening it

Never push to `main`. The branch was cut from `origin/main` at setup, not from
local `main`, which may hold somebody's unpushed work. Push the branch and open
the PR. CodeRabbit reviews it as finished work, and every push after that spends
another of its reviews.

Opening the PR is not the end of the task. The [outer loop](outer-loop.md)
starts here.
