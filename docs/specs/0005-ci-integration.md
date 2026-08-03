# Spec 0005 — CI integration and PR feedback

**Status:** `built, never run` — see [the status vocabulary](README.md#status-vocabulary)
**Depends on:** [0003](0003-cli.md), [0004](0004-artifact-storage.md)

## Purpose

Deliver a finding to the place where acting on it is cheap: the pull request. A
report written to a file that nobody opens has the same value as no report.

## Contract

- A composite action for GitHub Actions, and a documented equivalent for
  Bitbucket Pipelines, both wrapping the same CLI. No hosted control plane.
- A PR comment carrying the docket: one entry per cause, with the component, the
  file, and the counted collateral.
- Optionally, a bot commits regenerated baselines back to the PR branch.

## Behaviour

**One comment, updated in place.** A new comment per run buries the current
state under a history nobody reads, which is the review-blindness failure with a
notification attached.

**The comment leads with causes and counts collateral.** One token change with
300 affected subjects is one review item with a count, never 300 lines.

**Committing baselines back is opt-in and signed as a bot.** A tool that rewrites
a contributor's branch without being asked is a tool people disable.

**Nothing is uploaded anywhere the operator did not configure.**

## Acceptance

1. A workflow on a real repository produces a comment naming the cause component
   and its file, and the comment is updated rather than duplicated on re-run.
2. A run with no changes leaves no comment and exits 0.
3. Baseline commit-back is off by default; enabling it produces one commit
   attributed to the bot, containing only image artifacts.
4. The action fails the check on changes needing review and passes on a no-op
   refactor, driven by the CLI's exit code and not by parsing its output.

## Out of scope

- A review UI.
- Approval workflows beyond `accept`.
- Any GitHub App or hosted service.
