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
file's cases opens. Per-case scoping under that recipe recorded only the load
again in each case: on TanStack Query's `query-core` it wrote about 186 KB of
case sections against 0 bytes of blocks.

## Decision

**`mode: 'loads'` is a third recipe, `sense:instrument/loads-v1`. It cuts
nothing and probes nothing: every module the run would probe gets the
`unprobed` mark, and the run records one bucket per test file and no cases.**

1. **The mark is the whole transform.** `markLoaded` appends
   `\n;<header>__vaE();` after the text as the seam received it: no parse, no
   walk, no map. Jest's transformer is never asked for its `senseRecipe`, and
   the recipe digest is the header's half of the presence recipe.
2. **The module is recorded with no blocks.** Its id is `path@~digest`, held
   not instrumented, so a change anywhere in the file selects every test file
   that loaded it. A text change that moves no line still selects: the reader
   has no regions to compare.
3. **No case is recorded.** Vitest, Rstest, Jest and the runner-neutral seam
   take the `flat` collector, as Jest's flat path already did. Continuations,
   cadence and stories are off with it; `variancePrecondition` returns
   silently when no case scope is installed.
4. **Every seam takes it.** The Vitest plugin, the Jest transform, the Rstest
   loader, the Node loader hooks and `testSelectionProbes` (and with it the
   Storybook addon) all read the same option.

Which checks run in a given environment, and whether a build or module cache
is shared between environments, is the project's configuration. The recipe is
a switch it composes, not a policy this package decides.

## Consequences

- On `query-core` (21 test files, 614 tests, best of five): the plain run takes
  1.21 s, `presence` 1.50 s with a 374 KB record, `loads` 1.37 s with a 46 KB
  record. Recording costs about half of what `presence` costs, and the record
  is about an eighth its size.
- A `loads` record selects at the file grain and cannot answer which line a
  test reached, which case covered a region, or what a case said.
- A record made under `loads` is never laid over one made under another recipe:
  the id differs, as between `presence` and `entries`.
