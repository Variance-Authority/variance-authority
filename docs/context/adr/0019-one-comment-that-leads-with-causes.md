# ADR-0019 — One comment, updated in place, leading with causes

**Status:** accepted
**Date:** 2026-08-03
**Extends:** ADR-0012 (observability and the damage boundary), ADR-0017 (the exit code is the interface)
**Discharges:** the CI integration and PR feedback spec

## Context

A report written to a file nobody opens has the value of no report. The place
where acting on a finding is cheap is the pull request, and getting a finding
there is the only part of this system that has to speak somebody else's protocol.

Two obvious implementations are both wrong in ways that take a while to show.
Posting a new comment per run buries the current state under a history nobody
reads — review blindness with a notification attached. Listing every affected
subject turns one token change into three hundred lines, which is the same
blindness produced by volume instead of by depth.

## Decision

**One comment, found by an invisible marker and updated in place.** A new comment
per run is refused. The marker is carried in the rendered body itself and printed
by `variance comment --marker`, so any platform's poster can find its own comment
without this project knowing anything about that platform.

**The comment leads with causes and counts collateral.** One token change
reaching 300 subjects is one review item with a count, never 300 lines. Each
entry names the component, the file, and how much it displaced.

**The action renders nothing itself.** The body comes from `variance comment` —
the same binary the exit code comes from — so the docket on a pull request and
the output of `report` cannot describe one run differently. The alternative was
tried and removed: a script inside the action that reached into the CLI's `dist/`
layout to import the renderer, coupling the action to a build path that is not a
published contract.

**Committing baselines back is opt-in, off by default, and signed as a bot.** A
tool that rewrites a contributor's branch without being asked is a tool people
disable. It is off for a second reason specific to this project: `accept` takes
`--all`, so enabling commit-back accepts *changed* subjects as well as new ones —
the regression the check found is promoted to the baseline by the run that found
it, and the next run is green. Turned on carelessly, the gate has become a
recorder (ADR-0017).

**Nothing is uploaded anywhere the operator did not configure.** The only thing
the example workflow sends anywhere is an artifact upload to the instance already
running the job, and it is commented as the operator's decision.

**One integration is built; the rest is documentation.** A composite action for
GitHub Actions, because that is where this runs. For everything else the exit
code is the whole gate, so the only platform-specific part is the poster —
written down for Bitbucket Pipelines in the CLI README as three API calls, not
shipped as a second integration nobody has run.

## Consequences

**`pull_request`, never `pull_request_target`.** A fork's run gets a read-only
token, so the docket cannot be posted on a pull request from a fork. That is a
real limitation and the correct trade: `pull_request_target` would run the fork's
own build, collector and dependencies with a token that can write to this
repository. The comment step warns and continues, and the verdict still arrives
as the exit code, which no token can change.

**A pinned container, not `ubuntu-latest`.** A durable baseline is machine-bound
(ADR-0011), so a suite pinned to a moving image goes `incomparable` on somebody
else's schedule — every baseline invalidated by an infrastructure update nobody
in the repository approved.

**None of it has ever run.** Not one execution against a real pull request. The
example workflow in this repository additionally gates every step on a
`variance.config.json` that this repository does not commit, so merging it does
not change that: its first real execution prints a notice and stops. Closing this
needs a project with a config, or a step that builds the Storybook case and
points at its own. Tracked in the checkpoint, where unexercised claims live.

**Commit-back refuses three ways before it pushes** — no baselines to commit, no
head branch, or a workspace sitting on a detached merge ref — because pushing
from a merge ref would rewrite the contributor's branch with the merge. Written,
and like the rest of this, never executed.
