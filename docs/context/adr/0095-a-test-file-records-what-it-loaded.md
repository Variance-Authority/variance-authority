# ADR-0095 — A test file can record what it loaded, with one line per module

**Status:** accepted
**Date:** 2026-10-19
**Amends:** [spec 0028](../../specs/0028-the-instrument.md) §5 (identity)
**Relates to:** [ADR-0093](0093-probes-are-placed-after-the-transforms.md),
[`packages/sense/src/test-selection/captured-modules.ts`](../../../packages/sense/src/test-selection/captured-modules.ts),
[`packages/sense/src/test-selection/collectors.cts`](../../../packages/sense/src/test-selection/collectors.cts),
[`packages/sense/src/instrument/identity.ts`](../../../packages/sense/src/instrument/identity.ts)

## Context

Every recipe cut each module into regions and probed them: `presence` every
arrival region, `entries` the module and each function. Both rewrite the
module's body, so both pay a parse and a walk per module, a probe per region
that runs, and a record that grows with the regions. A transform that reads
syntax reads the probes too ([ADR-0093](0093-probes-are-placed-after-the-transforms.md)
moved them after the transforms for that reason, at the cost of a second parse
and a source map).

Selection at the file grain needs none of it. Ekstazi showed that the files a
test loaded are cheaper to collect than what it executed and lose little
precision; Microsoft and Datadog Test Impact Analysis keep a file list per test.
The `unprobed` option already marked a module as loaded without probing it:
one line after the module's own text, under the id `path@~digest`.

A module is marked as its test file loads it, which is before any of the
file's cases opens. Per-case scoping under that recipe opened a scope per case
and recorded only the load again in each one: work at run time that told
selection nothing.

## Decision

**`mode: 'loads'` is a third recipe, `sense:instrument/loads-v1`. It cuts
nothing and probes nothing: every module the run would probe gets the
`unprobed` mark, and the run records one bucket per test file and no cases.**

1. **The mark is the whole transform, and it is one call.** The seam appends
   `\n;globalThis.__VA__.m("<id>");` after the text as it received it: no
   parse, no walk, no map, no header and nothing imported. `m` is the run's
   root: it registers the module and logs it as loaded. A runner seam — Jest,
   Vitest, Rstest, the Node runner — installs the root in its setup, so the
   line is all a module carries. A page has no setup, so the bundle seams —
   `testSelectionProbes` and the webpack loader — add the import of the page's
   collector before the mark, as they do under every recipe. A module that runs
   where no root is installed throws on the missing global, as a probed one
   does. Jest's transformer is never asked for its `senseRecipe`. The probe
   recipe is the `loads` id with the presence recipe's digest, which covers the
   walk's sources, so a change to the walk keys a cache afresh though the mark
   did not move.
2. **The module is recorded with no blocks.** Its id is `path@~digest`, held
   not instrumented, so a change anywhere in the file selects every test file
   that loaded it. A text change that moves no line still selects: the reader
   has no regions to compare.
3. **No case is recorded.** Vitest, Rstest, Jest and the runner-neutral seam
   take the `flat` collector, as Jest's flat path already did. Continuations,
   cadence and stories are off with it; `variancePrecondition` returns
   silently when no case scope is installed.
4. **A test file claims what its realm already holds.** A realm shared between
   test files — Vitest's `isolate: false`, a reused Storybook page — evaluates
   a module once, so a later file that imports it runs no mark. Each file's
   bucket opens with every module the realm already loaded, and a page's
   collector leaves the same in its bucket after each drain, so selection errs
   toward running a file that imported less.
5. **Every seam takes it.** The Vitest plugin, the Jest transform, the Rstest
   loader, the Node loader hooks and `testSelectionProbes` (and with it the
   Storybook addon) all read the same option.

Which checks run in a given environment, and whether a build or module cache
is shared between environments, is the project's configuration. The recipe is
a switch it composes, not a policy this package decides.

## Consequences

- On this repository's unit slice (925 test files, 10,549 tests, 16 cores,
  two interleaved rounds that agree within 0.2 s): the run takes 66.8 s with
  no seam, 68.2 s with the seam installed and nothing marked, and 68.7 s under
  `loads`. The marks cost half a second; the rest is the seam's own setup and
  the run's fold. A run's preconditions are digested once, natively and in
  parallel, rather than once per test file that ran under them: before that,
  the digests alone cost several seconds and grew with the number of test
  files.
- Under a shared realm a later test file is charged with every module an
  earlier one loaded, so a change selects more of it than an isolated run would.
- A `loads` record selects at the file grain and cannot answer which line a
  test reached, which case covered a region, or what a case said.
- A record made under `loads` is never laid over one made under another recipe:
  the id differs, as between `presence` and `entries`.
