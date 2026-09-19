# Spec 0053 — a surface inside a suite reaches less

**Missing:** the run. A surface that hands subjects to `variance run` inherits
everything the run composes — sensitivity from configuration, the three images,
`variance accept`, `variance history`. A surface embedded in the adopter's own
test process inherits none of it, because nothing in that process writes a run
record: `packages/playwright-test` and `packages/vitest-browser` observe, judge
and promote per observation and leave no artifact the report side reads. The
asymmetry is not stated anywhere as a thing to close, so each half of it has
been closed once, separately, by whoever tripped on it.

## 1. What each embedded surface is missing, and what that is

`packages/playwright-test/src/evidence.ts` closed the images for one of the two:
its comment says a suite driving this library from its own runner got the
verdict sentence and nothing else. `packages/vitest-browser` still is that
suite. Nothing about a browser-mode component test makes a before, an after and
a diff harder to write than they are from a Playwright spec — the same
`@variance-authority/png` and the same `RasterStore` are one import away in
`node.ts`, which is already the judging half and already holds both rasters.
That is a defect, carried as one.

Retention is the larger half. Neither embedded surface can answer *has this
subject moved before*, because `@variance-authority/history` is imported by
`packages/cli` and by nothing else, and its rows are written by a run that has
a run identity. An in-test observation has a subject id, a verdict and a
timestamp, which is the whole of a row; what it does not have is anywhere to put
one.

## 2. Recording, where the placement has not been reached

The execution record follows the runner rather than the surface, so a jsdom
suite and a Playwright suite both have one. Two placements do not:

Vitest browser mode. The worker journal is written with `node:fs/promises`
(`packages/sense/src/test-selection/worker-source.ts`), and a browser-mode test
body runs in the tab, where there is no such module and no worker to write from.
The Vitest seam has no branch for it and installs the same setup file either
way. Per [ADR-0068](../context/adr/0068-a-seam-takes-the-hosts-own-unit.md) that
is a defect, not a documented limitation: the artifact would have to travel the
protocol the runner already gives its test body, which is the one
`packages/vitest-browser/src/protocol.ts` uses for every observation.

A served application. `packages/route-collector` visits URLs a server already
renders and records nothing, because the process that executes the product is
not the process the collector runs in. This one already has its answer built —
a journey head reports from a service it was wired into, and
`packages/playwright-test/src/events.ts` mints the journey a driver carries. The
collector does not mint one.

## 3. What must not be fixed by symmetry

An in-test surface must not grow a second report writer. A run record written by
a Playwright reporter and a run record written by `variance run` would be two
formats with one name, and the report side would have to ask which it was
reading. Whatever closes §1 writes the record the CLI already reads, or the CLI
grows a command that folds what the reporter staged.

`packages/unit-test` must not import React to close its attribution cell. It
takes `provenanceOf`, `wiringOf` and `holdingOf` as callbacks on purpose, so a
jsdom suite that renders something else can still archive a capture. That cell
reads *pass the reader* because it is a position, and it stays one.

## 4. The measure

[What each surface reaches](../surface.md#5-what-each-surface-reaches) is the
table this spec is the gap list for. A row that reads `Not written` or
`Not recorded` is either named here as a defect or named on the page as the
adopter's own to supply; there is no third kind.
