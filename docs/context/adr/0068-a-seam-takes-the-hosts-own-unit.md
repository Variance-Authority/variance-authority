# ADR-0068 — A recording seam takes the host's own unit

**Status:** accepted
**Date:** 2026-09-20
**Amends:** ADR-0043 (an extension does not own its host)

## Context

ADR-0043 settled one direction of the boundary with a test host: an extension
never exports replacements for the host's control primitives. The recording
seam is the other direction. To attribute a crossing to a test *case* rather
than to a test file, the seam has to reach the registrars the host installed —
`it` and `test` — and the shortest way to reach them is to tell the adopter
where to put them.

The Rstest seam took that shortest way. `cases: true` threw unless the project
had also set `globals: true`, because the realm was the only place the seam
looked. That is the same ownership error ADR-0043 removed, wearing a
configuration key instead of an export: the project's runner options were being
decided by which of two lookups the integration had implemented. Rstest
publishes its API as an Rspack external of type `global`, so an
`import { it } from '@rstest/core'` compiles to a read of
`globalThis['@rstest/core']` — the object was reachable the whole time, under a
name the seam had not looked up.

The seams also disagree about what a crossing joins, and that disagreement is
not ours. Vitest, Jest and Rstest schedule a test file; Playwright schedules a
spec file and closes one window per test; Storybook shows one story at a time.
Each seam records the unit its host already has a name for.

## Decision

**A seam attributes a crossing to the unit the host schedules**, and invents
neither a finer nor a coarser one. The unit is a property of the host, so it is
stated per host rather than normalized away.

**A seam never asks the project to change a runner option to buy the case
axis.** It reaches the registrars wherever the host put them, for every
placement the host supports, and wraps each one it finds. For Rstest that is
the realm and `globalThis['@rstest/core']`, both, so an importing suite, a
`globals: true` suite and a suite that mixes them record alike.

**Where the host will announce a case, take it from there instead.** Searching
the realm enumerates placements and can only ever reach the ones enumerated;
Jest hands an importing file a fresh spread of `@jest/globals` from an object
only the test environment sees, so no enumeration reaches it. A runner that
calls out to handlers before it calls the body inverts that: jest-circus
dispatches `test_fn_start` with the case object, and the seam replaces the `fn`
on it. Every placement arrives as the same object in the same event, so there
is nothing left to enumerate. The realm wrapping stays behind it for a project
that replaced the runner, and the two compose because each leaves a body the
other enclosed alone.

**A placement a seam has not reached yet is a defect against this decision**,
carried as one. It is not written down as a limitation the adopter is asked to
work around.

## Consequences

**Both spellings are wrapped whether or not a project uses both.** Wrapping an
absent registrar is skipped, so the cost of covering a placement nobody in this
project uses is one `typeof` check per name.

**What each host gives the recording is a published table**, in
`@variance-authority/sense`'s README beside the case axis it qualifies. The
chart states the requirement in the form that survives the runners:
[`externals/test-host.md`](../../../.compass/externals/test-host.md) names what
the seam needs of any host and what degrades when a host withholds it.

**A new host changes one row.** It brings its own scheduling unit and its own
place to find the registrars; nothing above the seam learns which host wrote a
record, and the snapshot is one file whichever ones did.
