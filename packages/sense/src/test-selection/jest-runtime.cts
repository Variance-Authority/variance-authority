/**
 * The runtime Jest constructs for every test file, handed the environment Jest
 * built for it — the project's `testEnvironment` or the file's
 * `@jest-environment` — which a configuration rewritten before Jest starts can
 * only guess. It constructs the project's own runtime, `jest-runtime` when it
 * names none, with the same arguments and returns that, so Jest talks to
 * nothing of ours.
 *
 * Here the environment's module, found by Jest's own steps and checked against
 * the class Jest built, gives the test file its inputs; and the trace is
 * required in the worker's realm, once for the worker's life, because an SDK
 * hooks `fetch` for the whole process (see `trace` in `jest.ts`). The worker's
 * collector root is installed earlier, by `preload`, when Jest loads the
 * transformer, before any environment.
 */

import nodeFs = require('node:fs');
import nodeModule = require('node:module');
import nodeUrl = require('node:url');
import nodeUtil = require('node:util');
import path = require('node:path');
import collectors = require('./collectors.cjs');
import presets = require('./jest-preset-file.cjs');
import moduleIds = require('./module-id.cjs');
import type { ModuleId } from '../instrument/index.js';
import type { FindNodeModule } from './jest-config-paths.js';
import type { JourneyTrace } from './journey.js';

/** Where the sandbox finds the trace; mirrors `TRACE` in `collectors.cts`. */
const TRACE = Symbol.for('variance-authority.test-selection.trace');

/** The key the Jest wrappers put this runtime's options under in `globals`, which Jest merges with a preset. */
const OPTIONS = 'variance-authority.runtime';

interface Options {
  /** The checkout environment inputs are named against. */
  readonly root: string;
  /** The runtime the project configured, as written; its preset's, or Jest's own, when absent. */
  readonly runtime?: string;
  /** The project's preset, as written, read for its runtime when the project names none. */
  readonly preset?: string;
  /** The module whose export is the application's {@link JourneyTrace}. */
  readonly trace?: string;
}

type Environment = { constructor: unknown; global: { __VA__?: unknown; [key: symbol]: unknown } };
interface ProjectConfig {
  readonly rootDir: string;
  readonly testEnvironment: string;
  readonly resolver?: string | null;
  readonly globals: { readonly [OPTIONS]?: Options };
}
type RuntimeClass = new (config: ProjectConfig, environment: Environment, ...rest: unknown[]) => object;
type Mark = (root: string, file: string) => ModuleId | undefined;
/**
 * A value of `require.cache`. A JSON file reached through `import` sits there as
 * `{ exports, loaded }`, with no `children` and no `filename`, and a module that
 * then requires the file holds that value among its `children`.
 */
interface Cached {
  readonly exports: unknown;
  readonly filename?: string;
  readonly children?: readonly Cached[];
}

const load = (file: string): unknown => {
  const loaded = nodeModule.createRequire(file)(file) as { default?: unknown };
  return loaded.default ?? loaded;
};

const { interop, readPreset, rooted } = presets;

const INPUTS = Symbol.for('variance-authority.test-selection.environment');
const cache: NodeJS.Dict<Cached> = require.cache;
const RUNTIME = path.resolve(__dirname, '..') + path.sep;
const nativeImports = new Map<string, Set<string>>();
const marked = new Map<string, ModuleId | undefined>();
let mark: Mark | undefined;

/** Native imports do not appear in CommonJS children, even when their importer does. */
function observeNativeImports(): void {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (context.conditions.includes('import') && context.parentURL?.startsWith('file:') && resolved.url.startsWith('file:')) {
        const parent = nodeUrl.fileURLToPath(context.parentURL);
        const target = nodeUrl.fileURLToPath(resolved.url);
        if (!intrinsic(target)) {
          const imports = nativeImports.get(parent) ?? new Set<string>();
          imports.add(target);
          nativeImports.set(parent, imports);
        }
      }
      return resolved;
    },
  });
}

