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

**Is the diff only the task?** `git diff origin/main --stat`. A file you did not
mean to change, or a finding outside the task, comes out and goes to its own
change.

**Does it carry its changeset?** `yarn changeset status --since=origin/main`
fails the same way CI does when a published package changed and no changeset
came with it. See [change](change.md).

## Reviewing it before it is pushed

The body follows
[`.github/pull_request_template.md`](../../.github/pull_request_template.md).
`gh pr create --body-file` skips the template, so apply it yourself.

Before anything is pushed, three subagents review the change. Each starts with
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

Each answers its own question; one reviewer finding nothing does not clear the
others. Each marks a finding blocking or not. Fix the blocking ones, in the code
or the body, and run the three again until none of them reports a blocking
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
