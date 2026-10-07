import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Deep, Documented, Help, Taken } from '@variance-authority/package/help';
import { requested } from '@variance-authority/package/help';

/**
 * Names imported by the path of a file, or through an entry no file was read
 * for, rather than through an entry the reading opened.
 *
 * Three kinds, and they read differently. An import past every specifier a
 * package declares is deep: the package says what it opens and the importer
 * names a file behind it. A package that declares no entry has nothing to be
 * past, so every import of it names a file and none of them is deep. An import
 * of a specifier the manifest declares, which this reading could not follow to
 * a source file, names the entry exactly and is not deep either: the names it
 * takes are known, the file that declares them is not. All three are the only
 * record of what is used, so all three answer `uses` and `symbol`; the words
 * say which kind each site is.
 */

/** How an import names what it takes, when no entry the reading opened carries it. */
export type PathKind = 'deep' | 'byPath' | 'unfollowed';

/** One name one import takes by path. */
export interface PathSite {
  readonly held: Deep;
  readonly taken: Taken;
  readonly kind: PathKind;
  /** The package the specifier names. */
  readonly owner: string;
}

/** What a package whose declared entry leads to no source file is told about it. */
export const UNFOLLOWED = 'this reading could not follow to a source file, such as a build output the checkout does not hold';

/** The package a specifier names. */
export function ownerOf(specifier: string): string {
  const key = requested(specifier);
  return key.slice(0, key.indexOf(' '));
}

/** Every import by path, deep ones first, narrowed to a package or a specifier when one is given. */
export function importsByPath(help: Help, within?: string): readonly (readonly [Deep, PathKind])[] {
  const all = [
    ...help.deep.map((held) => [held, 'deep'] as const),
    ...help.byPath.map((held) => [held, 'byPath'] as const),
    ...help.unfollowed.map((held) => [held, 'unfollowed'] as const),
  ];
  return within === undefined
    ? all
    : all.filter(([held]) => ownerOf(held.specifier) === within || held.specifier === within);
}

/** Every place `name` is taken by path. */
export function sitesByPath(help: Help, name: string, within?: string): readonly PathSite[] {
  const sites: PathSite[] = [];
  for (const [held, kind] of importsByPath(help, within)) {
    for (const taken of held.names) {
      if (taken.name === name) sites.push({ held, taken, kind, owner: ownerOf(held.specifier) });
    }
  }
  return sites;
}

/** How a site names what it imports, as a suffix to `<by>`. */
export function how(site: Pick<PathSite, 'held' | 'kind'>): string {
  if (site.kind === 'deep') return `, deep import of ${site.held.specifier}`;
  if (site.kind === 'byPath') return `, by path from ${site.held.specifier}`;
  return `, through ${site.held.specifier}, an entry this reading could not follow to a source file`;
}

/**
 * Whether a published package declares an entry its reading opened nothing of:
 * its manifest declares one, as {@link Documented.entry} records, and no file of it was read.
 */
export function unfollowedEntry(published: Documented): boolean {
  return published.entry && published.openings.length === 0;
}

/**
 * The imports of an entry `owner` declares that this reading could not follow,
 * in specifier, file and line order. A package's own imports of itself are left out.
 */
