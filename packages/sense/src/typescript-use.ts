/**
 * What the `tsconfig` files of a repository ask of a resolution, read for
 * `variance doctor`. Apart from [`typescript.ts`](./typescript.ts) because it
 * reads the tree listing, and every scan that only asks which config is
 * declared must not load the addon to do so.
 */

// compass: variance-authority.reach.relations

import { join, relative, resolve, sep } from 'node:path';
import { declaredOptionsReader } from './conditions.js';
import { repositoryRoot } from './test-selection/repository-root.js';
import { gitTreeOf } from './tree.js';
import { declaredTsconfig } from './typescript.js';

/** What the configs the listing holds ask of a resolution; see {@link tsconfigUse}. */
export interface TsconfigUse {
  /** What the root config declares, a named config as a path; undefined when it declares nothing. */
  readonly declared: string | false | undefined;
  /** The directory asked, from the repository root; empty for the root itself. */
  readonly under: string;
  /** Every `tsconfig*.json` the listing holds; absent where git gives none. */
  readonly configs?: readonly string[];
  /** Of `configs`, those that can govern a file under `under`: below it, or in a directory above it; all of them when the root config names one. */
  readonly governing?: readonly string[];
  readonly conditioned: readonly string[];
  readonly mapped: readonly string[];
  readonly based: readonly string[];
}

/**
 * What the configs of a repository ask of a resolution, so that whoever sets
 * `typescript.tsconfig` can see what turning it off would lose.
 *
 * The setting reaches the whole repository, so every `tsconfig*.json` the
 * listing holds is read ([`tree.ts`](./tree.ts) names them, as it does for the
 * config digest). A file answers to a config in its own directory or one above
 * it, so the ones that can govern the directory asked are named apart: a
 * monorepo holds products whose configs ask for different things. Every path is
 * from the repository root, slash-separated. A config is `conditioned` when it
 * adds a condition, `mapped` when it maps `paths`, and `based` when it sets
 * `baseUrl`, through which a bare specifier resolves with no `paths` at all;
 * each of its own or by what it extends. One that cannot be read is listed in `configs` and in
 * neither. `configs` is absent where git gives no listing, where nothing says which
 * configs are the repository's.
 */
export async function tsconfigUse(from: string): Promise<TsconfigUse> {
  const top = repositoryRoot(from);
  const named = declaredTsconfig(top);
  const declared = typeof named === 'string' && named !== 'auto' ? fromRoot(top, named) : named;
  const under = fromRoot(top, resolve(from));
  const tree = await gitTreeOf(top);
  if (tree === undefined) return { declared, under, conditioned: [], mapped: [], based: [] };
  // A named config governs every directory, and need not be a `tsconfig*.json`
  // the listing holds; the projects it references may be any of the rest.
  const chosen = typeof declared === 'string' && declared !== 'auto' ? declared : undefined;
  const listed = tree.named([]);
  const configs = chosen === undefined || listed.includes(chosen) ? [...listed] : [...listed, chosen].sort();
  const read = declaredOptionsReader();
  const options = configs.map((file) => ({ file, options: read(join(top, file)) }));
  return {
    declared,
    under,
    configs,
    governing: chosen !== undefined ? configs : configs.filter((file) => governs(file, under)),
    conditioned: options.filter(({ options }) => (options?.conditions.length ?? 0) > 0).map(({ file }) => file),
    mapped: options.filter(({ options }) => options?.paths === true).map(({ file }) => file),
    based: options.filter(({ options }) => options?.baseUrl === true).map(({ file }) => file),
  };
}

/** Whether a config at `file` can govern a file under `under`: it sits below `under`, or in a directory above it. */
function governs(file: string, under: string): boolean {
  if (under === '' || file.startsWith(`${under}/`)) return true;
  const directory = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  return directory === '' || under.startsWith(`${directory}/`);
}

function fromRoot(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}
