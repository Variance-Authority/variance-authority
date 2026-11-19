// compass: variance-authority.reach.relations

import { dependenciesOf, idOf, relationsOf, type Relation } from '@variance-authority/core/relate';
import type { PackageLayer } from '@variance-authority/sense';
import { OperatorError } from '../exit.js';

export interface LayerScope {
  readonly roots: readonly string[];
  readonly packageCount: number;
  readonly layerCount: number;
  readonly boundary: 'repository';
}

/** Select the roots' dependency closure; keeping every dependency preserves the stored layers. */
export function layersFrom(packages: readonly PackageLayer[], roots: readonly string[]): { packages: readonly PackageLayer[]; scope: LayerScope } {
  const named = new Map(packages.map((entry) => [entry.package, entry]));
  for (const root of roots) {
    if (!named.has(root)) throw new OperatorError(`No package named \`${root}\` in the code map.`);
  }
  function* edges(): IterableIterator<Relation> {
    for (const entry of packages) {
      for (const dependency of entry.takes) {
        if (named.has(dependency)) {
          yield { from: { kind: 'package', name: entry.package }, to: { kind: 'package', name: dependency }, kind: 'depends-on' };
        }
      }
    }
  }
  const graph = relationsOf({ relations: edges(), isolated: packages.map((entry) => ({ kind: 'package', name: entry.package })) });
  const reached = dependenciesOf(graph, roots.map((root) => idOf(graph, 'package', root)!));
  const selected = reached.nodes.map((node) => named.get(graph.names[node]!)!);
  return {
    packages: selected,
    scope: { roots, packageCount: selected.length, layerCount: selected.reduce((max, entry) => Math.max(max, entry.layer), 0), boundary: 'repository' },
  };
}
