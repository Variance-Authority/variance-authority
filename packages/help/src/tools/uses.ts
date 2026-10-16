import type { FileSet, Tool } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import type { Documented, Entry, Help, Opening, Use } from '@variance-authority/package/help';
import type { DeclaredName } from '@variance-authority/sense';
import { how, ownerOf, sitesByPath } from './by-path.js';
import { entriesNamed, isPackage, unfound } from './find.js';
import { declarations, reachSentences, unreadLine } from './declared.js';
import { limitOf, notShown } from './limit.js';
import { type Members, membersOf, places, routes } from './members.js';
import { originOf, passesOn } from './passed-on.js';
import { type IndexedUse, UNCOUNTED, type Within, exportedAt, exportsNamed, importsOf, indexMissing } from './unpublished.js';

/**
 * `docs_uses` — how this repository actually writes a name.
 *
 * The second of the two questions somebody has about a symbol, and the one a
 * signature cannot answer. `docs_symbol` says what the thing is supposed to be;
 * this says where it is already being done, which is the answer that survives a
 * doc comment going stale, and the only one that carries the conventions nobody
 * wrote down.
 *
 * ## Nearest, by how much of the path is shared
 *
 * Sites come back ordered by how many leading path segments they share with
 * `from` — the file the asker is working in. Not import distance: this question
 * asks where a known name is imported, and its `from` only chooses which exact
 * sites to show first. The graph belongs to `docs_search`, where a start point
 * removes names outside a closure. Shared segments are readable off the two
 * strings. The claim here is the modest one it can support — *this import site
 * is written near the code you are in* — and a caller that passes no
 * `from` is told the sites in path order rather than a made-up ranking.
 *
 * ## A story is pointed at, not quoted
 *
 * A story or a test is a file written to show the thing being used, which is
 * what an example is, and both are named here with a line to open. What comes
 * back is the path, not the source. Serving the source would spend a context
 * window re-transmitting a file the caller can read in one cheap operation, and
 * it would answer with the file as it was when this reading was taken.
 *
 * ## A module held whole is named as such
 *
 * A name read off `import()` or off `import * as` is a site like any other, and
 * it is marked, because the line that reads the name is not the line that loads
 * it. An `import()` loads the module when that call runs, so whether the name
 * is there at all can depend on a path the program takes.
 *
 * ## An import by path is a site
 *
 * A name no entry publishes is still used when another package imports the file
 * that exports it. That import is listed like any other, saying whether it is a
 * deep import — past the entry its package declares — or an import from a
 * package that declares none.
 *
 * ## An import within the package is a site
 *
 * The Help value records the imports that cross a package. The rest are read
 * off the source index: every import that resolved to the file declaring the
 * name, or to a file that passes it on with `export … from`, which is followed
 * under the name it exports and is not itself a use. An import of the name
 * under another name says which. A name a file exports and no entry publishes
 * is answered from there alone. Asked for one specifier of a package, an
 * import through another specifier of it is left to that one.
 *
 * An index that is missing or does not read leaves the imports by package path
 * standing, and the answer says the rest were not read and why.
 *
 * ## A member is declared, not imported
 *
 * A method or property of an interface, a type literal or a class is reached
 * through a value, so no import names it, and this question, which answers by
 * imports, lists its declarations as well, each on its container: after the
 * imports when an export has the name too, alone when none does. The scan
 * records every member declaration with the file's parse, so reading them is a
 * lookup in the source index.
 *
 * Each declaration on a named container is followed by its uses: the lines
 * that read, write or destructure the member through a value whose type the
 * line writes as that container — an annotation, an `as`, a `satisfies`. The
 * type's name is joined to its declaration the way an import is, so two
 * containers that share a member's name each get their own uses, and a value
 * typed as neither is a use of neither. What a type checker would infer is
 * `docs_grep`'s: a text search over the files that import a declaring file,
 * which this answer names, with what a text match lets in and misses.
 */

/**
 * A site, how it names the module it imports when that is a file path, and
 * the name it takes when that is known.
 */
type Site = Use & { readonly how?: string; readonly name?: string };

/** How many leading path segments two files share. */
export function sharedSegments(left: string, right: string): number {
  const a = left.split('/');
  const b = right.split('/');

  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared;
}

/** Sites of one kind shown when `limit` is not said: how many are worth naming before the list stops being read. */
const SHOWN = 12;

function order(sites: readonly Site[], from: string | undefined): readonly Site[] {
  return [...sites].sort(
    (a, b) =>
      (from === undefined ? 0 : sharedSegments(from, b.at) - sharedSegments(from, a.at)) ||
      (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) ||
      a.line - b.line,
  );
}

