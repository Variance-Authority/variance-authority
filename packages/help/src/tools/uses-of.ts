/**
 * What `docs_uses` reads for a name: every declaration of it, each another
 * thing, chosen once by the `file` an asker names, and the sites of each one.
 *
 * The Help value holds the imports that cross a package; the rest are read
 * off the source index, out of the file that declares the name. The index
 * follows each `export … from` that passes it on, so an import through a
 * barrel is listed and the barrel is not, and a same-named export of another
 * file is another declaration, whose sites are read and kept apart.
 */

// compass: variance-authority.report.agent-surface

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Documented, Entry, Help, Opening, Use } from '@variance-authority/package/help';
import { askedOnce } from './asked-once.js';
import { type PathSite, how, ownerOf, sitesByPath } from './by-path.js';
import { isPackage, specifierOf } from './find.js';
import { answering, answers, keyOf, says } from './declaration-key.js';
import { searchIndexOf } from '../snapshot.js';
import { type IndexedUse, type Within, importsOf } from './unpublished.js';

/**
 * A site, how it names the module it imports when that is a file path, the
 * name it takes when that is known, and the lines of its file that use what
 * its import binds, when the source index read them.
 */
export type Site = Use & { readonly how?: string; readonly name?: string; readonly lines?: readonly number[] };

/**
 * The sites that import a name, and the ones that may read it and are no use
 * of it: a read off the module's `default`, which holds the name only when the
 * module is CommonJS, and the module passed on whole, where the reading does
 * not follow it. Only `certain` is counted as places that import the name.
 */
export function sureness(sites: readonly Site[]): { readonly certain: readonly Site[]; readonly off: readonly Site[]; readonly whole: readonly Site[] } {
  return {
    certain: sites.filter((use) => use.through?.whole !== true && use.through?.throughDefault !== true),
    off: sites.filter((use) => use.through?.throughDefault === true),
    whole: sites.filter((use) => use.through?.whole === true && use.through.throughDefault !== true),
  };
}

type Published = readonly [Documented, Opening, Entry];

/**
 * One published declaration: the binding a file declares, by its file and its
 * declared name, and every entry that publishes it. A barrel and a subpath that
 * pass one declaration on are two doors to one thing; two files that declare
 * the name are two, and so are two bindings of one file, which an entry doing
 * `export { greet as salute }` beside the file's own `salute` makes.
 */
interface PublishedDeclaration {
  readonly at: string;
  readonly line: number;
  /** The name its file exports it under, which a door may publish under another; its named one when the file exports it as `default` too. */
  readonly declared: string;
  /** Every name its file exports it under, `declared` among them. */
  readonly spellings: readonly string[];
  /** The entries that publish it, the one the workspace imports it by most first. */
  readonly doors: readonly Published[];
}

/**
 * Every published declaration of a name, by the name an entry publishes or the
 * name the declaring file exports it under, from the package asked for when
 * one was, the one whose leading door the workspace imports most first. The
 * package stage carries which declaration each entry reaches, so nothing here
 * walks the exports again. Equal counts fall to the published name and subpath
 * by code unit, then to the declaring file, so the order never follows the
 * order directories were read in.
 */
function publishedDeclarations(help: Help, root: string | undefined, name: string, wanted: string | undefined): readonly PublishedDeclaration[] {
  const rows = searchIndexOf(help).rows;
  const doors = rows.publishedCandidates(name, answering(help, root, name))
    .flatMap((row) => {
      const [held, opening, entry] = rows.published(row);
      const declared = { at: entry.at, name: entry.declared };
      if (!(says(entry.name, name) || answers(help, root, declared, name)) || (wanted !== undefined && !isPackage(held, opening, wanted))) return [];
      const door: Published = [held, opening, rows.entry(row)];
      return [[door, keyOf(help, root, declared)] as const];
    })
    .sort(([left], [right]) => byDoor(left, right));
  const declarations = new Map<string, { at: string; line: number; declared: string; spellings: readonly string[]; doors: Published[] }>();
  for (const [door, { named, spellings }] of doors) {
    const [, , entry] = door;
    const key = `${entry.at}\0${named}`;
    const one = declarations.get(key);
    if (one === undefined) declarations.set(key, { at: entry.at, line: entry.line, declared: named, spellings, doors: [door] });
    else one.doors.push(door);
  }
  return [...declarations.values()].sort((left, right) => byDoor(left.doors[0]!, right.doors[0]!) || codeUnitOrder(left.at, right.at) || codeUnitOrder(left.declared, right.declared));
}

