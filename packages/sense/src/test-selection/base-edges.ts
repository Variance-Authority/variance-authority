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
import { idOf, type NodeId, type Relations } from '@variance-authority/core/relate';
import { native } from '../addon.js';
import { declaredTsconfig } from '../typescript.js';
import type { BaseEdges } from './drift.js';
import { listedIn, runtimeTargets } from './effects.js';

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
  const tsconfig = declaredTsconfig(root);

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
    if (verdict === undefined || verdict === null || scanner?.resolveSources === undefined) {
      unknown.add(file);
      continue;
    }
    if (verdict.imported.length === 0 || id === undefined) continue;
    const targets = scanner.resolveSources(root, file, [...verdict.imported], listedIn(relations), tsconfig);
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

