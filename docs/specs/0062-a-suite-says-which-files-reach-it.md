# Spec 0062 — a suite says which files reach it

**Missing:** a way to say that a change to an image, a font or a declared data
file does not select a suite's tests. Today every `asset` and `depends` edge is
a runtime edge, and every suite is reached through it. A changed icon runs the
unit tests of every module that imports it, and those tests never read a pixel.
**Built on:** `RUNTIME_EDGES` in `packages/core/src/relate/graph.ts` (the kinds a
selection walks), `answerByImporters` in
`packages/sense/src/test-selection/importers.ts` (where a rowless file is
answered).

## Purpose

An image changes rarely, so the cost is small and it is paid at the worst time:
the one commit that swaps a logo runs the whole unit suite of the component
library. The visual suite is the one that has to run. Some unit suites do read
the bytes, such as an image loader or a checksum test, so no default can decide
it for everyone.

## What would discharge it

**1. The configuration declares it, per suite.** A suite's entry names the edge
kinds, or the file patterns, that do not reach it: for example `asset` for a
unit suite, and nothing for the visual one. The default stays the current
answer, so every suite is reached.

**2. The decision is printed.** A file that reached no test because a suite
declined it is reported with the suite and the declaration that declined it,
never dropped silently.

**3. A test that reads the bytes stays reachable.** A `/// <depends>` in that
test, or in the module it tests, is an edge the author drew on purpose, and a
suite that declines `asset` still follows it.

**4. It keys on what the suite is, not on the runner.** Whether a suite is a
unit or a visual suite is its declared nature. It is not inferred from which
seam recorded it.
