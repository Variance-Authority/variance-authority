/**
 * How a module id reads: the repository-relative path, `@`, then the digest of
 * the text its probes were placed on, `~`-prefixed where the module was marked
 * as loaded rather than probed. A digest has no `@` in it, so the last one is
 * the separator.
 *
 * CommonJS for the reason `journal-format.cts` is: Jest's setup file reads ids
 * from inside the sandbox, untransformed.
 */

import type { ModuleId } from '../instrument/index.js';

/** The path, the mark and the digest an id names. */
const ID = /^(.+)@(~?)([0-9a-f]+)$/;

/** The repository-relative path an id names, or the whole id when it names no digest. */
function pathOf(id: ModuleId): string {
  return ID.exec(id)?.[1] ?? id;
}

export = { ID, pathOf };
