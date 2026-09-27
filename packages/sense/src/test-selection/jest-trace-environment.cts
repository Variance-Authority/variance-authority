/**
 * The Jest environment `withJourneyCoverage` names when it is given a `trace`.
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

import nodeModule = require('node:module');
import type { JourneyTrace } from './journey.js';

/** Where the sandbox finds the trace; mirrors `TRACE` in `collectors.cts`. */
const TRACE = Symbol.for('variance-authority.test-selection.trace');

/** The key `withJourneyCoverage` puts its two paths under in `testEnvironmentOptions`. */
const OPTIONS = 'varianceAuthority';

interface Options {
  /** The environment the project configured, resolved to a file. */
  readonly environment: string;
  /** The module whose export is the application's {@link JourneyTrace}. */
  readonly trace: string;
}

type Environment = { global: { [key: symbol]: unknown } };
type EnvironmentClass = new (config: unknown, context: unknown) => Environment;
interface EnvironmentConfig {
  readonly projectConfig: { readonly testEnvironmentOptions: { readonly [OPTIONS]?: Options } };
}

const load = (file: string): unknown => {
  const loaded = nodeModule.createRequire(file)(file) as { default?: unknown };
  return loaded.default ?? loaded;
};

class TraceEnvironment {
  constructor(config: EnvironmentConfig, context: unknown) {
    const options = config.projectConfig.testEnvironmentOptions[OPTIONS];
    if (options === undefined) {
      throw new Error(`${__filename} is named by withJourneyCoverage, which passes it the environment and trace it wraps`);
    }
    const Base = load(options.environment) as EnvironmentClass;
    const environment = new Base(config, context);
    const trace = load(options.trace) as Partial<JourneyTrace> | null;
    if (typeof trace?.carry !== 'function' || typeof trace.current !== 'function') {
      throw new Error(
        `${options.trace} exports no trace: end it with \`module.exports = sentry(Sentry)\` or ` +
          '`module.exports = openTelemetry(api)`, both from @variance-authority/sense/case-journey',
      );
    }
    environment.global[TRACE] = trace;
    // A constructor that returns an object is that object: Jest drives the
    // project's environment and never sees this class.
    return environment as unknown as TraceEnvironment;
  }
}

export = TraceEnvironment;
