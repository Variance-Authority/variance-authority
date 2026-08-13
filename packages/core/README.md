# @variance-authority/core

**Requires:** nothing — not even a runtime with a `Buffer`. No DOM, no I/O, no
async, enforced by its `tsconfig` (`lib: ES2022`, `types: []`), so "the core
cannot peek at a live document" is a compile error rather than a code-review
convention ([ADR-0006](../../docs/context/adr/0006-host-free-core.md)).

Pure data in, pure data out. Collectors extract; core normalizes and adjudicates.

## Entrypoints

Seven groups. Five of them are the order an answer travels through; `core/plan`
and `core/relate` sit outside that line, because both are asked *before* anything
is captured — one decides which baselines the run can reach at all, the other
decides which subjects are worth reaching for. The default entrypoint is all
seven and is what most callers want.

| entrypoint | holds |
|---|---|
| `core/format` | what a subject *is*: capture, snapshot, document, identity, hashing |
| `core/rules` | the versioned opinions: allowlist, applicability, cascade, canonicalization |
| `core/compare` | two snapshots become deltas — and **no verdict** |
| `core/attribute` | a position becomes a component becomes a file |
| `core/judge` | policy: verdicts, intent claims, ignores, the docket a reader is handed |
| `core/plan` | the whole configuration of a run — profile, ruleset version, viewport, policy, interventions — as one value, plus the identity digest derived from it |
| `core/relate` | what rests on what: a file graph in adjacency form, the components a change reaches, and a closure digest over each one |

The groups exist for callers who genuinely want one. Somebody implementing the
capture format for a renderer this project has never met needs `core/format` and
would be misled by everything else. Somebody deciding where a baseline is stored,
or whether two runs may be compared at all, needs `core/plan` and nothing else:
the digest it derives is the address, so changing any part of the plan changes
which baselines the run can see.

## The split that carries weight

`compare` says **what moved**. `judge` says **whether anyone should mind**. A
comparison that also decided severity could not be reused by a team with a
different policy, and every team has a different policy.

## Usage

```ts
import { normalize, diffSnapshots, isolateRegions, attributeRegions } from '@variance-authority/core';

const before = normalize(capture);                  // the profile arrived with the capture;
const after = normalize(recapture);                 // normalization does not choose one

const diff = diffSnapshots(before, after);          // deltas, roots, matching — no verdict
                                                    // hand `diff` to core/judge for one

// The pixel path, for the subjects a digest could not settle. `mask` is a
// ChangeMask from the raster tier (`@variance-authority/png` decodes and
// compares); core never opens an image, which is why it requires nothing.
const places = isolateRegions(mask, { cell: 8 });   // pixels → regions
const named = attributeRegions(places.regions, after, { scale: 2 });
```

`scale` is device pixels per CSS pixel, it is **required**, and it has no default
on purpose: a 2x screenshot attributed at 1x lands every region in the top-left
quadrant and names the wrong component for each — a full, plausible, entirely
wrong report. That last step is where regions become components and files.

## What it refuses

**Absent is not empty.** Not measured, measured as zero, and unobservable are
three states, and collapsing any two produces a pass nobody earned. A band a
profile cannot see reports `UNOBSERVED`, which the type system will not let you
spell the same way as a pass.

**Two results whose identities differ are `incomparable`, never `different`.**
A difference in conditions reported as a difference in the product is a
confident wrong answer, and the confidence is what makes it expensive.

## Reading

- [ADR-0001](../../docs/context/adr/0001-toolchain-and-layout.md) — layout and direction
- [ADR-0003](../../docs/context/adr/0003-cruft-removal-and-css-applicability.md) — CSS applicability pruning, 1007 rules → 1
- [ADR-0007](../../docs/context/adr/0007-subject-boundary-is-the-component-tree.md) — the subject boundary
- [ADR-0008](../../docs/context/adr/0008-per-profile-expectations.md) — undecidable / divergent / undeclared