/** The recording bootstrap is not a product environment input. */
function intrinsic(file: string): boolean {
  return file.startsWith(RUNTIME);
}

function unavailable(file: string): never {
  throw new Error(`variance-authority cannot read the dependency registry of environment input ${file}; native ES module inputs are not observable through the CommonJS registry`);
}

/** Opaque source identity, frozen the first time this worker reads a file. */
function markOnce(root: string, file: string): ModuleId | undefined {
  if (mark === undefined) throw new Error('variance-authority: the Jest runtime ran before its transformer was loaded');
  if (!marked.has(file)) marked.set(file, mark(root, file));
  return marked.get(file);
}

/** The cached modules that required `child`. */
function requirers(child: Cached): Cached[] {
  return Object.values(cache).filter((cached) => cached?.children?.includes(child)) as Cached[];
}

/** The jest-runner that required this runtime, which resolves the way Jest just resolved. */
let jestRunner: NodeJS.Require | undefined;
function runner(): NodeJS.Require {
  if (jestRunner !== undefined) return jestRunner;
  const parent = requirers(module).map(({ filename }) => filename).find((file) => file !== undefined && /[\\/]jest-runner[\\/]/u.test(file));
  if (parent === undefined) throw new Error('variance-authority: the Jest runtime was not required by jest-runner');
  jestRunner = nodeModule.createRequire(parent);
  return jestRunner;
}

/**
 * The environment module Jest loaded for this test file, by Jest's own steps:
 * the docblock's `@jest-environment` through `resolveTestEnvironment`, the
 * project's `testEnvironment` otherwise.
 */
function environmentOf(jest: NodeJS.Require, config: ProjectConfig, source: string, environment: Environment): Cached {
  const docblock = jest('jest-docblock') as { parse(text: string): Record<string, unknown>; extract(text: string): string };
  const named = docblock.parse(docblock.extract(source))['jest-environment'];
  // An empty pragma is Jest's falsy: the project's environment.
  const file = typeof named === 'string' && named !== ''
    ? (jest('jest-resolve') as { resolveTestEnvironment(options: object): string }).resolveTestEnvironment({
      ...config,
      requireResolveFunction: (name: string) => jest.resolve(name),
      testEnvironment: named,
    })
    : config.testEnvironment;
  const entry = cache[nodeModule.createRequire(file).resolve(file)];
  if (entry === undefined) unavailable(file);
  if (interop(entry.exports) !== environment.constructor) {
    throw new Error(`variance-authority: the environment Jest built for this test file is not the export of ${file}, where Jest resolves it`);
  }
  return entry;
}

/** The CommonJS modules the environment loaded, its entry included, even when a previous test already cached them. */
function inputs(entry: Cached, root: string): ModuleId[] {
  const paths = new Set<string>();
  // What required the environment — Jest's loader — required every other one for
  // Jest too: its children are not this environment's inputs.
  const loaders = new Set(requirers(entry));
  const pending = [entry];
  for (let at = 0; at < pending.length; at += 1) {
    const module = pending[at]!;
    // Only a value `import` left has no filename, and its key in the cache is its path.
    const file = module.filename ?? Object.keys(cache).find((key) => cache[key] === module);
    if (file === undefined) {
      throw new Error(`variance-authority cannot name every input of environment ${entry.filename}: ${entry.filename} requires a file that left require.cache after an import cached it. Keep that file in require.cache.`);
    }
    if (paths.has(file) || intrinsic(file) || loaders.has(module)) continue;
    if (nodeUtil.types.isModuleNamespaceObject(module.exports) && markOnce(root, file) !== undefined) unavailable(file);
    const native = [...nativeImports.get(file) ?? []];
    const seenNative = new Set<string>();
    for (let next = 0; next < native.length; next += 1) {
      const target = native[next]!;
      if (seenNative.has(target)) continue;
      seenNative.add(target);
      if (markOnce(root, target) !== undefined) unavailable(target);
      native.push(...nativeImports.get(target) ?? []);
    }
    paths.add(file);
    pending.push(...module.children ?? []);
  }
  const known = new Map(collectors.attach(globalThis as { __VA__?: unknown }, false).registered()
    .map((id) => [path.resolve(root, moduleIds.pathOf(id)), moduleIds.marked(id)]));
  return [...paths].flatMap((file) => {
    const id = known.get(file) ?? markOnce(root, file);
    return id === undefined ? [] : [id];
  });
}

