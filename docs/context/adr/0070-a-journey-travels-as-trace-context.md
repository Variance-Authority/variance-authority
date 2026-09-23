# ADR-0070 — a journey travels as trace context, carried by the system itself

**Status:** proposed
**Date:** 2026-09-23
**Extends:** [ADR-0056](0056-a-journey-is-the-places-visited.md) (a journey is
the places visited), [ADR-0069](0069-every-answer-has-an-owner.md) (every answer
has an owner)
**Relates to:** [spec 0036](../../specs/0036-a-journey-crosses-processes.md)
(item 5, the second hop),
[`packages/sense/src/test-selection/journey.ts`](../../../packages/sense/src/test-selection/journey.ts),
[`packages/wire/src/index.ts`](../../../packages/wire/src/index.ts)

## Context

A journey is an opaque id per execution and the address its accounts return to.
The driver sets both as cookies on the application's origin, the browser sends
them with every request to that host, and a head reads them with `journeyOf`.
That is propagation, and the browser does it: nothing in the page or the service
changes.

It stops in two places.

- **Another hostname.** The cookies are scoped to `baseURL`. A page on
  `app.localhost` calling `api.localhost` sends that head nothing, so its
  accounts carry no journey and the run refuses to narrow.
- **The second hop.** A handler that calls another service does not forward a
  cookie it received, so a head behind a head is unattributed however well it
  is instrumented (spec 0036, item 5).

Distributed tracing solved both of these years ago. W3C Trace Context carries
context in `traceparent` and `baggage` headers. The frontend's instrumentation
puts them on outgoing requests, the backend's puts them on its own calls, and a
system that already runs OpenTelemetry forwards `baggage` through every hop
without knowing what is in it.

There are two ways to get the id further, and they differ in who carries it.

1. **We carry it.** An `addInitScript` wraps `fetch` and `XMLHttpRequest` in the
   page, a head patches `node:http` and `undici`, and a context `route` rewrites
   headers. It works without anyone's cooperation. It also changes the
   application under test in ways its authors cannot see. It breaks on the next
   client library. And it charges every request a detour the product never takes.
2. **The system carries it.** The id rides the standard the system already
   propagates. The page and the services pass it on through code their authors
   installed and can read, which is exactly how they already pass on their own
   trace.

## Decision

**A journey crosses a boundary only where a participant carries it, through code
that participant installed and can read, and it travels in the format tracing
already uses.**

1. **No magic.** Nothing this project ships patches a global, wraps a client,
   intercepts a route or rewrites a header in order to move the id. A hop is
   attributed because something in the system passed the id on, and never
   because we reached in and did it.
2. **Not alone.** The id is not a protocol of our own. It travels as W3C
   `baggage` members, `variance-authority-journey` and
   `variance-authority-return`, named for what the cookies are already named. So
   an OpenTelemetry propagator, or any tracing that forwards `baggage`, carries
   it with no code of ours. Where a system has no tracing, the piece it installs
   is a propagator written against the same standard, one it could replace with
   OpenTelemetry's without changing what arrives.
3. **The cookie stays the first hop.** The browser propagates it to the same
   host for free and asks nothing of the page, so a single-host application keeps
   working with nothing installed. A head reads either carrier. When both arrive
   they must agree, and a head that sees them disagree reports the request as
   unattributed rather than choosing one.
4. **A hop nobody carried widens.** A head that received no journey reports what
   it entered as unattributed, as it does today. A declared head that reported no
   journey all run keeps retiring the run. Attribution is earned hop by hop, and
   a missing hop costs selection, never correctness.

## What it forecloses

- **Patching the page's network.** No `addInitScript` wrapper around `fetch`,
  `XMLHttpRequest`, `sendBeacon` or `WebSocket` to add a header.
- **Patching a head's outgoing calls.** No hook on `node:http`, `undici` or any
  client library installed as a side effect of `collectJourneys`.
- **Rewriting requests in the driver.** No `page.route` or `context.route` that
  adds the id to a request the page made.
- **A header of our own.** No `x-variance-journey`. A header only this project
  reads is one every proxy, gateway and tracing stack in between has to be taught
  to forward, and none of them will be.
- **Widening the cookie by configuration as the answer to another host.** Naming
  every head's origin so the driver sets the cookie there too reaches the first
  hop on another host. It reaches no second hop, and it depends on the page's
  `credentials` mode and the cookie's `SameSite` value, which the test does not
  own.

## Consequences

The adopter does work that the patching alternative would have done for them. An
application with tracing already installed does none: it adds two `baggage`
members to what it propagates. One without tracing installs a propagator in the
page and in each head it wants followed past the first hop. That is the cost of
this decision, and it is the same cost the system pays for its own traces.

A head's reader grows a second carrier and a disagreement rule. The page agent
and the driver grow nothing.

Spec 0036, item 5 stops being a forwarder this project writes. It becomes a
record of which heads received their journey as `baggage` and which did not, so
a change behind a hop that was never carried widens exactly as a change behind an
unwatched origin does.
