# 0002 — Fiber provenance: owner chains from a live DOM node

**Date:** 2026-08-01
**Cycle:** helix 1, move M2
**Branch:** B2 (provenance)

## What was asked

Build `@variance-authority/provenance-react`: given a DOM element, produce the
`Provenance` value `core` defines — owner chain innermost-first with a props
digest per boundary, `createdBy`, optional source location. It must work in both
jsdom and a real browser, and must not require the React DevTools hook.

## What was done

Four source files (`fiber`, `names`, `resolve`, `runtime`), 23 tests rendering
real React trees under jsdom, ADR-0005, and a manual browser harness under
`packages/provenance-react/browser-check/` that runs the same ten assertions in
Chromium.

**Tested against React 19.2.8 / react-dom 19.2.8.** Everything below was
measured on that version, not read from documentation.

## Five things about fibers that were not obvious

### 1. The DOM's fiber pointer goes stale on alternating commits

This is the one that would have shipped a wrong answer rather than a missing one.

React double-buffers: every fiber has an `alternate`, and a commit swaps which
half is "current". `precacheFiberNode` writes `node.__reactFiber$xyz` **once, at
mount**, and never re-points it on update. So after an odd number of commits the
pointer addresses the *stale* half, and its `memoizedProps` are one render
behind.

Measured, rendering a prop through `c1 → c2 → c3`:

```
cached fiber memoizedProps:    {"className":"c1", …}   ← after the c2 commit
alternate memoizedProps:       {"className":"c2", …}
__reactProps$ value:           {"className":"c2", …}
walked-up tag: 3   is root.current? false
after 3rd render, cached fiber is current? true   props: c3
```

Note `__reactProps$` *is* updated in place, which makes this easy to miss: a
naive check against host props looks right while the fiber's own props are
wrong. And composites have no `__reactProps$` at all, so it is not a workaround.

Unresolved, a props digest would alternate between correct and one-render-stale
on every commit. In this system that is not a cosmetic bug: §6.2 decides
root-vs-collateral by asking whether a component's *incoming props held* while
its subtree changed. A digest computed from props that were never in force
decides that question wrongly, in both directions, on alternating renders.

Resolution: walk `return` to the top, and if the `HostRoot` you land on is not
`fiberRoot.current`, take `fiber.alternate`. A bailed-out subtree is shared by
reference between both trees and has no alternate, so `?? fiber` is the correct
fallback there rather than a fudge.

### 2. `memo()` has two different fiber representations

`memo(fn)` where `fn` is a plain function with no comparator collapses to a
single `SimpleMemoComponent` (tag 15) fiber. Anything else — a custom comparator,
or a `forwardRef` inside — cannot collapse, and React emits a `MemoComponent`
(tag 14) wrapper **plus** an inner fiber, both carrying identical props:

```
[data-t="simple"]   5:b <- 15:SimpleInner <- …
[data-t="compare"]  5:i <- 0:CompareInner <- 14:react.memo <- …
[data-t="leaf"]     5:span <- 11:react.forward_ref <- 14:react.memo <- …
```

So whether a memoized component contributes one frame or two depends on an
argument the author passed for performance reasons. Tag 14 is therefore excluded
from the owner-frame set entirely; the inner fiber carries the frame.

### 3. `fiber.type` is the wrong field to name a component from

For a `SimpleMemoComponent`, React sets `fiber.type` to the *inner function* and
keeps the `memo()` object — and any `displayName` set on it — only in
`fiber.elementType`. A test asserting that `Renamed.displayName = 'ExplicitName'`
wins caught this: reading `type` reported `Original`, silently discarding a name
the author chose deliberately.

Reading `elementType` first, `type` as fallback, is correct for every tag:
`elementType` is "the type as authored", which is precisely the thing whose name
a human recognises.

### 4. `_debugSource` no longer exists

React 19 removed it. Probing every fiber in a rendered tree:

```
hasDebugSource: false      hasDebugStack: true
```

It was replaced by `_debugStack`, an `Error` captured at element creation.
Recovering `file:line` from that means parsing a stack trace and running it back
through source maps — a build tool's job, not a collector's. So spec §6.1's
"optional source location via a babel/swc plugin" is, on React 19, entirely a
compile-plugin story: there is no runtime field left to read. `source` is
returned as absent, which the type already declares as the normal case.

### 5. Unmount deletes the expandos

```
after unmount, leaf keys: []
```

React removes `__reactFiber$` and `__reactProps$` from detached nodes, so a
torn-down subtree is indistinguishable from third-party DOM. Convenient — it
means the `no-client-fiber` sentinel covers unmounted nodes without a liveness
check — but it also means the `unmounted` reason is nearly unreachable in
practice, and a collector cannot use "had a fiber once" as a signal.

## What breaks if React changes

Three assumptions, ranked by how badly each fails:

| Assumption | Symptom if it breaks | Severity |
|---|---|---|
| Expando prefix `__reactFiber$` | every node reports `no-client-fiber` | loud, harmless |
| Work-tag numbering | chains lose frames; unknown tags are skipped, not thrown on | quiet, recoverable |
| Double-buffer resolution | props digests one render stale | **quiet and wrong** |

The third is the dangerous one, because a stale digest is still a well-formed
digest. It has a regression test that fails if the resolution is removed
(`reads the props actually in force, not the previous render's`), which compares
a twice-committed tree against a freshly-mounted one — the fresh tree has no
alternate, so it is ground truth.

Exact React version is recorded where reachable, but honestly: nothing on a
fiber carries a version number. With no DevTools hook the best available *fact*
is which expando convention `react-dom` used (`reactFiber` ⇒ ≥17), so
`detectReactRuntime` reports that bound and leaves `version` undefined rather
than guessing. The hook, when present, gives the exact string.

