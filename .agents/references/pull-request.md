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
| `fix` | Behaviour that departs from what a doc, spec, test or issue states, quoted | A test that fails on the base; every place the same defect lives, with the search that found them quoted in the body; a changeset when a package ships | Behaviour nobody stated |
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
[`.github/pull_request_template.md`](../../.github/pull_request_template.md).
`gh pr create --body-file` skips the template, so apply it yourself.

Before anything is pushed, three subagents review the change, and a fourth when
the change writes a published page. Each starts with
no other context, and each gets only what its question needs, read from your
worktree and `origin/main`, never from local `main`:

1. **Description** — the body alone. Can a reader who has never seen this
   repository say what the PR is? Is every result it claims observed, with how
   it was observed, rather than predicted? It quotes each sentence it could not
   follow.
2. **Direction** — the body and the repository. Should this change happen at
   all? Is it proportionate to the problem the body states, does something that
   already exists carry it, and what is missing from it? These are
   [refine](refine.md)'s questions, asked by a reader who did not write the
   change.
3. **Fidelity** — the body, the diff and `origin/main`. Is every claim in the
   body true of the diff? Does each claimed behaviour have the test the body
   names, and, where it pins a change, does the body show that test failing on
   `origin/main`?

When the change writes or rewrites a published page, a fourth runs first:

4. **Flow** — the `content-flow` agent, given each changed page alone. Does
   the page show what it gives the reader before its internals, and does every
   section belong where it is? It reports what [content flow](content-flow.md)
   asks for. A verdict of *reorder* or *re-spine* is blocking, and the other
   three wait until it passes: a review of facts on a page whose structure will
   change is spent twice.

Each answers its own question; one reviewer finding nothing does not clear the
others. Each marks a finding blocking or not. Fix the blocking ones, in the code
or the body, and run them all again, Flow included, until none of them reports a blocking
finding. A finding still marked blocking after the second round is yours to
decide: fix it, or set it aside. Every finding not fixed is named in the body
with the reason it was set aside.

## Opening it

Never push to `main`. The branch was cut from `origin/main` at setup, not from
local `main`, which may hold somebody's unpushed work. Push the branch and open
the PR. CodeRabbit reviews it as finished work, and every push after that spends
another of its reviews.

Opening the PR is not the end of the task. The [outer loop](outer-loop.md)
starts here.
