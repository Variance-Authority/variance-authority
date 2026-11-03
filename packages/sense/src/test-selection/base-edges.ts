// compass: variance-authority.reach
/**
 * The merge base's walk, as the checkout's graph with the change's edges
 * undone (spec 0105): what `driftFromWalk` reads a baseline against without
 * indexing the merge base.
 *
 * Each file the change edits is read in both texts, and every specifier each
 * loads, a bare `import './x'` and a re-export included, is resolved at the
 * checkout. The targets are compared as sets: one only the checkout's text
 * lands on is an edge the change added, one only the merge base's lands on an
 * edge it removed, and a target both land on moves nothing however each text
 * spells it. A relative merge-base import that no longer resolves, and an edit
 * that does not parse, leave the importer's merge-base edges unknown; a bare
 * one that resolves to no file is a builtin or a package, which the graph holds
 * no file for either way (`isRelative`).
 */
import { isAbsolute } from 'node:path';
import { EDGE_KINDS, idOf, type Adjacency, type NodeId, type Relations } from '@variance-authority/core/relate';
import { native } from '../addon.js';
import { isRelative } from '../specifier.js';
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
    const sides = [before, after].map((text) => scanner?.moduleReferences?.(file, text)?.sources);
    const [was, now] = sides;
    const specifiers = was === undefined || now === undefined ? undefined : [...new Set([...was, ...now])];
    const resolved = specifiers === undefined ? undefined : resolvedImports(root, relations, file, specifiers);
    if (was === undefined || now === undefined || specifiers === undefined || resolved === undefined) {
      unknown.add(file);
      continue;
    }
    if (id === undefined) continue;
    const landing = new Map(specifiers.map((specifier, at) => [specifier, resolved[at]!]));
    const inGraph = (target: string) => target !== '' && !isAbsolute(target);
    const then = new Set(was.map((specifier) => landing.get(specifier)!));
    const there = new Set(now.map((specifier) => landing.get(specifier)!).filter(inGraph));
    if (was.some((specifier) => landing.get(specifier) === '' && isRelative(specifier))) unknown.add(file);
    const held = new Set(runtimeTargets(relations, id));
    for (const target of there) {
      const to = idOf(relations, 'file', target);
      if (then.has(target) || to === undefined || !held.has(to)) continue;
      const of = added.get(id);
      if (of === undefined) added.set(id, new Set([to]));
      else of.add(to);
    }
    for (const target of [...then].filter(inGraph)) {
      if (there.has(target)) continue;
      const to = idOf(relations, 'file', target);
      if (to === undefined) {
        unknown.add(file);
      } else if (!held.has(to)) {
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