## The RSC finding (spec §11.6)

§11.6 asks how provenance works for server components. The measurable part:

A React Server Component **never becomes a client fiber**. Its *output* does —
the host elements it produced are reconciled on the client and get expandos
normally — but the component itself evaluated on a server and only its result
crossed the wire. So the owner chain for a node under an RSC subtree contains
every client component that encloses it and **silently omits every server one**.
Nothing is missing-looking; the chain is just shorter than the source suggests.

What React 19 does leave behind, both dev-only:

- `fiber._debugOwner` is polymorphic. For a client owner it is a `Fiber`; for a
  server owner it is a `ReactComponentInfo` — `{ name, env }`, with no `tag`, no
  `type`, and **no props**. Handled: `createdBy` resolves from either shape.
- `fiber._debugInfo` exists on every fiber (confirmed present, `null` in a pure
  client tree) and is where React accumulates server-component records.

The decision this forces: **do not synthesize owner frames from `_debugInfo`.**
An `OwnerFrame` requires a `propsDigest`, and a server component's props were
never observed on the client. Emitting a frame with a digest of `{}` would assert
"these props did not change" about props nobody saw — a manufactured
`unchanged`, which ADR-0002 names as the one failure mode this product cannot
have. A missing frame is honest; a fabricated stable digest is not.

So §11.6's answer, on the evidence: build-time annotation is not a nice-to-have
alternative to traversal, it is the only sound source. Traversal can contribute a
server component's *name* (via `_debugOwner`) and nothing else.

Not yet measured: a real RSC payload rendered through a flight runtime. The
`ReactComponentInfo` shape is handled and unit-tested, but the end-to-end
behaviour of `_debugInfo` under `react-server-dom-*` is unverified. The
stand-in in the suite is unhydrated `renderToStaticMarkup` output, which
confirms the sentinel path but not the `_debugInfo` path.

## Contradiction with ADR-0001, stated plainly

**`core` cannot run in a browser.** `core/src/hash.ts` imports `node:crypto`.

This is not a theoretical objection. `propsDigest` has to run *where the props
are*: a prop can be a function or a React element, and `core`'s own digest
strategy (journal 0001, §11.2) resolves those by reading `fn.name` and
`element.type`. Neither survives serialization out of a page. So the digest is
necessarily computed in the browser — and `core`'s only hash implementation
cannot execute there.

Bundling the browser check surfaced it immediately:

```
ERROR: Could not resolve "node:crypto"   packages/core/dist/hash.js:1:27
```

ADR-0001 says `core` is pure data with no DOM, React, or browser types, and
enforces that with `lib: ["ES2022"]`. That check is one-directional: it stops
`core` reaching *into* a browser but not `core` depending on *Node*. The intent
— an environment-free core — is not actually enforced, and is currently violated.

Not fixed here, because `core` is B1's and a unilateral change to the hash would
change every digest in the repo. The shape of the fix is a `digestString` that
works in both runtimes; `globalThis.crypto.subtle` is not a drop-in, since it is
async and `digestString` is synchronous by design. The browser check therefore
runs with a deliberately fake `node:crypto` stub, labelled as such, which
verifies the traversal but not the hashing.

## Verification

```bash
yarn install --no-immutable && yarn build && yarn test
```

```
 ✓ packages/core/src/canonical.test.ts (16 tests) 3ms
 ✓ packages/provenance-react/src/provenance.test.ts (23 tests) 35ms

 Test Files  2 passed (2)
      Tests  39 passed (39)
```

`tsc --build` clean. Real-browser run:

```bash
node packages/provenance-react/browser-check/build.mjs
python3 -m http.server 5600 --directory packages/provenance-react/browser-check/www
```

```json
{
  "userAgent": "…Chrome/148.0.7778.280 Electron/42.7.0 Safari/537.36",
  "reactVersion": "19.2.8",
  "runtime": { "keyFormat": "reactFiber", "majorHint": ">=17" },
  "passed": 10, "total": 10, "failures": []
}
```

Same assertions as the jsdom suite: chain order, `memo(forwardRef())`
unwrapping, `createdBy` ≠ `owners[0]` for a prop-passed element, digest
stability across a no-op re-render, digest movement on a real prop change,
digest returning across the alternate flip, the no-fiber sentinel, and container
discovery with `__REACT_DEVTOOLS_GLOBAL_HOOK__` confirmed `undefined`.

## Readback (move M2)

**Expected:** owner chains resolve to component display names, identically under
both profiles (checkpoint P3, and the ADR-0002 claim that fiber traversal is
engine-independent).

**Observed:** both. The same module produces identical chains in jsdom and in
Chromium 148 with no hook installed, and the only browser-specific work needed
was stubbing `core`'s `node:crypto` import — which is a `core` problem, not an
engine-independence problem.

**Result:** expected, with one disconfirmation adjacent to it. P3 holds.
ADR-0002's cheap-tier claim for provenance holds. ADR-0001's "environment-free
core" does not, and blocks any browser-side use of `core` until B1 fixes the
hash.

## Not done, deliberately

No `_debugInfo` reading — the RSC path needs build-time annotation, and a frame
without a real props digest is worse than no frame. No source-location recovery
from `_debugStack`. No portal or shadow-DOM handling beyond what falls out of
the `return` walk (a portal's fiber `return` points at its React parent, not its
DOM parent — correct for attribution, and worth a test once the collectors land).
No caching across a whole-document walk; the collector will want one, and the
expando-key memo is the only optimisation present.
