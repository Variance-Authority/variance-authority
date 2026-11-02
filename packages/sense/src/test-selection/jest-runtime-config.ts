/**
 * How a Jest configuration names the selection runtime: ours in `runtime`, and
 * the project's own, the run's root and the trace under `globals`, where the
 * runtime reads them in each worker.
 */

import { fileURLToPath } from 'node:url';
import type { JestConfig } from './jest.js';

/** Where our runtime reads its options; mirrors `OPTIONS` in `jest-runtime.cts`. */
const RUNTIME_GLOBAL = 'variance-authority.runtime';

/** The runtime that reads the environment Jest built for each test file, and constructs the project's own. */
export const SELECTION_RUNTIME = fileURLToPath(new URL('./jest-runtime.cjs', import.meta.url));

/**
 * Construct every test file's runtime through ours, which reads the
 * environment Jest built for that file — whatever chose it — and requires the
 * trace once per worker. The project's own `runtime`, or its preset's when it
 * names none, is carried as written: the worker resolves it as Jest does, with
 * the project's resolver, and ours constructs it.
 */
export function selecting(config: JestConfig, root: string, trace: string | undefined): JestConfig {
  const named = config['runtime'] as string | undefined;
  const carried = (config['globals'] as { [RUNTIME_GLOBAL]?: { runtime?: string; preset?: string } } | undefined)?.[RUNTIME_GLOBAL];
  const preset = config['preset'] as string | undefined;
  // A config wrapped before already names ours; the project's is the one that wrap carried.
  const own = named === SELECTION_RUNTIME
    ? { ...(carried?.runtime === undefined ? {} : { runtime: carried.runtime }), ...(carried?.preset === undefined ? {} : { preset: carried.preset }) }
    : named !== undefined ? { runtime: named } : preset !== undefined ? { preset } : {};
  return {
    ...config,
    runtime: SELECTION_RUNTIME,
    // `globals`, the one key Jest merges with a preset rather than replacing it.
    globals: {
      ...(config['globals'] as object | undefined),
      [RUNTIME_GLOBAL]: { root, ...own, ...(trace === undefined ? {} : { trace }) },
    },
  };
}
