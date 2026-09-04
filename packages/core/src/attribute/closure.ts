import type { CanonicalValue } from '../format/canonical.js';
import { digestCombine, digestString, digestValue, type Digest } from '../format/hash.js';
import type { NodePath, SemanticNode } from '../format/snapshot.js';
import { ID_REFERENCE_ATTRIBUTES, ID_REFERENCE_LIST_ATTRIBUTES } from '../rules/ruleset.js';

/**
 * A digest per node over everything under it, on the document tree.
 *
 * The component hash deliberately is not this. It covers a component's own
 * nodes and names a hole where a child sits, so that an edit stays local and
 * the page root does not move on every commit. The price is a sentence no such
 * digest can say: *this whole subtree, to the leaf, is the one on three other
 * pages*. A closure says exactly that, and it is content-addressed the way a
 * fingerprint is — position removed, so the same bytes at two paths in two
 * subjects are one key — which is what lets *where else is this* become a
 * lookup rather than a comparison.
 *
 * Two closures per node, at two grains of the same tree. `structure` is the
 * tag and the children's structure closures and nothing else: the join key,
 * because two subtrees with different shapes have nothing further to compare.
 * `semantics` is the same walk carrying what the semantics band keeps for each
 * node — role, accessible name, state, the surviving attributes, the text — and
 * it qualifies a match rather than making one.
 *
 * ## What an id contributes
 *
 * An identical widget with a different generated id is the case this tree is
 * for, so an id contributes its presence and never its value. A reference to
 * one is a fact about a *pair* of nodes, and it enters the closure of the
 * lowest node holding both — as the two paths relative to that node, which is
 * position-free with respect to everything outside it. A label and the input
 * it names read the same on every page; a label naming something outside the
 * subtree stays an unbound reference at every closure up to the one that
 * contains its target, and at the root if nothing does.
 *
 * That is the one place a closure cannot be a plain fold of its children's
 * digests: whether a reference is bound is not a property of the node carrying
 * it. So each subtree also carries up what it defines and what it has not yet
 * resolved, and a binding is hashed once, where it closes.
 *
 * ## What enters no closure
 *
 * Style, geometry, tokens, wiring, holding, provenance. A closure is a
 * statement about what was rendered, and it is computed by a run over what it
 * already collected — it enters no baseline and no stored digest.
 */
export interface NodeClosure {
  readonly path: NodePath;
  readonly tag: string;
  /** Tag and the children's structure closures, nothing else. */
  readonly structure: Digest;
  /** The structure walk, carrying what the semantics band keeps per node. */
  readonly semantics: Digest;
  /** Nodes under this one, itself included. */
  readonly nodes: number;
}

/** One closure per node, in document order. */
export function nodeClosures(root: SemanticNode): readonly NodeClosure[] {
  const found: NodeClosure[] = [];
  const flatten = (closed: Closed): void => {
    found.push(closed.closure);
    for (const child of closed.children) flatten(child);
  };
  flatten(close(root));
  return found;
}

/** One subject's document tree, named. */
export interface SubjectTree {
  readonly subject: string;
  readonly root: SemanticNode;
}

export interface ClosureSite {
  readonly subject: string;
  readonly path: NodePath;
}

/**
 * One structure closure that recurs across subjects, at the shallowest node
 * where it does.
 */
export interface SharedClosure {
  readonly structure: Digest;
  readonly tag: string;
  /** Nodes under each site, the site included; every site has the same count. */
  readonly nodes: number;
  /** Sorted by subject, then path. Spans at least two subjects. */
  readonly sites: readonly ClosureSite[];
  /**
   * `held` when every site agrees on the semantics closure too — the same
   * shape with the same content. `parted` is the same shape carrying different
   * content, which is what the two grains exist to keep apart.
   */
  readonly semantics: 'held' | 'parted';
}

export interface SharedClosureOptions {
  /**
   * The smallest subtree worth reporting, in nodes. A shared `<span>` is true
   * and says nothing; the floor is the report's to choose, and absent means
   * every size.
   */
  readonly floor?: number;
}

/**
 * Every structure closure that recurs in more than one subject, reported once
 * and at its widest.
 *
 * The two-subject rule is composition's: three identical rows in one list say
 * nothing, and the same rows in two subjects say that two diffs are one review.
 *
 * A site is dropped when its parent recurs over exactly the same partners — the
 * rule that makes an echo's example the shallowest boundary, applied to every
 * node. A whole page rendered twice is one entry at the root, not one per
 * element. A subtree that recurs in *more* places than its parent does is kept,
 * because the extra places are the finding.
 */
export function sharedClosures(
  subjects: readonly SubjectTree[],
  options: SharedClosureOptions = {},
): readonly SharedClosure[] {
  const index = new Map<Digest, Entry>();

  const file = (subject: string, closed: Closed, parent: Parent | undefined): void => {
    const { closure } = closed;
    let entry = index.get(closure.structure);
    if (entry === undefined) {
      entry = { tag: closure.tag, nodes: closure.nodes, sites: [] };
      index.set(closure.structure, entry);
    }
    entry.sites.push({ subject, path: closure.path, semantics: closure.semantics, parent });
    const here = { structure: closure.structure, site: `${subject}\u0000${closure.path}` };
    for (const child of closed.children) file(subject, child, here);
  };

  for (const { subject, root } of subjects) file(subject, close(root), undefined);

  const shared: SharedClosure[] = [];
  for (const [structure, entry] of index) {
    if (entry.nodes < (options.floor ?? 0)) continue;
    if (new Set(entry.sites.map((site) => site.subject)).size < 2) continue;
    if (subsumed(entry, index)) continue;

    const sites = entry.sites
      .map(({ subject, path }) => ({ subject, path }))
      .sort((left, right) => codeUnitOrder(left.subject, right.subject) || codeUnitOrder(left.path, right.path));
    const held = new Set(entry.sites.map((site) => site.semantics)).size === 1;

    shared.push({ structure, tag: entry.tag, nodes: entry.nodes, sites, semantics: held ? 'held' : 'parted' });
  }

  return shared.sort((left, right) => codeUnitOrder(left.structure, right.structure));
}

