/** Where the packages Jest itself depends on are, for the code that reads them outside Jest. */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/** The packages a dependency of Jest is reached through, from the outside in. */
const JEST_CHAIN = ['jest', '@jest/core', 'jest-config'] as const;

/**
 * Where a package Jest depends on is. Jest resolves it from `jest-config`, not
 * from the project: under pnpm or any layout that does not hoist it, the project
 * cannot resolve it. So it is looked for from the project, then from each
 * package on Jest's path to it.
 */
export function jestDependency(rootDir: string, name: string): string {
  let from = resolve(rootDir, 'package.json');
  for (const next of [...JEST_CHAIN, undefined]) {
    const require = createRequire(from);
    try {
      return require.resolve(name);
    } catch (error) {
      if (next === undefined) throw error;
      try {
        from = require.resolve(next);
      } catch {
        throw error;
      }
    }
  }
  throw new Error(`unreachable: ${name}`);
}
