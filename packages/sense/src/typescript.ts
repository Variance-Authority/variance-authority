/**
 * Which `tsconfig` governs resolution: the `typescript` key of the root config.
 *
 * A `tsconfig` decides two things about an import: where its `paths` send a
 * specifier, and which `customConditions` select a package's `exports`
 * ([`conditions.ts`](./conditions.ts)). A library that exports its source under
 * a condition of its own needs both read. A product whose packages export the
 * files they hold, and a repository with no TypeScript, need neither, and still
 * pay for finding and reading the config that governs every file a scan opens.
 * The repository says which it is, in `typescript.tsconfig`:
 *
 * - `"auto"`, the default: the nearest config that owns each file;
 * - a path from the repository root: that config and the projects it references;
 * - `false`: no config, so no `paths` and no custom conditions.
 *
 * Which config is *the* config is the repository's to say, and nothing here
 * guesses it: a workspace may keep one config for its editors and another of
 * project references for its checks, and an Angular project's is
 * `tsconfig.app.json`.
 */

// compass: variance-authority.reach.relations

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { declaredOptionsReader } from './conditions.js';
import type { ResolveOptions } from './resolve.js';
import { rootConfig } from './test-selection/cache-layers.js';
import { repositoryRoot } from './test-selection/repository-root.js';

/** The `typescript` section, as the root config holds it. */
export interface Typescript {
  /** `'auto'`, a path from the repository root, or `false`. */
  readonly tsconfig: string | false;
}

/** A `typescript` value its rules refuse. */
export class TypescriptError extends Error {
  constructor(
    readonly where: string,
    readonly field: string,
    readonly said: string,
  ) {
    super(`${where}: "${field}" ${said}`);
    this.name = 'TypescriptError';
  }
}

/** Check a `typescript` value. Pure, so the CLI parses the same value with the same rules. */
export function parseTypescript(value: unknown, where: string): Typescript {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypescriptError(where, 'typescript', `must be an object, not ${JSON.stringify(value)}`);
  }
  for (const key of Object.keys(value)) {
    if (key !== 'tsconfig') throw new TypescriptError(where, `typescript.${key}`, 'is not a setting; the one setting is `tsconfig`');
  }
  const tsconfig = (value as { tsconfig?: unknown }).tsconfig ?? 'auto';
  if (tsconfig !== false && (typeof tsconfig !== 'string' || tsconfig === '')) {
    throw new TypescriptError(where, 'typescript.tsconfig', `must be "auto", a path or false, not ${JSON.stringify(tsconfig)}`);
  }
  if (typeof tsconfig === 'string' && isAbsolute(tsconfig)) {
    throw new TypescriptError(where, 'typescript.tsconfig', `is a path from the repository root, not ${JSON.stringify(tsconfig)}`);
  }
  return { tsconfig };
}

/**
 * The `tsconfig` the root config of `root`'s repository declares: `'auto'`, the
 * absolute path of the config it names, `false`, or undefined when it declares
 * nothing. A named config that is not a file is an error rather than a
 * default, because every resolution under it would quietly use none.
 */
export function declaredTsconfig(root: string): string | false | undefined {
  const config = rootConfig(root);
  if (config === undefined || config.value['typescript'] === undefined) return undefined;
  const { tsconfig } = parseTypescript(config.value['typescript'], config.file);
  if (tsconfig === false || tsconfig === 'auto') return tsconfig;
  const file = resolve(dirname(config.file), tsconfig);
  if (statSync(file, { throwIfNoEntry: false })?.isFile() !== true) {
    throw new TypescriptError(config.file, 'typescript.tsconfig', `names ${tsconfig}, which is not a file`);
  }
  return file;
}

/** `options` with the `tsconfig` the repository declares, unless the caller named one. */
export function withDeclaredTsconfig<Options extends ResolveOptions>(root: string, options: Options): Options {
  if (options.tsconfig !== undefined) return options;
  const declared = declaredTsconfig(root);
  return declared === undefined ? options : { ...options, tsconfig: declared };
}

/** What the tracked configs that can govern a directory ask of a resolution; see {@link tsconfigUse}. */
export interface TsconfigUse {
  /** What the root config declares, a named config as a path; undefined when it declares nothing. */
  readonly declared: string | false | undefined;
  /** The directory asked, from the repository root; empty for the root itself. */
  readonly under: string;
  readonly configs?: readonly string[];
  readonly conditioned: readonly string[];
  readonly mapped: readonly string[];
}

/**
 * What the tracked configs that can govern a directory ask of a resolution, so
 * that whoever sets `typescript.tsconfig` can see what turning it off would
 * lose there.
 *
 * A file answers to a config in its own directory or one above it, so those
 * are the configs read: every one below the directory asked, and the ones in
 * each directory above it up to the repository root. A monorepo holds products
 * whose configs ask for different things, and each is read from its own
 * directory. Every path is from the repository root, slash-separated. A config is
 * `conditioned` when it adds a condition, and `mapped` when it maps `paths`,
 * either of its own or by what it extends. One that cannot be read is listed
 * in `configs` and in neither. `configs` is absent outside a git checkout,
 * where nothing says which configs are the repository's.
 */
export function tsconfigUse(from: string): TsconfigUse {
  const top = repositoryRoot(from);
  const named = declaredTsconfig(top);
  const declared = typeof named === 'string' && named !== 'auto' ? fromRoot(top, named) : named;
  const under = fromRoot(top, resolve(from));
  const above: string[] = [];
  for (let at = under; at !== ''; ) {
    at = at.includes('/') ? at.slice(0, at.lastIndexOf('/')) : '';
    above.push(`:(glob)${at === '' ? '' : `${at}/`}tsconfig*.json`);
  }
  const below = `:(glob)${under === '' ? '' : `${under}/`}**/tsconfig*.json`;
  let configs: string[];
  try {
    configs = execFileSync('git', ['ls-files', '-z', '--', below, ...above], {
      cwd: top,
      encoding: 'utf8',
      maxBuffer: 1 << 30,
      stdio: 'pipe',
    }).split('\0').filter((file) => file !== '').sort();
  } catch (error) {
    // 128 is git's own refusal: not a repository. Anything else is a fault, not an absence.
    if ((error as { status?: unknown }).status === 128) return { declared, under, conditioned: [], mapped: [] };
    throw error;
  }
  const read = declaredOptionsReader();
  const options = configs.map((file) => ({ file, options: read(join(top, file)) }));
  return {
    declared,
    under,
    configs,
    conditioned: options.filter(({ options }) => (options?.conditions.length ?? 0) > 0).map(({ file }) => file),
    mapped: options.filter(({ options }) => options?.paths === true).map(({ file }) => file),
  };
}

function fromRoot(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}
