# ADR-0020 — An adapter reads the artifact a tool produced, not the tool's configuration

**Status:** accepted
**Date:** 2026-08-03
**Extends:** ADR-0003 (cruft removal and CSS applicability), ADR-0009 (sessions detect instead of rinse), ADR-0013 (packages are named for their requirements)
**Discharges:** the Storybook adapter spec

## Context

Story-shaped subjects worked from the beginning, and nothing read a real story
index — the subjects came from fixtures this project wrote. A corpus we authored
proves the pipeline agrees with itself; it proves nothing about somebody else's
component library, which is the objection `cases/` exists to answer.

Taking subjects from a project's existing Storybook has two entry points and they
lead to different products. `.storybook/main.js` is the *configuration*: it is
JavaScript, it must be executed, and its `stories` globs have to be resolved the
way Storybook resolves them — which means reimplementing a moving part of
somebody else's build and being wrong about it on their version. `index.json` is
the *artifact*: `storybook build` already did all of that, and wrote down the
answer.

## Decision

**Read the artifact. Each entry in the story index is one subject, identified by
its story id.**

A real `.storybook` configuration is not read and is out of scope. The cost is
that a project must have built its Storybook before this can observe it, which is
a step it was going to run anyway.

**A malformed index is refused; an entry that is well-formed but not a story is
reported as excluded.** A `docs` entry, or a `type` this adapter has never seen,
is not a failure — it is a subject that will not be observed, and it is named.
One malformed entry blocks the whole run, which is deliberate: a run that
observes 239 subjects and says nothing about the 240th is the silence this
project refuses, and a machine-generated file that does not match its own format
is evidence that the file is not what the caller thinks it is.

**A story that throws is a reported subject, not a crashed run.** Its error is
carried onto the record and the remaining stories are still observed.

**One Storybook per run.** Stories share a session and are switched over
Storybook's own channel rather than by reloading the iframe, because a reload per
subject is the setup cost ADR-0009 refuses to pay. Cross-pollution between
stories is detected rather than prevented, as everywhere else.

## Consequences

**Nothing here prunes Storybook's chrome, and nothing needs to.** The story mounts
into `#storybook-root`, so the preview reset, the addon layout and the error
overlay sit outside the subject subtree and are dropped by ordinary CSS
applicability pruning (ADR-0003). A Storybook-specific denylist would be a second
normalization ruleset, versioned by nobody, and would need updating on somebody
else's release schedule.

**The adapter names the three page methods it drives instead of importing a
`Page`.** Six lines of structural interface, so that reading a story index does
not put a browser in the dependency tree of everyone who does it (ADR-0013).

**Story parameters cannot come from the index, because they are not in it.**
Viewport and per-story exclusion are read from what the caller supplies, and
`subjects.ts` says where that is — an override that cannot be completed, or is
expressed in a relative unit, costs one subject rather than the run.

**A run with no channel still works and says that it paid for it.** Where
Storybook's channel is unavailable the adapter falls back to markup quiescence
and a reload per story, and reports that it did — so the cheap path and the
expensive one are never confused in a summary.

**This is one real Storybook, built by us from components we wrote.**
`cases/storybook-case` removes the fixture convenience and does not remove
ourselves: Storybook writes the index and Playwright writes the failure messages,
and the components are still this repository's. What that case has actually
produced is recorded with it.
