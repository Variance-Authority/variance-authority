/**
 * The Jest transformer: the project's own transform first, probes on its output.
 *
 * Named in a configuration by `withTestSelection`, and loaded by Jest once per
 * worker. It wraps whatever transformer the configuration named — `@swc/jest`,
 * `ts-jest`, `babel-jest`, anything with Jest's transformer shape — and never
 * chooses one: the project's transformer runs first, with the project's
 * options, and the probes land on what it produced.
 *
 * Two things decide what it costs. The first is Jest's transform cache: the
 * text this returns is stored on disk under `getCacheKey`, shared by every
 * worker and every later run, and a module whose content and configuration have
 * not changed is never handed to `process` again — so the parse `instrument`
 * does is paid once per content version per machine, not once per worker or per
 * run. The second is that the record of what the probes mean is written under
 * that same key: a cache hit is a hit for both halves, and a cache miss rewrites
 * both. Nothing is recomputed at report time.
 *
 * A module the instrumenter cannot read passes through as the inner transformer
 * produced it, with an inventory that says so; the selector widens over such a
 * module rather than trusting an absence of crossings.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import picomatch from 'picomatch';
import { instrument, instrumentationId, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { readModuleNames } from '../module-names.js';
import {
  defaultInclude,
  openModuleNames,
  openRecords,
  projectPath,
  writeRecord,
  type CapturedModule,
  type RecordWriter,
} from './instrumented-modules.js';
import { coverageBlock } from './coverage-rows.js';
import { jestStore, type SelectionTransformerConfig } from './jest.js';
import { recordedFrame, type TransformSourceMap } from './source-lines.js';

/** The fields of Jest's project configuration this reads. */
export interface JestProjectConfig {
  readonly cacheDirectory: string;
  /** Jest's own hash of this project's configuration: which build made this text. */
  readonly id?: string;
  /** Globs, with `<rootDir>` already replaced, as Jest normalizes them. */
  readonly testMatch?: readonly string[];
  readonly testRegex?: string | readonly string[];
}

/** The fields of Jest's `TransformOptions` this reads. */
export interface JestTransformRequest {
  readonly config: JestProjectConfig;
  readonly configString: string;
  readonly instrument: boolean;
  readonly transformerConfig?: unknown;
}

export interface JestTransformedSource {
  readonly code: string;
  readonly map?: string | TransformSourceMap | null;
}

/** The shape of a transformer as Jest loads one, sync or async. */
export interface JestTransformer {
  readonly canInstrument?: boolean;
  getCacheKey?(source: string, path: string, options: JestTransformRequest): string;
  getCacheKeyAsync?(source: string, path: string, options: JestTransformRequest): Promise<string>;
  process?(source: string, path: string, options: JestTransformRequest): JestTransformedSource;
  processAsync?(
    source: string,
    path: string,
    options: JestTransformRequest,
  ): Promise<JestTransformedSource>;
}

interface TransformerModule {
  readonly createTransformer?: (config?: unknown) => JestTransformer | Promise<JestTransformer>;
  readonly default?: TransformerModule;
  readonly process?: unknown;
  readonly processAsync?: unknown;
}

/**
 * Build the transformer Jest will call, wrapping whichever one the configuration
 * named.
 *
 * Async because a transformer module may be ES, and Jest awaits this factory
 * for exactly that reason. The inner transformer is resolved from the project
 * root rather than from this package: `@swc/jest` is the adopter's dependency,
 * and resolving it from here would find this package's copy or none.
 *
 * `process` is offered only when the wrapped transformer has one. Jest takes the
 * synchronous path for every CommonJS module, and a wrapper that answered it by
 * blocking on an asynchronous inner transform would be a wrapper that hangs.
 * `canInstrument` is the inner transformer's own: one that instruments for
 * `--coverage` itself still does, and the probes land on top.
 */
