import type { Deep, Help, Taken } from '@variance-authority/package/help';
import { requested } from '@variance-authority/package/help';

/**
 * Names imported by the path of a file, rather than through an entry a
 * manifest declares.
 *
 * Two kinds, and they read differently. An import past the entry a package
 * declares is deep: the package says what it opens and the importer names a
 * file behind it. A package that declares no entry has nothing to be past, so
 * every import of it names a file and none of them is deep. Both are the only
 * record of what is used, so both answer `uses` and `symbol`; the words say
 * which kind each site is.
 */

/** One name one import takes by path. */
export interface PathSite {
  readonly held: Deep;
  readonly taken: Taken;
  /** Whether the package declares an entry, which makes this a deep import. */
  readonly deep: boolean;
  /** The package the specifier names. */
  readonly owner: string;
}

/** The package a specifier names. */
export function ownerOf(specifier: string): string {
  const key = requested(specifier);
  return key.slice(0, key.indexOf(' '));
}

/** Every import by path, deep ones first, narrowed to a package or a specifier when one is given. */
export function importsByPath(help: Help, within?: string): readonly (readonly [Deep, boolean])[] {
  const all = [
    ...help.deep.map((held) => [held, true] as const),
    ...help.byPath.map((held) => [held, false] as const),
  ];
  return within === undefined
    ? all
    : all.filter(([held]) => ownerOf(held.specifier) === within || held.specifier === within);
}

/** Every place `name` is taken by path. */
export function sitesByPath(help: Help, name: string, within?: string): readonly PathSite[] {
  const sites: PathSite[] = [];
  for (const [held, deep] of importsByPath(help, within)) {
    for (const taken of held.names) {
      if (taken.name === name) sites.push({ held, taken, deep, owner: ownerOf(held.specifier) });
    }
  }
  return sites;
}

/** How a site names what it imports, as a suffix to `<by>`. */
export function how(site: Pick<PathSite, 'held' | 'deep'>): string {
  return site.deep ? `, deep import of ${site.held.specifier}` : `, by path from ${site.held.specifier}`;
}

/**
 * What other packages import from a package that declares no entry: one line
 * per name each import takes, and the counts a heading states. A package's own
 * imports of itself are not its surface, and are left out.
 */
export function surfaceByPath(help: Help, owner: string): {
  readonly names: number;
  readonly files: number;
  readonly lines: readonly string[];
} {
  const pairs = new Set<string>();
  const files = new Set<string>();
  const rows: (readonly [string, string, string, number, string])[] = [];
  for (const held of help.byPath) {
    if (ownerOf(held.specifier) !== owner || held.by === owner) continue;
    const file = held.to ?? held.specifier;
    files.add(file);
    if (held.names.length === 0) rows.push([held.specifier, '', held.at, held.line, `  ${held.specifier} — ${held.by} at ${held.at}:${held.line}`]);
    for (const taken of held.names) {
      pairs.add(`${file}\0${taken.name}`);
      rows.push([held.specifier, taken.name, taken.at, taken.line, `  ${held.specifier} — ${taken.name} — ${taken.by} at ${taken.at}:${taken.line}`]);
    }
  }
  rows.sort((a, b) => byCodeUnit(a[0], b[0]) || byCodeUnit(a[1], b[1]) || byCodeUnit(a[2], b[2]) || a[3] - b[3]);
  return { names: pairs.size, files: files.size, lines: rows.map((row) => row[4]) };
}

/** `N names from M of its files`, counted. */
export function counted(surface: { readonly names: number; readonly files: number }): string {
  return `${surface.names} ${surface.names === 1 ? 'name' : 'names'} from ${surface.files} of its files`;
}

/** The packages that declare no entry and that another package imports a file of, in code-unit order. */
export function unenteredImported(help: Help): readonly string[] {
  const owners = new Set(help.byPath.filter((held) => held.by !== ownerOf(held.specifier)).map((held) => ownerOf(held.specifier)));
  return [...owners].sort(byCodeUnit);
}

function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
