/**
 * The Jest transformer: isolate the module, then hand it to the project's own.
 *
 * ```js
 * // reset.setup.cjs: the driver loads before any isolated module.
 * const { configureResetHandler } = require('@variance-authority/ioc/reset/setup');
 *
 * configureResetHandler(beforeEach);
 * ```
 *
 * ```js
 * // jest.config.mjs
 * export default {
 *   setupFilesAfterEnv: ['<rootDir>/reset.setup.cjs'],
 *   transform: {
 *     '\\.[jt]sx?$': ['@variance-authority/isolator/jest', { transformer: '@swc/jest' }],
 *   },
 * };
 * ```
 *
 * The project's transformer runs on the isolated text, with the project's
 * options, and its source map is composed with this one, so a stack trace and
 * a coverage report name the file on disk. A test file is never isolated: its
 * own variables carry a `beforeAll` into the tests after it, which is what a
 * test file means by them. Neither is anything under `node_modules`, nor a
 * module its package lists in `sideEffects`.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import remapping, { type SourceMapInput } from '@jridgewell/remapping';
import {
  isTestFile,
  jestCacheKey,
  loadTransformer,
  type JestTransformer as Transformer,
  type JestTransformOptions,
  type TransformerEntry,
} from './jest-transformer.js';
import { skipper } from './skips.js';
import { isolate, type Isolated } from './transform.js';

/** What a transform entry hands this transformer. */
export interface IsolatorTransformerConfig {
  /** The transformer that runs after this one, as Jest's configuration would name it. */
  readonly transformer?: TransformerEntry;
  /** Globs, relative to `root`, of modules whose state stays shared. */
  readonly exclude?: readonly string[];
  /** Where `exclude` and `transformer` are resolved from; the working directory unless given. */
  readonly root?: string;
}

interface JestTransformedSource {
  readonly code: string;
  readonly map?: SourceMapInput | null;
}

/** The shape of a transformer as Jest loads one. */
export type JestTransformer = Transformer<JestTransformOptions, JestTransformedSource>;

const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

/**
 * Build the transformer Jest will call. Async because the wrapped transformer
 * may be an ES module, and Jest awaits this factory for that reason.
 */
export async function createTransformer(config: IsolatorTransformerConfig = {}): Promise<JestTransformer> {
  const root = resolve(config.root ?? process.cwd());
  const inner = config.transformer === undefined
    ? undefined
    : await loadTransformer<JestTransformOptions, JestTransformedSource>(root, config.transformer);
  const skipped = skipper(root, config.exclude);
  // Jest answers which files are tests, and a test file's own variables carry
  // a `beforeAll` into the tests after it: it is never isolated.
  const skips = (path: string, options: JestTransformOptions): boolean => skipped(path) || isTestFile(path, options.config);

  const keyOf = (path: string, innerKey: string): string =>
    createHash('sha1')
      .update(VERSION)
      .update('\u0000')
      .update(innerKey)
      .update('\u0000')
      .update(path)
      .update('\u0000')
      // A package that declares side effects in a manifest the source never
      // names still changes what this module becomes.
      .update(skipped(path) ? 'shared' : 'isolated')
      .update('\u0000')
      .update(JSON.stringify([inner?.options ?? null, root, config.exclude ?? []]))
      .digest('hex');
  const isolated = (source: string, path: string, options: JestTransformOptions): Isolated => {
    if (skips(path, options)) return { code: source, map: undefined, left: [] };
    const result = isolate(source, path);
    for (const { line, name, reason } of result.left) {
      console.warn(`isolator: ${relative(root, path)}:${line} \`${name}\` stays shared: ${reason}`);
    }
    return result;
  };
  const bare = (ours: Isolated): JestTransformedSource => ({ code: ours.code, map: (ours.map ?? null) as SourceMapInput | null });
  const composed = (ours: Isolated, theirs: JestTransformedSource): JestTransformedSource => {
    if (ours.map === undefined || theirs.map == null) return theirs;
    const map = remapping([theirs.map, ours.map as SourceMapInput], () => null);
    return { ...theirs, map: JSON.parse(map.toString()) as SourceMapInput };
  };

  if (inner === undefined) {
    const key = (source: string, path: string, options: JestTransformOptions): string =>
      keyOf(path, jestCacheKey(source, path, options));
    return {
      canInstrument: false,
      getCacheKey: key,
      getCacheKeyAsync: async (source, path, options) => key(source, path, options),
      process: (source, path, options) => bare(isolated(source, path, options)),
      processAsync: async (source, path, options) => bare(isolated(source, path, options)),
    };
  }
  const transformer: JestTransformer = {
    canInstrument: inner.canInstrument,
    getCacheKey: (source, path, options) => keyOf(path, inner.cacheKey(source, path, options)),
    getCacheKeyAsync: async (source, path, options) => keyOf(path, await inner.cacheKeyAsync(source, path, options)),
    processAsync: async (source, path, options) => {
      const ours = isolated(source, path, options);
      return composed(ours, await inner.processAsync(ours.code, path, options));
    },
  };
  // Jest takes the synchronous path for every CommonJS module, so it is offered
  // only when the wrapped transformer has one to answer it with.
  const innerProcess = inner.process;
  if (innerProcess !== undefined) {
    transformer.process = (source, path, options) => {
      const ours = isolated(source, path, options);
      return composed(ours, innerProcess(ours.code, path, options));
    };
  }
  return transformer;
}

// Jest unwraps `default` when a host loader transpiles this module to CommonJS.
export default { createTransformer };