export async function createTransformer(
  config: SelectionTransformerConfig,
): Promise<JestTransformer> {
  const root = resolve(config.root);
  const inner = config.transformer === undefined
    ? undefined
    : await loadTransformer(root, config.transformer);
  const innerConfig = typeof config.transformer === 'string' ? undefined : config.transformer?.[1];
  const mode = config.mode ?? 'presence';
  const instrumentation = instrumentationId(mode);
  const excluded = new Set((config.exclude ?? []).map((file) => resolve(file)));
  // Once per worker. The table is immutable for the life of this run — the fold
  // that grows it is the reporter, in the parent, after the last worker exits.
  const names = readModuleNames(openModuleNames(root));
  const idOf = (path: string): ModuleId => {
    const file = projectPath(root, path);
    return names.idOf(file) ?? file;
  };
  const forInner = (options: JestTransformRequest): JestTransformRequest => ({
    ...options,
    ...(innerConfig === undefined ? {} : { transformerConfig: innerConfig }),
  });
  const keyOf = (source: string, path: string, options: JestTransformRequest, innerKey: string | undefined): string =>
    createHash('sha1')
      .update(instrumentation)
      .update('\0')
      .update(innerKey ?? defaultKey(source, path, options))
      .update('\0')
      .update(path)
      .update('\0')
      // The id is emitted as a literal, so a file that was numbered since the
      // last run produces different text from the same source. Jest would
      // otherwise serve the cached text, and the run would report a path the
      // journal's reader has already stopped expecting.
      .update(String(idOf(path)))
      .update('\0')
      .update(JSON.stringify(innerConfig ?? null))
      .update('\0')
      .update(excluded.has(resolve(path)) ? 'excluded' : '')
      .digest('hex')
      .slice(0, 32);
  const innerKeyAsync = inner?.getCacheKeyAsync ?? inner?.getCacheKey;
  const innerProcessAsync = inner?.processAsync ?? inner?.process;
  // One segment per worker, held for the worker's life: this transformer is
  // instantiated once per Jest worker process, and the store it writes to is
  // named by a project configuration that does not change under it.
  let records: RecordWriter | undefined;
  const recordsOf = (config: JestProjectConfig): RecordWriter => {
    const store = jestStore(config.cacheDirectory, config.id);
    if (records === undefined || records.store !== store) records = openRecords(store, instrumentation);
    return records;
  };

  const transformer: JestTransformer = {
    canInstrument: inner?.canInstrument ?? false,
    getCacheKey: (source, path, options) =>
      keyOf(source, path, options, inner?.getCacheKey?.(source, path, forInner(options))),
    getCacheKeyAsync: async (source, path, options) =>
      keyOf(source, path, options, await innerKeyAsync?.(source, path, forInner(options))),
    processAsync: async (source, path, options) => {
      const transformed = innerProcessAsync === undefined
        ? { code: source }
        : await innerProcessAsync(source, path, forInner(options));
      return place(root, recordsOf(options.config), path, idOf(path), options, source, transformed, mode, excluded);
    },
  };
  if (inner === undefined || inner.process !== undefined) {
    transformer.process = (source, path, options) => {
      const transformed = inner?.process === undefined
        ? { code: source }
        : inner.process(source, path, forInner(options));
      return place(root, recordsOf(options.config), path, idOf(path), options, source, transformed, mode, excluded);
    };
  }
  return transformer;
}

/**
 * Probes on the transformed text, and the inventory beside Jest's cache entry.
 *
 * The inventory is written before the text is returned, synchronously, because
 * Jest writes its own cache entry the moment this returns and a worker can be
 * ended the moment after: a text in the cache with no inventory is a module the
 * reporter can never attribute.
 *
 * A test file is not a module: nothing enters one, and its own edit is what
 * runs it. Which files are tests is the project's `testMatch` or `testRegex`,
 * read from the configuration Jest hands every transform, matched the way
 * Jest's own search matches them.
 */
