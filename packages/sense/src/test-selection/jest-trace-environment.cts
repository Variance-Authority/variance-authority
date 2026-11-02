/**
 * The host bridge loaded by the cached entry for a configured Jest environment.
 *
 * Its root is installed before the environment loads. The environment still
 * owns its sandbox; that sandbox receives opaque marks for the host dependency
 * subtree, while modules evaluated inside the sandbox keep their own probes.
 *
 * The application's tracing has to be initialized once per process. Sentry and
 * OpenTelemetry both hook `fetch` through Node's diagnostics channels, which
 * belong to the process and not to a realm, so an SDK initialized in a setup
 * file — once per test file, inside that file's sandbox — keeps the first
 * file's hooks subscribed after that file is done. The next file in the same
 * worker sends the first file's trace, and its cases' work beyond the fence is
 * charged to nobody. Jest runs files in one worker whenever its timings say
 * so, so this is an ordinary second run and not an edge.
 *
 * So the trace module is required here, in the worker's own realm, where
 * `require` caches it for the worker's life: initialized once, whatever runs
 * after. Each file's sandbox is handed the same instance, and the case scope
 * runs every case inside it.
 *
 * The environment the project configured still runs. This constructs it and
 * returns it, so Jest talks to it and to nothing of ours.
 *
 * FIXME: a file that names its own environment in a `@jest-environment`
 * docblock is constructed without this, and its cases run under no trace.
 */

import nodeFs = require('node:fs');
import nodeModule = require('node:module');
import nodeUrl = require('node:url');
import nodeUtil = require('node:util');
// FIXME: Jest's colour in `sense`; see `jest-setup.cts`.
import jestUtil = require('jest-util');
import path = require('node:path');
import collectors = require('./collectors.cjs');
import moduleIds = require('./module-id.cjs');
import type { ModuleId } from '../instrument/index.js';
import type { JourneyTrace } from './journey.js';

/** Where the sandbox finds the trace; mirrors `TRACE` in `collectors.cts`. */
const TRACE = Symbol.for('variance-authority.test-selection.trace');

/** The key `withJourneyCoverage` puts its two paths under in `testEnvironmentOptions`. */
const OPTIONS = 'varianceAuthority';

interface Options {
  /** The environment the project configured, resolved to a file. */
  readonly environment: string;
  /** The module whose export is the application's {@link JourneyTrace}. */
  readonly trace?: string;
}

type Environment = { global: { __VA__?: unknown; [key: symbol]: unknown } };
type EnvironmentClass = new (config: EnvironmentConfig, context: unknown) => Environment;
interface EnvironmentConfig {
  readonly projectConfig: { readonly testEnvironmentOptions: { readonly [OPTIONS]?: Options } };
}

const load = (file: string): unknown => {
  const loaded = nodeModule.createRequire(file)(file) as { default?: unknown };
  return loaded.default ?? loaded;
};

const INPUTS = Symbol.for('variance-authority.test-selection.environment');
const RUNTIME = path.resolve(__dirname, '..') + path.sep;
const caches = new Set<string>();
const nativeImports = new Map<string, Set<string>>();
let observing = false;

/** Native imports do not appear in CommonJS children, even when their importer does. */
function observeNativeImports(cache: string): void {
  caches.add(nodeFs.realpathSync(cache) + path.sep);
  if (observing) return;
  observing = true;
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

/** The recording bootstrap and its generated entries are not product environment inputs. */
function intrinsic(file: string): boolean {
  return file.startsWith(RUNTIME) || [...caches].some((cache) => file.startsWith(cache));
}

function unavailable(file: string): never {
  throw new Error(`variance-authority cannot read the dependency registry of environment input ${file}; native ES module inputs are not observable through the CommonJS registry`);
}

/** The actual CommonJS dependency subtree, including modules a previous test already cached. */
function inputs(file: string, root: string, mark: (file: string) => ModuleId | undefined): ModuleId[] {
  const entry = nodeModule.createRequire(file).resolve(file);
  if (require.cache[entry] === undefined) {
    unavailable(file);
  }
  const paths = new Set<string>();
  const pending = [require.cache[entry]];
  for (let at = 0; at < pending.length; at += 1) {
    const module = pending[at];
    if (module === undefined || paths.has(module.filename) || intrinsic(module.filename)) continue;
    if (nodeUtil.types.isModuleNamespaceObject(module.exports) && mark(module.filename) !== undefined) unavailable(module.filename);
    const native = [...nativeImports.get(module.filename) ?? []];
    const seenNative = new Set<string>();
    for (let next = 0; next < native.length; next += 1) {
      const target = native[next]!;
      if (seenNative.has(target)) continue;
      seenNative.add(target);
      if (mark(target) !== undefined) unavailable(target);
      native.push(...nativeImports.get(target) ?? []);
    }
    paths.add(module.filename);
    pending.push(...module.children);
  }
  paths.delete(entry); // The configured entry is already a precondition of the project.
  const known = new Map(collectors.attach(globalThis as { __VA__?: unknown }, false).registered()
    .map((id) => [path.resolve(root, moduleIds.pathOf(id)), moduleIds.marked(id)]));
  return [...paths].flatMap((file) => {
    const id = known.get(file) ?? mark(file);
    return id === undefined ? [] : [id];
  });
}

class TraceEnvironment {
  /** Install the worker's root before Jest evaluates any environment dependency. */
  static preload(cache: string): void {
    observeNativeImports(cache);
    const root = collectors.attach(globalThis as { __VA__?: unknown }, false).root;
    Object.defineProperty(root, Symbol.for('variance-authority.test-selection.host'), { value: globalThis, configurable: true });
  }

  /** Load with Jest's own CommonJS/ESM interop while its transpilation hook is active. */
  static load(file: string): Promise<unknown> {
    return jestUtil.requireOrImportModule(file);
  }

  /** Keep the original constructor and methods; expose its host inputs to its sandbox. */
  static wrap(Base: EnvironmentClass, file: string, root: string, mark: (file: string) => ModuleId | undefined): EnvironmentClass {
    const marked = new Map<string, ModuleId | undefined>();
    const markOnce = (file: string): ModuleId | undefined => {
      if (!marked.has(file)) marked.set(file, mark(file));
      return marked.get(file);
    };
    return class extends Base {
      constructor(config: EnvironmentConfig, context: unknown) {
        super(config, context);
        const capture = () => inputs(file, root, markOnce);
        capture(); // Freeze opaque source identities before the test can edit them.
        this.global[INPUTS] = capture;
        const traceFile = config.projectConfig.testEnvironmentOptions[OPTIONS]?.trace;
        if (traceFile === undefined) return;
        const trace = load(traceFile) as Partial<JourneyTrace> | null;
        if (typeof trace?.carry !== 'function' || typeof trace.current !== 'function') {
          throw new Error(
            `${traceFile} exports no trace: end it with \`module.exports = sentry(Sentry)\` or ` +
            '`module.exports = openTelemetry(api)`, both from @variance-authority/sense/case-journey',
          );
        }
        this.global[TRACE] = trace;
      }
    };
  }
}

export = TraceEnvironment;
