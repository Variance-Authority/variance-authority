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
import type { Spelling } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import type { Documented, Entry, Help, Named, Opening, Use } from '@variance-authority/package/help';
import { everyEntry } from '@variance-authority/package/help';
import type { DeclaredName } from '@variance-authority/sense';
import { type PathSite, how, ownerOf, sitesByPath } from './by-path.js';
import { declarations } from './declared.js';
import { FoundNothing, isPackage, nowhere, specifierOf } from './find.js';
import { type Members, membersOf } from './members.js';
import { boundOf, originOf } from './passed-on.js';
import { type IndexedUse, type Within, exportsNamed, importsOf, indexMissing } from './unpublished.js';
import { declaredIn, membersIn, notDeclaredIn } from './uses-declarations.js';

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
export interface PublishedDeclaration {
  readonly at: string;
  readonly line: number;
  /** The name its file declares it by, which a door may publish under another. */
  readonly declared: string;
  /** The entries that publish it, the one the workspace imports it by most first. */
  readonly doors: readonly Published[];
}

/**
 * Every published declaration of a name, by the name an entry publishes or the
 * name a file declares, from the package asked for when one was, the one whose
 * leading door the workspace imports most first. Equal counts fall to the
 * published name and subpath by code unit, then to the declaring file, so the
 * order never follows the order directories were read in.
 */
export function publishedDeclarations(help: Help, root: string | undefined, name: string, wanted: string | undefined): readonly PublishedDeclaration[] {
  // A door that spells another name publishes the name only when its file declares it.
  const declaring = new Set(exportsNamed(help, name, undefined).filter((held) => held.declaration !== undefined).map((held) => held.at));
  const doors = [...everyEntry(help)]
    .filter(([held, opening, entry]) => (entry.name === name || declaring.has(entry.at)) && (wanted === undefined || isPackage(held, opening, wanted)))
    .sort(byDoor);
  const declarations = new Map<string, { at: string; line: number; declared: string; doors: Published[] }>();
  for (const door of doors) {
    const [, opening, entry] = door;
    const bound = boundOf(root, { at: opening.source, name: entry.name });
    const at = bound?.at ?? entry.at;
    const declared = bound?.name ?? entry.name;
    if (entry.name !== name && declared !== name) continue;
    const key = `${at}\0${declared}`;
    const one = declarations.get(key);
    if (one === undefined) declarations.set(key, { at, line: bound?.line ?? entry.line, declared, doors: [door] });
    else one.doors.push(door);
  }
  return [...declarations.values()].sort((left, right) => byDoor(left.doors[0]!, right.doors[0]!) || codeUnitOrder(left.at, right.at) || codeUnitOrder(left.declared, right.declared));
}

/** The door the workspace imports by most first, then by published name and subpath in code-unit order. */
function byDoor([left, leftDoor, a]: Published, [right, rightDoor, b]: Published): number {
  return b.usedBy.length - a.usedBy.length || b.uses - a.uses || codeUnitOrder(left.name, right.name) || codeUnitOrder(leftDoor.subpath, rightDoor.subpath);
}

/**
 * Every declaration of a name: published by an entry, exported, kept to its
 * file, or a member; `exporting` holds the files that only pass it on too.
 */
interface Declarations {
  readonly published: readonly PublishedDeclaration[];
  readonly exporting: readonly Named[];
  readonly kept: readonly DeclaredName[];
  readonly members: Members;
  /** Files whose declarations were not read. */
  readonly undeclared: readonly string[];
}

/**
 * One declaration beside the one answered first: the entries that publish it,
 * or the exports that reach it when none does, the package it is declared in,
 * and the sites of it.
 */
export interface Namesake {
  readonly published: readonly Published[];
  /** The declaration the entries publish, when one does. */
  readonly declaration: PublishedDeclaration | undefined;
  readonly exported: readonly Named[];
  readonly home: string | undefined;
  readonly sites: readonly Site[];
  readonly inFile: readonly Use[];
}

function declarationsOf(help: Help, root: string | undefined, name: string, wanted: string | undefined): Declarations {
  const published = publishedDeclarations(help, root, name, wanted);
  const read = declarations(root, name);
  const kept = 'refused' in read ? [] : read.names.filter((one) => wanted === undefined || one.by === wanted);
  return {
    published,
    exporting: exportsNamed(help, name, wanted),
    kept,
    members: membersOf(root, name, wanted),
    undeclared: 'refused' in read ? [] : read.unread,
  };
}

/**
 * The file a declaration asked for by `asked` is in: `asked` when it declares
 * the name, else the declaration it passes the name on from, as a barrel or
 * an entry does with `export … from`.
 */
function reached(root: string | undefined, all: Declarations, asked: string): string {
  const declares =
    all.published.some((one) => one.at === asked) ||
    all.exporting.some((held) => held.at === asked && held.declaration !== undefined) ||
    all.kept.some((one) => one.at === asked) ||
    all.members.declared.some((one) => one.at === asked);
  if (declares) return asked;
  const passing = all.exporting.find((held) => held.at === asked);
  const origin = passing === undefined ? undefined : originOf(root, passing)?.at;
  return origin ?? all.published.find((one) => one.doors.some(([, opening]) => opening.source === asked))?.at ?? asked;
}

