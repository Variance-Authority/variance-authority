---
id: TASK-19
title: Give test code a debugger the agent can drive
status: Done
assignee: []
created_date: '2026-09-15'
labels: []
dependencies: []
references:
  - packages/playwright-test/src/vantage.ts
  - packages/vantage/src/watch.ts
  - packages/vantage/src/attach.ts
  - packages/eyes/src/playwright.ts
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`debugger;` and a logpoint, for an agent instead of a person. Two calls a test
author writes in a spec file:

```ts
variance.snapshot();        // send what is here now, keep going
await variance.observe();   // send it and wait until the agent says continue
```

### This is user space

The names come from the vocabulary a developer already owns — breakpoint,
logpoint, snapshot, observe — and not from anything inside this system. A test
author does not know that `Holding` means a hook cell in
`@variance-authority/core/format`, or that an `Observation` carries a verdict
against a baseline, and nothing about this API should make them learn either.
Internal terms collide with these words only in a space the caller never enters.

What crosses the boundary is thin and already established: the three
coordinates, `location`, `subject`, `action`, which a test already names back to
what product source announced through `vae`. Nothing else needs to agree.

Two calls rather than one, because the author's intent differs. Recording a
waypoint and stopping to be inspected are different things to want, the same way
`console.log` and `debugger;` are, even where the machinery underneath is shared.

### What it costs when nobody is watching

Nothing. `openVantage` already answers `undefined` on an unset address for one
environment read per worker, so `observe()` returns immediately and `snapshot()`
sends nowhere. A call left in a committed spec file is inert in CI — unlike
`debugger;` or `.only`, it never has to be policed out of the source, which is
the property that makes it worth having at all.

### Where a call can be placed

A prototype over the real `listen` from `@variance-authority/wire` established
that `await variance.observe()` stops the test wherever the test is
**transitively awaiting that frame** — which is wider than the test body and
narrower than anywhere:

| placement | result |
| --- | --- |
| test body | stops the test |
| async helper the test awaits | stops |
| sync frame (a React render body) | cannot stop — no await point, execution escapes |
| effect nobody awaits | does not stop — the test's next statement runs |
| handler the test awaits (`page.route`, instrumented service) | **stops** |
| nobody watching | returns immediately |
| watcher goes away mid-wait | returns, never hangs |

The fifth row is the one to build for: a stop inside a route interceptor or an
instrumented service handler parks the world mid-request, with the page's fetch
pending and the test's wait pending. Nothing else in the system reaches that
point.

### Implementation, which is the other side of the boundary

The mechanism belongs in `@variance-authority/vantage`, which owns the address
and the channel, with the fixture on the desk in
`packages/playwright-test/src/vantage.ts` where the driver half already lives.
`unit-test` is the same story browserless, and a service — which imports `event`
and `sense/journal` and has nothing author-facing — is the caller that has no
desk yet.

Not `@variance-authority/event`: that package ships in **product source**, where
a blocking call has no business, and its guarantee is that a listener cannot
reach the code that announced. Not `@variance-authority/wire`, which is the
medium and not a place verbs live.

The run polls and the watcher answers, so the socket direction never reverses
and a watcher that goes away releases the wait instead of hanging it. In-page
calls travel `page.exposeFunction` — which returns a promise the page can await
— because wire's listener answers JSON with no `access-control-allow-origin` and
a fetch from page origin would have its response blocked.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 Ship `variance.snapshot()` and `await variance.observe()` under names from the debugging vocabulary, with no internal term required to understand either
- [x] #2 Keep the crossing surface to the three coordinates a test already names back, and let internal naming stay free of this API
- [x] #3 Prove the nobody-watching return and the watcher-gone return with tests rather than asserting them, so a committed call is demonstrably inert in CI
- [x] #4 Put the fixture on the desk in `playwright-test` and the mechanism in `vantage`, leaving the suite half with no listener
- [x] #5 Keep it out of `event`, which ships in product source, and out of `wire`
- [x] #6 Carry enough with a snapshot that the agent can act without the run's scope: the subject, where the execution is, and what the tree was holding
- [x] #7 Expose what is waiting, what it sent, and continue — one and all — exercised from a real MCP client rather than from the tool functions alone
- [x] #8 Resolve the runner timeout so a waiting test cannot be killed by it silently
- [x] #9 Decide the in-page call over `page.exposeFunction`, or mark that boundary at the site
- [x] #10 Decide the service-side caller: a package named for who it serves, or a marked boundary at the site
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`variance.snapshot()` and `await variance.observe()` hang off the `variance`
fixture a suite already destructures, rather than a second fixture to remember:
`variance(locator)` is what the suite checks, the other two are what it says
while checking it.

Neither takes a line number — both read their own caller off a thrown stack,
skipping frames from this module by its own path rather than by a name fragment,
which would also match the file that tests it.

A note is stamped on arrival with how much the test had announced by then, so a
reader can place it in the announcement stream without a clock between the two
lists. That is the whole of AC #6 that is worth carrying: what the tree was
holding is available because `observe` is still holding it, and a `snapshot` past
which the run has moved on cannot honestly promise the same.

The runner's clock is stopped for the duration of a wait and the time stood still
is handed back afterwards, so a released test has exactly the remaining budget it
had before somebody looked at it — not a reset one.

ACs #9 and #10 took the marked-boundary branch. The in-page and service-side
callers are additions of the same two calls in another place; what each needs is
written at the site in `packages/playwright-test/src/vantage.ts`, including why
an in-page `fetch` cannot be the route.

The worked example lives at `docs/agent-interrogate.md`, published under
`/agents/interrogate`: a spec with both calls in it, the `variance_waiting`
listing it produces, the release, and the two callers that are not the test body
— an awaited helper and an awaited route handler. `docs/vantage.md` gained the
stopping rule, and `runnerReprieve` was lifted out of the fixture into
`vantage.ts`, which is the half of `DeskOptions.reprieve` that knows the runner.
<!-- SECTION:NOTES:END -->
