# Validate and correct

Phases 6 and 7 of [`AGENTS.md`](../../AGENTS.md). Once the PR is open, other
parties answer: CI and CodeRabbit. A PR is handed over only
when every check except a running `site` is green and every finding is
classified.

**`site` reports; it is not waited for.** It photographs variance-authority.dev,
takes the longest of any check, and a change it finds is a warning on a green
check rather than a red one: a docs page that renders differently is far more
often what the PR was for than a defect. Neither a watch nor a handover waits
for it. A red `site` is a run that did not happen, a subject it could not
observe, or an accept the comparison after it did not hold, and that is yours
like any other red check; one that goes red after you handed over reaches the
person, and the next cycle picks it up. Its docket is the person's to read, and
accepting what it found is their label, `variance: accept site`.

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

`agent:done` means what handing over means: every check except a running
`site` green, and every finding classified. A cycle that stops short of that,
because you are blocked on something outside the repository, takes
`agent:debugging` off and does not put `agent:done` on. A PR with neither label is one nobody is working on and nobody
has finished, and the report says why.

**A cycle ends in one of those two states, never with `agent:debugging` left on.**
Nothing tells you when the last check turns green. A failure, a comment or a
conflict reaches you; a PR that simply finishes passing does not, and one left
labelled `agent:debugging` then says somebody is working on a PR that is ready.
So every cycle that is not stopping blocked, including one woken by a comment
with nothing to fix, ends by watching the checks until each but `site` has
finished, then reading them. Where a foreground `sleep` is refused, run the
watch in the background. It stops when `gh` fails, a PR with no checks
included, as `--watch` did; the `gh pr checks <n>` after it exits 8 while
`site` is still running, which is not a failure:

```bash
while done=$(gh pr checks <n> --json name,bucket --jq 'all(.[]; .name == "site" or .bucket != "pending")') && [ "$done" != true ]; do sleep 30; done
gh pr checks <n>
```

CodeRabbit is one of those checks, and an opportunity, never a blocker: its
check passes when it skipped a push or ran out of reviews, and neither is waited
for. Read what it found, classify it, and either go round again or hand over.
A cycle you had to start by fixing something ends the same way, after
the push. A cycle that stops blocked does not wait for the checks: it takes the
label off and says why, and the next cycle watches them.

## 6. Validate

### Look around

**Every check but `site`, until each has finished**, with the watch above.

**CodeRabbit.** It reviews pull requests here and reports as the `CodeRabbit` check, which
reads `Review completed` when it reviewed, and something else, such as `Review
skipped` or `Review rate limited`, when it did not. A review it did not make is
named in the report, never waited for. The inline comments are where the
findings are:

```bash
gh api --paginate repos/{owner}/{repo}/pulls/<n>/comments --jq '.[] | select(.user.login == "coderabbitai[bot]") | "\(.path):\(.line)\n\(.body)\n"'
```

Its walkthrough also carries the pre-merge checks `.coderabbit.yaml` declares.
An **Alignment** check that reads failed asks the same questions as the
`alignment` reviewer of the pushed diff. Its finding is classified like a
comment; one that is real goes back to the inner loop.

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
failure locally, fix it on the branch, have it reviewed as below, push, and
validate again.

A failure is not called flaky, pre-existing or unrelated on sight. That is a
claim, and it needs the same failure on `main` to stand: `main`'s latest run of
that check failing the same way or, when that run predates the failure, the same
check reproduced on a checkout of `origin/main`. If it stands, say so with that run's
link or that reproduction's output.

A fix made in this phase is reviewed before it is pushed, by the reviewers in
[pull request](pull-request.md) its change concerns: fidelity on the diff it
adds, description when the body changed, and occam when what the PR does
changed.

**A CodeRabbit comment is a signal, not an instruction.** Classify each one
against `AGENTS.md`, its references and the code. A real defect goes where
[change](change.md) draws the line: in the task's diff or in work it needs, on
this branch; otherwise on its own branch. A finding that contradicts a rule
here, or misreads the code, is left as it is. Never reply to a thread, never
resolve one, and never tick its autofix checkboxes.

**A comment on a top-layer page may be about its structure.** A reviewer asking
why something is said, asking for an example, or adding a caveat to the first
half of a page is saying the spine failed. Do not patch the line the comment is
attached to. Go back to the brief, fix the outline, and run the `content-flow`
reviewer again, as [content flow](content-flow.md) says. A correctness finding
on a page may be fixed by moving the fact into the layer that owns it or cutting
it.

## Handing over

Swap `agent:debugging` for `agent:done` when you hand over, and not before.

Never report a PR as done, ready or passing while any check is red, or any
check but `site` is still running. Say which check, what it said, and what you did about it.
A `site` still running is named as running.

The report starts from the task as it was set in [refine](refine.md): which
parts are done, where they live, and what is not done. Then the CodeRabbit
findings you acted on and the ones you set aside, and why. It ends with the
merge, which is the owner's, and nothing else asked of her: every other decision
was the loop's, and is named where it was made.