/** The declarations in `file`, or all of them when none is named. */
function chosen(all: Declarations, file: string | undefined): Declarations {
  if (file === undefined) return all;
  return {
    ...all,
    published: all.published.filter((one) => one.at === file),
    exporting: all.exporting.filter((held) => held.at === file || held.declaration === undefined),
    kept: all.kept.filter((one) => one.at === file),
    members: membersIn(all.members, file),
  };
}

/**
 * The exports by the declaration each reaches, its file and the name it is
 * declared by there: an export that declares the name is its own, one that
 * passes it on joins the declaration it passes on, or stands alone when the
 * walk ends short of one. The declaring export comes first in each, and the
 * declarations in code-unit order of their file, then of their declared name.
 */
function exportGroups(root: string | undefined, exporting: readonly Named[]): readonly Group[] {
  const groups = new Map<string, { at: string; declared: string; exported: Named[] }>();
  for (const held of exporting) {
    const origin = held.declaration !== undefined ? undefined : originOf(root, held);
    const at = origin?.at ?? held.at;
    const declared = origin?.name ?? held.name;
    const key = `${at}\0${declared}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { at, declared, exported: [held] });
    else group.exported.push(held);
  }
  const declaringFirst = (left: Named, right: Named): number => Number(left.declaration === undefined) - Number(right.declaration === undefined);
  return [...groups.values()]
    .sort((left, right) => codeUnitOrder(left.at, right.at) || codeUnitOrder(left.declared, right.declared))
    .map((group) => ({ ...group, exported: [...group.exported].sort(declaringFirst) }));
}

/** The exports that reach one declaration, by its file and the name it is declared by there. */
interface Group {
  readonly at: string;
  readonly declared: string;
  readonly exported: readonly Named[];
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

/**
 * The sites of one declaration: the imports by path that resolved to one of
 * its files, the imports the source index read out of them, and the lines of
 * the declaring file that use it there.
 */
function sitesOfOne(root: string | undefined, name: string, wanted: string | undefined, found: readonly Published[], files: readonly string[], byPath: readonly Site[]) {
  const read = files.length === 0 ? undefined : importsOf(root, files, name);
  const unread = read !== undefined && 'unread' in read ? read.unread : undefined;
  const within = read !== undefined && 'uses' in read ? read.uses.filter((use) => throughDoor(use, wanted)) : undefined;
  const inFile: readonly Use[] = read !== undefined && 'inFile' in read ? read.inFile : [];
  return { sites: sitesOf(found, byPath, within ?? [], read), unread, within, inFile, namespaces: read !== undefined && 'namespaces' in read ? read.namespaces : [] };
}

/**
 * The doors that publish a name only inside a namespace, `shout.greet` by
 * `@acme/lib` for an entry doing `export * as shout`: each namespace the
 * source index followed it into, written at a file an entry opens.
 */
function publishedInside(help: Help, namespaces: ReturnType<typeof sitesOfOne>['namespaces']): readonly string[] {
  const doors = help.packages.flatMap((held) => held.openings.map((opening) => [opening.source, specifierOf(held, opening)] as const));
  return [
    ...new Set(
      namespaces.flatMap((inside) =>
        doors.filter(([source]) => source === inside.at).map(([, door]) => `\`${[inside.name, ...inside.members].join('.')}\` by ${door}`),
      ),
    ),
  ];
}

/** The package a file is in, as the place `by` names it; none for a file no manifest holds, which `by` names as empty. */
export function packageOf(by: string | undefined): string | undefined {
  return by === '' ? undefined : by;
}

/**
 * Every site of the name for the declaration asked about, and each other
 * declaration's apart, and what was read to find them, or the refusal.
 */
