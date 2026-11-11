# Spec 0016 — CI that has run

**Missing:** a check red because stories changed, the commit-back's refusals,
and the Bitbucket recipe. The workflow and the composite action have fired on
real pull requests since [#7](https://github.com/Variance-Authority/variance-authority/pull/7):
`variance comment` posts one docket per project under its marker, and the next
push updates it in place. On [#1179](https://github.com/Variance-Authority/variance-authority/pull/1179)
the `site` docket was posted at 07:37 and updated at 08:23 to say a later run
found nothing to review. A clean run posts nothing: the `tribunal` job on
[#1186](https://github.com/Variance-Authority/variance-authority/pull/1186) logged
`nothing needs review and there is no previous comment; nothing was posted`.
The commit-back has landed on a contributor's branch three times, twice on
[#340](https://github.com/Variance-Authority/variance-authority/pull/340) and once on
[#528](https://github.com/Variance-Authority/variance-authority/pull/528), each a
`chore(variance): regenerate baselines` commit by the workflow. The red runs on
pull requests read so far failed on a subject they could not observe, not on a
change. None of the commit-back's three refusals has been met, and the
Bitbucket recipe has not run.
**Built on:** [ADR-0019](../context/adr/0019-one-comment-that-leads-with-causes.md),
`variance comment` and its marker, `--exit-zero-on-changes`, and the commit-back
that is built and off by default.

## Purpose

The exit code is the whole gate, so a CI that can run a command already has the
verdict. What CI adds is delivery — a comment a reviewer reads, and baselines
that come back to the branch — and delivery is the half only a real pull request shows. The
docket has been rendered against a real report, and
[`.github/workflows/variance.yml`](../../.github/workflows/variance.yml) and
[`.github/actions/variance`](../../.github/actions/variance) have posted it on
this repository's pull requests, as **Missing** records.

The gap is narrow and it is the kind that only closes by running: token scopes,
the permissions block, the marker survived through GitHub's own markdown
rendering, and what a merge-ref checkout does to the commit-back's branch
detection.

## What would discharge it

**One pull request in this repository, and the comment it leaves.**

1. The action runs on a pull request that changes a component, and the check goes
   red because five stories changed.
2. `variance comment` posts one comment. A second push **updates that comment in
   place** rather than adding a second — the marker is found, and the update
   path is the one exercised.
3. A clean pull request posts **nothing**, and the absence is observed rather
   than assumed. A bot that comments on every green build teaches the team to
   filter it out, and the filter does not distinguish the clean ones.
4. The commit-back runs once on a pull request's branch where accepting is
   correct, and its three refusals are each provoked: no baselines to commit, no
   head branch, and a workspace on a detached merge ref. The `lfs` job of
   `variance.yml` runs the commit-back onto a pull request's branch on a
   dispatch with `accept` ticked; no refusal has been met.

**Then the second platform, on its own terms.** The Bitbucket recipe in
[`packages/cli/README.md`](../../packages/cli/README.md#run-it-in-ci)
is three steps against a different API and is currently a starting point
somebody still has to prove. Either run it or say plainly that it is untested —
and running it is cheaper than the paragraph explaining why it is not.

## Constraints this must not break

- **`comment` posts nothing itself.** Rendering the body and sending it stay
  separate, with the operator's own token doing the sending. A CLI that can post
  is a CLI that needs a credential.
- **Exit 2 is never suppressed.** `--exit-zero-on-changes` suppresses exit 1
  only, and writes one line to stderr saying it did. A job whose browser never
  launched observed nothing, and `|| true` would post a green tick over it.
- **`accept --all` does not belong in an unattended job** until
  [spec 0023](0023-accept-tells-new-from-changed.md) lands. A schedule is
  unattended. A label, a dispatch and a push to `main` are not: each is
  somebody's act, made where the report could be read first.

## Leaves behind

Nothing new, if ADR-0019 survives contact. If it does not — if one comment
updated in place turns out to be the wrong shape once a real review thread exists
around it — the amendment is the ADR this spec produces.
