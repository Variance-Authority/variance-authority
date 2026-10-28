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
import type { DeclaredName } from '@variance-authority/sense';
import { type PathSite, how, ownerOf, sitesByPath } from './by-path.js';
import { declarations } from './declared.js';
import { FoundNothing, entriesNamed, isPackage, nowhere, specifierOf } from './find.js';
import { type Members, membersOf } from './members.js';
import { originOf } from './passed-on.js';
import { type IndexedUse, type Within, exportsNamed, importsOf, indexMissing } from './unpublished.js';
import { declaredIn, membersIn, notDeclaredIn } from './uses-declarations.js';
import { importsUnread, outsideOf } from './uses-names.js';

/**
 * A site, how it names the module it imports when that is a file path, and
 * the name it takes when that is known.
 */
export type Site = Use & { readonly how?: string; readonly name?: string };

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
 * Every declaration of a name: published by an entry, exported, kept to its
 * file, or a member; `exporting` holds the files that only pass it on too.
 */
interface Declarations {
  readonly published: readonly Published[];
  readonly exporting: readonly Named[];
  readonly kept: readonly DeclaredName[];
  readonly members: Members;
  /** Files whose declarations were not read. */
  readonly undeclared: readonly string[];
}

/** One exported declaration no entry publishes, the files passing it on, and the sites of it. */
export interface Namesake {
  readonly exported: readonly Named[];
  readonly sites: readonly Site[];
  readonly inFile: readonly Use[];
}

function declarationsOf(help: Help, root: string | undefined, name: string, wanted: string | undefined): Declarations {
  const published = entriesNamed(help, name).filter(([held, opening]) => wanted === undefined || isPackage(held, opening, wanted));
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
    all.published.some(([, , entry]) => entry.at === asked) ||
    all.exporting.some((held) => held.at === asked && held.declaration !== undefined) ||
    all.kept.some((one) => one.at === asked) ||
    all.members.declared.some((one) => one.at === asked);
  if (declares) return asked;
  const passing = all.exporting.find((held) => held.at === asked);
  const origin = passing === undefined ? undefined : originOf(root, passing)?.at;
  return origin ?? all.published.find(([, opening]) => opening.source === asked)?.[2].at ?? asked;
}

/** The declarations in `file`, or all of them when none is named. */
function chosen(all: Declarations, file: string | undefined): Declarations {
  if (file === undefined) return all;
  return {
    ...all,
    published: all.published.filter(([, , entry]) => entry.at === file),
    exporting: all.exporting.filter((held) => held.at === file || held.declaration === undefined),
    kept: all.kept.filter((one) => one.at === file),
    members: membersIn(all.members, file),
  };
}

/**
 * The exports by the declaration each reaches: an export that declares the
 * name is its own, one that passes it on joins the declaration it passes on,
 * or stands alone when the walk ends short of one. The declaring export comes
 * first in each, and the declarations in code-unit order of their file.
 */
function exportGroups(root: string | undefined, exporting: readonly Named[]): readonly Group[] {
  const groups = new Map<string, Named[]>();
  for (const held of exporting) {
    const at = held.declaration !== undefined ? held.at : (originOf(root, held)?.at ?? held.at);
    groups.set(at, [...(groups.get(at) ?? []), held]);
  }
  const declaringFirst = (left: Named, right: Named): number => Number(left.declaration === undefined) - Number(right.declaration === undefined);
  return [...groups]
    .sort(([left], [right]) => codeUnitOrder(left, right))
    .map(([at, held]) => ({ at, exported: [...held].sort(declaringFirst) }));
}

/** The exports that reach one declaration, by the file it is in. */
interface Group {
  readonly at: string;
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
  const indexed = new Set(passing !== undefined && 'uses' in passing ? passing.uses.map((use) => `${use.at}:${use.line}`) : []);