export function unfollowedOf(help: Help, owner: string): readonly Deep[] {
  return help.unfollowed
    .filter((held) => held.by !== owner && ownerOf(held.specifier) === owner)
    .sort((left, right) => codeUnitOrder(left.specifier, right.specifier) || codeUnitOrder(left.at, right.at) || left.line - right.line);
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

/** One file other packages import by path, as a package's name answers for it. */
export interface FileTaken {
  /** The specifiers the file is imported as, the one the most files write first, ties in code-unit order. */
  readonly specifiers: readonly string[];
  /** Distinct names taken from the file. */
  readonly names: number;
  /** Distinct files that import it. */
  readonly importers: number;
  /**
   * The name the most files take through the first specifier, ties in
   * code-unit order, for the narrower question about one name; none when every
   * import takes the whole module.
   */
  readonly name?: string;
}

/**
 * `imports` counted per file they reach, the file the most files import first,
 * then the one with the most names, then in code-unit order of its first
 * specifier. One row per file, however many sites import it: the sites are
 * what asking for one specifier lists.
 */
export function perFile(imports: readonly Deep[]): readonly FileTaken[] {
  const files = new Map<string, Deep[]>();
  for (const held of imports) {
    const file = held.to ?? held.specifier;
    let group = files.get(file);
    if (group === undefined) files.set(file, (group = []));
    group.push(held);
  }
  const rows = [...files.values()].map((group): FileTaken => {
    const specifiers = [...importersBy(group, (held) => [held.specifier])].sort(mostFirst).map(([specifier]) => specifier);
    const through = group.filter((held) => held.specifier === specifiers[0]);
    const name = [...importersBy(through, (held) => held.names.map((taken) => taken.name).filter(isName))].sort(mostFirst)[0]?.[0];
    return {
      specifiers,
      names: new Set(group.flatMap((held) => held.names.map((taken) => taken.name))).size,
      importers: new Set(group.map((held) => held.at)).size,
      ...(name === undefined ? {} : { name }),
    };
  });
  return rows.sort((a, b) => b.importers - a.importers || b.names - a.names || codeUnitOrder(a.specifiers[0]!, b.specifiers[0]!));
}

/** For each key `keys` gives an import, the files that import it. */
function importersBy(imports: readonly Deep[], keys: (held: Deep) => readonly string[]): Map<string, Set<string>> {
  const under = new Map<string, Set<string>>();
  for (const held of imports) {
    for (const key of keys(held)) {
      let at = under.get(key);
      if (at === undefined) under.set(key, (at = new Set()));
      at.add(held.at);
    }
  }
  return under;
}

/** The most importing files first, ties in code-unit order. */
const mostFirst = (a: readonly [string, ReadonlySet<string>], b: readonly [string, ReadonlySet<string>]): number =>
  b[1].size - a[1].size || codeUnitOrder(a[0], b[0]);

/** The imports written as one specifier, counted per name as asking for that specifier answers for them. */
export interface ByName {
  /** Distinct names taken, the whole module not among them. */
  readonly names: number;
  /** One row per name, and one for the whole module when an import takes no name. */
  readonly lines: readonly string[];
  /** The name the most files take, for the narrower question about its sites; none when no import takes a name. */
  readonly first?: string;
}

/**
 * `imports` counted per name: each name with the number of files importing it,
 * the most first, ties in code-unit order. A side-effect import and a module
 * held whole take no name, and are counted on a row of their own after the
 * names it ties with. One row per name, however many sites take it: the sites
 * of one name are what `uses` lists.
 */
export function byName(imports: readonly Deep[]): ByName {
  const whole = new Set<string>();
  const named = importersBy(imports, (held) => {
    if (!held.names.some((taken) => isName(taken.name))) whole.add(held.at);
    return held.names.map((taken) => taken.name).filter(isName);
  });
  const rows: (readonly [string | undefined, number])[] = [...named].map(([name, files]) => [name, files.size] as const);
  if (whole.size > 0) rows.push([undefined, whole.size]);
  rows.sort((a, b) => b[1] - a[1] || (a[0] === undefined ? 1 : b[0] === undefined ? -1 : codeUnitOrder(a[0], b[0])));
  const first = rows.find((row) => row[0] !== undefined)?.[0];
  return {
    names: named.size,
    lines: rows.map(([name, files]) => `  ${name ?? 'the whole module, no name read'} — imported by ${files} ${files === 1 ? 'file' : 'files'}`),
    ...(first === undefined ? {} : { first }),
  };
}

/** `N names from M of its files`, counted. */
export function counted(surface: { readonly names: number; readonly files: number }): string {
  return `${surface.names} ${surface.names === 1 ? 'name' : 'names'} from ${surface.files} of its files`;
}

/**
 * Every package other packages import by path, counted in one walk of the
 * imports: what is taken from each package that declares no entry, how many
 * imports reach past the entry of each package that declares one, and how many
 * name an entry this reading could not follow. Most taken first, then in
 * code-unit order. A package's own imports of an entry it declares are left out.
 *
 * One walk, because the counts are per package and the imports are not. In a
 * repository whose packages declare no entry there are a hundred thousand
 * imports, and a walk of all of them per package is quadratic.
 */
export function countsByPath(help: Help): {
  readonly unentered: readonly (readonly [string, { readonly names: number; readonly files: number }])[];
  readonly deep: readonly (readonly [string, number])[];
  readonly unfollowed: readonly (readonly [string, number])[];
} {
  const deep = new Map<string, number>();
  for (const held of help.deep) {
    const owner = ownerOf(held.specifier);
    deep.set(owner, (deep.get(owner) ?? 0) + 1);
  }
  const unfollowed = new Map<string, number>();
  for (const held of help.unfollowed) {
    const owner = ownerOf(held.specifier);
    if (held.by !== owner) unfollowed.set(owner, (unfollowed.get(owner) ?? 0) + 1);
  }
  const unentered = [...takenByPath(help)].map(([owner, imports]) => [owner, tally(imports)] as const);
  return {
    unentered: unentered.sort((a, b) => b[1].names - a[1].names || codeUnitOrder(a[0], b[0])),
    deep: mostImports(deep),
    unfollowed: mostImports(unfollowed),
  };
}

/** Per-package import counts, most first, ties in code-unit order. */
const mostImports = (counts: ReadonlyMap<string, number>): readonly (readonly [string, number])[] =>
  [...counts].sort((a, b) => b[1] - a[1] || codeUnitOrder(a[0], b[0]));

/** What a package that declares an entry is told about the imports past it. */
export const REACHING =
  'Either the manifest has stopped describing what the package is used for, or something is reaching into its internals';

/**
 * The imports past the entry of `owner`, in specifier, file and line order.
 * With `specifier`, only the imports written as that specifier.
 */
export function reachingPast(help: Help, owner: string, specifier?: string): readonly Deep[] {
  return importsByPath(help, specifier ?? owner)
    .filter(([, kind]) => kind === 'deep')
    .map(([held]) => held)
    .sort((left, right) => codeUnitOrder(left.specifier, right.specifier) || codeUnitOrder(left.at, right.at) || left.line - right.line);
}

/** A name a reader could ask `uses` about: not the whole module, not a side effect. */
export const isName = (name: string): boolean => name !== '' && name !== '*';