/**
 * The file of the project's own runtime, by jest-config's steps: the preset
 * found as `setupPreset` finds it, its `runtime` overridden by the project's,
 * and that name resolved as `normalize` resolves `runtime`, through the
 * project's resolver.
 */
function projectRuntime(jest: NodeJS.Require, config: ProjectConfig, options: Options): string | undefined {
  const find = (jest('jest-resolve') as { default: { findNodeModule: FindNodeModule } }).default.findNodeModule;
  let name = options.runtime;
  if (name === undefined && options.preset !== undefined) {
    const preset = readPreset(find, require, config.rootDir, options.preset);
    // Jest read this preset before it started: a miss here is a moved file.
    if (preset === null) throw new Error(`variance-authority: preset ${options.preset} is not found from ${config.rootDir}`);
    name = preset.runtime;
  }
  if (name === undefined) return undefined;
  const file = find(rooted(config.rootDir, name), { basedir: config.rootDir, ...(config.resolver ? { resolver: config.resolver } : {}) });
  if (file === null) throw new Error(`Module ${name} in the runtime option was not found. <rootDir> is: ${config.rootDir}`);
  return file;
}

/** Construct the project's runtime, then hand its environment the inputs and the trace. */
function SelectionRuntime(config: ProjectConfig, environment: Environment, ...rest: unknown[]): object {
  const options = config.globals[OPTIONS];
  if (options === undefined) throw new Error('variance-authority: the Jest runtime is named without its options');
  const jest = runner();
  const own = projectRuntime(jest, config, options);
  const Base = interop(own === undefined ? jest('jest-runtime') : require(own)) as RuntimeClass;
  const runtime = new Base(config, environment, ...rest);
  // Jest's arguments after the environment: resolver, transformer, cacheFS, coverage options, test path.
  const [, , cacheFS, , testPath] = rest as [unknown, unknown, Map<string, string>, unknown, string];
  const source = cacheFS.get(testPath) ?? nodeFs.readFileSync(testPath, 'utf8');
  const entry = environmentOf(jest, config, source, environment);
  const capture = () => inputs(entry, options.root);
  capture(); // Freeze opaque source identities before the test can edit them.
  environment.global[INPUTS] = capture;
  if (options.trace === undefined) return runtime;
  const trace = load(options.trace) as Partial<JourneyTrace> | null;
  if (typeof trace?.carry !== 'function' || typeof trace.current !== 'function') {
    throw new Error(
      `${options.trace} exports no trace: end it with \`module.exports = sentry(Sentry)\` or ` +
      '`module.exports = openTelemetry(api)`, both from @variance-authority/sense/case-journey',
    );
  }
  environment.global[TRACE] = trace;
  return runtime;
}

let preloaded = false;

/**
 * Install the worker's root before Jest evaluates any environment, and keep
 * the reader that marks an environment input by its source.
 */
SelectionRuntime.preload = (reader: Mark): void => {
  mark = reader;
  if (preloaded) return;
  preloaded = true;
  observeNativeImports();
  const root = collectors.attach(globalThis as { __VA__?: unknown }, false).root;
  Object.defineProperty(root, Symbol.for('variance-authority.test-selection.host'), { value: globalThis, configurable: true });
};

export = SelectionRuntime;
