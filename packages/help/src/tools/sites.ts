/**
 * The sites `docs_uses` lists, and the order it lists them in: nearest to the
 * file the asker is in by shared leading path segments, then by path and line,
 * stories and tests apart from source.
 */

// compass: variance-authority.report.agent-surface

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Spelling } from '@variance-authority/mcp/tools';
import { notShown } from '@variance-authority/mcp/tools';
import type { Use } from '@variance-authority/package/help';
import { sharedSegments } from './shared-segments.js';
import type { Site } from './uses-of.js';

/** Sites of one kind shown when `limit` is not said: how many are worth naming before the list stops being read. */
export const SHOWN = 12;

/** How many sites of each kind are shown, and how the answer names what to ask next. */
export interface Shown {
  readonly limit: number;
  readonly spell: Spelling;
}

/** How the sites are ordered, said once above them. */
export function nearestLine(from: string | undefined, spell: Spelling): string {
  return from === undefined ? `Path order; \`${spell.input('from')}\` sorts nearest first.` : `Nearest to ${from} first.`;
}

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
export function listed(sites: readonly Site[], heading: string, name: string, shown: Shown): readonly string[] {
  if (sites.length === 0) return [];

  const cut = sites.slice(0, shown.limit);
  const rest = sites.length - cut.length;
  const renamed = (use: Site): string => {
    const known = use.local ?? use.name;
    return known === undefined || known === name ? '' : ` (as ${known})`;
  };
  return [
    '',
    heading,
    '',
    ...cut.map((use) => `${use.at}:${use.line} — ${use.by}${use.how ?? ''}${renamed(use)}${use.type ? ' (type only)' : ''}${held(use)}`),
    ...(rest > 0 ? [`… ${notShown(rest, shown.spell)}`] : []),
  ];
}

/**
 * Where a name read off a module held whole was loaded, and when; whether it
 * was read off the module's `default`; and whether the module went on, whole,
 * where this reading does not follow it, so the line may read the name.
 */
function held(use: Use): string {
  if (use.through === undefined) return '';
  const loaded = use.through.kind === 'dynamic' ? `import() on line ${use.through.line}` : `namespace, line ${use.through.line}`;
  const off = use.through.throughDefault === true ? ', through `default`: may read it' : '';
  const whole = use.through.whole === true ? ', passed on whole: may read it' : '';
  return ` (${loaded}${off}${whole})`;
}

/** The sites of a name, nearest first when `from` is said, stories and tests apart. */
export function kinds(sites: readonly Site[], from: string | undefined, name: string, shown: Shown): readonly string[] {
  const sorted = order(sites, from);
  return [
    ...listed(sorted.filter((use) => use.kind === 'story'), 'Stories:', name, shown),
    ...listed(sorted.filter((use) => use.kind === 'test'), 'Tests:', name, shown),
    ...listed(sorted.filter((use) => use.kind === 'source'), 'Source:', name, shown),
  ];
}
