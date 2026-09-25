/**
 * How each file uses each file it imports, read back from the index that
 * recorded the edge.
 *
 * Nothing new is stored for it. A record keeps one resolved target per request
 * of its parse, in the parse's own order, and the parse keeps what each request
 * binds and what the file republishes. Joining the two by position names the
 * imports on every edge. The join runs per importer, once, and only for the
 * importers a narrowed walk actually reaches. A column of names on every edge
 * would copy what the parse already holds into every generation of the index.
 *
 * Two readings the stored parse cannot tell apart are charged whole:
 *
 * - an `import './x'` binds nothing, and a `require('./x')` is stored the same
 *   way, because what a `require` binds is a destructuring the module record
 *   never saw. So an import that binds nothing is a use of the whole module.
 * - `export { a } from './x'` beside `export * from './x'` is one request whose
 *   bindings name `a` alone. So the republished names are read from the parse's
 *   exports, which keep the star, and never from the request's bindings.
 */

// compass: variance-authority.reach.source-index

import type { EdgeUse, Uses } from '@variance-authority/core/relate';
import type { ParseCache } from './cache.js';
import { keyFor, parseWay } from './files.js';
import { NAMESPACE_NAME, type Request } from './read.js';
import type { IndexedRecord } from './source-index-format.js';

/** One importer's uses, by target; `undefined` for an importer nothing can be read for. */
type ByTarget = ReadonlyMap<string, EdgeUse> | undefined;

/** The lookup a narrowed walk asks, over the records and parses of one index. */
export function usesOf(records: ReadonlyMap<string, IndexedRecord>, cache: ParseCache): Uses {
  const read = new Map<string, ByTarget>();
  return (importer, target) => {
    let uses = read.get(importer);
    if (!read.has(importer)) {
      uses = usesByTarget(importer, records.get(importer), cache);
      read.set(importer, uses);
    }
    return uses?.get(target);
  };
}

function usesByTarget(file: string, held: IndexedRecord | undefined, cache: ParseCache): ByTarget {
  const digest = held?.record.digest;
  const targets = held?.targets;
  if (digest === undefined || targets === undefined) return undefined;
  const parsed = cache.get(keyFor(digest, parseWay(file)));
  if (parsed === undefined || parsed.requests.length !== targets.length) return undefined;

  // `null` is a use of the whole module.
  const imports = new Map<string, Set<string> | null>();
  const republishing = new Map<string, string>();
  for (const [at, request] of parsed.requests.entries()) {
    const target = targets[at];
    if (target === undefined) continue;
    if (request.kind === 'reexports') republishing.set(request.value, target);
    if (request.kind === 'imports') imports.set(target, joined(imports.get(target), request));
  }

  // Absent when the parse never recorded what the file publishes, which reads
  // as whole: absent is not empty.
  const reexports = parsed.exports === undefined ? undefined : new Map<string, [string, string][]>();
  for (const published of parsed.exports ?? []) {
    const target = published.from === undefined ? undefined : republishing.get(published.from);
    if (target === undefined || published.type) continue;
    const passes = reexports!.get(target) ?? [];
    passes.push([published.imported ?? NAMESPACE_NAME, published.exported ?? NAMESPACE_NAME]);
    reexports!.set(target, passes);
  }

  const uses = new Map<string, EdgeUse>();
  for (const target of new Set([...imports.keys(), ...republishing.values()])) {
    const named = imports.get(target);
    // A target republished only as types passes nothing a test can run.
    const passes = reexports === undefined ? undefined : (reexports.get(target) ?? []);
    uses.set(target, {
      ...(named === undefined || named === null ? {} : { imports: [...named] }),
      ...(passes === undefined ? {} : { reexports: passes }),
    });
  }
  return uses;
}

/** A request's names joined onto what the same target already binds. */
function joined(held: Set<string> | null | undefined, request: Request): Set<string> | null {
  if (held === null) return null;
  if (request.bindings.length === 0 || request.bindings.some((binding) => binding.imported === NAMESPACE_NAME)) {
    return null;
  }
  const names = held ?? new Set<string>();
  for (const binding of request.bindings) names.add(binding.imported);
  return names;
}
