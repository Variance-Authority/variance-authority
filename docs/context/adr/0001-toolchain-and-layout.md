# ADR-0001 — Monorepo toolchain and package layout

**Status:** accepted
**Date:** 2026-08-01

## Context

The repository must support four independently adoptable dimensions (§9, "no
monolithic v1") and two rendering surfaces (JSDOM, REAL-DOM) that must not be able
to accidentally depend on each other's assumptions.

Plug'n'Play is the better linker in the abstract, but the two riskiest dependencies
here are Playwright, which downloads and spawns browser binaries, and the React
DevTools/fiber internals the provenance layer reaches into. Both are exactly the
class of package that breaks under strict PnP resolution, and resolution failures
consume effort that belongs to the normalizer, which is the actual moat.

## Decision

The repository uses **Yarn 4 workspaces, `nodeLinker: node-modules`, TypeScript
project references, and Vitest**.

Package dependencies point downward only:

```
cli
 ├── collector-playwright ──┐
 ├── collector-jsdom ───────┤
 │        └── provenance-react
 └── core ◀─────────────────┘
```

- `core` depends on **nothing** in the repo and has **no DOM, React, or browser
  types**. It is pure data: format, normalization, hash, diff, band, verdict.
- Collectors depend on `core` for types and on `provenance-react` for owner chains.
  They never depend on each other.
- `provenance-react` depends on `core` types only.

`node_modules` is the linker output and is gitignored; `.pnp.cjs` is absent. The
linker choice is revisitable once Playwright and the fiber internals are proven to
resolve under PnP.

## Consequences

- Every package builds with plain `tsc --build`. There is no bundler, and a bundler
  stays deferrable until there is something worth bundling.
- `core` having no DOM types is enforced by its `tsconfig` `lib` (ES2022 only). This
  makes "the core cannot peek at the DOM" a compile error rather than a code-review
  convention.

## What this forecloses

- Zero-installs. The Yarn cache is not committed.
- Any design where `core` reaches into a live document to resolve something.
  Collectors must hand `core` fully-materialised data. This is the constraint that
  makes a remote sub-renderer possible at all (see ADR-0002).