interface Parent {
  readonly structure: Digest;
  /** Subject and path, so that two rows under one parent count that parent once. */
  readonly site: string;
}

interface Entry {
  readonly tag: string;
  readonly nodes: number;
  readonly sites: {
    readonly subject: string;
    readonly path: NodePath;
    readonly semantics: Digest;
    readonly parent: Parent | undefined;
  }[];
}

/**
 * Whether every site sits under one recurring parent, and that parent recurs
 * nowhere else. Two identical rows under one `<tbody>` are one parent site, so
 * the parents are counted distinct: the rows are subsumed by the body, and the
 * body by the table above it, up to the node that recurs on its own.
 */
function subsumed(entry: Entry, index: ReadonlyMap<Digest, Entry>): boolean {
  const first = entry.sites[0]?.parent;
  if (first === undefined) return false;
  const parents = new Set<string>();
  for (const site of entry.sites) {
    if (site.parent === undefined || site.parent.structure !== first.structure) return false;
    parents.add(site.parent.site);
  }
  return index.get(first.structure)?.sites.length === parents.size;
}

interface Closed {
  readonly closure: NodeClosure;
  readonly children: readonly Closed[];
  /** Alias → path relative to this node, for every id defined in this subtree. */
  readonly defined: ReadonlyMap<string, string>;
  /** References made in this subtree whose target is not in it. */
  readonly unbound: readonly Reference[];
}

interface Reference {
  readonly attribute: string;
  readonly alias: string;
  /** Path of the referring node, relative to the subtree carrying this. */
  readonly from: string;
}

/** A reference and its target, as two paths relative to the node they close under. */
type Binding = {
  readonly attribute: string;
  readonly from: string;
  readonly to: string;
};

function close(node: SemanticNode): Closed {
  const children = node.children.map((child) => close(child));

  const defined = new Map<string, string>();
  if (node.alias !== undefined) defined.set(node.alias, '');
  children.forEach((child, index) => {
    for (const [alias, path] of child.defined) defined.set(alias, under(index, path));
  });

  const bindings: Binding[] = [];
  const unbound: Reference[] = [];
  const settle = (reference: Reference): void => {
    const to = defined.get(reference.alias);
    if (to === undefined) unbound.push(reference);
    else bindings.push({ attribute: reference.attribute, from: reference.from, to });
  };
  for (const reference of referencesOf(node)) settle(reference);
  children.forEach((child, index) => {
    for (const reference of child.unbound) settle({ ...reference, from: under(index, reference.from) });
  });
  bindings.sort(
    (left, right) =>
      codeUnitOrder(left.from, right.from) ||
      codeUnitOrder(left.attribute, right.attribute) ||
      codeUnitOrder(left.to, right.to),
  );

  let nodes = 1;
  for (const child of children) nodes += child.closure.nodes;

  const structure = digestCombine('closure:structure', [
    digestString(node.tag),
    ...children.map((child) => child.closure.structure),
  ]);
  const semantics = digestCombine('closure:semantics', [
    digestValue({ own: ownSemantics(node), bindings }),
    ...children.map((child) => child.closure.semantics),
  ]);

  return {
    closure: { path: node.path, tag: node.tag, structure, semantics, nodes },
    children,
    defined,
    unbound,
  };
}

/** A relative path one level down: the child's index, then the path beneath it. */
function under(index: number, path: string): string {
  return path === '' ? String(index) : `${index}/${path}`;
}

const REFERENCE = new Set(ID_REFERENCE_ATTRIBUTES);
const REFERENCE_LIST = new Set(ID_REFERENCE_LIST_ATTRIBUTES);
/** What normalization turned an id into; an `extern:` alias lies outside every subtree. */
const ALIAS = /^#(?:a\d+|extern:.*)$/;

/**
 * What the semantics band keeps for one node, with every id reduced to
 * presence. `null` rather than omitted where a node has nothing, for the reason
 * every band gives: an omitted entry lets two different nodes agree by
 * coincidence.
 */
function ownSemantics(node: SemanticNode): CanonicalValue {
  const attributes: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attributes)) {
    attributes[name] = isReference(name) ? withoutAliases(value) : value;
  }
  return {
    tag: node.tag,
    id: node.alias !== undefined,
    role: node.role ?? null,
    name: node.name ?? null,
    state: (node.state ?? null) as CanonicalValue,
    attributes,
    text: node.text ?? null,
  };
}

/** Every alias this node refers to, each as a reference from the node itself. */
function referencesOf(node: SemanticNode): readonly Reference[] {
  const found: Reference[] = [];
  for (const [attribute, value] of Object.entries(node.attributes)) {
    if (!isReference(attribute)) continue;
    for (const alias of aliasesIn(attribute, value)) found.push({ attribute, alias, from: '' });
  }
  return found;
}

function isReference(name: string): boolean {
  return REFERENCE.has(name) || name === 'href' || name === 'xlink:href';
}

function aliasesIn(name: string, value: string): readonly string[] {
  const parts = REFERENCE_LIST.has(name) ? value.split(/\s+/) : [value];
  return parts.filter((part) => ALIAS.test(part));
}

/** The attribute with each alias replaced by a marker, so the binding carries the pair and the value does not. */
function withoutAliases(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => (ALIAS.test(part) ? '#' : part))
    .join(' ');
}

/** The order every other list in this package is sorted by. */
function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
