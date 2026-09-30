# Validate and correct

Phases 6 and 7 of [`AGENTS.md`](../../AGENTS.md). Once the PR is open, other
parties answer: CI, CodeRabbit, the person who asked. A PR is handed over only
when every check is green and every finding is classified.

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

Never report a PR as done, ready or passing while any check is red or still
running. Say which check, what it said, and what you did about it.

The report starts from the task as it was set in [refine](refine.md): which
parts are done, where they live, and what is not done. Then the CodeRabbit
findings you acted on and the ones you set aside, and why. It ends with what you
need from the person who asked, even when that is one line.