export function usesOf(help: Help, input: Readonly<Record<string, unknown>>, root: string | undefined, spell: Spelling) {
  const name = stringArg(input, 'name');
  const wanted = typeof input['package'] === 'string' && input['package'] !== '' ? input['package'] : undefined;

  const all = declarationsOf(help, root, name, wanted);
  // Each declaration is another thing, so a named file answers for its own alone.
  const asked = declaredIn(input);
  const file = asked === undefined ? undefined : reached(root, all, asked);
  const { published, exporting, kept, members, undeclared } = chosen(all, file);
  // The declaration answered first, through every door that publishes it; each other published one is a namesake.
  const [lead, ...rest] = published;
  const found = lead?.doors ?? [];
  // Every file declaring a thing by the name, whichever one `file` names.
  const files = [
    ...all.published.map((one) => one.at),
    ...all.exporting.filter((held) => held.declaration !== undefined).map((held) => held.at),
    ...all.kept.map((one) => one.at),
    ...all.members.declared.map((one) => one.at),
  ];

  // A published declaration is one thing however many entries publish it; each other binding is another.
  const isPublished = (group: Group): boolean => published.some((one) => one.at === group.at && one.declared === group.declared);
  // Beside a published one, only an export that declares the name is another declaration.
  const groups = exportGroups(root, exporting).filter(
    (group) => !isPublished(group) && (file !== undefined ? group.at === file : found.length === 0 || group.exported[0]!.declaration !== undefined),
  );
  const primary = found.length > 0 ? undefined : groups[0];
  const others = found.length > 0 ? groups : groups.slice(1);
  const exported = primary?.exported ?? [];

  // An import by path of the name joins the declaration its file declares by
  // that name; one no file is known for joins the declaration asked about when
  // it is unpublished. A published declaration declared by another name is
  // imported by path by that name.
  const paths = sitesByPath(help, name, wanted);
  const everyFile = new Set([...published.filter((one) => one.declared === name).map((one) => one.at), ...groups.flatMap((group) => group.exported.map((held) => held.at))]);
  const claimed = (site: PathSite): boolean => site.held.to !== undefined && everyFile.has(site.held.to);
  const pathSites = (to: ReadonlySet<string>, stray: boolean, of: readonly PathSite[] = paths): readonly Site[] =>
    of.filter((site) => (site.held.to !== undefined && to.has(site.held.to)) || (stray && !claimed(site))).map((site) => ({ ...site.taken, how: how(site) }));
  const publishedPaths = (one: PublishedDeclaration): readonly Site[] =>
    pathSites(new Set([one.at]), false, one.declared === name ? paths : sitesByPath(help, one.declared, wanted));
  const byPath = lead !== undefined ? publishedPaths(lead) : pathSites(new Set(exported.map((held) => held.at)), file === undefined);

  const namesakes: readonly Namesake[] = [
    ...rest.map((other) => {
      const one = sitesOfOne(root, other.declared, wanted, other.doors, [other.at], publishedPaths(other));
      return { published: other.doors, declaration: other, exported: [], home: homeOf(help, other), sites: one.sites, inFile: one.inFile };
    }),
    ...others.map((group) => {
      const at = new Set(group.exported.map((held) => held.at));
      const one = sitesOfOne(root, name, wanted, [], [...at], pathSites(at, false));
      return { published: [], declaration: undefined, exported: group.exported, home: packageOf(group.exported[0]?.by), sites: one.sites, inFile: one.inFile };
    }),
  ];
  const { keptSites, keptInFile } = keptUses(root, name, kept);
  const shared = { name, lead, found, exported, namesakes, byPath, members, kept, keptSites, keptInFile, file, files };
  if (found.length === 0 && byPath.length === 0 && exported.length === 0) {
    if (kept.length > 0 || members.declared.length > 0) {
      return { ...shared, home: undefined as string | undefined, sites: [] as readonly Site[], unread: undefined, within: undefined, inFile: [] as readonly Use[], undeclared, origin: undefined, inside: [] as readonly string[] };
    }
    if (file !== undefined && files.length > 0) throw new FoundNothing(notDeclaredIn(name, file, files));
    // The answer `symbol` gives: what was read and declares nothing, and where else the name may be.
    throw new FoundNothing(nowhere(help, name, wanted, root, members, undefined, spell));
  }
  // A published declaration is read out of its file by the name it is declared by; the walk follows every door that renames it.
  const local = lead === undefined ? [...new Set(exported.map((held) => held.at))] : [lead.at];
  const { sites, unread, within, inFile, namespaces } = sitesOfOne(root, lead?.declared ?? name, wanted, found, local, byPath);
  if (exported.length > 0 && unread !== undefined && byPath.length === 0) throw new Error(indexMissing(name, exported, unread));

  // Inside is the declaring file's package, which a re-exporting door is not.
  const home = lead !== undefined ? homeOf(help, lead) : packageOf(exported[0]?.by);
  const [only] = exported;
  // The answer names one export's place, so only a name exported once is followed.
  const origin = only === undefined || exported.length > 1 ? undefined : originOf(root, only);
  return { ...shared, home, sites, unread, within, inFile, undeclared: [] as readonly string[], origin, inside: publishedInside(help, namespaces) };
}

/** The package a published declaration is declared in, which a re-exporting door is not. */
function homeOf(help: Help, declaration: PublishedDeclaration): string | undefined {
  return packageOf(help.exported.find((held) => held.at === declaration.at)?.by ?? declaration.doors[0]![0].name);
}

/**
 * The imports the source index resolved to the declarations a file keeps to
 * itself, and the lines of their own files that use them.
 */
function keptUses(root: string | undefined, name: string, kept: readonly DeclaredName[]) {
  const taken = kept.length === 0 ? undefined : importsOf(root, [...new Set(kept.map((one) => one.at))], name);
  const keptSites: readonly IndexedUse[] = taken !== undefined && 'uses' in taken ? taken.uses : [];
  const keptInFile: readonly Use[] = taken !== undefined && 'inFile' in taken ? taken.inFile : [];
  return { keptSites, keptInFile };
}

/** What `docs_uses` read for one question. */
export type Answer = ReturnType<typeof usesOf>;
