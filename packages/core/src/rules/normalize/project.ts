import type { CanonicalValue } from '../../format/canonical.js';
import type { IgnoreSite, SemanticNode } from '../../format/snapshot.js';

/**
 * What a finished tree projects into.
 *
 * Three walks over the same normalized tree, each producing something the
 * snapshot carries: two hash inputs and one list. They sit together because the
 * relationship between them is the interesting part — **what a projection omits
 * is a decision**, and reading them side by side is the only way to check that
 * the decisions still line up.
 *
 * The projections are explicit field lists rather than "the node minus some
 * keys", and that is load-bearing rather than stylistic. A field added to
 * `SemanticNode` must be *chosen* into a hash by someone editing this file; the
 * subtractive form would have swept `ignoredBy` into the structure hash the day
 * it was added, and every subject carrying an ignore would have re-baselined.
 */

/**
 * Structure alone: shape, roles, names, descriptions, states, admitted
 * attributes, text.
 *
 * Hashed separately from style so the docket can say *which* held. "The DOM is
 * identical, only styling moved" is the sentence that turns a diff into a
 * token-band root instead of a structural review.
 */
export function structureOf(node: SemanticNode): CanonicalValue {
  return {
    tag: node.tag,
    alias: node.alias,
    portalled: node.portalled,
    role: node.role,
    name: node.name,
    description: node.description,
    state: node.state as CanonicalValue | undefined,
    attributes: node.attributes,
    text: node.text,
    children: node.children.map(structureOf),
  };
}

export function styleOf(node: SemanticNode, includeLayout: boolean): CanonicalValue {
  const entries: CanonicalValue[] = [];

  const visit = (current: SemanticNode): void => {
    entries.push({
      path: current.path,
      style: current.style,
      tokens: current.tokens,
      // Absent, never zeroed, under a profile without layout (ADR-0002).
      rect: includeLayout && current.rect ? { ...current.rect } : undefined,
    });
    for (const child of current.children) visit(child);
  };

  visit(node);
  return entries;
}

/**
 * Every excluded subtree in the finished tree, outermost first (spec 0024).
 *
 * Read from the *finished* tree rather than recorded during the walk, because
 * wrapper collapse re-paths whole subtrees: a path taken on the way down names a
 * node that may not be there on the way out, and an ignore that quietly slid one
 * level up absorbs a sibling nobody excluded.
 *
 * Nested marks are kept rather than collapsed. Two rules can reach the same
 * subtree, and the register has to be able to say which of them absorbed what;
 * the cost is a duplicate site absorbing the same deltas under two names, which
 * shows up in the register, where it belongs.
 */
export function sitesIn(root: SemanticNode): readonly IgnoreSite[] {
  const sites: IgnoreSite[] = [];

  const visit = (node: SemanticNode): void => {
    for (const rule of node.ignoredBy ?? []) {
      sites.push({
        path: node.path,
        rule,
        ...(node.rect ? { rect: node.rect } : {}),
      });
    }
    for (const child of node.children) visit(child);
  };

  visit(root);
  return sites;
}
