---
'@variance-authority/wire': minor
'@variance-authority/event': minor
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
---

Carry announcements and coverage on one medium, under one execution id.

A run said two kinds of things about the same execution and had two ways of
saying them: journeys reported coverage, events announced decisions, and each
had its own idea of where home was. Configuring one did not configure the other,
and a service that could talk about what it decided still could not say what it
executed.

`@variance-authority/wire` is that one medium. It resolves the carrier from the
realm — a sink the driver installed, for a server the suite started inside
itself, or a loopback return address the request arrived with on a cookie — so
the same `collectEvents()` and `collectJourneys()` calls serve a page, a service
in another process, and an in-process server without knowing which they are in.
Told neither, a participant reports to nobody, which is what a request the run
did not drive should do. The return address is refused unless it is `http:` on
loopback, because whoever is talking to the service writes that cookie.

Two guarantees ride the one wire, chosen by what a loss costs. An announcement
is fire-and-forget with per-endpoint ordering: a lost one is a wait that times
out loudly in the driver, holding the diagnosis. A coverage account is
acknowledged and retried: a lost one is a test silently skipped on the next run,
so a head counts what it lost and carries the count on later accounts, and a
head that lost everything is silent, which already retires the run.

Nothing at this level writes a file. A service is handed a `Cookie` header
naming the execution and where to answer, and nothing else; the driver alone
writes the coverage index.
