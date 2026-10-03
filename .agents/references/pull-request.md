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

**Does it carry its changeset?** `yarn changeset status --since=origin/main`
fails the same way CI does when a published package changed and no changeset
came with it. See [change](change.md).

## Opening it

Never push to `main`. The branch was cut from `origin/main` at setup, not from
local `main`, which may hold somebody's unpushed work. Push the branch and open
the PR.

The body follows
[`.github/pull_request_template.md`](../../.github/pull_request_template.md).
`gh pr create --body-file` skips the template, so apply it yourself. Before
sending, have a subagent with no other context read the body alone, say what the
PR is, and quote each sentence it could not follow. Fix those sentences.

Opening the PR is not the end of the task. The [outer loop](outer-loop.md)
starts here.
