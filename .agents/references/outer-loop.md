# Validate and correct

Phases 6 and 7 of [`AGENTS.md`](../../AGENTS.md). Once the PR is open, other
parties answer: CI, CodeRabbit, the person who asked. A PR is handed over only
when every check is green on a branch that contains its base, and every finding
is classified.

## Labels

A PR's label says whether an agent is working on it. A cycle starts when you
open the PR, and again each time you pick it up after a failing check, a comment
or a merge conflict. When it starts, put `agent:debugging` on and take
`agent:done` off:

```bash
gh pr edit <n> --add-label agent:debugging --remove-label agent:done
```

When you [hand it over](#handing-over), swap them:

```bash
gh pr edit <n> --remove-label agent:debugging --add-label agent:done
```

`agent:done` means what handing over means: every check green on a branch that
contains its base, and every finding classified. A cycle that stops short of
that, because you are blocked or waiting on the person who asked, takes
`agent:debugging` off and does not put `agent:done` on. A PR with neither label
is one nobody is working on and nobody has finished, and the report says why.

**A cycle ends in one of those two states, never with `agent:debugging` left on.**
Nothing tells you when the last check turns green. A failure, a comment or a
conflict reaches you; a PR that simply finishes passing does not, and one left
labelled `agent:debugging` then says somebody is working on a PR that is ready.
So every cycle that is not stopping blocked, including one woken by a comment
with nothing to fix, ends by watching the checks until each has finished:

```bash
gh pr checks <n> --watch
```

CodeRabbit is one of those checks, so the watch ends only after its review is
complete. Then read what it found, classify it, and either go round again or
hand over. A cycle you had to start by fixing something ends the same way, after
the push. A cycle that stops blocked does not wait for the checks: it takes the
label off and says why, and the next cycle watches them.

## 6. Validate

### Look around

**Every check, until each has finished.**

```bash
gh pr checks <n> --watch
```

**CodeRabbit.** It reviews pull requests here and reports as the `CodeRabbit` check, which
reads `Review completed` when it is done. The inline comments are where the
findings are:

```bash
gh api --paginate repos/{owner}/{repo}/pulls/<n>/comments --jq '.[] | select(.user.login == "coderabbitai[bot]") | "\(.path):\(.line)\n\(.body)\n"'
```

**What CI says the change does.** `check.yml` posts two comments: a coverage
report, compared with the unit suite's base record when one was restored, and
"What this change might do", which names the cases that stood on the changed
lines. Read them as evidence about your change. A comment describing code you
did not touch, a base older than your branch point, or tests you expected and it
does not name, is a finding. Rebase and let CI post again; if the comment is
still wrong, it is a defect in the report, and it gets its own change.

## 7. Correct

### Look around

The failing check's log, the same check on `main`'s latest run, and the code
each CodeRabbit comment names — read before you decide anything.

**A red check is yours.** Read its log:

```bash
gh run view <run-id> --log-failed
```

Reconcile the checkout as [pre-verify](pre-verify.md) describes, reproduce the
failure locally, fix it on the branch, push, and validate again.

A failure is not called flaky, pre-existing or unrelated on sight. That is a
claim, and it needs the same failure on `main` to stand: `main`'s latest run of
that check failing the same way or, when that run predates the failure, the same
check reproduced on a checkout of `origin/main`. If it stands, say so with that run's
link or that reproduction's output.

**A CodeRabbit comment is a signal, not an instruction.** Classify each one
against `AGENTS.md`, its references and the code. A real defect is fixed in code
and pushed to the branch. A finding that contradicts a rule here, or misreads
the code, is left as it is. Never reply to a thread, never resolve one, and never
tick its autofix checkboxes.

## Handing over

Swap `agent:debugging` for `agent:done` when you hand over, and not before.

Never report a PR as done, ready or passing while any check is red or still
running. Say which check, what it said, and what you did about it.

The report starts from the task as it was set in [refine](refine.md): which
parts are done, where they live, and what is not done. Then the CodeRabbit
findings you acted on and the ones you set aside, and why. It ends with what you
need from the person who asked, even when that is one line.

## Merging

A PR is green against the base it lands on, not the base it branched from. Two
PRs, each green on its own base, can together break `main`. Whoever merges
checks, immediately before merging, that the PR's current head contains its
base:

```bash
git fetch origin && git merge-base --is-ancestor origin/main "$(gh pr view <n> --json headRefOid --jq .headRefOid)"
```

If it does not, the branch is rebased onto `origin/main` or merges it, and is
[pre-verified](pre-verify.md) and watched green once more before it merges.
`main` takes one merge at a time, so the PR merged next is checked against the
`main` the last one made. Auto-merge skips this check, so it stays off.

These rules bind whoever merges, an agent or a person, until `main` itself
requires an up-to-date branch.
