/**
 * How a Jest configuration names the selection runtime: ours in `runtime`, and
 * the project's own, the run's root and the trace under `globals`, where the
 * runtime reads them in each worker.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredPath } from './jest-config-paths.js';
import type { JestConfig } from './jest.js';

/** Where our runtime reads its options; mirrors `OPTIONS` in `jest-runtime.cts`. */
const RUNTIME_GLOBAL = 'variance-authority.runtime';

/** The runtime that reads the environment Jest built for each test file, and constructs the project's own. */
export const SELECTION_RUNTIME = fileURLToPath(new URL('./jest-runtime.cjs', import.meta.url));

/**
 * Construct every test file's runtime through ours, which reads the
 * environment Jest built for that file — whatever chose it — and requires the
 * trace once per worker. The project's own `runtime` is resolved here as Jest
 * resolves it and constructed by ours.
 */
export function selecting(config: JestConfig, root: string, rootDir: string, trace: string | undefined): JestConfig {
  const named = config['runtime'] as string | undefined;
  const carried = (config['globals'] as { [RUNTIME_GLOBAL]?: { runtime?: string } } | undefined)?.[RUNTIME_GLOBAL];
  // A config wrapped before already names ours; the project's is the one that wrap carried.
  const runtime = named === undefined
    ? undefined
    : named === SELECTION_RUNTIME
      ? carried?.runtime
      : configuredPath(named, rootDir)[0] ?? createRequire(resolve(rootDir, 'package.json')).resolve(named);
  return {
    ...config,
    runtime: SELECTION_RUNTIME,
    // `globals`, the one key Jest merges with a preset rather than replacing it.
    globals: {
      ...(config['globals'] as object | undefined),
      [RUNTIME_GLOBAL]: {
        root,
        ...(runtime === undefined ? {} : { runtime }),
        ...(trace === undefined ? {} : { trace }),
      },
    },
  };
}
