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

import { statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ResolveOptions } from './resolve.js';
import { rootConfig } from './test-selection/cache-layers.js';

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
  // Only an absent key is the default: `null` is a value, and not one of the three.
  const given = (value as { tsconfig?: unknown }).tsconfig;
  const tsconfig = given === undefined ? 'auto' : given;
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
  const top = dirname(config.file);
  const file = resolve(top, tsconfig);
  // A record names files from the checkout's root, so a config outside it is
  // one no record could name.
  if (relative(top, file).split(sep)[0] === '..') {
    throw new TypescriptError(config.file, 'typescript.tsconfig', `names ${tsconfig}, which is outside the repository root`);
  }
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
