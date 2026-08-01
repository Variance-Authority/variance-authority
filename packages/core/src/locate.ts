import type { NodePath, SemanticNode } from './snapshot.js';

/**
 * Orientation: *where* a change is, in words a person can act on.
 *
 * A path like `0/0/0/2/1/0` is an address, not a location. It tells a reviewer
 * nothing, and it tells an agent nothing either — which is how a report ends up
 * being read as "looks right, merge".
 *
 * Coordinates are no better. Spec §6.3 is explicit that spatial location is
 * expressed through landmarks rather than pixels, and the reason is that
 * coordinates are the least stable thing about a page: a rect moves whenever
 * anything above it reflows, so "at (412, 880)" describes this build and no
 * other. A landmark path describes the *page*, and stays true while the layout
 * moves under it.
 *
 * So a location is built from the things a user would use to describe where they
 * are: the landmark they are in, the named region or dialog, and their position
 * in a list. `main → region "Todos" → list → item 2 of 3` is a sentence someone
 * can follow without opening a screenshot.
 */

/** Roles that orient: a user could say "in the navigation" and be understood. */
const LANDMARKS = new Set([
  'banner', 'navigation', 'main', 'complementary', 'contentinfo',
  'region', 'form', 'search', 'dialog', 'alertdialog',
]);

/** Roles whose children are positional, so an ordinal is worth reporting. */
const ORDINAL_CONTAINERS = new Set(['list', 'table', 'rowgroup', 'row', 'tablist', 'menu', 'grid']);

export interface LocationStep {
  /** `landmark`, `named`, or `ordinal` — why this step is worth mentioning. */
  readonly kind: 'landmark' | 'named' | 'ordinal';
  readonly text: string;
}

export interface Location {
  readonly steps: readonly LocationStep[];
  /** The nearest landmark, for grouping. Spec §6.3's "right panel". */
  readonly region?: string;
  /** One phrase: `main → region "Todos" → item 2 of 3`. */
  readonly where: string;
}

/**
 * Describe where `path` sits, from the landmarks and names above it.
 *
 * Returns an empty location rather than throwing when the path does not resolve.
 * A stale or unresolvable path is a defect somewhere upstream, and losing the
 * whole report over it would hide the finding that actually matters.
 */
export function locate(root: SemanticNode, path: NodePath): Location {
  const chain = walkTo(root, path);
  if (chain.length === 0) return { steps: [], where: '' };

  const steps: LocationStep[] = [];
  let region: string | undefined;

  for (const [index, node] of chain.entries()) {
    const child = chain[index + 1];

    if (node.role !== undefined && LANDMARKS.has(node.role)) {
      const text = node.name !== undefined ? `${node.role} "${node.name}"` : node.role;
      steps.push({ kind: 'landmark', text });
      // Nearest wins: the innermost landmark is the one a person would name.
      region = text;
      continue;
    }

    // A named non-landmark still orients — `tabpanel "Active"`, `group "Filters"`.
    if (node.role !== undefined && node.name !== undefined && index > 0) {
      steps.push({ kind: 'named', text: `${node.role} "${node.name}"` });
      continue;
    }

    if (child !== undefined && node.role !== undefined && ORDINAL_CONTAINERS.has(node.role)) {
      const position = node.children.indexOf(child);
      if (position >= 0) {
        steps.push({
          kind: 'ordinal',
          text: `${node.role} item ${position + 1} of ${node.children.length}`,
        });
      }
    }
  }

  return {
    steps,
    ...(region !== undefined ? { region } : {}),
    // Deepest first would read backwards; a location is spoken outside-in, the
    // way someone points at a screen.
    where: steps.map((step) => step.text).join(' → '),
  };
}

/**
 * Nodes from the root down to `path`, inclusive.
 *
 * Paths are child indices, so this is index navigation rather than a search —
 * except for portal segments, which are keyed rather than positional because a
 * portalled subtree is appended outside the DOM child order (ADR-0007).
 */
function walkTo(root: SemanticNode, path: NodePath): readonly SemanticNode[] {
  const segments = path.split('/');
  if (segments.length === 0) return [];

  const chain: SemanticNode[] = [root];
  let current = root;

  for (const segment of segments.slice(1)) {
    const next = segment.startsWith('portal:')
      ? current.children.find((child) => child.portalled === true)
      : current.children[Number.parseInt(segment, 10)];

    if (next === undefined) return chain;
    chain.push(next);
    current = next;
  }

  return chain;
}
