/**
 * The entry a manifest declares for its bare name, and the packages that
 * declare none.
 */

/**
 * The `"."` a manifest with no `exports` opens: `types`, then `typings`, then
 * `main`, the order TypeScript reads them in.
 *
 * Without `exports`, Node loads `main` for the bare name and TypeScript takes
 * its declarations from these keys, so the bare name is published exactly as if
 * `exports` had written `"."`. The package's other files stay importable by path
 * and are not listed: `publishes` reads `exports` alone, so an import of one is
 * reported as a deep import, past the entry the package declares.
 */
export function legacyEntry(manifest: Record<string, unknown>): readonly (readonly [string, unknown])[] {
  const written = [manifest['types'], manifest['typings'], manifest['main']].find((key) => typeof key === 'string');
  return written === undefined ? [] : [['.', written]];
}

/** Whether a manifest is a package's own to publish: named, and not `private: true`. */
export function isPublished(manifest: Record<string, unknown>): manifest is Record<string, unknown> & { readonly name: string } {
  return typeof manifest['name'] === 'string' && manifest['private'] !== true;
}

/** The packages whose files an import between packages is followed into, by what each declares. */
export interface ImportTargets {
  /** Every package that is published, whether or not the entry it declares could be followed. */
  readonly published: ReadonlySet<string>;
  /**
   * The packages that declare no entry: named, and writing none of `exports`,
   * `main`, `types` or `typings`.
   *
   * Such a package is a folder and a boundary. Nothing is declared, so nothing
   * is listed from its files, and no import of one is deep: every consumer
   * imports the file it wants by path, and those imports are the package's
   * surface. `private: true` does not exclude one. It says the package is not
   * published, and other packages import its files either way.
   */
  readonly unentered: ReadonlySet<string>;
}

/**
 * The published packages among `manifests` and the ones that declare no entry,
 * in one pass.
 *
 * An import into a published package that its entries do not open is past the
 * entry, whether or not the entry could be followed to a file: a `main` naming
 * a build output the checkout does not hold opens nothing, and every import of
 * the package is still one somebody wrote.
 */
export function importTargets(manifests: Iterable<Record<string, unknown>>): ImportTargets {
  const published = new Set<string>();
  const unentered = new Set<string>();
  for (const manifest of manifests) {
    if (typeof manifest['name'] !== 'string') continue;
    if (isPublished(manifest)) published.add(manifest['name']);
    if (['exports', 'main', 'types', 'typings'].some((key) => manifest[key] !== undefined)) continue;
    unentered.add(manifest['name']);
  }
  return { published, unentered };
}