/** The door the workspace imports by most first, then by published name and subpath in code-unit order. */
function byDoor([left, leftDoor, a]: Published, [right, rightDoor, b]: Published): number {
  return b.usedBy.length - a.usedBy.length || b.uses - a.uses || codeUnitOrder(left.name, right.name) || codeUnitOrder(leftDoor.subpath, rightDoor.subpath);
}

/**
 * Whether a use the source index resolved is one `wanted` answers for. Asked
 * for one specifier of a package, an import through another specifier of that
 * package is that door's, not this one's; a relative import, and any import
 * when the package is asked for by name, is the declaration's own.
 */
function throughDoor(use: IndexedUse, wanted: string | undefined): boolean {
  if (wanted === undefined) return true;
  const owner = ownerOf(wanted);
  if (owner === wanted || use.specifier.startsWith('.')) return true;
  return ownerOf(use.specifier) !== owner || use.specifier === wanted;
}

/**
 * Every site of one declaration, across every door it is published from,
 * without duplicates. A line the Help value records in a file that passes the
 * name on, and that the source index does not read as an import of it, is the
 * re-export, which is no use.
 */
function sitesOf(found: readonly Published[], byPath: readonly Site[], within: readonly Site[], passing: Within | undefined): readonly Site[] {
  const seen = new Set<string>();
  const sites: Site[] = [];
  const through = passing !== undefined && 'through' in passing ? new Set(passing.through) : new Set<string>();
  // The lines a binding is used on are the index's, joined to the site the Help value recorded by its file and line.
  const indexed = new Map<string, readonly number[] | undefined>(passing !== undefined && 'uses' in passing ? passing.uses.map((use) => [`${use.at}:${use.line}`, use.lines] as const) : []);

  const recorded = [...found.flatMap(([, opening, entry]) => [...entry.sites, ...entry.throughDefault, ...opening.whole]), ...byPath];
  for (const [index, use] of [...recorded, ...within].entries()) {
    const key = `${use.at}:${use.line}`;
    if (seen.has(key) || (index < recorded.length && through.has(use.at) && !indexed.has(key))) continue;
    seen.add(key);
    const lines = indexed.get(key);
    sites.push(lines === undefined || 'lines' in use ? use : { ...use, lines });
  }
  return sites;
}

/** {@link importsOf} once per generation, for the answer and the look that ask it of one file, in either order. */
const importsOfOnce = askedOnce((_help: Help, root: string | undefined, files: string, name: string): Within => importsOf(root, files.split('\0'), name));

/**
 * Every file that makes a declaration published, for the look at an answer that
 * teaches it: each entry opening it, and each barrel passing it on by the walk
 * {@link sitesOfPublished} makes for that answer.
 */
function publishingFiles(help: Help, root: string | undefined, published: readonly PublishedDeclaration[]): readonly string[] {
  return published.flatMap((one) => [
    ...one.doors.map(([, opening]) => opening.source),
    ...one.spellings.flatMap((name) => {
      const read = importsOfOnce(help, root, one.at, name);
      return 'through' in read ? read.through : [];
    }),
  ]);
}

/**
 * Every import of one binding out of `files` under any name its file exports
 * it by: `import greet from` and `import { greet } from` are imports of one
 * declaration. A line two names reach is one use.
 */
