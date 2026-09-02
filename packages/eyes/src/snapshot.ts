import { resolveProvenance } from '@variance-authority/react';
import type { TargetSnapshot } from './access.js';

function nonEmpty(value: string | null): string | undefined {
  return value === null || value === '' ? undefined : value;
}

/**
 * Copy a DOM node's identity and React attribution in the current synchronous turn.
 *
 * React deletes its Fiber expando on unmount. The returned value therefore holds
 * no DOM or Fiber reference: delaying this call and retaining the node is not an
 * equivalent operation.
 */
export function snapshotNode(node: Node): TargetSnapshot {
  const element = node instanceof Element ? node : undefined;
  const snapshot: {
    nodeName: string;
    id?: string;
    role?: string;
    testId?: string;
    ariaLabel?: string;
    name?: string;
    type?: string;
    provenance: ReturnType<typeof resolveProvenance>;
  } = {
    nodeName: node.nodeName.toLowerCase(),
    provenance: resolveProvenance(node),
  };

  if (element !== undefined) {
    const id = nonEmpty(element.id);
    const role = nonEmpty(element.getAttribute('role'));
    const testId = nonEmpty(element.getAttribute('data-testid'));
    const ariaLabel = nonEmpty(element.getAttribute('aria-label'));
    const name = nonEmpty(element.getAttribute('name'));
    const type = nonEmpty(element.getAttribute('type'));

    if (id !== undefined) snapshot.id = id;
    if (role !== undefined) snapshot.role = role;
    if (testId !== undefined) snapshot.testId = testId;
    if (ariaLabel !== undefined) snapshot.ariaLabel = ariaLabel;
    if (name !== undefined) snapshot.name = name;
    if (type !== undefined) snapshot.type = type;
  }

  return snapshot;
}
