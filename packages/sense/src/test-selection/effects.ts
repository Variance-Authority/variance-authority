import { EDGE_KINDS, RUNTIME_EDGES, idOf, nodeAt, type NodeId, type Relations } from '@variance-authority/core/relate';
import { native } from '../addon.js';

/**
 * Of a changed file and what the imports it started or stopped binding load,
 * the files whose package declares that loading them does something.
 *
 * An added import loads its target and everything the target loads, so a
 * declared module behind an undeclared one is as much a load of the importer
 * as a declared module imported directly — the rule a bundler keeps it by. A
 * declared module the importer's other imports already load ran before the
 * change and runs after it, and charges nothing. The graph owns what each
 * file loads, and is walked for it; a target outside the graph, a package in
 * `node_modules`, answers for itself alone.
 *
 * Nothing is asked without a `root`, which leaves the assumption that loading
 * a module only declares what it exports.
 */
export function declaredEffects(
  root: string | undefined,
  relations: Relations | undefined,
  file: string,
  imported: readonly string[],
): readonly string[] {
  const scanner = native();
  if (root === undefined || scanner?.declaredEffects === undefined || scanner.resolveSources === undefined) return [];
  const targets = imported.length === 0 ? [] : scanner.resolveSources(root, file, [...imported]).filter(Boolean);
  const loaded = new Set(targets.flatMap((target) => loadedFrom(relations, [target])));
  for (const already of loadedFrom(relations, unchangedImports(relations, file, targets))) loaded.delete(already);
  loaded.delete(file);
  return scanner.declaredEffects(root, [file, ...[...loaded].sort()]);
}

/** What `file` imports at runtime, as the graph holds it, less the targets the change moved. */
function unchangedImports(relations: Relations | undefined, file: string, moved: readonly string[]): readonly string[] {
  const id = relations === undefined ? undefined : idOf(relations, 'file', file);
  if (relations === undefined || id === undefined) return [];
  const skip = new Set(moved);
  return runtimeTargets(relations, id).flatMap((target) => {
    const node = nodeAt(relations, target);
    return node?.kind === 'file' && !skip.has(node.name) ? [node.name] : [];
  });
}

/** These files and every file they load at runtime, at any depth, as the graph holds them. */
function loadedFrom(relations: Relations | undefined, files: readonly string[]): readonly string[] {
  const loaded: string[] = [];
  const seen = new Set<NodeId>();
  for (const file of files) {
    const id = relations === undefined ? undefined : idOf(relations, 'file', file);
    if (relations === undefined || id === undefined) loaded.push(file);
    else seen.add(id);
  }
  for (const id of seen) {
    const node = nodeAt(relations!, id);
    if (node?.kind === 'file') loaded.push(node.name);
    for (const target of runtimeTargets(relations!, id)) seen.add(target);
  }
  return loaded;
}

function runtimeTargets(relations: Relations, id: NodeId): readonly NodeId[] {
  const { offset, target, kind } = relations.depends;
  const targets: NodeId[] = [];
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) {
    if (LOADS[kind[edge]!] === 1 && target[edge] !== id) targets.push(target[edge]!);
  }
  return targets;
}

const LOADS = new Uint8Array(EDGE_KINDS.length);
for (const kind of RUNTIME_EDGES) LOADS[EDGE_KINDS.indexOf(kind)] = 1;
