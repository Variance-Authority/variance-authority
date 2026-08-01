import { propsDigest, type OwnerFrame, type Provenance, type SourceLocation } from '@variance-authority/core';
import { FiberTag, findFiber, isOwnerFrame, type Fiber } from './fiber.js';
import { debugOwnerName, fiberComponentName } from './names.js';

/**
 * Turning a DOM node into the `Provenance` value `core` defines.
 *
 * Two chains come out of a fiber and they answer different questions. Spec §6.2
 * needs both, and conflating them makes the docket blame the wrong person:
 *
 * - **`owners`** is the `return` chain filtered to composite components. It says
 *   *where this node ended up* — which boundaries enclose it, and therefore
 *   whose props changing could explain a change here.
 * - **`createdBy`** is `_debugOwner`. It says *who authored the JSX*. When a
 *   component is passed as a prop, these differ: `<Toolbar action={<Button/>}/>`
 *   puts `Button` inside `Toolbar`'s subtree, so `owners[0]` is `Toolbar`, but
 *   the person who wrote that `<Button/>` is the caller. Attribution wants the
 *   author; root/collateral analysis wants the enclosure.
 *
 * `createdBy` is development-only. React records `_debugOwner` from
 * `element._owner`, which production builds do not populate. Its absence is a
 * normal state, never an error — this module degrades to omitting the field.
 */

export type NoFiberReason =
  /**
   * The node exists in the DOM but no React fiber was ever cached on it.
   *
   * Covers three genuinely different situations we cannot tell apart from the
   * node alone, which is exactly why this is a sentinel and not a guess:
   * non-React DOM (a portal target, a third-party widget), server-rendered
   * markup that the client never hydrated, and — spec §11.6 — a React Server
   * Component subtree, which by construction has no client fiber because it was
   * never reconciled on the client.
   */
  | 'no-client-fiber'
  /**
   * A fiber was cached on the node, but walking `return` did not reach a live
   * `HostRoot`. The node belonged to a tree that has been torn down.
   */
  | 'unmounted';

export interface NoFiberResult {
  readonly status: 'no-fiber';
  readonly reason: NoFiberReason;
}

export interface ResolvedProvenance {
  readonly status: 'resolved';
  readonly provenance: Provenance;
}

export type ProvenanceResult = ResolvedProvenance | NoFiberResult;

/**
 * The documented sentinel for "React did not render this".
 *
 * Returned rather than an empty `Provenance`, because an empty owner chain is a
 * *claim* — "this node is owned by nobody" — and would be indistinguishable from
 * a node rendered directly by a root. A collector must be able to record "not
 * attributable" in `diagnostics` instead of silently emitting a chain-less node,
 * or §6.2's root/collateral split would count unattributable nodes as roots.
 */
export const NO_FIBER: NoFiberResult = Object.freeze({
  status: 'no-fiber',
  reason: 'no-client-fiber',
});

export const UNMOUNTED: NoFiberResult = Object.freeze({
  status: 'no-fiber',
  reason: 'unmounted',
});

/** Guards the `return` walk against a corrupted or cyclic chain. */
const MAX_CHAIN_DEPTH = 10_000;

/**
 * Full provenance for a DOM node, or a sentinel explaining why there is none.
 *
 * Never throws. A collector runs this once per node across an entire document;
 * an exception on one malformed fiber would abort a capture, and a capture that
 * fails is strictly worse than a capture with one unattributed node.
 */
export function resolveProvenance(node: Node): ProvenanceResult {
  let fiber: Fiber | null;
  try {
    fiber = findFiber(node);
  } catch {
    return NO_FIBER;
  }

  if (fiber === null) {
    // `findFiber` returns null both when no expando exists and when the cached
    // fiber's tree has no live root. Re-checking the raw expando would let us
    // tell those apart, but React deletes the expando on unmount (verified on
    // 19.2.8), so in practice the second case only arises for a node detached
    // mid-commit. Distinguished below via `hasStaleFiber`.
    return hasStaleFiber(node) ? UNMOUNTED : NO_FIBER;
  }

  try {
    return { status: 'resolved', provenance: provenanceFromFiber(fiber) };
  } catch {
    return NO_FIBER;
  }
}

/**
 * Convenience for the collector path: the value `RawNode.provenance` wants.
 *
 * Discards *why* provenance is missing. Use `resolveProvenance` where the reason
 * belongs in a diagnostic.
 */
