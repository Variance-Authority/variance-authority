# @variance-authority/core

**Requires:** nothing — not even a runtime with a `Buffer`. No DOM, no I/O, no
async, enforced by its `tsconfig` (`lib: ES2022`, `types: []`), so "the core
cannot peek at a live document" is a compile error rather than a code-review
convention ([ADR-0006](../../docs/context/adr/0006-host-free-core.md)).

Pure data in, pure data out. Collectors extract; core normalizes and adjudicates.

## Entrypoints

Six groups, in the order an answer travels through them. The default entrypoint
is all six and is what most callers want.

| entrypoint | holds |
|---|---|
| `core/format` | what a subject *is*: capture, snapshot, document, identity, hashing |
| `core/rules` | the versioned opinions: allowlist, applicability, cascade, canonicalization |
| `core/compare` | two snapshots become deltas — and **no verdict** |
| `core/attribute` | a position becomes a component becomes a file |
| `core/judge` | policy: verdicts, intent claims, the docket a reader is handed |
| `core/plan` | a composition as a value, and the identity derived from it |

The groups exist for callers who genuinely want one. Somebody implementing the
capture format for a renderer this project has never met needs `core/format` and
would be misled by everything else.

## The split that carries weight

`compare` says **what moved**. `judge` says **whether anyone should mind**. A
comparison that also decided severity could not be reused by a team with a
different policy, and every team has a different policy.

## Usage

```ts
import { normalize, diffSnapshots, isolateRegions, attributeRegions } from '@variance-authority/core';

const before = normalize(capture, { profile: 'chromium' });
const after = normalize(recapture, { profile: 'chromium' });

const diff = diffSnapshots(before, after);          // deltas, roots, matching
const places = isolateRegions(mask, { cell: 8 });   // pixels → regions
const named = attributeRegions(places.regions, after); // regions → components → files
```

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
