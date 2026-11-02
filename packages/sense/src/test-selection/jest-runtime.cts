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
import moduleIds = require('./module-id.cjs');
import type { ModuleId } from '../instrument/index.js';
import type { JourneyTrace } from './journey.js';

/** Where the sandbox finds the trace; mirrors `TRACE` in `collectors.cts`. */
const TRACE = Symbol.for('variance-authority.test-selection.trace');

/** The key the Jest wrappers put this runtime's options under in `testEnvironmentOptions`. */
const OPTIONS = 'varianceAuthority';

interface Options {
  /** The checkout environment inputs are named against. */
  readonly root: string;
  /** The runtime the project configured, resolved to a file; Jest's own when absent. */
  readonly runtime?: string;
  /** The module whose export is the application's {@link JourneyTrace}. */
  readonly trace?: string;
}

type Environment = { constructor: unknown; global: { __VA__?: unknown; [key: symbol]: unknown } };
interface ProjectConfig {
  readonly rootDir: string;
  readonly testEnvironment: string;
  readonly testEnvironmentOptions: { readonly [OPTIONS]?: Options };
}
type RuntimeClass = new (config: ProjectConfig, environment: Environment, ...rest: unknown[]) => object;
type Mark = (root: string, file: string) => ModuleId | undefined;

const load = (file: string): unknown => {
  const loaded = nodeModule.createRequire(file)(file) as { default?: unknown };
  return loaded.default ?? loaded;
};

/** Jest's `interopRequireDefault(…).default`, the way it reads an environment or a runtime module. */
const interop = (loaded: unknown): unknown =>
  (loaded as { __esModule?: boolean } | null)?.__esModule === true ? (loaded as { default: unknown }).default : loaded;

const INPUTS = Symbol.for('variance-authority.test-selection.environment');
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

const installed = (file: string): boolean => /[\\/]node_modules[\\/]/u.test(file);

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

/** The jest-runner that required this runtime, which resolves the way Jest just resolved. */
function runner(): NodeJS.Require {
  const parent = Object.values(require.cache).find((cached) => cached?.children.includes(module) && /[\\/]jest-runner[\\/]/u.test(cached.filename));
  if (parent === undefined) throw new Error('variance-authority: the Jest runtime was not required by jest-runner');
  return nodeModule.createRequire(parent.filename);
}

/**
 * The environment module Jest loaded for this test file, by Jest's own steps:
 * the docblock's `@jest-environment` through `resolveTestEnvironment`, the
 * project's `testEnvironment` otherwise.
 */
function environmentOf(jest: NodeJS.Require, config: ProjectConfig, source: string, environment: Environment): NodeJS.Module {
  const docblock = jest('jest-docblock') as { parse(text: string): Record<string, unknown>; extract(text: string): string };
  const named = docblock.parse(docblock.extract(source))['jest-environment'];
  const file = typeof named === 'string'
    ? (jest('jest-resolve') as { resolveTestEnvironment(options: object): string }).resolveTestEnvironment({
      ...config,
      requireResolveFunction: (name: string) => jest.resolve(name),
      testEnvironment: named,
    })
    : config.testEnvironment;
  const entry = require.cache[nodeModule.createRequire(file).resolve(file)];
  if (entry === undefined) unavailable(file);
  if (interop(entry.exports) !== environment.constructor) {
    throw new Error(`variance-authority: the environment Jest built for this test file is not the export of ${file}, where Jest resolves it`);
  }
  return entry;
}

/** The CommonJS modules the environment loaded, its entry included, even when a previous test already cached them. */
function inputs(entry: NodeJS.Module, root: string): ModuleId[] {
  const paths = new Set<string>();
  const pending = [entry];
  for (let at = 0; at < pending.length; at += 1) {
    const module = pending[at];
    if (module === undefined || paths.has(module.filename) || intrinsic(module.filename)) continue;
    if (nodeUtil.types.isModuleNamespaceObject(module.exports) && markOnce(root, module.filename) !== undefined) unavailable(module.filename);
    const native = [...nativeImports.get(module.filename) ?? []];
    const seenNative = new Set<string>();
    for (let next = 0; next < native.length; next += 1) {
      const target = native[next]!;
      if (seenNative.has(target)) continue;
      seenNative.add(target);
      if (markOnce(root, target) !== undefined) unavailable(target);
      native.push(...nativeImports.get(target) ?? []);
    }
    paths.add(module.filename);
    // A package's children include what it required for anybody: `jest-util`
    // requires every environment Jest loads. Below the entry, only the
    // checkout's own modules say what the environment imported.
    if (module === entry || !installed(module.filename)) pending.push(...module.children);
  }
  const known = new Map(collectors.attach(globalThis as { __VA__?: unknown }, false).registered()
    .map((id) => [path.resolve(root, moduleIds.pathOf(id)), moduleIds.marked(id)]));
  return [...paths].flatMap((file) => {
    const id = known.get(file) ?? markOnce(root, file);
    return id === undefined ? [] : [id];
  });
}

/** Construct the project's runtime, then hand its environment the inputs and the trace. */
function SelectionRuntime(config: ProjectConfig, environment: Environment, ...rest: unknown[]): object {
  const options = config.testEnvironmentOptions[OPTIONS];
  if (options === undefined) throw new Error('variance-authority: the Jest runtime is named without its options');
  const jest = runner();
  const Base = interop(options.runtime === undefined ? jest('jest-runtime') : require(options.runtime)) as RuntimeClass;
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
