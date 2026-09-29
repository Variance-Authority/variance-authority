// compass: variance-authority.reach
/**
 * Where each part of a repository starts: the `entrypoints` key of the root
 * config, which `variance coverage --from <dir>` reads to know what `<dir>` is
 * made of ([`source-scope.ts`](../source-scope.ts)).
 *
 * Read here, beside `suites`, because both are the root file's, and the CLI's
 * config parser carries this reading rather than repeating it.
 */

import { rootConfig } from './cache-layers.js';

/** Each declared directory, repository-relative, to the patterns its entry points match. */
export type Entrypoints = ReadonlyMap<string, readonly string[]>;

/** An `entrypoints` value the declaration's rules refuse, in the shape `SuitesError` has. */
export class EntrypointsError extends Error {
  constructor(
    readonly where: string,
    readonly field: string,
    readonly said: string,
  ) {
    super(`${where}: "${field}" ${said}`);
    this.name = 'EntrypointsError';
  }
}

/**
 * Check an `entrypoints` value. Pure, so the CLI parses the same value with the
 * same rules. A pattern is relative to the directory it is declared under:
 * `*` matches within one path segment, and `**` any number of them.
 */
export function parseEntrypoints(value: unknown, where: string): Entrypoints {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EntrypointsError(where, 'entrypoints', `must be an object from a directory to its entry points, not ${JSON.stringify(value)}`);
  }
  const declared = new Map<string, readonly string[]>();
  for (const [dir, patterns] of Object.entries(value)) {
    if (
      !Array.isArray(patterns) ||
      patterns.length === 0 ||
      patterns.some((pattern) => typeof pattern !== 'string' || pattern === '' || pattern.startsWith('/') || pattern.split('/').includes('..'))
    ) {
      throw new EntrypointsError(
        where,
        `entrypoints.${dir}`,
        `must be a non-empty array of paths relative to "${dir}", with "*" and "**" as a glob spells them, not ${JSON.stringify(patterns)}`,
      );
    }
    const key = directoryOf(dir);
    if (key === undefined || declared.has(key)) {
      throw new EntrypointsError(
        where,
        `entrypoints.${dir}`,
        key === undefined
          ? 'is not a directory inside the repository: spell it from the repository root, without ".."'
          : `names the directory "${key}" a second time`,
      );
    }
    declared.set(key, patterns as string[]);
  }
  if (declared.size === 0) {
    throw new EntrypointsError(where, 'entrypoints', 'declares no directory; remove it, or name each part of the repository and where it starts');
  }
  return declared;
}

/** The entry points the root config of `root`'s repository declares, or undefined when it declares none. */
export function declaredEntrypoints(root: string): Entrypoints | undefined {
  const config = rootConfig(root);
  if (config === undefined || config.value['entrypoints'] === undefined) return undefined;
  return parseEntrypoints(config.value['entrypoints'], config.file);
}

/** Repository-relative, without `./` or a trailing `/`; `''` for the root; undefined when it climbs out. */
export function directoryOf(path: string): string | undefined {
  const parts = path.split('/').filter((part) => part !== '' && part !== '.');
  if (path.startsWith('/') || parts.includes('..')) return undefined;
  return parts.join('/');
}
