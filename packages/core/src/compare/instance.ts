import { digestCombine, digestValue } from '../format/hash.js';
import type {
  IgnoreSite,
  NodePath,
  SemanticNode,
  SemanticSnapshot,
  StyleProvenanceEntry,
} from '../format/snapshot.js';
import { structureOf, styleOf } from '../rules/normalize/project.js';

/**
 * One component instance, read as though it were the whole subject.
 *
 * `partingOf` compares two readings of one tree. A divergence is not that: it is
 * one component reached at two *sites*, in two different subjects, and handing
 * the two subjects straight to a parting produces a confident wrong answer.
 * Measured on the divergence example, `Price` — the component the finding is
 * about, present on both sides — came back `unpaired`, while `Receipt` and
 * `PromoCard`, which are genuinely different components, paired positionally at
 * the root and were reported nondeterministic for holding no state.
 *
 * The cause is that a boundary's identity is its owner chain, and the chain
 * carries the container: the same `<Price>` is `Price>Receipt` at one site and
 * `Price>PromoCard` at the other, so neither `pairBoundaries` nor `sameTree`
 * can see them as one component. That is correct for the question those
 * functions were built for — two arms of an experiment share a root, and a
 * container that differs there really is a difference — and wrong for this one.
 *
 * So the instance is lifted out before it is compared. Everything outside it
 * goes, including the part of every owner chain that named it: what is left is
 * the subtree that component rendered, addressed from its own root, which is
 * the thing two sites actually have in common.
 *
 * Returns `undefined` when the path names no node, rather than an empty
 * snapshot, so a caller cannot mistake "that site is not in this tree" for
 * "that site rendered nothing".
 */
export function boundarySnapshot(
  snapshot: SemanticSnapshot,
  path: NodePath,
): SemanticSnapshot | undefined {
  const node = nodeAt(snapshot.root, path);
  if (node === undefined) return undefined;

  /**
   * How many owners to drop, decided once at the boundary and applied to every
   * node under it.
   *
   * Owners run innermost-first, so the containers outside this instance are the
   * *tail* of the list — and they are the same tail at every depth, because
   * every node in the subtree is inside the same containers. `Price>PromoCard`
   * loses one and becomes `Price`; a `Label` nested inside it reads
   * `Label>Price>PromoCard` and loses exactly the same one.
   */
  const outer = Math.max(0, (node.provenance?.owners.length ?? 1) - 1);

  const root = lift(node, path, outer);
  const structureHash = digestValue(structureOf(root));
  const styleHash = digestValue(styleOf(root, snapshot.profile.layout));
  const ignoreSites = rebasedSites(snapshot.ignoreSites, path);

  return {
    formatVersion: snapshot.formatVersion,
    subject: snapshot.subject,
    profile: snapshot.profile,
    environment: snapshot.environment,

    /**
     * Recomputed, and it is not bookkeeping.
     *
     * `compareTrees` returns `identical` the moment two `renderHash`es match, so
     * a lifted snapshot carrying the digest of the subject it came out of would
     * make every comparison between two instances answer a question about their
     * containers. Two identical renderings of one component in two different
     * pages would compare as different, which is precisely the echo this half of
     * the report exists to recognise.
     */
    renderHash: digestCombine('render', [
      snapshot.environment.semanticDigest,
      structureHash,
      styleHash,
    ]),
    structureHash,
    styleHash,
    root,
    styleProvenance: rebasedProvenance(snapshot.styleProvenance, path),
    ...(ignoreSites.length > 0 ? { ignoreSites } : {}),
    diagnostics: snapshot.diagnostics,
  };
}

/**
 * The subtree, re-addressed and with the containers stripped from its chains.
 *
 * Paths are rewritten rather than kept, because a delta carries a path and a
 * reader of one instance has no way to resolve `0/3/1/0` against a tree whose
 * root is `0/3/1`. The rewrite is a prefix swap, so sibling order and depth
 * survive it exactly.
 */
function lift(node: SemanticNode, prefix: NodePath, outer: number): SemanticNode {
  const owners = node.provenance?.owners;

  return {
    ...node,
    path: rebase(node.path, prefix),
    ...(node.provenance !== undefined && owners !== undefined
      ? {
          provenance: {
            ...node.provenance,
            owners: owners.slice(0, Math.max(1, owners.length - outer)),
          },
        }
      : {}),
    children: node.children.map((child) => lift(child, prefix, outer)),
  };
}

/**
 * A path in the lifted tree's own space.
 *
 * The boundary itself becomes `ROOT`; everything under it keeps its tail. A path
 * that is not under the prefix never reaches here — both callers filter first —
 * and returning it unchanged would be a silent mis-address.
 */
function rebase(path: NodePath, prefix: NodePath): NodePath {
  return path === prefix ? ROOT : `${ROOT}${path.slice(prefix.length)}`;
}

function under(path: NodePath, prefix: NodePath): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function rebasedProvenance(
  entries: readonly StyleProvenanceEntry[],
  prefix: NodePath,
): readonly StyleProvenanceEntry[] {
  return entries
    .filter((entry) => under(entry.path, prefix))
    .map((entry) => ({ ...entry, path: rebase(entry.path, prefix) }));
}

/**
 * Ignores kept rather than dropped.
 *
 * An ignore that fell inside this instance still applies to it: dropping it here
 * would let a masked clock back into a comparison by the side door, which is the
 * one direction this system is not allowed to be wrong in.
 */
function rebasedSites(
  sites: readonly IgnoreSite[] | undefined,
  prefix: NodePath,
): readonly IgnoreSite[] {
  return (sites ?? [])
    .filter((site) => under(site.path, prefix))
    .map((site) => ({ ...site, path: rebase(site.path, prefix) }));
}

function nodeAt(root: SemanticNode, path: NodePath): SemanticNode | undefined {
  if (root.path === path) return root;
  if (!under(path, root.path)) return undefined;
  for (const child of root.children) {
    const found = nodeAt(child, path);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The path a normalized tree's root carries, and therefore a lifted one's. */
const ROOT = '0';
