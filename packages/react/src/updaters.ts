import type { Digest, SourceLocation } from '@variance-authority/core/format';
import { currentFiber, isOwnerFrame, type Fiber } from './fiber.js';
import { fiberComponentName } from './names.js';
import { boundaryPropsDigest } from './props.js';
import { componentFiberPath, fiberSourceLocation } from './traversal.js';

/** The FiberRoot fields React uses to expose the initiators of one commit. */
export interface FiberRootUpdate {
  readonly current?: Fiber;
  readonly memoizedUpdaters?: ReadonlySet<Fiber>;
}

/** One composite boundary in an updater's structural location, innermost first. */
export interface CommitUpdaterFrame {
  readonly name: string;
  readonly key: string | null;
  readonly propsDigest: Digest;
}

/** One state-update initiator and where that live instance sat in the component tree. */
export interface CommitUpdater {
  readonly path: readonly CommitUpdaterFrame[];
  readonly source?: SourceLocation;
}

export interface MemoizedUpdatersResult {
  readonly updaters: readonly CommitUpdater[];
  readonly truncated: boolean;
}

/**
 * Read React's `memoizedUpdaters` as portable component paths.
 *
 * `undefined` means the renderer did not expose the set. A present result with
 * no updaters is a completed empty observation, as on an initial mount.
 */
export function memoizedUpdatersOf(
  root: FiberRootUpdate | undefined,
  limit = 64,
): MemoizedUpdatersResult | undefined {
  if (root === undefined || !Object.prototype.hasOwnProperty.call(root, 'memoizedUpdaters')) {
    return undefined;
  }
  const set = root.memoizedUpdaters;
  if (set === undefined || typeof set[Symbol.iterator] !== 'function') return undefined;

  const updaters: CommitUpdater[] = [];
  const seen = new Set<Fiber>();
  let truncated = false;
  for (const candidate of set) {
    const fiber = currentFiber(candidate) ?? candidate;
    if (seen.has(fiber) || (fiber.alternate !== null && seen.has(fiber.alternate))) continue;
    seen.add(fiber);
    if (fiber.alternate !== null) seen.add(fiber.alternate);
    if (!isOwnerFrame(fiber)) continue;
    if (updaters.length >= Math.max(1, Math.floor(limit))) {
      truncated = true;
      break;
    }
    updaters.push(commitUpdater(fiber));
  }
  return { updaters, truncated };
}

function commitUpdater(fiber: Fiber): CommitUpdater {
  const path = componentFiberPath(fiber).fibers.map((frame): CommitUpdaterFrame => ({
    name: fiberComponentName(frame),
    key: frame.key,
    propsDigest: boundaryPropsDigest(frame.memoizedProps),
  }));
  const source = fiberSourceLocation(fiber);
  return { path, ...(source === undefined ? {} : { source }) };
}
