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

/**
 * The names of the packages among `manifests` that declare no entry: named,
 * and writing none of `exports`, `main`, `types` or `typings`.
 *
 * Such a package is a folder and a boundary. Nothing is declared, so nothing is
 * listed from its files, and no import of one is deep: every consumer imports
 * the file it wants by path, and those imports are the package's surface.
 * `private: true` does not exclude one. It says the package is not published,
 * and other packages import its files either way.
 */
export function unentered(manifests: Iterable<Record<string, unknown>>): ReadonlySet<string> {
  const found = new Set<string>();
  for (const manifest of manifests) {
    if (typeof manifest['name'] !== 'string') continue;
    if (['exports', 'main', 'types', 'typings'].some((key) => manifest[key] !== undefined)) continue;
    found.add(manifest['name']);
  }
  return found;
}
