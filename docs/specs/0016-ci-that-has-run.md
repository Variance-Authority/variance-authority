# Spec 0016 — CI that has run

**Missing:** one execution. The workflow, the composite action and the Bitbucket
recipe are written, reviewed and committed, and not one of them has ever fired on
a real pull request.
**Built on:** [ADR-0019](../context/adr/0019-one-comment-that-leads-with-causes.md),
`variance comment` and its marker, `--exit-zero-on-changes`, and the commit-back
that is built and off by default.

## Purpose

The exit code is the whole gate, so a CI that can run a command already has the
verdict. What CI adds is delivery — a comment a reviewer reads, and baselines
that come back to the branch — and delivery is the half with no evidence. The
docket has been rendered against a real report;
[`.github/workflows/variance.yml`](../../.github/workflows/variance.yml) and
[`.github/actions/variance`](../../.github/actions/variance) have posted nothing,
anywhere, ever.

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
4. The commit-back runs once on a branch where accepting is correct, and its
   three refusals are each provoked: no baselines to commit, no head branch, and
   a workspace on a detached merge ref.

**Then the second platform, on its own terms.** The Bitbucket recipe in
[`packages/cli/README.md`](../../packages/cli/README.md#bitbucket-pipelines-and-what-carries-to-any-ci)
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
  [spec 0023](0023-accept-tells-new-from-changed.md) lands.

## Leaves behind

Nothing new, if ADR-0019 survives contact. If it does not — if one comment
updated in place turns out to be the wrong shape once a real review thread exists
around it — the amendment is the ADR this spec produces.
