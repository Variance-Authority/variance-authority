import { findCommittedFiber } from './fiber.js';
import { ownerNames } from './identity.js';

/**
 * The component that rendered `node`, as a story's change line names it, or
 * undefined for a node React did not render or has not committed. A node taken
 * off the page has lost its fiber, so its line names no component.
 */
export function pageOwner(node: Node): string | undefined {
  const own = findCommittedFiber(node);
  if (own === null || own === 'uncommitted') return undefined;
  return ownerNames(own.return)[0];
}