export function provenanceOf(node: Node): Provenance | undefined {
  const result = resolveProvenance(node);
  return result.status === 'resolved' ? result.provenance : undefined;
}

function hasStaleFiber(node: Node): boolean {
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      return record[key] != null;
    }
  }
  return false;
}

function provenanceFromFiber(fiber: Fiber): Provenance {
  const owners = ownerChain(fiber);
  const createdBy = debugOwnerName(fiber._debugOwner);
  const source = sourceLocation(fiber);

  // Built by assignment rather than a literal with `undefined` values:
  // `exactOptionalPropertyTypes` distinguishes an absent optional field from one
  // present-and-undefined, and `core`'s canonicalizer encodes absence
  // structurally (ADR-0002 §2). A `createdBy: undefined` would hash differently
  // from an omitted `createdBy`, so a production build would not match a dev one.
  const provenance: {
    owners: readonly OwnerFrame[];
    createdBy?: string;
    source?: SourceLocation;
  } = { owners };

  if (createdBy !== null) provenance.createdBy = createdBy;
  if (source !== null) provenance.source = source;

  return provenance;
}

/**
 * Composite ancestors, innermost first, starting from `fiber` itself.
 *
 * The walk is total: an unrecognised tag falls through the `isOwnerFrame` test
 * and is skipped, so a React release that adds or renumbers work tags shortens
 * a chain instead of crashing the collector (see `fiber.ts`).
 */
function ownerChain(fiber: Fiber): readonly OwnerFrame[] {
  const frames: OwnerFrame[] = [];
  let node: Fiber | null = fiber;

  for (let depth = 0; node !== null && depth < MAX_CHAIN_DEPTH; depth += 1) {
    if (node.tag === FiberTag.HostRoot) break;

    if (isOwnerFrame(node)) {
      const authoredBy = debugOwnerName(node._debugOwner);
      frames.push({
        name: fiberComponentName(node),
        propsDigest: propsDigest(digestableProps(node.memoizedProps)),
        // Development-only, like every `_debugOwner` read. Absent in a
        // production build, which degrades structural attribution to the
        // enclosing component rather than breaking it.
        ...(authoredBy ? { createdBy: authoredBy } : {}),
      });
    }

    node = node.return;
  }

  return frames;
}

/**
 * Props as they enter this boundary, minus `children`.
 *
 * Excluding `children` is not a convenience — it is what makes §6.2's
 * root/collateral distinction work at all. `children` *is* the subtree, and the
 * snapshot already captures the subtree structurally. Digesting it here would
 * mean any change anywhere below a component alters that component's incoming
 * props digest, and every ancestor's too. §6.2 declares a component the **root**
 * of a change when its subtree changed *while its incoming props held*; if a
 * descendant edit moved every ancestor's digest, that condition could never
 * hold, every change would read as "arrived from outside", and the root would
 * always be reported as the application shell.
 *
 * The cost is real and bounded: swapping which element is passed as `children`
 * while everything else holds does not move this digest. That change is still
 * caught — the subtree diff sees it — it is just attributed to the enclosing
 * component rather than to the prop provider.
 */
function digestableProps(props: Readonly<Record<string, unknown>> | null): Record<string, unknown> {
  if (props === null || typeof props !== 'object') return {};

  const shaped: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === 'children') continue;
    shaped[key] = props[key];
  }
  return shaped;
}

/**
 * Source location, when a build was configured to emit it.
 *
 * `_debugSource` is populated from `element._source`, which only exists if the
 * JSX transform ran with source tracking on — the per-project compiler plugin
 * spec §6.1 describes. **React 19 removed the field outright** (verified absent
 * on 19.2.8, replaced by `_debugStack`, an `Error` captured at element creation).
 * Recovering a location from that stack means parsing a stack trace and mapping
 * it through source maps, which is a build-tool's job, not a collector's. So on
 * React 19 this returns null and `source` is simply absent — which the type
 * already declares as the normal case.
 */
function sourceLocation(fiber: Fiber): SourceLocation | null {
  const debugSource = fiber._debugSource;
  if (!debugSource || typeof debugSource !== 'object') return null;

  const { fileName, lineNumber, columnNumber } = debugSource;
  if (typeof fileName !== 'string' || typeof lineNumber !== 'number') return null;

  return {
    file: fileName,
    line: lineNumber,
    column: typeof columnNumber === 'number' ? columnNumber : 0,
  };
}
