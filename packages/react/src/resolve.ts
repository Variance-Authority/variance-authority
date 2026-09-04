import {
  isVendorPath,
  jsxSourceOf,
  parseStackFrames,
  type OwnerFrame,
  type Provenance,
  type SourceLocation,
  type StackFrame,
} from '@variance-authority/core';
import { FiberTag, findFiber, isOwnerFrame, type Fiber } from './fiber.js';
import { debugOwnerName, fiberComponentName } from './names.js';
import { boundaryPropsDigest } from './props.js';

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
    stack?: readonly StackFrame[];
  } = { owners };

  if (createdBy !== null) provenance.createdBy = createdBy;

  if (source !== null) {
    provenance.source = source;
  } else {
    // Only when nothing was recorded. A runtime that wrote the location knows it
    // exactly and without a map; this is the fallback for a project that
    // installed nothing, and running it alongside would cost every node a stack
    // read to arrive at an answer already in hand.
    const stack = callSiteFrames(fiber);
    if (stack.length > 0) provenance.stack = stack;
  }

  return provenance;
}

/**
 * Candidate call sites for this node, read off React's own captured error.
 *
 * Not an answer — a shortlist. Deciding which frame is the author needs source
 * maps, and maps need to be fetched, which is Node's job and not a page agent's
 * (ADR-0013). What this can do without leaving the page is throw away the frames
 * that are certainly not the author: React's runtime, the renderer, and any
 * custom JSX runtime above them, all of which are recognisable from their URL
 * alone. That check is a filter and not the decision — the collector applies it
 * again to the *mapped* path, which is what actually rules a frame out.
 *
 * The cap is what keeps this honest about cost. A stack is deep — React's
 * renderer contributes dozens of frames — and this runs once per node on a
 * document with thousands. Measured on a 4211-node page: every fiber carries a
 * stack, reading all of them costs 17.6 ms, and they hold 14 distinct call sites
 * between them. So the shortlist is short by construction, and the collector's
 * cache absorbs the rest.
 */
function callSiteFrames(fiber: Fiber): readonly StackFrame[] {
  const captured = fiber._debugStack;
  if (captured === null || typeof captured !== 'object') return [];

  const stack = (captured as { stack?: unknown }).stack;
  if (typeof stack !== 'string' || stack === '') return [];

  const candidates: StackFrame[] = [];
  for (const frame of parseStackFrames(stack)) {
    if (isVendorPath(frame.url)) continue;

    candidates.push(frame);
    if (candidates.length >= MAX_CALL_SITE_FRAMES) break;
  }

  return candidates;
}

/**
 * How many project frames are worth carrying.
 *
 * One is the answer on every stack measured — the component that wrote the
 * element — and the rest are its callers, which are already `owners`. More than
 * one is kept only for the case the URL test cannot settle: a bundle served from
 * the project's own path with a dependency compiled into it, where the first
 * frame looks like the project and maps into `node_modules`.
 */
const MAX_CALL_SITE_FRAMES = 4;

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
        propsDigest: boundaryPropsDigest(node.memoizedProps),
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
 * Source location, when a build was configured to emit it.
 *
 * Two places to look, because two different runtimes put it in two places.
 *
 * **The props symbol** is where `@variance-authority/jsx-source` writes it. That
 * runtime is a `jsxImportSource` setting away in any build, and it is the path
 * that works on React 19: React's own `jsxDEV` takes four parameters and drops
 * the transform's fifth argument, so a location that is not intercepted before
 * React sees it is gone. Being on `memoizedProps` is what makes it readable here
 * at all — a fiber keeps its props, and a symbol key survives `Object.freeze`,
 * minification, and every `for…in` React DOM runs over the same object.
 *
 * **`_debugSource`** is where React ≤18 put it, populated from `element._source`
 * by the same transform argument. Read second and kept because a project on 18
 * needs no build change to get a location, and because a wrong answer here is
 * worse than no answer: this is the field a report points at when it says which
 * line to open.
 *
 * Absent remains a normal state, not an error — a production build with the
 * development transform off computes no location for anybody to record.
 *
 * **Composite ancestors are consulted when the fiber itself has none.** A custom
 * JSX runtime layered above the recording one may rebuild the props object before
 * React ever sees it — Emotion does exactly this for an element carrying a `css`
 * prop, copying with `for…in`, which does not copy symbols. The location is not
 * lost when that happens, because such a runtime forwards the transform's source
 * argument unchanged and the element it renders instead is recorded with it; it
 * has simply moved up one fiber.
 *
 * The climb stops at the first host element, so it never reaches past the
 * component that rendered this node. For a node whose own location was recorded
 * — every node in a build that compiled with the development transform — the
 * climb does not happen at all.
 */
function sourceLocation(fiber: Fiber): SourceLocation | null {
  const recorded = recordedLocation(fiber);
  if (recorded !== null) return recorded;

  for (
    let ancestor = fiber.return;
    ancestor !== null && isOwnerFrame(ancestor);
    ancestor = ancestor.return
  ) {
    const enclosing = recordedLocation(ancestor);
    if (enclosing !== null) return enclosing;
  }

  return null;
}

function recordedLocation(fiber: Fiber): SourceLocation | null {
  const recorded = jsxSourceOf(fiber.memoizedProps);
  if (recorded !== undefined) return recorded;

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
