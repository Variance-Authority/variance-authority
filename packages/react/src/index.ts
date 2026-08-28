/**
 * `@variance-authority/react` — owner chains from a live DOM node.
 *
 * Given an element, produce the `Provenance` value `@variance-authority/core`
 * defines: the composite components enclosing it, a props digest at each
 * boundary, and the component that authored it.
 *
 * Two constraints shape the whole package:
 *
 * 1. **Engine independence.** Traversal reads plain JavaScript objects React
 *    attached to DOM nodes. Nothing here touches layout, `getComputedStyle`, or
 *    any Chromium-only API, which is why the same chains come out of jsdom and a
 *    real browser — and why the cheap tier of ADR-0002 can carry the full
 *    provenance dimension at ~ms rather than ~100ms.
 * 2. **No DevTools hook required.** The primary path is the `__reactFiber$…`
 *    expando `react-dom` writes onto every host node it creates. The hook is
 *    used only for the exact React version, and only if it happens to exist.
 *
 * The package depends on `core` for types and `propsDigest`, and on React for
 * nothing at all — there is no `import 'react'` anywhere in `src`, so it cannot
 * pin or conflict with the application's React copy.
 */

export type {
  ProvenanceResult,
  ResolvedProvenance,
  NoFiberResult,
  NoFiberReason,
} from './resolve.js';
export { resolveProvenance, provenanceOf, NO_FIBER, UNMOUNTED } from './resolve.js';

export type { Fiber, ContextDependency, DebugComponentInfo, DebugSource } from './fiber.js';
export {
  FiberTag,
  findFiber,
  hasFiber,
  currentFiber,
  isOwnerFrame,
  findReactContainers,
} from './fiber.js';

export { componentName, fiberComponentName, debugOwnerName, ANONYMOUS } from './names.js';

export { portalContentOf } from './portal.js';

export type { SuspenseBoundary, SuspenseStateName } from './suspense.js';
export { suspenseBoundaries, suspenseBoundariesIn, pendingSuspense } from './suspense.js';

export type {
  SuspenseOutcome,
  SuspenseSettlement,
  SuspenseWaitOptions,
  LoadingDeclaration,
} from './arrival.js';
export { awaitSuspense, suspenseRefusal } from './arrival.js';

export type { Commit, CommitTap, TapOptions, TapRefusal, QuietOptions, QuietResult } from './commits.js';
export { tapCommits, awaitQuiet } from './commits.js';

export { wiringOf, componentFiberOf } from './wiring.js';

export { holdingOf } from './holding.js';

export type { Remount, RenderMark } from './identity.js';
export { markRender, remountedSince } from './identity.js';

export type { ReactRuntimeInfo, ReactKeyFormat } from './runtime.js';
export { detectReactVersion, detectReactRuntime } from './runtime.js';
