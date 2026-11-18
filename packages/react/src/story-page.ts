import { findCommittedFiber, isOwnerFrame, MAX_FIBER_DEPTH } from './fiber.js';
import { fiberComponentName } from './names.js';

/**
 * The component that rendered `node`, as a story's change line names it, or
 * undefined for a node React did not render or has not committed. A node taken
 * off the page has lost its fiber, so its line names no component.
 */
export function pageOwner(node: Node): string | undefined {
  const own = findCommittedFiber(node);
  if (own === null || own === 'uncommitted') return undefined;
  let above = own.return;
  for (let depth = 0; depth < MAX_FIBER_DEPTH && above !== null; depth += 1) {
    if (isOwnerFrame(above)) return fiberComponentName(above);
    above = above.return;
  }
  return undefined;
}
