import { codeUnitOrder } from '@variance-authority/core/segment';
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

/** What other packages import by path from one package: the counts a heading states, and a line per name. */
export interface Surface {
  /** Distinct names, each counted once per file that exports it. */
  readonly names: number;
  readonly files: number;
  readonly lines: readonly string[];
  /**
   * The first name the lines take, other than the whole module, and the
   * specifier it is taken from, for the narrower question about one name.
   */
  readonly first?: { readonly name: string; readonly specifier: string };
  /** The specifier with the most lines, ties in code-unit order, when they are under more than one: the narrower question about one specifier. */
  readonly busiest?: string;
}

/**
 * What other packages import by path from each package that declares no entry,
 * grouped by that package in one walk. A package's own imports of itself are
 * not what it is imported for, and are left out.
 */
export function takenByPath(help: Help): ReadonlyMap<string, readonly Deep[]> {
  const taken = new Map<string, Deep[]>();
  for (const held of help.byPath) {
    const owner = ownerOf(held.specifier);
    if (held.by === owner) continue;
    let imports = taken.get(owner);
    if (imports === undefined) taken.set(owner, (imports = []));
    imports.push(held);
  }
  return taken;
}

/** The names and files `imports` take: a name counted once per file that exports it, a file once. */
export function tally(imports: readonly Deep[]): { readonly names: number; readonly files: number } {
  const pairs = new Set<string>();
  const files = new Set<string>();
  for (const held of imports) {
    const file = held.to ?? held.specifier;
    files.add(file);
    for (const taken of held.names) pairs.add(`${file}\0${taken.name}`);
  }
  return { names: pairs.size, files: files.size };
}

/**
 * The specifier the most of `specifiers` are, ties in code-unit order, when
 * they are more than one specifier: the narrower question about one of them.
 */
export function busiestOf(specifiers: readonly string[]): string | undefined {
  const under = new Map<string, number>();
  for (const specifier of specifiers) under.set(specifier, (under.get(specifier) ?? 0) + 1);
  if (under.size < 2) return undefined;
  return [...under].sort((a, b) => b[1] - a[1] || codeUnitOrder(a[0], b[0]))[0]![0];
}

/**
 * What other packages import from a package that declares no entry: one line
 * per name each import takes, in specifier, name, file and line order, and the
 * counts a heading states. With `specifier`, only the imports written as that
 * specifier.
 */
export function surfaceByPath(help: Help, owner: string, specifier?: string): Surface {
  const imports = (takenByPath(help).get(owner) ?? []).filter((held) => specifier === undefined || held.specifier === specifier);
  const rows: (readonly [string, string, string, number, string])[] = [];
  for (const held of imports) {
    if (held.names.length === 0) rows.push([held.specifier, '', held.at, held.line, `  ${held.specifier} — ${held.by} at ${held.at}:${held.line}`]);
    for (const taken of held.names) {
      rows.push([held.specifier, taken.name, taken.at, taken.line, `  ${held.specifier} — ${taken.name} — ${taken.by} at ${taken.at}:${taken.line}`]);
    }
  }
  rows.sort((a, b) => codeUnitOrder(a[0], b[0]) || codeUnitOrder(a[1], b[1]) || codeUnitOrder(a[2], b[2]) || a[3] - b[3]);
  const row = rows.find((candidate) => isName(candidate[1]));
  const first = row === undefined ? undefined : { name: row[1], specifier: row[0] };
  const busiest = busiestOf(rows.map((candidate) => candidate[0]));
  return {
    ...tally(imports),
    lines: rows.map((candidate) => candidate[4]),
    ...(first === undefined ? {} : { first }),
    ...(busiest === undefined ? {} : { busiest }),
  };
}

/** `N names from M of its files`, counted. */
export function counted(surface: { readonly names: number; readonly files: number }): string {
  return `${surface.names} ${surface.names === 1 ? 'name' : 'names'} from ${surface.files} of its files`;
}

/**
 * Every package other packages import by path, counted in one walk of the
 * imports: what is taken from each package that declares no entry, and how
 * many imports reach past the entry of each package that declares one. Most
 * taken first, then in code-unit order.
 *
 * One walk, because the counts are per package and the imports are not. In a
 * repository whose packages declare no entry there are a hundred thousand
 * imports, and a walk of all of them per package is quadratic.
 */
export function countsByPath(help: Help): {
  readonly unentered: readonly (readonly [string, { readonly names: number; readonly files: number }])[];
  readonly deep: readonly (readonly [string, number])[];
} {
  const deep = new Map<string, number>();
  for (const held of help.deep) {
    const owner = ownerOf(held.specifier);
    deep.set(owner, (deep.get(owner) ?? 0) + 1);
  }
  const unentered = [...takenByPath(help)].map(([owner, imports]) => [owner, tally(imports)] as const);
  return {
    unentered: unentered.sort((a, b) => b[1].names - a[1].names || codeUnitOrder(a[0], b[0])),
    deep: [...deep].sort((a, b) => b[1] - a[1] || codeUnitOrder(a[0], b[0])),
  };
}

/** What a package that declares an entry is told about the imports past it. */
export const REACHING =
  'Either the manifest has stopped describing what the package is used for, or something is reaching into its internals';

/**
 * The imports past the entry of `owner`, in specifier, file and line order.
 * With `specifier`, only the imports written as that specifier.
 */
export function reachingPast(help: Help, owner: string, specifier?: string): readonly Deep[] {
  return importsByPath(help, specifier ?? owner)
    .filter(([, deep]) => deep)
    .map(([held]) => held)
    .sort((left, right) => codeUnitOrder(left.specifier, right.specifier) || codeUnitOrder(left.at, right.at) || left.line - right.line);
}

/** A name a reader could ask `uses` about: not the whole module, not a side effect. */
export const isName = (name: string): boolean => name !== '' && name !== '*';