  const recorded = [...found.flatMap(([, opening, entry]) => [...entry.sites, ...entry.throughDefault, ...opening.whole]), ...byPath];
  for (const [index, use] of [...recorded, ...within].entries()) {
    const key = `${use.at}:${use.line}`;
    if (seen.has(key) || (index < recorded.length && through.has(use.at) && !indexed.has(key))) continue;
    seen.add(key);
    sites.push(use);
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

/**
 * Every site of the name for the declaration asked about, and each other
 * declaration's apart, and what was read to find them, or the refusal.
 */
export function usesOf(help: Help, input: Readonly<Record<string, unknown>>, root: string | undefined, spell: Spelling) {
  const name = stringArg(input, 'name');
  const wanted = typeof input['package'] === 'string' && input['package'] !== '' ? input['package'] : undefined;

  // A name declared outside the workspace is imported here whether or not the workspace declares one too.
  const outside = outsideOf(root, name, wanted);
  // An `export … from` out of a module outside the workspace passes on that
  // module's declaration: it is one of the imports from outside, not a declaration here.
  const passing = new Set('sites' in outside ? outside.passing : []);
  const read = declarationsOf(help, root, name, wanted);
  const all = { ...read, exporting: read.exporting.filter((held) => !passing.has(`${held.at}:${held.line}`)) };
  // Each declaration is another thing, so a named file answers for its own alone.
  const asked = declaredIn(input);
  const file = asked === undefined ? undefined : reached(root, all, asked);
  const { published: found, exporting, kept, members, undeclared } = chosen(all, file);
  // Every file declaring a thing by the name, whichever one `file` names.
  const files = [
    ...all.published.map(([, , entry]) => entry.at),
    ...all.exporting.filter((held) => held.declaration !== undefined).map((held) => held.at),
    ...all.kept.map((one) => one.at),
    ...all.members.declared.map((one) => one.at),
  ];

  // A published name is one declaration; each other file's export of it is another.
  const declared = new Set(found.map(([, , entry]) => entry.at));
  // Beside a published one, only an export that declares the name is another declaration.
  const groups = exportGroups(root, exporting).filter(
    (group) =>
      !declared.has(group.at) && (file !== undefined ? group.at === file : found.length === 0 || group.exported[0]!.declaration !== undefined),
  );
  const primary = found.length > 0 ? undefined : groups[0];
  const others = found.length > 0 ? groups : groups.slice(1);
  const exported = primary?.exported ?? [];

  // An import by path joins the declaration whose file it resolved to; one no
  // file is known for joins the declaration asked about when it is unpublished.
  const paths = sitesByPath(help, name, wanted);
  const everyFile = new Set([...declared, ...groups.flatMap((group) => group.exported.map((held) => held.at))]);
  const claimed = (site: PathSite): boolean => site.held.to !== undefined && everyFile.has(site.held.to);
  const pathSites = (to: ReadonlySet<string>, stray: boolean): readonly Site[] =>
    paths.filter((site) => (site.held.to !== undefined && to.has(site.held.to)) || (stray && !claimed(site))).map((site) => ({ ...site.taken, how: how(site) }));
  const byPath = found.length > 0 ? pathSites(declared, false) : pathSites(new Set(exported.map((held) => held.at)), file === undefined);

  const namesakes: readonly Namesake[] = others.map((group) => {
    const at = new Set(group.exported.map((held) => held.at));
    const one = sitesOfOne(root, name, wanted, [], [...at], pathSites(at, false));
    return { exported: group.exported, sites: one.sites, inFile: one.inFile };
  });
  const { keptSites, keptInFile } = keptUses(root, name, kept);
  const shared = { name, found, exported, namesakes, byPath, members, kept, keptSites, keptInFile, file, files, outside };
  if (found.length === 0 && byPath.length === 0 && exported.length === 0) {
    if (kept.length > 0 || members.declared.length > 0 || ('sites' in outside && outside.sites.length > 0 && file === undefined)) {
      return { ...shared, sites: [] as readonly Site[], unread: undefined, within: undefined, inFile: [] as readonly Use[], undeclared, origin: undefined, inside: [] as readonly string[] };
    }
    if (file !== undefined && files.length > 0) throw new FoundNothing(notDeclaredIn(name, file, files));
    // The answer `symbol` gives: what was read and declares nothing, and where else the name may be.
    // A file whose imports were not read may import it from outside the workspace.
    throw new FoundNothing([nowhere(help, name, wanted, root, members, undefined, spell), ...importsUnread(outside)].join(' '));
  }
  // A published name is read from its entry file as well as its declaration:
  // an entry that renames it, `export { greet as salute }`, passes on a name
  // the declaring file never exports.
  const local = found.length === 0 ? exported.map((held) => held.at) : found.flatMap(([, opening, entry]) => [entry.at, opening.source]);
  const { sites, unread, within, inFile, namespaces } = sitesOfOne(root, name, wanted, found, [...new Set(local)], byPath);
  if (exported.length > 0 && unread !== undefined && byPath.length === 0) throw new Error(indexMissing(name, exported, unread));

  const [only] = exported;
  // The answer names one export's place, so only a name exported once is followed.
  const origin = only === undefined || exported.length > 1 ? undefined : originOf(root, only);
  return { ...shared, sites, unread, within, inFile, undeclared: [] as readonly string[], origin, inside: publishedInside(help, namespaces) };
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
