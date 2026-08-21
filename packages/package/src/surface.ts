import { resolve } from 'node:path';
import { type OfferingOptions, readOfferings } from './manifest.js';
import { createReader, namesReachedBy } from './reach.js';

/**
 * What a workspace publishes, as one value.
 *
 * Two halves, and the split is the whole design. What a package *offers* comes
 * from its `package.json`, because that manifest is the thing npm uploads and
 * the thing another project reads. What each entrypoint *reaches* comes from the
 * source that manifest points at, followed through the barrels.
 *
 * Plain JSON on purpose. This is a source, and a source that returned a shaped
 * capture would have decided which comparison you were allowed to run against
 * it. Hand it to `shapeValue` and `compareValues`, hand it to a snapshot
 * assertion, hand it to anything.
 */

/** One package, as it offers itself and as its entrypoints read. */
export interface PublishedPackage {
  /** The manifest keys `OFFERED` names, present-or-absent, verbatim. */
  readonly declared: Readonly<Record<string, unknown>>;
  /** Subpath to every name it publishes, each named by what kind of thing it is. */
  readonly names: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Every published package of a workspace, by name. */
export type PackageSurface = Readonly<Record<string, PublishedPackage>>;

/**
 * Read a workspace's published surface.
 *
 * The entrypoint map is built before anything is followed, because a re-export
 * that hops packages — `export { settle } from '@variance-authority/raster'` —
 * has to land on the other package's source rather than on its build.
 */
export function readSurface(root: string, options: OfferingOptions = {}): PackageSurface {
  const where = resolve(root);
  const offerings = readOfferings(where, options);

  const entrypoints = new Map<string, string>();
  for (const offering of offerings) {
    for (const entry of offering.entrypoints) {
      entrypoints.set(`${offering.name} ${entry.subpath}`, entry.source);
    }
  }

  const reader = createReader(where, entrypoints);
  const surface: Record<string, PublishedPackage> = {};

  for (const offering of offerings) {
    const names: Record<string, Record<string, string>> = {};
    for (const entry of offering.entrypoints) {
      const reachable: Record<string, string> = {};
      for (const [name, kinds] of [...namesReachedBy(reader, entry.source)].sort()) {
        reachable[name] = [...kinds].sort().join('+');
      }
      names[entry.subpath] = reachable;
    }
    surface[offering.name] = { declared: offering.declared, names };
  }

  return surface;
}

/**
 * How many names a surface holds.
 *
 * Worth having because the interesting failure of a reader like this is not a
 * wrong answer but an empty one: a resolver that stops resolving returns nothing
 * rather than something false, and a baseline re-recorded from nothing agrees
 * with it forever.
 */
export function countNames(surface: PackageSurface): number {
  return Object.values(surface).reduce(
    (total, published) =>
      total + Object.values(published.names).reduce((names, entry) => names + Object.keys(entry).length, 0),
    0,
  );
}