/** The first `limit` sites of `name` under `heading`, each marked with the name it takes when a re-export renamed it. */
function listed(sites: readonly Site[], heading: string, name: string, limit: number): readonly string[] {
  if (sites.length === 0) return [];

  const shown = sites.slice(0, limit);
  const rest = sites.length - shown.length;
  const renamed = (use: Site): string => (use.name === undefined || use.name === name ? '' : ` (as ${use.name})`);
  return [
    '',
    heading,
    '',
    ...shown.map((use) => `${use.at}:${use.line} — ${use.by}${use.how ?? ''}${renamed(use)}${use.type ? ' (type only)' : ''}${held(use)}`),
    ...(rest > 0 ? [`… ${notShown(rest)}`] : []),
  ];
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

/** Where a name read off a module held whole was loaded, and when. */
function held(use: Use): string {
  if (use.through === undefined) return '';
  return use.through.kind === 'dynamic'
    ? ` (import() on line ${use.through.line})`
    : ` (namespace, line ${use.through.line})`;
}

/**
 * Every site of one name, across every door it is published from, without
 * duplicates. A line the Help value records in a file that passes the name on,
 * and that the source index does not read as an import of it, is the
 * re-export, which is no use.
 */
function sitesOf(
  found: readonly (readonly [Documented, Opening, Entry])[],
  byPath: readonly Site[],
  within: readonly Site[],
  passing: Within | undefined,
): readonly Site[] {
  const seen = new Set<string>();
  const sites: Site[] = [];
  const through = passing !== undefined && 'through' in passing ? new Set(passing.through) : new Set<string>();
  const indexed = new Set(passing !== undefined && 'uses' in passing ? passing.uses.map((use) => `${use.at}:${use.line}`) : []);

  const recorded = [...found.flatMap(([, , entry]) => entry.sites), ...byPath];
  for (const [index, use] of [...recorded, ...within].entries()) {
    const key = `${use.at}:${use.line}`;
    if (seen.has(key) || (index < recorded.length && through.has(use.at) && !indexed.has(key))) continue;
    seen.add(key);
    sites.push(use);
  }
  return sites;
}

export const uses: Tool<Help> = {
  name: 'docs_uses',
  description:
    'Every file:line in the workspace that imports one exported name, including reads through ' +
    '`import()` or `import * as`, marked with the line that loads the module, and imports that ' +
    'name the file by path, marked as such. Imports within the exporting package are read from the ' +
    'source index, through each `export … from` that passes the name on, marked `(as x)` where one renames it, so a ' +
    'name exported and not published is answered too. A member of an interface, a type literal or a class by that ' +
    'name is listed with its declarations, after the imports, each with the lines that read, write or destructure ' +
    'it through a value whose type is written as its container, and the docs_grep that finds the uses no line types. A top-level ' +
    'name a file declares and does not export is answered with where it is declared and who can reach it there. Stories ' +
    'and tests are listed apart. `from`, the file you are in, sorts sites by shared path; `limit` says how many sites of ' +
    'each kind are shown. A name only passed on with `export … from` is followed to the declaration it reaches.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The exported name or member name, matched exactly.' },
      package: { type: 'string', description: 'Only answer from this package, by name or by specifier. Optional.' },
      from: {
        type: 'string',
        description:
          'The file you are working in, relative to the workspace root. Sites written near it ' +
          'are listed first. This orders the sites and never removes one — every site of the ' +
          'name still comes back. Unlike `from` on docs_search, it is not a start point and no ' +
          'import graph is walked: nearness here is how many leading path segments two files ' +
          'share. Optional.',
      },
      limit: { type: 'integer', description: `Sites of each kind to show. ${SHOWN} when not said; the rest are counted.` },
    },
    required: ['name'],
    additionalProperties: false,
  },

  run(help, input, invocation) {
    const from = typeof input['from'] === 'string' && input['from'] !== '' ? input['from'] : undefined;
    const limit = limitOf(input, SHOWN);
    const answer = usesOf(help, input, invocation?.root);
    const { name, members, exported, found, byPath, kept } = answer;
    const declared = members.declared.length;
    // A name no file exports may be declared in a file whose declarations
    // were not read, so the answer names those files after what it found.
    const unread = unreadLine(answer.undeclared);
    if (kept.length > 0) {
      if (declared === 0) return [keptLine(name, kept), ...unread].join('\n');
      return [keptLine(name, kept), '', `\`${name}\` is a member too, declared in ${places(declared)}:`, ...memberLines(members, from, name, limit), ...unread].join('\n');
    }
    if (found.length === 0 && byPath.length === 0 && exported.length === 0) {
      return [`\`${name}\` is no exported name; it is a member, declared in ${places(declared)}:`, ...memberLines(members, from, name, limit), ...unread].join('\n');
    }
    const imports = imported(answer, from, limit);
    // An index the imports already said did not read is not said twice.
    if (declared === 0 && members.unread !== undefined && answer.unread === undefined) {
      return `${imports}\n\nMembers by this name were not read: ${members.unread}.`;
    }
    if (declared === 0) return imports;
    // The imports already said the order, so the members do not say it again.
    const lines = memberLines(members, from, name, limit).slice(1);
    return [imports, '', `\`${name}\` is a member too, declared in ${places(declared)}:`, ...lines].join('\n');
  },

  // Every file importing the name, at each line that does, or every file
  // declaring it as a member, read as `run` reads them; an index that did not
  // read leaves the imports within the package unread.
  files(help, input, invocation): FileSet {
    const { sites, unread, members, kept } = usesOf(help, input, invocation?.root);
    const files = new Map<string, number[]>();
    for (const site of [...sites, ...members.declared, ...members.used.flatMap((one) => one.uses), ...kept]) {
      files.set(site.at, [...new Set([...(files.get(site.at) ?? []), site.line])].sort((left, right) => left - right));
    }
    return { files, ...(unread === undefined ? {} : { unread: [`imports within the package: ${unread}`] }) };
  },
};

