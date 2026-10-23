/**
 * Run a project's own Jest transformer inside yours.
 *
 * A transformer that wraps the one a project would have used — `@swc/jest`,
 * `ts-jest`, `babel-jest`, anything with Jest's transformer shape — has to load
 * it the way Jest would, hand it the options the project gave it, and ask it
 * for a cache key and a transform the way Jest would have asked. The Jest
 * transformer next to this file does that through {@link loadTransformer}, and
 * reads which files are tests through {@link isTestFile}.
 *
 * `isolator` keeps a copy of this file and of `jest-test-files.ts`, on purpose: a
 * package of its own would be one nobody installs for what it does.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { JestTestFiles } from './jest-test-files.js';

export { globMatcher, isTestFile, slashed, type JestTestFiles } from './jest-test-files.js';

/** The fields of Jest's `TransformOptions` a wrapping transformer reads. */
export interface JestTransformOptions {
  readonly config: JestTestFiles;
  readonly configString: string;
  readonly instrument: boolean;
  readonly transformerConfig?: unknown;
}

/** The shape of a transformer as Jest loads one, sync or async. */
export interface JestTransformer<Options extends JestTransformOptions, Result> {
  readonly canInstrument?: boolean;
  getCacheKey?(source: string, path: string, options: Options): string;
  getCacheKeyAsync?(source: string, path: string, options: Options): Promise<string>;
  process?(source: string, path: string, options: Options): Result;
  processAsync?(source: string, path: string, options: Options): Promise<Result>;
}

/** A transformer as a Jest configuration names one: a module, or a module and its options. */
export type TransformerEntry = string | readonly [string, Record<string, unknown>];

/**
 * The project's transformer, asked the way Jest asks it: with its own options
 * in `transformerConfig`, and with Jest's answer wherever it declares none.
 */
export interface ProjectTransformer<Options extends JestTransformOptions, Result, Transformer> {
  /** The module the entry named. */
  readonly name: string;
  /** The options the entry gave it; absent when it gave none. */
  readonly options: Record<string, unknown> | undefined;
  /** The transformer itself, for what only its caller knows to ask. */
  readonly transformer: Transformer;
  readonly canInstrument: boolean;
  /** Its synchronous key for a module, or Jest's own when it declares none. */
  cacheKey(source: string, path: string, options: Options): string;
  /** Its asynchronous key, its synchronous one, or Jest's own. */
  cacheKeyAsync(source: string, path: string, options: Options): Promise<string>;
  /**
   * Its synchronous transform; absent when it has none. Jest takes the
   * synchronous path for every CommonJS module, so a wrapper offers `process`
   * only when this is present: answering it by blocking on an asynchronous
   * transform would hang.
   */
  readonly process: ((source: string, path: string, options: Options) => Result) | undefined;
  /** Its asynchronous transform, or its synchronous one. */
  processAsync(source: string, path: string, options: Options): Promise<Result>;
}

interface TransformerModule {
  readonly createTransformer?: (config?: unknown) => unknown;
  readonly default?: TransformerModule;
  readonly process?: unknown;
  readonly processAsync?: unknown;
}

/**
 * Load the transformer an entry names the way Jest would have: resolved from
 * the project at `root`, `import`ed when it is ES, and built by its
 * `createTransformer` factory when it has one. Jest's own default, `babel-jest`,
 * is a dependency of `jest-config` rather than of the project, and is found
 * where Jest finds it.
 */
export async function loadTransformer<
  Options extends JestTransformOptions,
  Result,
  Transformer extends JestTransformer<Options, Result> = JestTransformer<Options, Result>,
>(root: string, entry: TransformerEntry): Promise<ProjectTransformer<Options, Result, Transformer>> {
  const [name, options] = typeof entry === 'string' ? [entry, undefined] : entry;
  const transformer = (await load(root, name, options)) as Transformer;
  // Jest hands a transformer the options its entry gave, and `{}` for none:
  // never the options the wrapper was given.
  const forIt = (given: Options): Options => ({ ...given, transformerConfig: options ?? {} });
  const key = transformer.getCacheKey?.bind(transformer);
  const keyAsync = transformer.getCacheKeyAsync?.bind(transformer) ?? key;
  const process = transformer.process?.bind(transformer);
  const processAsync = transformer.processAsync?.bind(transformer) ?? process;
  if (processAsync === undefined) throw new Error(`${name} has neither process nor processAsync`);
  return {
    name,
    options,
    transformer,
    canInstrument: transformer.canInstrument ?? false,
    cacheKey: (source, path, given) => key?.(source, path, forIt(given)) ?? jestCacheKey(source, path, given),
    cacheKeyAsync: async (source, path, given) =>
      (await keyAsync?.(source, path, forIt(given))) ?? jestCacheKey(source, path, given),
    process: process === undefined ? undefined : (source, path, given) => process(source, path, forIt(given)),
    processAsync: async (source, path, given) => await processAsync(source, path, forIt(given)),
  };
}

/** What Jest hashes for a module when its transformer declares no key of its own. */
export function jestCacheKey(source: string, path: string, options: JestTransformOptions): string {
  return createHash('sha1')
    .update(source)
    .update('\u0000')
    .update(options.configString)
    .update('\u0000')
    .update(options.instrument ? 'instrument' : '')
    .update('\u0000')
    .update(path)
    .digest('hex');
}

async function load(root: string, name: string, options: Record<string, unknown> | undefined): Promise<unknown> {
  const path = resolveTransformer(root, name);
  let loaded: TransformerModule;
  try {
    // Jest awaits a CommonJS transformer's export before it asks whether that
    // value is a transformer or a factory. Jira's Babel transformer uses that
    // contract: `module.exports` is the Promise returned by its asynchronous
    // configuration load. Inspecting the Promise itself reports that a valid
    // transformer has neither `process` nor `createTransformer`.
    loaded = (await createRequire(path)(path)) as TransformerModule;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'ERR_REQUIRE_ESM' && code !== 'ERR_REQUIRE_ASYNC_MODULE') throw error;
    loaded = (await import(pathToFileURL(path).href)) as TransformerModule;
  }
  for (const candidate of [loaded, loaded.default]) {
    if (candidate === undefined) continue;
    if (candidate.createTransformer !== undefined) return await candidate.createTransformer(options ?? {});
    if (typeof candidate.process === 'function' || typeof candidate.processAsync === 'function') return candidate;
  }
  throw new Error(`${name} exports neither a transformer nor a createTransformer factory`);
}

function resolveTransformer(root: string, name: string): string {
  const fromProject = createRequire(resolve(root, 'package.json'));
  try {
    return fromProject.resolve(name);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'MODULE_NOT_FOUND') throw error;
    return createRequire(fromProject.resolve('jest-config')).resolve(name);
  }
}
