/**
 * The sites `docs_uses` lists, and the order it lists them in: nearest to the
 * file the asker is in by shared leading path segments, then by path and line,
 * stories and tests apart from source.
 */

// compass: variance-authority.report.agent-surface

import { codeUnitOrder } from '@variance-authority/core/segment';
import { notShown } from '@variance-authority/mcp/tools';
import type { Use } from '@variance-authority/package/help';

/**
 * A site, how it names the module it imports when that is a file path, and
 * the name it takes when that is known.
 */
export type Site = Use & { readonly how?: string; readonly name?: string };

/** How many leading path segments two files share. */
export function sharedSegments(left: string, right: string): number {
  const a = left.split('/');
  const b = right.split('/');

  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared;
}

/** Sites of one kind shown when `limit` is not said: how many are worth naming before the list stops being read. */
export const SHOWN = 12;

/** `sites` nearest to `from` first when it is said, then by file and line. */
export function order(sites: readonly Site[], from: string | undefined): readonly Site[] {
  return [...sites].sort(
    (a, b) =>
      (from === undefined ? 0 : sharedSegments(from, b.at) - sharedSegments(from, a.at)) ||
      codeUnitOrder(a.at, b.at) ||
      a.line - b.line,
  );
}

/**
 * The first `limit` sites of `name` under `heading`, each marked with the name
 * its file knows it by when that is another: the one its import binds it to
 * with `as`, or else the one a re-export renamed it to.
 */
export function listed(sites: readonly Site[], heading: string, name: string, limit: number): readonly string[] {
  if (sites.length === 0) return [];

  const shown = sites.slice(0, limit);
  const rest = sites.length - shown.length;
  const renamed = (use: Site): string => {
    const known = use.local ?? use.name;
    return known === undefined || known === name ? '' : ` (as ${known})`;
  };
  return [
    '',
    heading,
    '',
    ...shown.map((use) => `${use.at}:${use.line} — ${use.by}${use.how ?? ''}${renamed(use)}${use.type ? ' (type only)' : ''}${held(use)}`),
    ...(rest > 0 ? [`… ${notShown(rest)}`] : []),
  ];
}

/** Where a name read off a module held whole was loaded, and when. */
function held(use: Use): string {
  if (use.through === undefined) return '';
  return use.through.kind === 'dynamic'
    ? ` (import() on line ${use.through.line})`
    : ` (namespace, line ${use.through.line})`;
}

/** The sites of a name, nearest first when `from` is said, stories and tests apart. */
export function kinds(sites: readonly Site[], from: string | undefined, name: string, limit: number): readonly string[] {
  const sorted = order(sites, from);
  return [
    ...listed(sorted.filter((use) => use.kind === 'story'), 'Stories:', name, limit),
    ...listed(sorted.filter((use) => use.kind === 'test'), 'Tests:', name, limit),
    ...listed(sorted.filter((use) => use.kind === 'source'), 'Source:', name, limit),
  ];
}
