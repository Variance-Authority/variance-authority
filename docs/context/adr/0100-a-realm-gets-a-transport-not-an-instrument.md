# ADR-0100 — a realm gets a transport, not a second instrument

**Status:** accepted
**Date:** 2026-11-12
**Discharges:** spec 0028, its rule that a browser needs a different transport
and not a different instrument
**Relates to:** [ADR-0068](0068-a-seam-takes-the-hosts-own-unit.md) (each
host's seam takes its own unit),
[ADR-0093](0093-probes-are-placed-after-the-transforms.md) (where the probes
are placed), [ADR-0070](0070-a-journey-travels-as-trace-context.md) (how a
service learns whose request it is serving),
[`packages/sense/native/instrument/src/header.rs`](../../../packages/sense/native/instrument/src/header.rs),
[the execution record](../../execution-record.md#journals)

## Context

Spec 0028 built one instrument for a Vitest worker and named the next realms
before they existed: a page that renders a story, and a service that answers
the page's requests. Each had an instrument of its own available. A page can be
read through the browser's own V8 coverage over the DevTools protocol, or by
Istanbul inside the bundle. A service can be read by `NODE_V8_COVERAGE`. Each
of those names a region its own way, so a crossing from a page and one from a
worker would not land on the same block, and a diff would be traced through
three tables that disagree at their edges.

The spec chose the other way while there was still one realm: *a browser needs
a different transport, not a different instrument.* The same probes and the
same block ids serve every realm, and only the path from the realm back to the
record changes. Keeping the emitted code free of Node built-ins is what keeps
that open.

## Decision

**There is one instrument, and a realm is given a way to report what it ran,
never a second way to observe it.**

- The code the instrumenter emits asks its realm for one global,
  `globalThis.__VA__`, and imports nothing: no Node built-in, no module, no
  bundler helper. `header.rs` is its one author.
- A realm records by installing that root. A Vitest, Jest or Rstest worker
  gets it from the seam's setup file, a page from the collector
  `testSelectionProbes` hoists, and a service from the getter
  `collectJourneys` installs.
- Each realm differs only in how its ordinals leave it: a worker journal per
  test file, a page journal drained after each subject, and a journey account
  sent over the journey wire. All three carry module ids and ordinals of the
  same recipe, so the writer folds them into one record.

## Alternatives

- **The realm's own coverage.** Browser V8 coverage over the DevTools protocol,
  Istanbul in the page bundle, or `NODE_V8_COVERAGE` in a service. Rejected:
  each cuts regions by its own rule, so a block would have one identity per
  realm and the record would need a translation between them that nothing can
  check.
- **A Node-specific runtime in the probe.** Reading `process`, `async_hooks` or
  a file from the emitted code would make the worker case simpler. Rejected:
  the same module then cannot run in a page, and a page would need its own
  instrumented build.

## Cost

- The emitted code can import nothing, so everything a probe needs arrives
  through the one global, and a realm that cannot hold a writable global
  property cannot record.
- A page records only when a driver that can evaluate in it drains the
  collector; a page nobody drains reports nothing.
- A realm this project has not shipped a root for is not recorded until one is
  written, even where the platform has a coverage tool of its own.