/** A name its files keep to themselves: where each declares it, and who can reach it from there. */
function keptLine(name: string, kept: readonly DeclaredName[]): string {
  if (kept.length === 1) {
    const one = kept[0]!;
    return `\`${name}\` is declared, not exported, at ${one.at}:${one.line}${reachSentences(one).clause}.`;
  }
  return [
    `\`${name}\` is declared, not exported, in ${kept.length} files:`,
    ...kept.map((one) => `  ${one.at}:${one.line}${reachSentences(one).clause}`),
  ].join('\n');
}

/**
 * The declarations of a member, then the uses of each one on a named
 * container, nearest first when `from` is said, and where the uses no line
 * types are read.
 */
function memberLines(members: Members, from: string | undefined, name: string, limit: number): readonly string[] {
  const nearest = from === undefined ? 'Path order; `from` sorts nearest first.' : `Nearest to ${from} first.`;
  const used = members.used.flatMap(({ declared, uses }) => {
    if (uses.length === 0) return [];
    const sites = uses.map(({ how: used, ...use }): Site => ({ ...use, by: use.by === '' ? used : `${use.by}, ${used}` }));
    return listed(order(sites, from), `\`${declared.by}.${name}\`, declared at ${declared.at}:${declared.line}, is used in ${places(uses.length)}:`, name, limit);
  });
  // A declaration no line reaches through its type is named once, with the others like it.
  const unused = members.used.filter(({ uses }) => uses.length === 0).map(({ declared }) => `\`${declared.by}\` at ${declared.at}:${declared.line}`);
  const none = unused.length === 0 ? [] : ['', `No line uses \`${name}\` through a value whose type is written as ${unused.join(', ')}.`];
  return [nearest, ...listed(order(members.declared, from), 'Member declarations:', name, limit), ...used, ...none, ...routes(name, members)];
}

