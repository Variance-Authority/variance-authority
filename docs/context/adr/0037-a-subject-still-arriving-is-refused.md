# ADR-0037 — a subject still arriving is refused, not captured

**Status:** accepted
**Date:** 2026-08-13
**Relates to:** [ADR-0002](0002-observation-profiles.md),
[ADR-0029](0029-a-page-is-held-still-before-it-is-read.md),
[ADR-0036](0036-the-fiber-is-a-band-and-a-finding.md),
[`packages/react/src/suspense.ts`](../../../packages/react/src/suspense.ts) (the reading),
[`packages/react/src/arrival.ts`](../../../packages/react/src/arrival.ts) (the wait and the rule),
[`cases/storybook-case/src/suspense.chromium.test.js`](../../../cases/storybook-case/src/suspense.chromium.test.js)

## Context

A `<Suspense>` boundary showing its fallback is the cleanest flake this system
meets: the same subject records a skeleton on a slow run and its content on a
fast one, nobody wrote that difference, and both readings are internally
consistent. Every band agrees, the second pass agrees with itself, and the
baseline is a spinner somebody approved without noticing.

Every readiness mechanism this project already ships asks the subject to speak,
and a suspending component cannot. Storybook's `storyRendered` fires when the
story function returns — a component that suspends *has* returned, and what is on
screen belongs to a boundary above it. A `readySelector` needs markup to attach
to; there is none. The commit tap hears the fallback commit and go quiet, which
is a page that has finished doing the wrong thing. The wire is settled by the
driver, which answers a different question: a response that arrived is not a
component that rendered, and between them sit a promise, a retry and a commit.

The boundary itself is a value. `memoizedState` is `null` while a boundary shows
its children and an object while it shows its fallback, reachable by traversal
from the expando provenance already reads — no hook, no build plugin, and it
works in production on a page nobody prepared.

That turns the readiness question from a threshold into a reading, and leaves one
decision: what a run does with the reading.

## Decision

**A subject that is still waiting is refused.** Not captured, not captured with a
warning, not waited on longer.

Three parts, split by what each half can know.

**In the page: `awaitSuspense` waits and reports.** It returns
`{ outcome, waitedMs, boundaries, pending }` where `outcome` is one of `settled`,
`pending`, `unobserved` — three states, because "nobody looked" and "looked and
found nothing waiting" must not compare equal (ADR-0002). A subject with no React
under it reports `unobserved` and never `settled`. It runs *first* in every page
agent, ahead of stabilization: content that arrives late brings its own images
and fonts, and a `waitForImages` that ran before them waited for the fallback's.

**Settled means N consecutive clean readings, not one.** A boundary that resolves
commits children that may immediately suspend on a boundary that did not exist a
moment earlier, so the first clean reading of a waterfall is taken exactly when
one boundary is showing children and the inner one has not appeared yet. The
default is two. A subtree with **no** boundary at all returns on the first
reading and pays nothing, which is the overwhelmingly common case.

**On the driver: `suspenseRefusal` decides, as a pure function.** It returns
`string | undefined` — the shape `unresizable` already uses, so a collector's use
of it is one `if` and cannot decay into a warning nobody reads. The sentence names
the subject, the boundaries, the components above each one, and says what it is:
a flake source, with the two things a person can do about it.

**The one escape hatch is a declaration.** `loading: ['some-subject']` says this
subject's *loading state* is what the baseline is over. A declared subject waits
for nothing (`timeoutMs: 0`) — the fallback is the point, and paying the timeout
to be told the boundary is still open would cost five seconds a subject to learn
what the declaration already said.

**The declaration is checked in both directions.** A subject declared as a
loading capture that turns out to have settled is refused too. A declaration
nobody deleted is a baseline that flips between a skeleton and a component
depending on the weather — the same flake arriving from the other side.

## Consequences

**A pending boundary is a refusal, not a finding.** It joins `unresizable` in the
small set of things that stop a subject being recorded, and it is the first one
that is about the *page* rather than about the run's configuration. `Collected`
already carries `{ok: false, because}` per subject, so one refused subject costs
the others nothing and is reported as a coverage hole rather than being silently
absent.

**`playwright-test` throws instead.** That surface returns an `Observation`, not
a `Collected`, and "we photographed a spinner" is not a comparison result. A
failed assertion is what actually reaches the person who can decide which of the
two states the test is about.

**Two collectors and a fixture pay for the wait; none of them decides.** The page
reports, the driver rules. The policy is one function with unit tests in Node, so
all three surfaces refuse identically and the sentence a person reads is written
in one place.

**A non-React page is unaffected and says so.** `unobserved` never refuses,
because a subject with no fiber under it is not a subject this instrument has an
opinion about — and reporting it as `settled` would let a failed bundle declare
itself fully arrived.

**The wait is the collector's default, at 5000ms.** Not opt-in, for the reason
stabilization is not opt-in (ADR-0029): a suite that has to ask for determinism is
a suite that discovers it needed it from a red build. `suspenseTimeoutMs: 0` keeps
the reading and skips the wait, which is a position for a project whose own
markers already cover its data.

**It cannot see a boundary that has not mounted.** A subject whose fetch has not
started — a route that suspends on an interaction that has not happened — has
nothing to wait for and reads `settled`. Correctly: there is no boundary. What
this refuses is a subject read mid-arrival, not a subject whose arrival has not
begun.

## Alternatives

**Capture it and mark the observation `unstable`.** Rejected. `unstable` is what
a *disagreement between two readings* means (ADR-0030), and a boundary that never
resolves produces two identical readings. Reusing the word would make the one
signal that means "read it twice and it moved" also mean "read it twice and it
was consistently wrong".

**Capture it and warn.** Rejected, and it is the option every incumbent takes.
The baseline is still a spinner and the build is still green; the warning is a
line in a log that the person who approves the baseline never sees.

**Wait longer.** Rejected as a category error. A boundary that never resolves is
not slow, and the timeout is precisely the thing that separates the two. Raising
it converts a refusal into a slower refusal.

**Sense the intent instead of declaring it.** Rejected: from outside, a story
that means to capture a skeleton and a story whose fetch is broken are the same
page. Any heuristic here — "the fallback has been stable for N ms", "the subject
is named `*Loading*`" — is a guess that silently un-refuses the exact case this
exists for.

**Put the decision in the page agent.** Rejected. The page can see the boundary
and cannot know whether an operator declared this subject a loading capture; a
page-side policy would need the declaration shipped into the browser, and three
page agents would each hold a copy of the rule.
