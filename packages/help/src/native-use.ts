/**
 * A use as the addon hands it over, read into the Help value's shape.
 *
 * Its own module because both the index publisher and the tools read uses this
 * way, and a tool that imported the publisher would load the whole refresh
 * path, `read.ts` included, with it.
 */

// compass: variance-authority.report.agent-surface

import type { readHelp } from '@variance-authority/sense';
import type { Use } from '@variance-authority/package/help';

export type NativeUsage = ReturnType<NonNullable<Awaited<ReturnType<typeof readHelp>>>['usage']>;
type NativeUse = NativeUsage['names'][number];

/** A use as the addon hands it over: `through` flattened, and `null` for absent. */
export function useOf(use: NativeUse): Use {
  return {
    by: use.by, at: use.at, line: use.line, type: use.type, kind: use.kind,
    ...(use.local === undefined || use.local === null ? {} : { local: use.local }),
    ...(use.through === undefined || use.through === null ? {} : {
      through: { kind: use.through, line: use.throughLine, ...(use.throughDefault ? { throughDefault: true } : {}), ...(use.whole ? { whole: true } : {}) },
    }),
  };
}