/** The imports of an exported name, as `uses` has always answered them. */
function imported(answer: ReturnType<typeof usesOf>, from: string | undefined, limit: number): string {
  const { name, found, exported, sites, unread, within, origin } = answer;
  // An export that only passes the name on is followed to the declaration.
  const passed = origin === undefined ? '' : `, which ${passesOn(origin)}`;
  if (sites.length === 0 && exported.length > 0) {
    return `\`${name}\` is exported, without being published, at ${exportedAt(exported)}${passed}, and nothing in this workspace imports it; ${UNCOUNTED}.`;
  }
  if (sites.length === 0 && unread !== undefined) {
    return `\`${name}\` is published and no other package imports it; the imports within its own package are read from the source index, and ${unread}.`;
  }
  if (sites.length === 0) {
    return `\`${name}\` is published and nothing in this workspace imports it; ${UNCOUNTED}. docs_symbol has its signature and what is written above it.`;
  }

  const sorted = order(sites, from);
  const stories = sorted.filter((use) => use.kind === 'story');
  const tests = sorted.filter((use) => use.kind === 'test');
  const source = sorted.filter((use) => use.kind === 'source');

  const nearest =
    from === undefined
      ? 'Path order; `from` sorts nearest first.'
      : `Nearest to ${from} first.`;

  const dynamic = sites.filter((use) => use.through?.kind === 'dynamic').length;
  const loaded = dynamic === 0 ? '.' : `, ${dynamic} through import(), which loads the module when the call runs.`;
  const published =
    found.length > 0 ? '' : exported.length > 0 ? `, and no entry publishes it; it is exported at ${exportedAt(exported)}${passed}` : ', and no entry publishes it';
  return [
    `\`${name}\` is imported in ${sites.length} ${sites.length === 1 ? 'place' : 'places'}${published}${loaded}`,
    nearest,
    ...listed(stories, 'Stories:', name, limit),
    ...listed(tests, 'Tests:', name, limit),
    ...listed(source, 'Source:', name, limit),
    // The imports by package path are in the Help value; the rest are not.
    ...(unread === undefined ? [] : [`\nImports that do not name a package path are not listed: ${unread}.`]),
    ...(within === undefined ? [] : [`\n${UNCOUNTED.charAt(0).toUpperCase()}${UNCOUNTED.slice(1)}.`]),
  ].join('\n');
}

/**
 * Every site of the name, and what was read to find them, or the refusal.
 *
 * The Help value holds the imports that cross a package; the rest are read
 * off the source index, out of the file that declares the name. The index
 * follows each `export … from` that passes it on, so an import through a
 * barrel is listed and the barrel is not, and a same-named export of
 * another file is not this name.
 */
function usesOf(help: Help, input: Readonly<Record<string, unknown>>, root: string | undefined) {
  const name = stringArg(input, 'name');
  const wanted = typeof input['package'] === 'string' && input['package'] !== '' ? input['package'] : undefined;

  const found = entriesNamed(help, name).filter(
    ([published, held]) => wanted === undefined || isPackage(published, held, wanted),
  );
  // An import by path joins a published name only when the index says it
  // resolved to the file that declares it; one no entry publishes is joined by name.
  const declared = new Set(found.map(([, , entry]) => entry.at));
  const byPath: Site[] = sitesByPath(help, name, wanted)
    .filter((site) => found.length === 0 || (site.held.to !== undefined && declared.has(site.held.to)))
    .map((site) => ({ ...site.taken, how: how(site) }));
  const exported = found.length === 0 ? exportsNamed(help, name, wanted) : [];
  // The scan records every member declaration, so reading the ones by this
  // name is a lookup in the source index, made whether or not an export has it.
  const members: Members = membersOf(root, name, wanted);
  if (found.length === 0 && byPath.length === 0 && exported.length === 0) {
    // A name no file exports may be one a file declares and keeps to itself,
    // which the source index holds with the file's parse, as well as a member.
    const read = declarations(root, name);
    const kept = 'refused' in read ? [] : read.names.filter((one) => wanted === undefined || one.by === wanted);
    const undeclared = 'refused' in read ? [] : read.unread;
    if (kept.length > 0 || members.declared.length > 0) {
      return { name, found, exported, byPath, sites: [], unread: undefined, within: undefined, members, kept, undeclared, origin: undefined };
    }
    const unreadMembers = members.unread === undefined ? '' : ` Members by this name were not read: ${members.unread}.`;
    throw new Error([`${unfound(help, name, wanted)}${unreadMembers}`, ...unreadLine(undeclared)].join(' '));
  }
  // A published name is read from its entry file as well as its declaration:
  // an entry that renames it, `export { greet as salute }`, passes on a name
  // the declaring file never exports.
  const local =
    found.length === 0
      ? [...new Set(exported.map((held) => held.at))]
      : [...new Set(found.flatMap(([, opening, entry]) => [entry.at, opening.source]))];
  const read = local.length === 0 ? undefined : importsOf(root, local, name);
  const unread = read !== undefined && 'unread' in read ? read.unread : undefined;
  const within = read !== undefined && 'uses' in read ? read.uses.filter((use) => throughDoor(use, wanted)) : undefined;
  if (exported.length > 0 && unread !== undefined && byPath.length === 0) throw new Error(indexMissing(name, exported, unread));

  const sites = sitesOf(found, byPath, within ?? [], read);
  const [only] = exported;
  // The answer names one export's place, so only a name exported once is followed.
  const origin = only === undefined || exported.length > 1 ? undefined : originOf(root, only);
  return { name, found, exported, byPath, sites, unread, within, members, kept: [] as readonly DeclaredName[], undeclared: [] as readonly string[], origin };
}
