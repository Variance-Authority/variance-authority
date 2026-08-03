# Spec 0005 — CI integration and PR feedback

**Status:** `built, never run` — see [the status vocabulary](README.md#status-vocabulary)
**Depends on:** [0003](0003-cli.md), and on baseline storage
([ADR-0016](../context/adr/0016-where-a-baseline-is-kept-decides-nothing.md),
which discharged spec 0004)

## Purpose

Deliver a finding to the place where acting on it is cheap: the pull request. A
report written to a file that nobody opens has the same value as no report.

## Contract

- A composite action for GitHub Actions, and a documented equivalent for
  Bitbucket Pipelines, both wrapping the same CLI. No hosted control plane.
- A PR comment carrying the docket: one entry per cause, with the component, the
  file, and the counted collateral.
- Optionally, a bot commits regenerated baselines back to the PR branch.

**The Bitbucket half did not exist until 2026-08-03** — not written, not stubbed,
not mentioned anywhere but here and in one line of the root README claiming the
tool runs there. The status said `built, never run`, which reads as *the code is
finished and nobody has executed it*, and half the contract had never been
written. It is now [a section in the CLI
README](../../packages/cli/README.md#bitbucket-pipelines-and-what-carries-to-any-ci),
and it is documentation rather than a second integration on purpose: the exit
code is the interface, so every CI already has the gate, and the only
platform-specific part is finding a previous comment by the marker
`variance comment --marker` prints.

## Behaviour

**One comment, updated in place.** A new comment per run buries the current
state under a history nobody reads, which is the review-blindness failure with a
notification attached.

**The comment leads with causes and counts collateral.** One token change with
300 affected subjects is one review item with a count, never 300 lines.

**Committing baselines back is opt-in and signed as a bot.** A tool that rewrites
a contributor's branch without being asked is a tool people disable.

**Nothing is uploaded anywhere the operator did not configure.**

**The action renders nothing itself.** The body comes from `variance comment`,
the same binary the check's exit code comes from, so the docket on a pull request
and the output of `variance report` cannot describe one run differently. The
alternative was tried and removed: a script in the action that reached into the
CLI's `dist/` layout to import the renderer, which coupled the action to a build
path that is not a published contract, and which the file itself named as the
wrong answer.

## Acceptance

1. **Unmet, and merging this will not change that.** A workflow on a real
   repository produces a comment naming the cause component and its file, updated
   rather than duplicated on re-run. Every step of
   [`variance.yml`](../../.github/workflows/variance.yml) is gated on a
   `variance.config.json` at the repository root, and **this repository does not
   commit one** — the only config here is
   [`cases/storybook-case/variance.config.json`](../../cases/storybook-case/variance.config.json).
   So the workflow's first real execution prints a notice and does nothing. That
   gate is deliberate and correct for a file meant to be copied, and it means
   this criterion cannot be discharged by running the example on its own
   repository. It needs a project with a config, or a step here that builds the
   Storybook case and points at its config.
2. **Unmet**, for the same reason as 1.
3. **Partly met.** Commit-back is off by default and the workflow says at length
   why (`commit-baselines: 'false'`). What one produces when enabled has never
   been observed.
4. **Met in the half that is ours.** The exit code is the verdict and nothing
   parses output: `packages/cli/src/exit.test.ts` fixes the codes, and the action
   passes `${{ steps.variance.outputs.exit-code }}` through. That the *runner*
   then fails the check on a non-zero step is GitHub's behaviour and is not
   something this repository can assert.

## Out of scope

- A review UI.
- Approval workflows beyond `accept`.
- Any GitHub App or hosted service.
