/**
 * Which chains a transitive relation rule forbids: a rule that decides what a
 * file may reach at any distance, not only what it imports.
 *
 * A transitive rule is judged like an import rule (`restrictions.ts`), by its
 * own ordered list: the rule files in or above either end, the deepest first,
 * the first transitive rule that matches deciding. Its two ends are the file a
 * chain starts from, a seed, and a file the chain arrives at. A file judged
 * `restricted` is a finding and the walk does not continue through it; any
 * other verdict lets the walk go on.
 *
 * The verdict depends on the seed only through which rule files sit above it
 * and which transitive rules' `from` holds it, so seeds that agree on both are
 * walked together in one breadth-first search. The finding is the import that
 * arrives in a restricted file, because that is the line a person changes; it
 * carries the shortest chain to it and how many seeds reach it, which is a
 * second walk per finding, never one per seed.
 *
 * Every edge kind is walked, types included: a declaration that names a module
 * makes a consumer's type check rest on it whether or not anything loads it.
 * It performs no I/O.
 */

// compass: variance-authority.reach.relations

import {
  EDGE_KINDS,
  dependenciesOf,
  dependentsOf,
  idOf,
  nodesOfKind,
  relationsOfFiles,
  trailOf,
  type FileRecord,
  type NodeId,
  type Relations,
} from '@variance-authority/core/relate';
import { chainBetween, holds, inside, type Decision, type RuleFile } from './restrictions.js';

/** One import that carries a chain from a seed into a file a transitive rule restricts. */
export interface ChainViolation {
  /** The file the chain went through, which imports `to`. */
  readonly from: string;
  /** The restricted file. */
  readonly to: string;
  readonly message?: string;
  /** The directory of the rule file that states the rule. */
  readonly directory: string;
  /** The shortest chain from a seed to `from`, seed first. */
  readonly chain: readonly string[];
  /** How many seeds reach `from` without passing a restricted file. */
  readonly seeds: number;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The part of a seed its verdicts depend on: the rule files above it and the transitive rules whose `from` holds it. */
function keyOf(files: readonly RuleFile[], seed: string): string | undefined {
  const above: string[] = [];
  const holding: string[] = [];
  files.forEach((file, at) => {
    if (inside(file.directory, seed)) above.push(String(at));
    file.rules.forEach((rule, index) => {
      if (rule.transitive === true && holds(file.directory, rule.from, seed)) holding.push(`${at}.${index}`);
    });
  });
  return holding.length === 0 ? undefined : `${above.join(',')}|${holding.join(',')}`;
}

/**
 * How many of `group` reach `at` without crossing a restricted file. A
 * restricted seed counts when it imports into that reach, since its own chain
 * starts there, and is never walked through: a seed behind it first broke the
 * rule on arriving in it. For the same reason a restricted `at` counts only
 * itself.
 */
function seedsBehind(relations: Relations, group: readonly NodeId[], restricted: ReadonlyMap<NodeId, Decision>, at: NodeId): number {
  if (restricted.has(at)) return group.includes(at) ? 1 : 0;
  const back = dependentsOf(relations, [at], { through: EDGE_KINDS, avoid: restricted.keys() });
  const { offset, target } = relations.depends;
  const intoReach = (seed: NodeId): boolean => {
    for (let edge = offset[seed]!; edge < offset[seed + 1]!; edge += 1) if (back.mask[target[edge]!] === 1) return true;
    return false;
  };
  return group.filter((seed) => back.mask[seed] === 1 || (restricted.has(seed) && intoReach(seed))).length;
}

/**
 * Every import a transitive `restricted` rule forbids, walked from `seeds` —
 * the files whose chains the rules are about, which are the files packages
 * ship. In code-unit order of importer and then target.
 */
export function restrictedChains(records: readonly FileRecord[], files: readonly RuleFile[], seeds: readonly string[]): ChainViolation[] {
  if (!files.some((file) => file.rules.some((rule) => rule.transitive === true))) return [];
  const relations = relationsOfFiles(records);
  const everyFile = nodesOfKind(relations, 'file');

  const groups = new Map<string, NodeId[]>();
  for (const seed of seeds) {
    const id = idOf(relations, 'file', seed);
    const key = id === undefined ? undefined : keyOf(files, seed);
    if (id === undefined || key === undefined) continue;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }

  const found = new Map<string, ChainViolation>();
  for (const group of groups.values()) {
    const seeded = new Set(group);
    const judged = relations.names[group[0]!]!;
    const restricted = new Map<NodeId, Decision>();
    for (const id of everyFile) {
      const decision = chainBetween(files, judged, relations.names[id]!);
      if (decision?.rule.type === 'restricted') restricted.set(id, decision);
    }
    if (restricted.size === 0) continue;

    // A shipped file can be where a chain may not arrive and still be walked
    // from: what it imports is its own package's offering. So the walk stops
    // at a restricted file only when it arrives there, never at a seed.
    const walls = [...restricted.keys()].filter((id) => !seeded.has(id));
    const options = { through: EDGE_KINDS, avoid: walls };
    const walk = dependenciesOf(relations, group, options);
    const { offset, target } = relations.depends;
    for (const at of walk.nodes) {
      const arrived = new Set<NodeId>();
      // Both depend on `at` alone, so an importer reaching several restricted files walks back once.
      let seeds: number | undefined;
      let chain: string[] | undefined;
      for (let edge = offset[at]!; edge < offset[at + 1]!; edge += 1) {
        const to = target[edge]!;
        const decision = restricted.get(to);
        if (decision === undefined || arrived.has(to)) continue;
        arrived.add(to);
        seeds ??= seedsBehind(relations, group, restricted, at);
        chain ??= trailOf(walk, at).map((id) => relations.names[id]!);
        const key = `${relations.names[at]}\0${relations.names[to]}`;
        const held = found.get(key);
        if (held !== undefined) {
          found.set(key, { ...held, chain: chain.length < held.chain.length ? chain : held.chain, seeds: held.seeds + seeds });
          continue;
        }
        found.set(key, {
          from: relations.names[at]!,
          to: relations.names[to]!,
          directory: decision.directory,
          ...(decision.rule.message === undefined ? {} : { message: decision.rule.message }),
          chain,
          seeds,
        });
      }
    }
  }
  return [...found.values()].sort((a, b) => byCodeUnit(a.from, b.from) || byCodeUnit(a.to, b.to));
}
