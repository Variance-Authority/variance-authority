// compass: variance-authority.reach
/**
 * The merge base's walk, as the checkout's graph with the change's edges
 * undone (spec 0105): what `driftFromWalk` reads a baseline against without
 * indexing the merge base.
 *
 * Each file the change edits is read in both texts, and an import that binds
 * names on one side only is resolved at the checkout. The checkout's graph
 * holding the edge says the change added it; not holding it says the change
 * removed it. Two such imports landing on one file are a respelling, and move
 * nothing. An import whose target no longer resolves, and an edit that does
 * not parse, leave the importer's merge-base edges unknown.
 *
 * An import that binds nothing — `import './x'` — is not one the reading
 * names, so a change to one is not undone.
 */
import { isAbsolute } from 'node:path';
import { EDGE_KINDS, idOf, type Adjacency, type NodeId, type Relations } from '@variance-authority/core/relate';
import { native } from '../addon.js';
import { resolvedImports, runtimeTargets } from './effects.js';

/** The merge base's walk, as the checkout's with the change's edges undone. */
export interface BaseEdges {
  /** Runtime edges the change added, by importer: the merge base's walk does not take them. */
  readonly added: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  /** Runtime edges the change removed, by importer: only the merge base's walk takes them. */
  readonly removed: ReadonlyMap<NodeId, readonly NodeId[]>;
  /** Files the change created, which the merge base's walk never enters. */
  readonly created: ReadonlySet<NodeId>;
  /**
   * Files whose merge-base edges are not known — an edit that does not parse,
   * an import that no longer resolves — and files the change deleted. A test
   * file whose walk enters one, or that loaded one, is unread.
   */
  readonly unknown: ReadonlySet<string>;
}

/** One file the change touched, with its text at the merge base and at the checkout; a side it was absent from has none. */
export interface ChangedText {
  readonly file: string;
  readonly before?: string;
  readonly after?: string;
}

/** The edges `changes` moved in `relations`, the checkout's graph, under `root`. */
export function baseEdgesOf(root: string, relations: Relations, changes: readonly ChangedText[]): BaseEdges {
  const scanner = native();
  const added = new Map<NodeId, Set<NodeId>>();
  const removed = new Map<NodeId, NodeId[]>();
  const created = new Set<NodeId>();
  const unknown = new Set<string>();

  for (const { file, before, after } of changes) {
    const id = idOf(relations, 'file', file);
    if (before === undefined) {
      if (id !== undefined) created.add(id);
      continue;
    }
    if (after === undefined) {
      unknown.add(file);
      continue;
    }
    const verdict = scanner?.moduleVerdict?.(file, before, after);
    const targets = verdict === undefined || verdict === null ? undefined : resolvedImports(root, relations, file, verdict.imported);
    if (targets === undefined) {
      unknown.add(file);
      continue;
    }
    if (id === undefined) continue;
    if (targets.some((target) => target === '')) unknown.add(file);
    const landed = targets.filter((target) => target !== '' && !isAbsolute(target));
    const once = landed.filter((target) => landed.indexOf(target) === landed.lastIndexOf(target));
    const held = new Set(runtimeTargets(relations, id));
    for (const target of once) {
      const to = idOf(relations, 'file', target);
      if (to === undefined) {
        unknown.add(file);
      } else if (held.has(to)) {
        const of = added.get(id);
        if (of === undefined) added.set(id, new Set([to]));
        else of.add(to);
      } else {
        const of = removed.get(id);
        if (of === undefined) removed.set(id, [to]);
        else of.push(to);
      }
    }
  }
  return { added, removed, created, unknown };
}


const IMPORTS = EDGE_KINDS.indexOf('imports');

/**
 * `relations.depends` as the merge base held it: the edges the change added
 * left out, the ones it removed put back as imports, and no edge into a file
 * it created. Built once, so the walk over it is the checkout's walk.
 */
export function undone(relations: Relations, { added, removed, created }: BaseEdges): Adjacency {
  const { offset, target, kind } = relations.depends;
  const nodes = relations.names.length;
  const next = new Uint32Array(nodes + 1);
  const targets: number[] = [];
  const kinds: number[] = [];
  for (let id = 0; id < nodes; id += 1) {
    const dropped = added.get(id);
    for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) {
      if (dropped?.has(target[edge]!) === true || created.has(target[edge]!)) continue;
      targets.push(target[edge]!);
      kinds.push(kind[edge]!);
    }
    for (const to of removed.get(id) ?? []) {
      if (created.has(to)) continue;
      targets.push(to);
      kinds.push(IMPORTS);
    }
    next[id + 1] = targets.length;
  }
  return { offset: next, target: Uint32Array.from(targets), kind: Uint8Array.from(kinds) };
}
