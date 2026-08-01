# ADR-0001 — Monorepo toolchain and package layout

**Status:** accepted
**Date:** 2026-08-01

## Context

Kickoff. The repo was empty apart from a Yarn 4 bootstrap using the default
Plug'n'Play linker. We need a layout that supports four independently adoptable
dimensions (§9 "no monolithic v1") and two rendering surfaces (JSDOM, REAL-DOM)
that must not be able to accidentally depend on each other's assumptions.

## Decision

**Yarn 4 workspaces, `nodeLinker: node-modules`, TypeScript project references,
Vitest.**

Package graph — dependencies point downward only:

```
cli
 ├── collector-playwright ──┐
 ├── collector-jsdom ───────┤
 │        └── provenance-react
 └── core ◀─────────────────┘
```

- `core` depends on **nothing** in the repo and has **no DOM, React, or browser
  types**. It is pure data: format, normalization, hash, diff, band, verdict.
- Collectors depend on `core` for types and on `provenance-react` for owner
  chains. They never depend on each other.
- `provenance-react` depends on `core` types only.

## Rationale for `node-modules` over PnP

PnP is the better default in the abstract, but this project's two riskiest
dependencies are Playwright (downloads and spawns browser binaries) and the
React DevTools/fiber internals we intend to reach into. Both are exactly the
class of package that breaks under strict PnP resolution, and debugging a
resolution failure is time not spent on the normalizer — which is the actual
moat. Revisit once the spike proves out.

## Consequences

- `.pnp.cjs` deleted; `node_modules` is gitignored (already was).
- Every package builds with plain `tsc --build`. No bundler in the spike. A
  bundler is a decision we can defer until there is something worth bundling.
- `core` having no DOM types is enforced by its `tsconfig` `lib` (ES2022 only).
  This is deliberate: it makes "the core can't peek at the DOM" a compile error
  rather than a code-review convention.

## What this forecloses

- Zero-installs. We are not committing the Yarn cache.
- Any design where `core` reaches into a live document to resolve something.
  Collectors must hand `core` fully-materialised data. This is the constraint
  that makes a remote sub-renderer possible at all (see ADR-0002).
