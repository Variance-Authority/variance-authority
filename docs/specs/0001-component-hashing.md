# Spec 0001 — Per-component band hashing

**Status:** specified, not built
**Package:** `@variance-authority/core`

## Purpose

Produce a stable content hash per component boundary per band, so that "this area
changed" is answerable without storing an image and without comparing
coordinates.

`SemanticSnapshot` carries `structureHash` and `styleHash` for a whole subject.
A subject-level hash answers "did anything change" and nothing else — it cannot
say which component, and it moves whenever anything inside it moves.

## Contract

```ts
export interface ComponentHash {
  readonly component: string;
  /** Instances of this component in the subject, counted in document order. */
  readonly instances: number;

  readonly structure: Digest;
  readonly style: Digest;
  /** Absent when the profile cannot observe layout. Absent is not empty. */
  readonly geometry?: Digest;
}

export function hashComponents(snapshot: SemanticSnapshot): readonly ComponentHash[];
```

Output is ordered by component name so two runs produce byte-identical output for
an unchanged subject.

## Behaviour

**Boundary scoping.** A node belongs to the nearest enclosing component boundary.
A component's hashes cover only the nodes whose nearest boundary is that
component; nodes inside a nested component belong to the nested one.

A component's hash MUST NOT move because a nested component's internals moved. A
whole-subtree hash makes every ancestor move on any leaf edit, which reports the
page root as changed on every commit and carries no information.

**Nested boundaries appear as placeholders.** Where a nested component sits in
the parent's node order, the parent's `structure` hash includes a placeholder
naming that component. Adding, removing, or reordering a child component is the
parent's own change and MUST move the parent's `structure` hash. What the child
renders internally MUST NOT.

**Bands are hashed separately, never blended.**

| Band | Covers |
|---|---|
| `structure` | tag, role, accessible name, state, normalized attributes, text, child order, nested-boundary placeholders |
| `style` | resolved declarations and the token names they resolved through |
| `geometry` | rects |

A single blended hash would make the same page hash differently depending on
which tier ran, so the record would churn on CI configuration rather than on
code.

**`geometry` is omitted, not empty, under a profile that cannot observe layout.**

**Instances fold in document order.** A component with N instances contributes
one entry whose hashes cover the ordered list of instance hashes. Reordering
instances moves the hash; it is a change.

**Paths are not hashed.** A node path is an address and shifts when unrelated
siblings move. Only content is hashed.

## Acceptance

Each is a test, not a claim.

1. **Ancestors do not move.** Editing markup inside `Button` moves `Button`'s
   hashes and does not move `Card`'s, where `Card` renders `Button`.
2. **Descendants do not move.** Editing `Card`'s own markup moves `Card` and does
   not move `Button`.
3. **Composition is the parent's change.** Removing a `<Button>` from `Card`'s
   JSX moves `Card.structure`.
4. **Bands separate.** A colour token change moves `Button.style` and leaves
   `Button.structure` unchanged.
5. **Reflow is geometry only.** A change that moves `Stack` without altering its
   own declarations moves `Stack.geometry` alone, and under `jsdom` moves
   nothing.
6. **Profiles agree.** The same subject captured under `jsdom` and under
   `chromium` produces identical `structure` and `style` hashes for every
   component.
7. **A no-op refactor moves nothing.** Run against the existing corpus's
   `noop-refactor` mutation across every subject.
8. **Reordering children moves the parent.** The `filter-reorder` mutation moves
   the structure hash of the component that owns the order, and not of the items
   that moved.

Acceptance 6 is the load-bearing one: without it the record is per-profile and
worthless as history.

## Out of scope

- Any persistence. This spec produces values; [0002](0002-history-store.md) keeps
  them.
- Raster hashes. Pixel content is machine-bound and cannot enter a record that
  crosses machines.
- Per-instance identity. Instance keys shift when content moves, which breaks
  exactly when a change occurs. A run report answers "which instance"; history
  answers "which area".