function place(
  root: string,
  records: RecordWriter,
  path: string,
  id: ModuleId,
  options: JestTransformRequest,
  source: string,
  transformed: JestTransformedSource,
  mode: InstrumentMode,
  excluded: ReadonlySet<string>,
): JestTransformedSource {
  if (excluded.has(resolve(path)) || !defaultInclude(path) || isTestFile(path, options.config)) {
    return transformed;
  }
  // The digest is of the project's text, which is what the block lines are
  // coordinates in once the wrapped transformer's map is read back through —
  // and of the transformed text when there is no map to read back through, so
  // the digest never vouches for a number line it did not see.
  const { lineOf, sourceDigest, file: wrote } = recordedFrame(
    transformed.code,
    parsedMap(transformed),
    path,
    (at) => (at === path ? source : readFileSync(at, 'utf8')),
  );
  const file = projectPath(root, wrote);
  const done = instrument(transformed.code, file, id, { mode });
  const captured: CapturedModule = done === undefined
    ? { file, id, sourceDigest, instrumented: false, blocks: [] }
    : {
        file,
        id,
        sourceDigest,
        instrumented: true,
        blocks: done.blocks.map((block) => coverageBlock(transformed.code, block, lineOf)),
      };
  writeRecord(records, captured);
  // Every probe is placed on the line it reports, so the wrapped transformer's
  // map still names the right line of the project's source for a stack trace;
  // only columns have moved. An inline map rides along inside the text.
  return done === undefined
    ? transformed
    : { code: done.code, ...(transformed.map === undefined ? {} : { map: transformed.map }) };
}

/** What Jest hashes when a transformer declares no key of its own. */
function defaultKey(source: string, path: string, options: JestTransformRequest): string {
  return createHash('sha1')
    .update(source)
    .update('\0')
    .update(options.configString)
    .update('\0')
    .update(options.instrument ? 'instrument' : '')
    .update('\0')
    .update(path)
    .digest('hex');
}

const testMatchers = new Map<string, (path: string) => boolean>();

/**
 * Jest's own reading of `testMatch` and `testRegex`: a glob list where a path
 * must match one positive pattern and no negated one, dotfiles included, and a
 * regex list where any pattern decides.
 */
function isTestFile(path: string, config: JestProjectConfig): boolean {
  const globs = config.testMatch ?? [];
  const regexes = typeof config.testRegex === 'string' ? [config.testRegex] : config.testRegex ?? [];
  const identity = JSON.stringify([globs, regexes]);
  let matcher = testMatchers.get(identity);
  if (matcher === undefined) {
    const positive = globs.filter((glob) => !glob.startsWith('!')).map((glob) => picomatch(glob, { dot: true }));
    const negative = globs.filter((glob) => glob.startsWith('!')).map((glob) => picomatch(glob.slice(1), { dot: true }));
    const patterns = regexes.map((regex) => new RegExp(regex));
    matcher = (candidate) => {
      const slashed = candidate.replaceAll(/\\(?![$()+.?^{}])/g, '/');
      return (
        (positive.some((match) => match(slashed)) && !negative.some((match) => match(slashed))) ||
        patterns.some((pattern) => pattern.test(candidate))
      );
    };
    testMatchers.set(identity, matcher);
  }
  return matcher(path);
}

/**
 * The map the inner transformer returned, or the one it inlined: `@swc/jest`
 * appends its map to the text as a data URL rather than returning it.
 */
function parsedMap(transformed: JestTransformedSource): TransformSourceMap | undefined {
  const inline = transformed.map === undefined || transformed.map === null
    ? /\/\/# sourceMappingURL=data:application\/json[^,]*;base64,([A-Za-z0-9+/=]+)\s*$/.exec(transformed.code)?.[1]
    : undefined;
  const map = inline === undefined ? transformed.map : Buffer.from(inline, 'base64').toString('utf8');
  if (map === undefined || map === null) return undefined;
  const value = typeof map === 'string' ? (JSON.parse(map) as Partial<TransformSourceMap>) : map;
  return typeof value.mappings === 'string' && Array.isArray(value.sources)
    ? { mappings: value.mappings, sources: value.sources }
    : undefined;
}

/**
 * Load the wrapped transformer the way Jest would have: resolved from the
 * project, `import`ed when it is ES, and built by its `createTransformer`
 * factory when it has one. Jest's own default, `babel-jest`, is a dependency of
 * `jest-config` rather than of the project, and is found where Jest finds it.
 */
async function loadTransformer(
  root: string,
  named: string | readonly [string, Record<string, unknown>],
): Promise<JestTransformer> {
  const [name, config] = typeof named === 'string' ? [named, undefined] : named;
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
    if (candidate.createTransformer !== undefined) return candidate.createTransformer(config);
    if (typeof candidate.process === 'function' || typeof candidate.processAsync === 'function') {
      return candidate as JestTransformer;
    }
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
