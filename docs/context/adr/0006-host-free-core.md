# ADR-0006 — `core` depends on no host: no Node, no DOM, no globals

**Status:** accepted
**Date:** 2026-08-01
**Amends:** ADR-0001 (§"What this forecloses"), ADR-0002 (§"The sub-renderer protocol")

## Context

ADR-0001 states that `core` has no DOM types, enforced by `lib: ["ES2022"]`, and
concludes that collectors must hand `core` fully-materialised data — "the
constraint that makes a remote sub-renderer possible at all".

That guard is **one-directional**. It prevents `core` from reaching into a
browser. It does nothing about `core` depending on Node: a `types: ["node"]`
entry in the same `tsconfig` admits `node:crypto` without objection, which is
how `hash.ts` obtained SHA-256.

`propsDigest` cannot run in a host process, because it cannot receive its input
there — a React prop may be a function or an element, and neither survives
serialization out of the page. The digest must be taken where the value still
exists, which is inside the rendering environment, and a `core` that imports
`node:crypto` cannot run there.

The division "collectors extract, `core` normalizes, the transport is free" is
therefore false in the one place it is load-bearing. A browser verification
harness for `react` built against a Node-dependent `core` must stub
`node:crypto` to run at all, and such a stub verifies traversal while proving
nothing about hashing.

## Decision

**`core` depends on no host environment.** Not Node, not the DOM, not
`TextEncoder`, not `crypto`. Its `tsconfig` declares `types: []` alongside
`lib: ["ES2022"]`, which makes the boundary bidirectional and enforced by the
compiler rather than by intent.

SHA-256 is implemented in `src/sha256.ts`, including its own UTF-8 encoder.

### Why not `crypto.subtle`

It is async. Hashing is synchronous throughout — `canonicalize` → `digestValue`
→ `normalize` is a pure, synchronous data transformation, and ADR-0004 already
commits to keeping it that way ("no `core` API that is async or streaming 'so it
can be native later'"). Making the hash async would colour every caller for no
gain, and would make `propsDigest` — called once per component boundary during a
fiber walk — an await inside a tree traversal.

### Why not a runtime branch

`node:crypto` where available, JS elsewhere, would mean two code paths producing
the system's identity values. SHA-256 is fully specified by FIPS 180-4 so both
paths would agree, and the risk is genuinely low — but the payoff is only
performance, which ADR-0004 declines to optimize for without a measurement, and
none has been taken.

### Why hand-encode UTF-8

`TextEncoder` is available in every runtime this targets. Hand-encoding keeps
`core` free of *every* host global rather than merely the Node ones. Lone
surrogates are substituted with U+FFFD exactly as `TextEncoder` does, so a
malformed string cannot digest differently on two runtimes.

## Consequences

- `core` runs unmodified in Node, a browser, a worker, or a device-farm agent.
  ADR-0002's claim that a `RawCapture` can cross any transport is true of the
  code that produces one, not only of the value.
- `node:crypto` appears in exactly one file, `sha256.test.ts`, as the oracle the
  portable implementation is checked against.
- The implementation is covered by the FIPS published vectors and by
  differential testing against `node:crypto` at the block and padding
  boundaries (55/56/57, 63/64/65, 127/128/129 bytes) and across multi-byte and
  astral input. Both layers are required: the published vectors do not catch a
  padding error that emits an extra block whenever `length + 9` is already a
  multiple of 64, and the differential test does.

## What this forecloses

- Reaching for any Node built-in in `core`, including `node:fs` for manifest I/O.
  Manifest reading and writing belong to the CLI, which is allowed a host.
- Using `crypto.subtle`, and with it any future move to an async hash.
- Claiming a performance number for hashing without first taking one.
