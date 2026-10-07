/**
 * The entry a manifest declares for its bare name, and the packages that
 * declare none.
 */

import { requested, subpathsOf } from './exports.js';

/**
 * The `"."` a manifest with no `exports` opens: `types`, then `typings`, then
 * `main`, the order TypeScript reads them in.
 *
 * Without `exports`, Node loads `main` for the bare name and TypeScript takes
 * its declarations from these keys, so the bare name is published exactly as if
 * `exports` had written `"."`. The package's other files stay importable by path
 * and are not listed, so an import of one is reported as a deep import, past the
 * entry the package declares.
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
  /**
   * The specifiers each published manifest declares, as `requested` keys,
   * whether or not the reading could follow one to a source file: every subpath
   * `exports` names with a target, or the bare name `main`, `types` or `typings`
   * declares when there is no `exports`.
   *
   * A `null` target is Node's way of closing a subpath, so it declares nothing.
   * A pattern is not listed: every file one matches is opened, so a specifier it
   * matches and the reading did not open names a file that does not exist. An
   * `exports` that mixes subpaths with conditions declares nothing, since Node
   * refuses to load it.
   */
  readonly declared: ReadonlySet<string>;
}

/** Whether a manifest declares an entry: writes any of `exports`, `main`, `types` or `typings`. */
function declaresEntry(manifest: Record<string, unknown>): boolean {
  return ['exports', 'main', 'types', 'typings'].some((key) => manifest[key] !== undefined);
}

/** The specifiers a published manifest declares, as `requested` keys. */
function declaredBy(name: string, manifest: Record<string, unknown>): readonly string[] {
  let subpaths: readonly (readonly [string, unknown])[];
  try {
    subpaths = manifest['exports'] === undefined ? legacyEntry(manifest) : subpathsOf(name, manifest['exports']);
  } catch {
    return [];
  }
  return subpaths.filter(([subpath, target]) => target !== null && !subpath.includes('*')).map(([subpath]) => requested(`${name}${subpath.slice(1)}`));
}

/**
 * The published packages among `manifests`, the ones that declare no entry, and
 * the specifiers each declares, in one pass.
 *
 * An import into a published package that its entries do not open is past the
 * entry, whether or not the entry could be followed to a file: a `main` naming
 * a build output the checkout does not hold opens nothing, and every import of
 * the package is still one somebody wrote.
 */
export function importTargets(manifests: Iterable<Record<string, unknown>>): ImportTargets {
  const published = new Set<string>();
  const unentered = new Set<string>();
  const declared = new Set<string>();
  for (const manifest of manifests) {
    const name = manifest['name'];
    if (typeof name !== 'string') continue;
    if (isPublished(manifest)) {
      published.add(name);
      for (const key of declaredBy(name, manifest)) declared.add(key);
    }
    if (!declaresEntry(manifest)) unentered.add(name);
  }
  return { published, unentered, declared };
}

/**
 * Where an import between packages lands, by its `requested` key: a specifier
 * an entry opens, a specifier the manifest declares and the reading could not
 * follow to a source file, a file past every declared entry, or a file of a
 * package that declares none. Nothing, for a package an import is not followed
 * into.
 */
export function landing(key: string, opened: ReadonlySet<string>, targets: ImportTargets): 'opened' | 'unfollowed' | 'deep' | 'byPath' | undefined {
  const named = key.slice(0, key.indexOf(' '));
  if (!targets.published.has(named) && !targets.unentered.has(named)) return undefined;
  if (opened.has(key)) return 'opened';
  if (targets.unentered.has(named)) return 'byPath';
  return targets.declared.has(key) ? 'unfollowed' : 'deep';
}