function importsOfEvery(help: Help, root: string | undefined, files: readonly string[], names: readonly string[]): Within {
  const reads = names.map((one) => importsOfOnce(help, root, files.join('\0'), one));
  const unread = reads.find((read) => 'unread' in read);
  if (unread !== undefined || reads.length === 1) return unread ?? reads[0]!;
  const read = reads.filter((one) => 'uses' in one);
  const once = <T extends { readonly at: string; readonly line: number }>(all: readonly T[]): readonly T[] => [...new Map(all.map((one) => [`${one.at}:${one.line}`, one] as const)).values()];
  // One statement can import the binding under two of its names, `import greet, { greet as g2 }`: each name's lines are its uses.
  const joined = new Map<string, IndexedUse>();
  for (const use of read.flatMap((one) => one.uses)) {
    const key = `${use.at}:${use.line}`;
    const held = joined.get(key);
    const lines = [...new Set([...(held?.lines ?? []), ...(use.lines ?? [])])].sort((a, b) => a - b);
    joined.set(key, held === undefined ? use : { ...held, ...(held.lines === undefined && use.lines === undefined ? {} : { lines }) });
  }
  return {
    uses: [...joined.values()],
    through: [...new Set(read.flatMap((one) => one.through))],
    namespaces: read.flatMap((one) => one.namespaces),
    inFile: once(read.flatMap((one) => one.inFile)),
  };
}

/**
 * The sites of one declaration: the imports by path that resolved to one of
 * its files, the imports the source index read out of them, and the lines of
 * the declaring file that use it there.
 */
function sitesOfOne(help: Help, root: string | undefined, names: readonly string[], wanted: string | undefined, found: readonly Published[], files: readonly string[], byPath: readonly Site[]) {
  const read = files.length === 0 ? undefined : importsOfEvery(help, root, files, names);
  const unread = read !== undefined && 'unread' in read ? read.unread : undefined;
  const within = read !== undefined && 'uses' in read ? read.uses.filter((use) => throughDoor(use, wanted)) : undefined;
  const inFile: readonly Use[] = read !== undefined && 'inFile' in read ? read.inFile : [];
  return { sites: sitesOf(found, byPath, within ?? [], read), unread, within, inFile, namespaces: read !== undefined && 'namespaces' in read ? read.namespaces : [] };
}

/** Whether an import by path resolved to one of the files in `to`. */
const resolvedTo = (site: PathSite, to: ReadonlySet<string>): boolean => site.held.to !== undefined && to.has(site.held.to);

/** An import by path as a site, saying how it names the file. */
const asSite = (site: PathSite): Site => ({ ...site.taken, how: how(site) });

/**
 * The sites of the published declaration of `name` in `at`, the ones `uses`
 * lists when asked for that name and that file, and why the source index did
 * not read the imports within its package, when it did not, with the files
 * that publish it. The row's door, `name` imported from `specifier`, picks the
 * declaration: two bindings of one file published under one name by two entries
 * are two rows.
 */
export function publishedSitesOf(help: Help, root: string | undefined, name: string, at: string, specifier: string): { readonly sites: readonly Site[]; readonly publishing: readonly string[]; readonly unread?: string } {
  const one = publishedDeclarations(help, root, name, undefined).find(
    (held) => held.at === at && held.doors.some(([published, opening, entry]) => entry.name === name && specifierOf(published, opening) === specifier),
  );
  if (one === undefined) return { sites: [], publishing: [] };
  const { sites, unread } = sitesOfPublished(help, root, name, undefined, one, sitesByPath(help, name, undefined));
  const publishing = publishingFiles(help, root, [one]);
  return unread === undefined ? { sites, publishing } : { sites, publishing, unread };
}

/**
 * The sites of one published declaration, the one assembly `uses` and the
 * count beside a search row both read: the imports by path of the name its
 * file declares it by that resolved to its file, then what {@link sitesOfOne}
 * reads out of that file under every name it exports it by. `paths` are the
 * imports by path of `name`.
 */
function sitesOfPublished(help: Help, root: string | undefined, name: string, wanted: string | undefined, one: PublishedDeclaration, paths: readonly PathSite[]) {
  const to = new Set([one.at]);
  const byPath = (one.declared === name ? paths : sitesByPath(help, one.declared, wanted)).filter((site) => resolvedTo(site, to)).map(asSite);
  return { byPath, ...sitesOfOne(help, root, one.spellings, wanted, one.doors, [one.at], byPath) };
}

/** The package a file is in, as the place `by` names it; none for a file no manifest holds, which `by` names as empty. */
export function packageOf(by: string | undefined): string | undefined {
  return by === '' ? undefined : by;
}
