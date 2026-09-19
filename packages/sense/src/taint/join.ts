/**
 * One file's diff, resolved against the tree and laid onto its record.
 *
 * The half of the join that is about *where a specifier points*. Everything
 * here answers the same question the scan answers for an import it read — which
 * file is this, and what is it — so it resolves the way the scan resolves, and
 * a specifier that resolves to nothing lands where the scan would have put it.
 *
 * A specifier arrives with the taints that named it, and leaves with them: two
 * taints that shadow one module both said so, and an operator reading a
 * selection that left a test out is owed the name of whoever cut it.
 */

// compass: variance-authority.reach

import { join } from 'node:path';
import type { FileEdge, FileRecord, PackageEdge } from '@variance-authority/core/relate';
import { resolveTo, type Resolvers } from '../resolve.js';
import { isRelative, kindFor, packageOf, requestOf } from '../specifier.js';

/** Specifiers a taint named, each with the taints that named it. */
export type Said = ReadonlyMap<string, ReadonlySet<string>>;

/** A specifier resolved from one file, the way the scan resolves an import. */
export type Target = (value: string) => string | undefined;

/** Where a file's specifiers landed, and who is answerable for each landing. */
export interface Reached {
  /** The files, sorted. */
  readonly targets: readonly string[];
  /** Per file, the taints that named a specifier pointing at it. */
  readonly by: ReadonlyMap<string, readonly string[]>;
  /** Specifiers that resolved to nothing, in the order they were named. */
  readonly missed: readonly string[];
}

/** How one file's specifiers resolve: the directory it sits in, and what is installed. */
export function targetFrom(file: string, root: string, resolvers: Resolvers): Target {
  const from = join(root, file);

  return (value) => {
    const request = requestOf(value);
    // Always `module`: taint follows the JavaScript import graph, and the caller
    // has already filtered to module extensions before it gets here.
    return request === undefined
      ? undefined
      : resolveTo({ resolvers, root, from, request, language: 'module' });
  };
}

/** Every specifier resolved once, with the taints behind each target unioned. */
export function reach(said: Said, target: Target): Reached {
  const by = new Map<string, Set<string>>();
  const missed: string[] = [];

  for (const [value, names] of said) {
    const to = target(value);
    if (to === undefined) {
      missed.push(value);
      continue;
    }
    const held = by.get(to) ?? new Set<string>();
    for (const name of names) held.add(name);
    by.set(to, held);
  }

  return {
    targets: [...by.keys()].sort(byCodeUnit),
    by: new Map([...by].map(([to, names]) => [to, [...names].sort(byCodeUnit)])),
    missed,
  };
}

/** One record with its additions joined on. */
export function applied(record: FileRecord, plus: Reached): FileRecord {
  const edges: FileEdge[] = [...(record.edges ?? [])];
  const unresolved = [...(record.unresolved ?? []), ...plus.missed];
  const holes = plus.missed.filter((value) => {
    const request = requestOf(value);
    return request !== undefined && isRelative(request);
  });

  // The target says what it is: a stylesheet is an asset however it was named.
  for (const to of plus.targets) edges.push({ to, kind: kindFor('imports', to) });

  // A tainted specifier that named a package lands here for the same reason the
  // scan's own does: it resolved to nothing inside the repository because it
  // resolves to an install. A table saying a file reaches `@mui/material` is
  // exactly as good a reason to seed that file on a `@mui/material` bump as the
  // import statement would have been.
  const packages: PackageEdge[] = [...(record.packages ?? [])];
  for (const value of plus.missed) {
    const request = requestOf(value);
    const named = request === undefined ? undefined : packageOf(request);
    if (named !== undefined) packages.push({ to: named, kind: 'imports' });
  }

  const reasons = [
    ...(record.unknown === undefined ? [] : [record.unknown]),
    ...(holes.length === 0
      ? []
      : [`${holes.length} tainted relative specifier(s) that resolve to nothing: ${holes.join(', ')}`]),
  ];

  const { edges: _edges, packages: _packages, unresolved: _unresolved, unknown: _unknown, ...rest } = record;

  return {
    ...rest,
    ...(edges.length > 0 ? { edges: dedupe(edges) } : {}),
    ...(packages.length > 0 ? { packages: dedupe(packages) } : {}),
    ...(unresolved.length > 0 ? { unresolved: [...new Set(unresolved)].sort(byCodeUnit) } : {}),
    ...(reasons.length > 0 ? { unknown: reasons.join('; ') } : {}),
  };
}

function dedupe<Edge extends FileEdge>(edges: readonly Edge[]): readonly Edge[] {
  const seen = new Set<string>();

  return edges
    .filter((edge) => {
      const key = `${edge.kind} ${edge.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => byCodeUnit(a.to, b.to) || byCodeUnit(a.kind, b.kind));
}

export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
